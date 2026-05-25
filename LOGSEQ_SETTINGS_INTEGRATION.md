# Logseq settings integration — reading plugin settings over HTTP

Status: **decided — Option A.** The Logseq-side configuration (the "Logseq
Capture" knobs + the clip tag) moves out of the extension and into the
schema-provider plugin's settings UI. The extension **reads** that config from
Logseq over the HTTP API at runtime and never assumes its contents.

This doc has two parts:

- **Part 1 — Extension side** (this repo): what to build to read + consume the
  plugin's settings.
- **Part 2 — Plugin side** (handoff): what the plugin dev must add — the 3-tab
  settings restructure, the dedicated web tag, and the exact settings-key
  contract the extension reads.

---

## Background — can the extension read plugin settings over HTTP? Yes.

The worry was that plugin settings live in `logseq.settings` (a per-plugin
store) and the HTTP caller is namespaced `_test_plugin`, so a settings read
would return the wrong namespace. **That limitation does not apply here.**
Verified live against a running DB graph on 2026-05-25:

```bash
POST http://127.0.0.1:12315/api
Authorization: Bearer <token>
{"method":"logseq.App.getStateFromStore",
 "args":[["plugin/installed-plugins","logseq-zotero","settings"]]}
```

returns **exactly** the plugin's live `logseq.settings` object (`zotTag`,
`propertyPreset`, `pageProps`, `tagRules`, …). It returned `zotTag: "Zotero"`
(the configured value), not the schema default `"Reference"` — so this reads the
**live** store, and edits made in the plugin's UI (via `updateSettings`) are
immediately visible to the extension.

`getStateFromStore` is a real, public SDK method:

```ts
// @logseq/libs/dist/LSPlugin.d.ts:339
getStateFromStore: <T = any>(path: string | Array<string>) => Promise<T>;
```

The **array-path form is part of the documented signature.** What is *not*
formally documented is the state key `plugin/installed-plugins` — that's an
internal re-frame app-db path. That's the one soft spot, and Part 1 neutralizes
it with a fallback chain.

### Gotchas (all verified empirically)

- The path must be a **vector** — `[["plugin/installed-plugins","<id>","settings"]]`
  (note the nested array). The flat string form `"a/b/c"` returns `null`.
- The plugin-id segment is **kebab-case** — the plugin's real `id`
  (`logseq-zotero`). The camelCase form seen in JSON output (`logseqZotero`)
  returns `null`.
- Works even when the plugin is **disabled** (disabled plugins stay in
  `installed-plugins` with settings intact). Only an *uninstalled* plugin, or a
  closed/unreachable Logseq, fails — those hit the fallback.

### The read/write asymmetry — important

The extension can **read** plugin settings but **cannot write** them. Over HTTP
the caller is `_test_plugin`, so `updateSettings` would write to the wrong
namespace (same rule that governs property writes). This makes the arrangement
**one-way**: editing happens only in the plugin's UI; the extension consumes.
That matches the plan.

### Connection config stays extension-side (chicken-and-egg)

The base URL + API token are how the extension *reaches* Logseq — it can't read
anything from the plugin until it has them. So `logseqApiBaseUrl` and
`logseqApiToken` **remain extension settings** and are never moved to the
plugin. Only the *capture/clip* config moves.

### Why Option A over storing settings as graph data

The alternative was to have the plugin mirror its settings into the graph as a
config page + block properties, which the extension would read via
`datascriptQuery` (fully documented, and bidirectional — the extension could
write values back). We rejected it: it makes the plugin do real work
serializing settings it doesn't itself consume, and we only need a one-way read.
Option A is zero plugin-write work and the failure mode is fully contained by
the fallback chain. (If a future need arises for the extension to *edit* these
settings, revisit the graph-data approach — it's the only one that supports
extension-side writes.)

---

## Part 1 — Extension side (this repo)

### 1. Single source of truth for the plugin id

The plugin will be renamed in the next few days, then stay stable. Define its id
**once** and import it everywhere. Put it in `logseq-shared` next to the tag
fallback — that package is already the repo's home for cross-cutting Logseq
constants, and keeping it there preserves the clean repo-root for upstream
merges.

