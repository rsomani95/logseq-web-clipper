# Logseq Web Clipper

Browser extension that clips web pages into a Logseq-DB graph, forked from [obsidianmd/obsidian-clipper](https://github.com/obsidianmd/obsidian-clipper).

Targets the **DB graph** version of Logseq only. Talks to Logseq via its local HTTP API on `http://127.0.0.1:12315`.

## Status

Phase 1 — **foundation only**. The clip pipeline isn't wired up yet. What's in:

- Monorepo scaffolded with bun workspaces.
- `logseq-shared` — single source of truth for the `#WebClipping` tag schema (11 fields, named to mirror the `logseq-zoterolocal-plugin` Essentials preset so Zotero + Web sources can be unified later).
- `logseq-plugin` — companion Logseq plugin that owns the `#WebClipping` tag and the `Web Clipper: Set up schema` command.
- Extension manifest renamed; upstream's clip flow (writer + frontmatter) still points at Obsidian and will be swapped in Phase 2.

## Repo layout

```
.                       — extension (fork of obsidianmd/obsidian-clipper, npm/webpack)
logseq-plugin/          — companion Logseq DB plugin (bun/vite)
logseq-shared/          — schema definitions used by both sides
```

The extension lives at the repo root so future `git pull upstream main` syncs stay clean.

## Develop

```bash
# Install workspace deps once
bun install

# Extension (webpack, watch mode)
npm run dev:chrome
# → build/chrome — load as unpacked in chrome://extensions

# Companion Logseq plugin (vite, watch mode)
cd logseq-plugin && bun run dev
# → dist/ — load as unpacked in Logseq's Plugins dashboard (developer mode on)
```

Open Logseq's command palette, run **Web Clipper: Set up schema** once per graph to create the `#WebClipping` tag and its properties.

## Architecture

Two pieces. The extension does the clipping; the plugin owns the Logseq-side schema. They talk indirectly: the plugin creates properties under `:plugin.property.logseq-web-clipper/*`, and the extension (Phase 2) writes values to those same idents over the HTTP API.

Why two pieces: properties created via `Editor.upsertProperty` get namespaced to the calling plugin's id. If the extension created them directly, the namespace would be unpredictable and unifying with Zotero's filter/view experience wouldn't work cleanly.

## Roadmap

- **Phase 2** — Logseq HTTP API client, page creator (replaces `obsidian-note-creator.ts`), metadata extractor (`og:` / JSON-LD / `citation_*`), settings UI for the HTTP API token. End-to-end "click → page in Logseq" working.
- **Phase 3** — port the highlighter, add SingleFile snapshot capture, append-to-journal mode, schema unification with `logseq-zoterolocal-plugin`.
- **Phase 4+** — Zotero translator catalog (Embedded Metadata + a translator engine) for richer scholarly metadata, React-ify the popup, polish.

## Upstream sync

```bash
git fetch upstream
git merge upstream/main
# resolve conflicts in src/manifest.*.json, src/utils/obsidian-note-creator.ts → logseq-page-creator.ts, etc.
```

Our additions (`logseq-plugin/`, `logseq-shared/`, this README) live in their own directories and never conflict.

## License

MIT, inherited from obsidian-clipper.
