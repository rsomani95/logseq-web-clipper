# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this repo is

A fork of [obsidianmd/obsidian-clipper](https://github.com/obsidianmd/obsidian-clipper) reshaped into a **Logseq-DB-only** web clipper. The upstream's pipeline — Defuddle for content extraction, the AST-based templating engine with its 60+ filters, the highlighter, the popup chrome — is reused as-is. Anything Obsidian-specific (vault dropdown, path field, `obsidian://` URI scheme, frontmatter-as-primary-output) is gone.

The repo holds **two pieces**:

- **The extension** at repo root (npm + webpack, the obsidian-clipper fork). Does the actual clipping — extracts page content, runs the template, posts to Logseq's HTTP API.
- **`logseq-plugin/`** — companion Logseq DB plugin (bun + vite, `vite-plugin-logseq`). Has no clip UI. Its only job is to own the `#WebClipping` tag and run the `Web Clipper: Set up schema` command, because properties created via `Editor.upsertProperty` get namespaced to the calling plugin's id — the extension can't create them from outside.
- **`logseq-shared/`** — workspace package with the schema definitions (`PROPERTIES`, `ident()`, `kebab()`, `WEB_CLIPPING_TAG`, plugin id constants). Imported by both sides via bun workspaces. **Single source of truth** for what gets created in Logseq and what idents the extension writes to.

Repo root stays clean for `git pull upstream main`: extension files are exactly where upstream put them, with `logseq-plugin/` and `logseq-shared/` as siblings.

## Zotero coupling

This clipper is designed to share property entities with [logseq-zoterolocal-plugin](https://github.com/rsomani95/logseq-zoterolocal-plugin) so a page tagged `#WebClipping` and a page tagged `#Zotero` carry the same `title`, `authors`, `url`, etc. — queries union naturally without a follow-up migration.

How: in `logseq-shared/src/schema.ts`, 12 of the 13 fields are marked `ownedBy: 'zotero'`. Their `ident()` resolves to `:plugin.property.logseq-zoterolocal-plugin/<kebab>` (not our namespace). Only `excerpt` is `ownedBy: 'web'` and lives under our plugin. The setup command in `logseq-plugin/src/services/set-logseqdb-schema.ts` skips creation for shared fields, verifies they exist (`getProperty(zoteroIdent)`), and just calls `addTagProperty(WEB_CLIPPING_TAG, zoteroIdent)` to associate them with our tag.

**Hard assumption (today)**: the user has run zoterolocal's "Add Zotero schema to Logseq" command before running ours. If properties are missing, schema setup surfaces a warning listing them and still wires up what it can. The future shape is a co-dependent setup wizard that detects missing Zotero schema and offers to set it up (or falls back to web-owned ownership when zoterolocal isn't installed) — track this as a real limitation, not a polish item.

## Commands

```bash
# One-time: install workspace deps from repo root
bun install

# Extension (the clipper itself)
npm run dev:chrome        # webpack watch → dist/chrome (load unpacked in Chrome)
npm run build:chrome      # production build + zip to builds/
bunx vitest run           # run all tests
bunx vitest run path/to.test.ts   # single file
bunx tsc --noEmit         # typecheck extension

# Companion Logseq plugin
cd logseq-plugin && bun run dev          # vite watch
cd logseq-plugin && bun run build        # production build → dist/
cd logseq-plugin && bunx tsc --noEmit    # typecheck plugin
```

**`tsc` gotcha:** there is no monorepo-wide tsconfig. Run typecheck from the package dir you care about (`bunx tsc --noEmit` at root checks the extension; `cd logseq-plugin && bunx tsc --noEmit` checks the plugin). Running `tsc` from `~/` silently does nothing.

**Pre-existing upstream noise** to ignore (not regressions): `src/cli.ts:208` reports TS1323 (dynamic import + es6 module) — the CLI builds with esbuild which has its own settings. Three `template-integration.test.ts` cases fail against upstream's fixtures.

## Editing surfaces

The three most-likely modification entry points and where to look:

### What content the clipper captures

- **`src/utils/content-extractor.ts`** — orchestrates extraction. Calls Defuddle via `createMarkdownContent` from `defuddle/full` to produce the markdown body. To change what raw content is captured (e.g., include captions, change article-vs-full-page heuristics), this is the file.
- **`src/content.ts`** — runs inside the page, calls the extractor, sends the result over runtime messaging.
- **`src/utils/shared.ts:buildVariables`** — turns extracted data + meta tags + schema.org into the `{{title}}`, `{{author}}`, `{{description}}`, `{{meta:name:keywords}}`, etc. template variables. To expose a new variable to templates (and therefore to schema fields), add it here.
- **`logseq-shared/src/schema.ts`** — adding a new property to `#WebClipping` happens here, then in the default template in `src/managers/template-manager.ts:createDefaultTemplate`, and (if web-owned) the schema-setup branch in `logseq-plugin/src/services/set-logseqdb-schema.ts` picks it up automatically.

### Where captured content is manipulated before being sent to Logseq

This is the popup the user sees after clicking the extension icon. Two layers:

- **`src/popup.html`** — vanilla DOM scaffold: template-select dropdown, page-name field, properties area, content textarea, clip button + dropdown for secondary actions. No vault, no path field, no Obsidian secondary action — those were stripped in Phase 3.
- **`src/core/popup.ts`** — the wiring:
  - `buildTemplateFieldsSkeleton(template)` builds the per-property `<input>` elements (one per template property).
  - `fillTemplateFieldValues(...)` runs each property's value template through the AST compiler and stuffs the result into the input.
  - `handleClipLogseq()` is the submit path — gathers fields, sends `{action: 'saveToLogseq', payload}` to the background worker.
  - `determineMainAction()` is the (now-trivial) "Add to Logseq" button setup + Copy/Save secondary actions in the dropdown.

If you want a Logseq-native UI (outliner-style block editing instead of a flat textarea, property pickers that match Logseq's chips, drag-to-reorder), this is the area to redesign. Be aware the popup is **vanilla TS + DOM manipulation** (upstream's choice), no framework. A React port is a phase-4 candidate and would touch most of `src/core/popup.ts` and several `src/managers/*.ts` files.

The styling is in `src/style.scss` + `src/styles/`. Upstream's tokens get extended there.

### How content lands in Logseq

- **`src/utils/logseq-api.ts`** — typed HTTP client around Logseq's `POST {baseUrl}/api` endpoint. Method strings are SDK-shaped (`logseq.Editor.upsertBlockProperty`, etc.). Add new SDK calls here when the page creator needs them.
- **`src/utils/logseq-page-creator.ts`** — the write pipeline: `URL dedupe check → createPage → addBlockTag(#WebClipping) → per-property writes → insertBatchBlock(body)`. Node-typed properties (`authors`, `tags`) get split on commas; one page is created per value via `createPage`, then `upsertBlockProperty(uuid, ident, page.id)` is called once per id (cardinality:many — same pattern as zoterolocal's `handle-zot-db.ts`).
- **`src/utils/logseq-url-index.ts`** — the dedupe gate: before creating, indexes every #WebClipping/#Zotero page in the graph by its `url` property (the ident is shared, so a page imported via Zotero with the same URL also counts) and short-circuits if the incoming URL matches. Mirrors zoterolocal's `zotero-code-index` pattern — keyed on URL (immutable) rather than page name (renameable), so renaming a clipped page doesn't re-open the dupe door. `saveToLogseq` returns `{status: 'created' | 'exists'}` so the popup can show "Already in graph — opened X" instead of pretending it wrote.
- **`src/utils/markdown-to-outliner.ts`** — converts the defuddle markdown to a nested `BatchBlock` tree (headings parent their content, lists nest by indentation, code fences pass through). Vitest suite covers the structural cases. This is where to evolve the outliner conversion (e.g., promote H1 to page-level instead of a block, special-case images, table-to-property extraction).
- **`src/background.ts`** — the `saveToLogseq` RPC handler that the popup sends to. Builds a `LogseqAPI` from settings, calls `saveToLogseq`, returns `{success, result}` or `{success, error}`.
- **`src/managers/general-settings.ts:initializeLogseqSettings`** — base URL + token inputs + Test Connection button.

## Design context

User cares about Vercel/Arc-level polish expressed with restraint: calm, fast, warm — in that order of dominance. Native feel inside Logseq matters (when the React popup port happens, mirror Logseq's CSS tokens the way zoterolocal does). The vanilla-DOM popup we inherited from upstream is pragmatic, not aspirational — polish lands when the UI gets rewritten.