```ts
// logseq-shared/src/schema.ts  (export it from logseq-shared/src/index.ts)

/**
 * The id of the Logseq plugin that owns the shared schema + web-clip settings.
 * SINGLE SOURCE OF TRUTH — when the plugin is renamed, change this one line.
 *
 * Must be the plugin's real `id` (kebab-case) — the key used in
 * getStateFromStore(['plugin/installed-plugins', <id>, 'settings']).
 */
export const LOGSEQ_PLUGIN_ID = 'logseq-zotero'
```

Nothing else in the repo may hardcode the id. (`logseq-shared` already exports
`WEB_CLIPPING_TAG` from `schema.ts:13` and re-exports via `src/index.ts`, so this
slots in with no new wiring.)

### 2. New `LogseqAPI` method

`src/utils/logseq-api.ts` already has a low-level dispatcher:

```ts
async call<T = unknown>(method: string, args: readonly unknown[] = []): Promise<T>
```

Add one method that uses it. Note the **vector path** and the kebab-case id (the
constant is already kebab-case):

```ts
import { LOGSEQ_PLUGIN_ID } from 'logseq-shared'

/**
 * The schema-provider plugin's live `logseq.settings`, read from the app store.
 * Returns null if the plugin is uninstalled / Logseq unreachable / the internal
 * state path ever changes — callers must fall back. See resolveLogseqCaptureSettings.
 */
async getPluginSettings<T = Record<string, unknown>>(): Promise<T | null> {
  return this.call<T | null>(
    'logseq.App.getStateFromStore',
    [['plugin/installed-plugins', LOGSEQ_PLUGIN_ID, 'settings']],
  )
}
```

### 3. Settings resolver — fetch → map → cache → defaults

New module `src/utils/logseq-remote-settings.ts`. This is the resilience layer
that makes the "internal path key" risk a non-issue: a successful live read is
**written through** to a `chrome.storage.local` cache, and any failure falls
back to last-known-good, then to hardcoded defaults. Worst case the extension
runs on stale-but-valid config; it never breaks.

```ts
import { LogseqAPI } from './logseq-api'
import { WEB_CLIPPING_TAG } from 'logseq-shared'
import type { LogseqCaptureSettings } from '../types/types'

const CACHE_KEY = 'logseqCaptureSettingsCache'

// Last-resort defaults — keep in sync with storage-utils defaults
// (the clip tag falls back to WEB_CLIPPING_TAG only when nothing can be read).
const DEFAULTS: LogseqCaptureSettings = {
  clippingTag: WEB_CLIPPING_TAG,
  capturePageContent: true,
  pageContentBlockName: 'Page Content',
  highlightsBlockName: 'Highlights',
  useHeadingMarkers: false,
  populatePageTags: false,
}

// Maps the plugin's flat settings object → our capture shape.
// The raw keys here MUST match what the plugin registers — see the
// "Settings-key contract" table in Part 2. Each lookup is defensive: a missing
// or wrong-typed key degrades to the default, never throws.
function mapPluginSettings(raw: Record<string, unknown>): LogseqCaptureSettings {
  const str = (v: unknown, d: string) => (typeof v === 'string' && v.trim() ? v.trim() : d)
  const bool = (v: unknown, d: boolean) => (typeof v === 'boolean' ? v : d)
  return {
    clippingTag:          str(raw.webTag, DEFAULTS.clippingTag).replace(/^#/, ''),
    capturePageContent:   bool(raw.webCapturePageContent, DEFAULTS.capturePageContent),
    pageContentBlockName: str(raw.webPageContentBlockName, DEFAULTS.pageContentBlockName),
    highlightsBlockName:  str(raw.webHighlightsBlockName, DEFAULTS.highlightsBlockName),
    useHeadingMarkers:    bool(raw.webUseHeadingMarkers, DEFAULTS.useHeadingMarkers),
    populatePageTags:     bool(raw.webPopulatePageTags, DEFAULTS.populatePageTags),
  }
}

/**
 * Resolve the active capture config: live plugin read → cached last-known-good
 * → hardcoded defaults. A successful read refreshes the cache.
 */
export async function resolveLogseqCaptureSettings(api: LogseqAPI): Promise<LogseqCaptureSettings> {
  try {
    const raw = await api.getPluginSettings()
    if (raw && typeof raw === 'object') {
      const mapped = mapPluginSettings(raw as Record<string, unknown>)
      await browser.storage.local.set({ [CACHE_KEY]: mapped })
      return mapped
    }
  } catch {
    /* fall through to cache/defaults */
  }
  const cached = (await browser.storage.local.get(CACHE_KEY))?.[CACHE_KEY]
  return (cached as LogseqCaptureSettings) ?? DEFAULTS
}
```

