# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this repo is

A fork of [obsidianmd/obsidian-clipper](https://github.com/obsidianmd/obsidian-clipper) reshaped into a **Logseq-DB-only** web clipper. The upstream's pipeline — Defuddle for content extraction, the AST-based templating engine with its 60+ filters, the highlighter, the popup chrome — is reused as-is. Anything Obsidian-specific (vault dropdown, path field, `obsidian://` URI scheme, frontmatter-as-primary-output) is gone.

The repo holds **two pieces**:

- **The extension** at repo root (npm + webpack, the obsidian-clipper fork). Does the actual clipping — extracts page content, runs the template, posts to Logseq's HTTP API.
- **`logseq-plugin/`** — companion Logseq DB plugin (bun + vite, `vite-plugin-logseq`). Has no clip UI. Its only job is to own the `#WebReference` tag and run the `Web Clipper: Set up schema` command, because properties created via `Editor.upsertProperty` get namespaced to the calling plugin's id — the extension can't create them from outside. **Tag name:** `WEB_CLIPPING_TAG` in `logseq-shared` is the default (`WebReference`); the extension also exposes it as a runtime **Reference tag** setting (Logseq Capture tab) used by `addBlockTag` and the dedupe query. The plugin reads the constant at *compile time* and can't see the extension's storage, so a *custom* runtime tag tags pages + writes properties + dedupes fine but only carries the registered property *schema* if the plugin is rebuilt with that name. Moving the default → edit the shared constant and rebuild both sides.
- **`logseq-shared/`** — workspace package with the schema definitions (`PROPERTIES`, `ident()`, `kebab()`, `WEB_CLIPPING_TAG`, plugin id constants). Imported by both sides via bun workspaces. **Single source of truth** for what gets created in Logseq and what idents the extension writes to.

Repo root stays clean for `git pull upstream main`: extension files are exactly where upstream put them, with `logseq-plugin/` and `logseq-shared/` as siblings.

## Zotero coupling

This clipper is designed to share property entities with [logseq-zoterolocal-plugin](https://github.com/rsomani95/logseq-zoterolocal-plugin) so a page tagged `#WebReference` and a page tagged `#Zotero` carry the same `title`, `authors`, `url`, etc. — queries union naturally without a follow-up migration.

How: in `logseq-shared/src/schema.ts`, 12 of the 13 fields are marked `ownedBy: 'zotero'`. Their `ident()` resolves to `:plugin.property.logseq-zoterolocal-plugin/<kebab>` (not our namespace). Only `excerpt` is `ownedBy: 'web'` and lives under our plugin. The setup command in `logseq-plugin/src/services/set-logseqdb-schema.ts` skips creation for shared fields, verifies they exist (`getProperty(zoteroIdent)`), and just calls `addTagProperty(WEB_CLIPPING_TAG, zoteroIdent)` to associate them with our tag.

**Hard assumption (today)**: the user has run zoterolocal's "Add Zotero schema to Logseq" command before running ours. If properties are missing, schema setup surfaces a warning listing them and still wires up what it can. The future shape is a co-dependent setup wizard that detects missing Zotero schema and offers to set it up (or falls back to web-owned ownership when zoterolocal isn't installed) — track this as a real limitation, not a polish item.

## Commands

```bash
# One-time: install workspace deps from repo root
bun install

# Extension (the clipper itself)
npm run dev:chrome        # webpack watch → dev/ (load unpacked from dev/ in Chrome; firefox/safari → dev_firefox/dev_safari)
npm run build:chrome      # production build → dist/ + zip to builds/
bunx vitest run           # run all tests
bunx vitest run path/to.test.ts   # single file
bunx tsc --noEmit         # typecheck extension

# Companion Logseq plugin
cd logseq-plugin && bun run dev          # vite watch
cd logseq-plugin && bun run build        # production build → dist/
cd logseq-plugin && bunx tsc --noEmit    # typecheck plugin
```

**Build-output gotcha:** dev and prod write to *different* folders. `dev:chrome` (development) → **`dev/`**; `build:chrome` (production) → **`dist/`** (`dev_firefox`/`dev_safari` and `dist_firefox`/`dist_safari` for the other browsers). While developing, **load the `dev/` folder unpacked** — `dist/` only changes when you run a production build, so pointing Chrome at `dist/` while running the watch silently runs a stale build.

**`tsc` gotcha:** there is no monorepo-wide tsconfig. Run typecheck from the package dir you care about (`bunx tsc --noEmit` at root checks the extension; `cd logseq-plugin && bunx tsc --noEmit` checks the plugin). Running `tsc` from `~/` silently does nothing.

**Pre-existing upstream noise** to ignore (not regressions): `src/cli.ts:208` reports TS1323 (dynamic import + es6 module) — the CLI builds with esbuild which has its own settings. Three `template-integration.test.ts` cases fail against upstream's fixtures.

## Editing surfaces

The three most-likely modification entry points and where to look:

### What content the clipper captures

- **`src/utils/content-extractor.ts`** — orchestrates extraction. Calls Defuddle via `createMarkdownContent` from `defuddle/full` to produce the markdown body. To change what raw content is captured (e.g., include captions, change article-vs-full-page heuristics), this is the file.
- **`src/content.ts`** — runs inside the page, calls the extractor, sends the result over runtime messaging. Its `getPageContent` handler returns the page's **full highlight objects** (incl. notes) via `highlighter.readStoredHighlights()` — read from `chrome.storage.local` and unioned with the in-memory set, so a just-made highlight is captured even when the content script's array is stale (e.g. after a reader-exit reload). The standalone reader page (`src/core/reader-view.ts`) uses `getHighlightsData()` instead. Don't use upstream's `getHighlights()` for the clip path — it returns content-only strings and drops `notes`.
- **`src/utils/shared.ts:buildVariables`** — turns extracted data + meta tags + schema.org into the `{{title}}`, `{{author}}`, `{{description}}`, `{{meta:name:keywords}}`, `{{highlights}}` (JSON of the highlight export), etc. template variables. To expose a new variable to templates (and therefore to schema fields), add it here. **Gotcha:** every key in the returned map is the *braced token* (`'{{highlights}}'`, `'{{title}}'`), not a bare name — read variables with the braces. (Reading the bare `highlights` key silently emptied the clip's highlight payload once.)
- **`logseq-shared/src/schema.ts`** — adding a new property to `#WebReference` happens here, then in the default template in `src/managers/template-manager.ts:createDefaultTemplate`, and (if web-owned) the schema-setup branch in `logseq-plugin/src/services/set-logseqdb-schema.ts` picks it up automatically. The tag name itself is `WEB_CLIPPING_TAG` here (default `WebReference`).

### Where captured content is manipulated before being sent to Logseq

This is the popup the user sees after clicking the extension icon. Two layers:

- **`src/popup.html`** — vanilla DOM scaffold: template-select dropdown, page-name field, properties area, content textarea, clip button + dropdown for secondary actions. No vault, no path field, no Obsidian secondary action — those were stripped in Phase 3.
- **`src/core/popup.ts`** — the wiring:
  - `buildTemplateFieldsSkeleton(template)` builds the per-property `<input>` elements (one per template property).
  - `fillTemplateFieldValues(...)` runs each property's value template through the AST compiler and stuffs the result into the input.
  - `handleClipLogseq()` is the submit path — gathers fields plus the page's highlights (`collectClipHighlights()` parses `currentVariables['{{highlights}}']` into `ClipHighlight[]`), sends `{action: 'saveToLogseq', payload}` to the background worker, and messages the result: "Already in graph" (`exists`), "Added N highlights" (`updated`), or close-on-success (`created`).
  - `determineMainAction()` is the (now-trivial) "Add to Logseq" button setup + Copy/Save secondary actions in the dropdown.

If you want a Logseq-native UI (outliner-style block editing instead of a flat textarea, property pickers that match Logseq's chips, drag-to-reorder), this is the area to redesign. Be aware the popup is **vanilla TS + DOM manipulation** (upstream's choice), no framework. A React port is a phase-4 candidate and would touch most of `src/core/popup.ts` and several `src/managers/*.ts` files.

The styling is in `src/style.scss` + `src/styles/`. Upstream's tokens get extended there.

### How content lands in Logseq

- **`src/utils/logseq-api.ts`** — typed HTTP client around Logseq's `POST {baseUrl}/api` endpoint. Method strings are SDK-shaped (`logseq.Editor.upsertBlockProperty`, etc.). Add new SDK calls here when the page creator needs them (`getPageBlocksTree` was added here for the re-import merge to read an existing page's blocks).
- **`src/utils/logseq-page-creator.ts`** — the write pipeline. A new page's body is built as a **`Page Content`** block (wrapping the article body produced by `markdownToBatchBlocks`, emitted only when that body is non-empty — the `Capture page content` setting, default on, can leave it blank for a highlights-only clip) plus a **`Highlights`** block when the clip carries any — each highlight a **plain block** (`highlightToBlock`) with its single note as an indented child. (No `> ` prefix: DB graphs render `> foo` literally now, and a native quote is the `:logseq.property.node/display-type` = `:quote` *keyword* property, which can't be set over the JSON HTTP API — empirically verified — so a clean block is the lossless choice.) `buildClipBlocks` assembles both; `ClipHighlight` (`{text, note?}`) is the input shape. Property writes are unchanged: node-typed (`authors`, `tags`) split on commas, one page per value linked via `upsertBlockProperty(uuid, ident, page.id)` (cardinality:many — zoterolocal's `handle-zot-db.ts` pattern). **Re-import merge:** when the URL dedupe matches an existing page, `mergeHighlightsIntoExistingPage` reads its block tree, finds (or creates) the `Highlights` block, and appends only highlights not already present (dedupe by `normalizeHighlightText`) — so re-clipping a page you've since highlighted adds them instead of no-op'ing. Pure builders + the merge are covered by `logseq-page-creator.test.ts`.
- **`src/utils/logseq-url-index.ts`** — the dedupe gate: before creating, indexes every #WebReference/#Zotero page in the graph by its `url` property (the ident is shared, so a page imported via Zotero with the same URL also counts) and short-circuits if the incoming URL matches. The clip tag is configurable, so `buildClipUrlIndex`/`findPageByUrl` take a `clipTag` arg (default the shared `WEB_CLIPPING_TAG`) and query that tag; renaming the tag means pages under the old tag no longer dedupe. Mirrors zoterolocal's `zotero-code-index` pattern — keyed on URL (immutable) rather than page name (renameable), so renaming a clipped page doesn't re-open the dupe door. `saveToLogseq` returns `{status: 'created' | 'exists' | 'updated', addedHighlightCount?}` — `created` (new page), `exists` (matched, nothing new to add), `updated` (matched, new highlights appended). The popup messages each accordingly.
- **`src/utils/markdown-to-outliner.ts`** — converts the defuddle markdown to a nested `BatchBlock` tree (headings parent their content, lists nest by indentation, code fences pass through), now nested under the `Page Content` block. Vitest suite covers the structural cases. This is where to evolve the outliner conversion (e.g., promote H1 to page-level instead of a block, special-case images, table-to-property extraction).
- **`src/background.ts`** — the `saveToLogseq` RPC handler that the popup sends to. Builds a `LogseqAPI` from settings, calls `saveToLogseq`, returns `{success, result}` or `{success, error}`.
- **`src/managers/general-settings.ts:initializeLogseqSettings`** — base URL + token inputs + Test Connection button.

### Highlights and notes (reader → Logseq)

Highlights are upstream's feature; we extended them with **per-highlight notes** and the `Highlights`-block layout. The data model already carried `notes?: string[]` on each highlight (`src/utils/highlighter.ts`) — we added the UI to capture notes and the plumbing to land them.

- **Capture UI (reader mode):**
  - `src/utils/reader.ts:registerSelectionToHighlightButton` — the floating selection toolbar. Now two pills: **Highlight** (upstream) and **Note** (creates the highlight *and* attaches a note in one step, Kindle-style). Both reuse the `.obsidian-selection-action` styling, so no scss change.
  - `src/utils/highlighter-overlays.ts` — clicking an existing highlight shows a **Note** button beside the existing **Remove**. `getHighlightNote` / `setHighlightNote` (in `highlighter.ts`) read/write the note; single-note convention (a grouped multi-block highlight stores the note on its first piece and clears the rest, so the export's note-merge yields exactly one).
  - `src/utils/note-input.ts` *(fork-owned)* — the floating note textbox shared by both call sites. Self-injects its CSS so it works on any page without the scss build; isolated in its own file to keep upstream merges clean.
- **Flow end-to-end:** reader Note UI → `notes` on the highlight → `chrome.storage.local` → extraction (`readStoredHighlights` / `getHighlightsData`, full objects) → `{{highlights}}` variable (`collapseGroupsForExport`) → `collectClipHighlights` → payload → `buildClipBlocks` → `Highlights` block with notes nested.
- **Note indicators (in-page):** `src/utils/note-indicators.ts` *(fork-owned)* renders a cue that a highlight carries a note — a small amber icon at the end of the highlight on regular pages, or the full note as a card in the reader's right margin (aligned to the highlight, collision-stacked). Driven from `applyHighlights` via `refreshNoteIndicators` in `highlighter-overlays.ts`; positions off the highlight's resolved rect (text Ranges in `textHighlightRanges`, element overlays), so it works on live pages, live-page reader, and the standalone reader with no cross-bundle plumbing. Self-injects CSS; owns its own scroll/resize/reflow reposition.
- **Cross-view sync:** highlights store an xpath against the DOM they were made in, so a reader-made highlight's xpath doesn't resolve in native view (different DOM) and vice-versa. `src/utils/highlight-anchoring.ts` *(fork-owned)* re-anchors by text — a TextQuoteSelector (normalized exact match + captured `before`/`after` context to disambiguate repeats). `applyHighlights` → `renderHighlight` (in `highlighter-overlays.ts`) tries the stored xpath first, verifies its text matches the quote, and falls back to the text search when it doesn't; the anchor index is built lazily and shared, so same-view renders pay nothing. Gated by the `syncHighlightsAcrossViews` setting (Settings → Highlighter, **default on**); off = legacy xpath-only. Both directions trigger through the existing load+apply (entering reader runs `initializeContentFeatures` → `loadHighlights`+`applyHighlights`; leaving reader reloads the page). Notes follow for free since indicators position off the re-anchored rect. Pure span logic is `findQuoteSpan` (unit-tested in `highlight-anchoring.test.ts` via linkedom, no Range needed).
- **Decisions baked in:** body is **clean** (highlights are no longer inlined — the upstream `highlightBehavior` setting no longer affects the Logseq body); `Page Content` is emitted whenever the article body is non-empty — the `Capture page content` setting (default on, in the Logseq Capture tab) gates whether the popup pre-fills it, and clearing the content box for a single clip also drops the block; `Highlights` only when ≥1 highlight (re-import creates it if missing); **single note** per highlight.
- **Known limitations:** re-import dedupe is by highlight *text*, so (a) re-wording a highlight inside Logseq makes a re-clip treat it as new, and (b) adding a note to a highlight that's *already* on the page won't re-sync on re-clip — only brand-new highlights merge in. Copy-to-clipboard / save-to-file secondary actions emit the clean body **without** the Highlights section. Cross-view re-anchoring matches by text: a highlight whose text isn't found in the other view's DOM simply doesn't render there (no worse than before); repeated short phrases use `before`/`after` context for highlights made after that feature landed but fall back to first-match for older ones; element highlights re-anchor images by filename and are best-effort otherwise.

## Design context

User cares about Vercel/Arc-level polish expressed with restraint: calm, fast, warm — in that order of dominance. Native feel inside Logseq matters (when the React popup port happens, mirror Logseq's CSS tokens the way zoterolocal does). The vanilla-DOM popup we inherited from upstream is pragmatic, not aspirational — polish lands when the UI gets rewritten.
