# Logseq DB API — Learnings

Hard-won notes from wiring this clipper to Logseq's **local HTTP API** against a
**DB graph**. Empirically verified **2026-05-25** against a running graph (HTTP
API server on `127.0.0.1:12315`). Treat the upstream docs
([`db_properties_guide.md`](https://github.com/logseq/logseq/blob/master/libs/guides/db_properties_guide.md),
[`db_properties_references.md`](https://github.com/logseq/logseq/blob/master/libs/guides/db_properties_references.md))
as the contract; this is "what actually happens over the wire," including things
the docs don't mention.

> Scope: **DB graphs only.** File graphs store properties as `key:: value` text and behave differently.

---

## 1. The transport

- One endpoint: `POST {baseUrl}/api` (default `http://127.0.0.1:12315`), header
  `Authorization: Bearer <token>`, body `{"method": "...", "args": [...]}`.
- The method string is split on `.` and dispatched to the `@logseq/libs` SDK as
  if called from inside a plugin — so `logseq.Editor.upsertBlockProperty`,
  `logseq.DB.datascriptQuery`, etc. all work.
- CORS is wide open (`origin: *`) since logseq/logseq#8651.
- Many methods return `null` / an empty body on success — tolerate empty responses.
- **Reads are ~25 ms; writes (`createPage` especially) can take >10 s** and may
  look like they hang — the page still gets created. Use generous timeouts; a
  slow write is not a failure, and queued requests serialize behind a slow one.

---

## 2. The big gotcha: over HTTP, the caller identity is `_test_plugin`

A property referenced by **bare name** resolves/creates under the *calling
plugin's* id — and **over the HTTP API the caller id is `_test_plugin`**:

```
getProperty('url')   → :plugin.property._test_plugin/url      (NOT the shared one!)
getProperty('title') → :plugin.property._test_plugin/title
```

So a **bare-name write silently forks your value into `_test_plugin`** instead of
landing on the shared property. Demonstrated by writing both forms to one page
and reading it back:

```
upsertBlockProperty(uuid, 'url', 'A')                                # bare name
upsertBlockProperty(uuid, ':plugin.property.logseq-zotero/url', 'B') # full ident

getPageProperties(uuid) →
  {
    ":plugin.property.logseq-zotero/url": "B",   # the shared property  ✓
    ":plugin.property._test_plugin/url":  "A"    # a separate junk prop ✗
  }
```

**Takeaway: always write by the full `:db/ident`. Never by bare name.**

---

## 3. Reading vs. writing a property

- **`getProperty(fullIdent)` is a safe existence check** — returns the property
  entity or `null`, and does **not** create on miss
  (`getProperty(':plugin.property.logseq-zotero/authors')` → `null` when absent).
- **Writing by full ident to a property that already exists succeeds**,
  regardless of which plugin owns it. (This is why a clipper can populate
  Zotero-owned properties.)
- **Writing to an ident that doesn't exist fails:**
  ```
  upsertBlockProperty(uuid, ':plugin.property.logseq-zotero/does-not-exist', 'x')
  → {"error": "Plugins can only upsert its own properties"}
  ```
  i.e. the HTTP caller may **create** properties only in its own `_test_plugin`
  namespace, but may **set values** on any *existing* property by ident.
- **Corollary / design rule:** the extension never creates properties. A separate
  plugin owns schema setup; the clipper discovers idents and only sets values,
  skipping (and warning about) anything the tag doesn't already carry.

---

## 4. Namespace conflicts are allowed

Two properties can share a title/name in different namespaces — e.g.
`:plugin.property.logseq-zotero/url` (title "URL") and
`:plugin.property._test_plugin/url` (title "url") coexisted happily. **A name is
not a unique key; only the `:db/ident` is.**

---

## 5. What a property entity looks like

`getProperty(':plugin.property.logseq-zotero/url')`:

```json
{
  "ident": ":plugin.property.logseq-zotero/url",
  "id": 378,
  "name": "url",
  "title": "URL",
  ":logseq.property/type": "url",
  "cardinality": ":db.cardinality/one",
  "valueType": ":db.type/ref",
  ":logseq.property/hide-empty-value": true
}
```

**JSON-key quirk:** the HTTP layer *simplifies* some keyword keys
(`:db/ident`→`ident`, `:block/title`→`title`, `:db/cardinality`→`cardinality`,
`:block/uuid`→`uuid`) but *keeps* others namespaced (`:logseq.property/type`,
`:logseq.property.class/properties`, `:logseq.property.class/extends`). Keyword
**values** keep their leading colon (`":db.cardinality/one"`,
`":plugin.property.logseq-zotero/url"`). `getPageProperties` keys are the
colon-prefixed idents.

---

## 6. Writing values, by property type

The property's `:logseq.property/type` + cardinality decide the value shape:

| `:logseq.property/type` | how to write the value |
|---|---|
| `default`, `url`, `number`, `checkbox` | the scalar directly (string / number / bool) |
| `node` | a page **`.id`** (entity id — **not** `.uuid`). `cardinality :many` → an array of ids in one call; `:one` → a single id |
| `date` | a **journal page** id — `createJournalPage(...)` then write the returned `page.id` |

Notes:
- For `date`, anchor to **local noon** (`YYYY-MM-DDT12:00:00`). A bare
  `YYYY-MM-DD` is parsed as midnight **UTC**, which rolls to the previous day in
  any negative-offset timezone.
- `IBatchBlock.properties` is **silently ignored on DB graphs** — create the
  block tree, then set properties in follow-up `upsertBlockProperty` calls.
- Native blockquotes can't be set over the JSON API: a quote is the keyword
  property `:logseq.property.node/display-type = :quote`, and the value arrives
  as a string and fails Logseq's `keyword?` validation. Use a clean block.

---

## 7. Tags are classes; properties arrive via inheritance

- A tag is a **class entity**: a user-created tag is `:user.class/<Name>-<hash>`;
  a plugin-created one is `:plugin.class.<plugin-id>/<Name>`.
- It carries properties through `:logseq.property.class/properties` (a list of
  property entities) and **inherits** more through
  `:logseq.property.class/extends` (a list of parent classes).
- In our graph, `#WebReference` (`:user.class/Web-…`) has **no own properties** —
  it `extends` the `:plugin.class.logseq-zotero/Zotero` class, whose
  `:logseq.property.class/properties` are the Zotero fields. That inheritance is
  how a `#WebReference` page ends up carrying `title` / `authors` / `url` / etc.,
  and why those share Zotero's idents (queries union across both tags).

---

## 8. Discovering a tag's full schema in one query

Recursive `extends` pull — `{... ...}` recurses the *enclosing* pattern, so each
class in the chain contributes its own `:logseq.property.class/properties`; it
terminates at a class with no `extends` (the "Root Tag"):

```clojure
[:find (pull ?t [:block/title
                 {:logseq.property.class/properties
                    [:db/ident :block/title :logseq.property/type :db/cardinality]}
                 {:logseq.property.class/extends ...}])
 :where [?t :block/title "WebReference"]]
```

Returns the tag's own + all inherited properties, each with `ident`, `title`,
`:logseq.property/type`, and `cardinality`. The clipper matches its fields to
these **by display title** and writes to the returned `ident`. See
`src/utils/logseq-schema-index.ts`.

---

## Appendix — a reusable curl probe

```bash
export LOGSEQ_URL=http://127.0.0.1:12315
export TOKEN=...   # Logseq → Settings → Features → HTTP APIs Server → auth token

lsq () {  # usage: lsq <method> '<json-args-array>'
  curl -sS -X POST "$LOGSEQ_URL/api" \
    -H "Authorization: Bearer $TOKEN" -H 'Content-Type: application/json' \
    -d "{\"method\":\"$1\",\"args\":${2:-[]}}" | python3 -m json.tool
}

# Inspect a property by ident:
lsq logseq.Editor.getProperty '[":plugin.property.logseq-zotero/url"]'
# Discover a tag's full (inherited) schema:
lsq logseq.DB.datascriptQuery '["[:find (pull ?t [:block/title {:logseq.property.class/properties [:db/ident :block/title :logseq.property/type :db/cardinality]} {:logseq.property.class/extends ...}]) :where [?t :block/title \"WebReference\"]]"]'
# List every property in the graph (ident + title + type):
lsq logseq.DB.datascriptQuery '["[:find (pull ?p [:db/ident :block/title :logseq.property/type]) :where [?p :logseq.property/type _]]"]'
```