### 4. The clip tag is *read*, never assumed

This is the load-bearing requirement: the operative tag is whatever the user set
in the plugin (`webTag`). The extension must not hardcode `"WebReference"` as the
tag anywhere in the live path. Good news — **the pipeline already takes the tag
as an argument end to end**, so this is just feeding it a different value:

- `saveToLogseq(api, input, options)` resolves `options.clippingTag`
  (`logseq-page-creator.ts:285`).
- → `buildTagPropertyIndex(api, clipTag)` (schema discovery,
  `logseq-schema-index.ts:156`).
- → `buildClipUrlIndex(api, clipTag, urlIdent)` (dedupe,
  `logseq-url-index.ts:110`).
- → `buildClipBlocks(...)` (page body).

`WEB_CLIPPING_TAG` is **demoted to an emergency fallback** — the value used only
when no live read and no cache exist (it's already the `||` fallback at
`logseq-page-creator.ts:285` and the `DEFAULTS.clippingTag` above). It is no
longer the source of truth.

(Dev-phase note: URL dedupe is keyed on the current clip tag, so changing
`webTag` means pages clipped under the old tag no longer dedupe. No users / no
backward-compat concern right now — not something to handle.)

### 5. Where the resolver is consumed

Two call sites, both calling the same resolver:

- **`src/background.ts`** (`saveToLogseq` handler, ~`:701`–`:716`) — the
  **authoritative** read. Today it builds `options` from
  `generalSettings.logseqCaptureSettings`. Change it to: build the `LogseqAPI`
  from the (still extension-side) connection settings, then
  `const capture = await resolveLogseqCaptureSettings(api)` and pass `capture`
  fields as the `saveToLogseq` options.
- **`src/core/popup.ts`** (popup open / `handleClipLogseq`) — the popup consumes
  `capturePageContent` (whether to pre-fill the content textarea) and
  `populatePageTags` (whether to pre-fill tags). On popup open, build a
  `LogseqAPI` from `generalSettings.logseqApiBaseUrl` / `logseqApiToken` (both
  still in scope) and call `resolveLogseqCaptureSettings(api)` to drive pre-fill.
  This also warms the cache before the user clicks clip.

Reads are ~25 ms; calling the resolver at both popup-open and clip-time is fine.
The cache mainly serves the failure path, not latency.

### 6. The extension's "Logseq Capture" settings tab — delete it

Editing moves to the plugin and we have no users / no backward-compat concern,
so **delete the "Logseq Capture" tab outright**: the nav item
(`src/settings.html:24`, `data-section="logseq-capture"`), the section markup
(`src/settings.html:572-640`), and its manager
(`src/managers/logseq-capture-settings.ts`).

- The **connection settings** (base URL + token) live in a *separate* tab
  (`src/managers/general-settings.ts:initializeLogseqSettings`) and **stay** —
  they're the bootstrap config (chicken-and-egg above).
- The `LogseqCaptureSettings` **type stays** (`src/types/types.ts:71-98`) — it's
  now the shape `resolveLogseqCaptureSettings` returns, not a stored editable
  blob.
- Drop the stored `logseqCaptureSettings` field from `Settings` /
  `browser.storage.sync` — superseded by the live read + the
  `logseqCaptureSettingsCache` in `storage.local`.

### 7. Files to touch (checklist)

- [ ] `logseq-shared/src/schema.ts` — add `LOGSEQ_PLUGIN_ID`; export from `index.ts`.
- [ ] `src/utils/logseq-api.ts` — add `getPluginSettings()`.
- [ ] `src/utils/logseq-remote-settings.ts` — **new**: `resolveLogseqCaptureSettings()` + mapping + cache.
- [ ] `src/background.ts` — read via resolver instead of `generalSettings.logseqCaptureSettings`.
- [ ] `src/core/popup.ts` — resolve on popup open for pre-fill (capturePageContent, populatePageTags).
- [ ] `src/managers/logseq-capture-settings.ts` + `src/settings.html` — **delete** the Logseq Capture tab (nav item + section + manager); connection settings live in their own tab and stay.
- [ ] `src/utils/storage-utils.ts` — drop the stored `logseqCaptureSettings` field/defaults (superseded by the resolver); keep connection defaults.
- [ ] Tests — unit-test `mapPluginSettings` (defensive coercion, missing keys → defaults, `#`-strip on tag) the way `logseq-schema-index.test.ts` tests pure parsers.

### 8. Failure behavior (what the user sees)

| Situation | Result |
|---|---|
| Plugin installed + Logseq running | Live settings; cache refreshed |
| Plugin disabled (not uninstalled) | Live settings still returned (verified) |
| Logseq closed / unreachable | Clip already fails to POST; resolver returns cache → defaults |
| Plugin uninstalled | `getPluginSettings` → null → cache → defaults |
| Future Logseq renames the state path | Read returns null/throws → cache → defaults (never breaks) |
| First-ever run, never read, plugin absent | Hardcoded `DEFAULTS` (incl. `WEB_CLIPPING_TAG`) |

---

## Part 2 — Plugin side (handoff to the plugin dev)

The extension will read your plugin's `logseq.settings` over the HTTP API via
`getStateFromStore(['plugin/installed-plugins', '<your-plugin-id>', 'settings'])`.
Everything below is what the extension needs from your side. (The extension
reads but **cannot write** your settings — your setup hub remains the only
editing surface, which is the intent.)

### A. Settings UI: three tabs

Restructure the setup hub into three top-level tabs:

1. **Schema** — the shared property schema, common to both Zotero and Web
   imports. This is the set of properties that *both* the Zotero class and the
   Web class inherit (today this lives inside `LibrarySection`: preset,
   `PropertyPicker`, Apply schema). Pull it out as its own tab since it's shared.
2. **Zotero** — the Zotero-specific config: connection (`ConnectSection`),
   Library specifics, Import formats (`FormatsSection`), Tag rules
   (`TagRulesSection`).
3. **Web references** — the dedicated web-clip tag + the capture knobs the
   extension reads (the table in section C).

### B. The dedicated web tag — and it must carry the shared schema

Add a user-editable **web tag** (proposed key `webTag`, see table). Two
requirements:

- The user can set it to anything; the extension reads that value and uses it as
  the clip tag. **Do not assume it stays `WebReference`.**
- **Critical:** whatever tag/class the user names here must **carry the shared
  schema properties by inheritance** — i.e. its class must `extends` the same
  base class the Zotero properties live on (today `#WebReference` works because
  it `extends` the `:plugin.class.<id>/Zotero` class, so it inherits all the
  shared properties). When the user sets or changes `webTag`, ensure that class
  exists and extends the shared schema. If it doesn't carry the properties, the
  extension's schema discovery finds nothing and **aborts the clip** with
  "Schema not set up" (by design — it never writes to guessed idents).

So "Apply schema" (or an equivalent step on the Web tab) needs to: create the
web class if missing, and make it extend the shared property class.

### C. Settings-key contract (what the extension reads)

Register these keys in your `SettingSchemaDesc` (same `HIDDEN_KEYS` +
setup-hub-control pattern you already use), edited in the **Web references** tab.
The extension's resolver maps **exactly these keys** — if you rename one, tell
the extension dev so the mapping in `logseq-remote-settings.ts` matches. Names
are proposed to parallel your existing `zotTag` convention; adjust if you
prefer, but keep them agreed.

| Plugin setting key | Type | Default | Meaning (how the extension uses it) |
|---|---|---|---|
| `webTag` | string | `WebReference` | The tag every clipped page carries (its schema class). Read as the clip tag; drives schema discovery, URL dedupe, and the page's tag. |
| `webCapturePageContent` | boolean | `true` | Whether to capture the article body as a "Page Content" block (and pre-fill the popup's content box). |
| `webPageContentBlockName` | string | `Page Content` | Name of the block the article body nests under. |
| `webHighlightsBlockName` | string | `Highlights` | Name of the block highlights nest under. |
| `webUseHeadingMarkers` | boolean | `false` | Keep Markdown `#` markers on heading blocks (off → hierarchy by indentation). |
| `webPopulatePageTags` | boolean | `false` | Pre-fill the page's `tags` field from the page's own keywords. |

Notes:

- Values must be the live `logseq.settings` values (your hub already writes them
  via `updateSettings`, which updates the in-memory store the extension reads —
  no extra mirroring needed).
- A blank/whitespace `webTag` is treated by the extension as "unset" and falls
  back to its default; prefer to validate it as non-empty in the hub.
- The extension strips a leading `#` from `webTag`, so either form is fine.
- (Optional, not required today: the "Abstract" block name is currently
  hardcoded extension-side. If you want it configurable too, add e.g.
  `webAbstractBlockName` and tell the extension dev — otherwise leave it out.)

### D. Plugin mechanics to keep in mind

(From your own `LOGSEQ_SDK_NOTES.md` / `settings.md` — restated so the contract
holds.)

- **Register every new key pre-`ready`** so Logseq seeds defaults on a fresh
  install (the extension's first read on a never-configured graph should get
  your declared defaults, not `null`).
- The extension reads the **live store**, so a value the user changes in the hub
  is visible to the next clip immediately — no save/reload step needed.
- Keep the keys in the flat settings object (the extension reads the flat
  `settings` map; nested objects aren't part of the contract above).

### E. How to verify the handoff works

With the plugin built and a web tag configured, from a shell:

```bash
curl -sS -X POST http://127.0.0.1:12315/api \
  -H "Authorization: Bearer <token>" -H 'Content-Type: application/json' \
  -d '{"method":"logseq.App.getStateFromStore",
       "args":[["plugin/installed-plugins","<your-plugin-id>","settings"]]}' | python3 -m json.tool
```

Confirm the response contains `webTag` (+ the other keys) with the user's values.
Then confirm a page tagged with that `webTag` carries the shared schema:

```bash
curl -sS -X POST http://127.0.0.1:12315/api \
  -H "Authorization: Bearer <token>" -H 'Content-Type: application/json' \
  -d '{"method":"logseq.DB.datascriptQuery","args":["[:find (pull ?t [:block/title {:logseq.property.class/properties [:db/ident :block/title]} {:logseq.property.class/extends ...}]) :where [?t :block/title \"<webTag>\"]]"]}' \
  | python3 -m json.tool
```

If that returns the inherited properties, the extension's `buildTagPropertyIndex`
will resolve them and clipping will populate values.

---

## Appendix — verified probe session (2026-05-25)

```
# the read that powers all of this:
getStateFromStore [["plugin/installed-plugins","logseq-zotero","settings"]]
  → { zotTag:"Zotero", propertyPreset:"Essentials", pageProps:[…], tagRules:"[…]", … }   ✅ live values

getStateFromStore [["plugin/installed-plugins","logseqZotero","settings"]]   → null   (camelCase id is wrong)
getStateFromStore ["plugin/installed-plugins/logseq-zotero/settings"]        → null   (string path is wrong)
logseq.settings  (as a method)                                               → MethodNotExist  (it's a getter, not dispatchable)
logseq.baseInfo  (as a method)                                               → MethodNotExist
```

Method confirmed in `@logseq/libs/dist/LSPlugin.d.ts:339`:
`getStateFromStore: <T = any>(path: string | Array<string>) => Promise<T>`.
