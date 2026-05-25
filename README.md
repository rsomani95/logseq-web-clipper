# Logseq Web Clipper

Browser extension that clips web pages into a Logseq-DB graph, forked from [obsidianmd/obsidian-clipper](https://github.com/obsidianmd/obsidian-clipper).

Targets the **DB graph** version of Logseq only. Talks to Logseq via its local HTTP API on `http://127.0.0.1:12315`.

## Status

Working end-to-end: clip a page → it lands in your DB graph as a `#WebReference` page with metadata properties, optional highlights (with per-highlight notes), and the article body. Re-clipping a URL dedupes (and merges any new highlights).

- `logseq-shared` — the field set the clipper populates (`title`, `authors`, `url`, `date`, …), each with a display title.
- Property idents aren't stored here — the extension **discovers** them from the clip tag at save time and writes to whatever the schema provider created.

## Repo layout

```
.                       — extension (fork of obsidianmd/obsidian-clipper, npm/webpack)
logseq-shared/          — the field set the clipper populates (camelCase name + display title)
```

The extension lives at the repo root so future `git pull upstream main` syncs stay clean.

## Develop

```bash
# Install workspace deps once
bun install

# Extension (webpack, watch mode)
npm run dev:chrome
# → dev/ — load as unpacked in chrome://extensions
```

Schema setup (creating the `#WebReference` tag and its properties) is **not** done here — a separate Logseq plugin owns it (today, [logseq-zotero](https://github.com/rsomani95/logseq-zotero)). Set that up in your graph first; the clipper discovers the tag's properties at save time and writes to them.

## Architecture

The extension does all the clipping and talks to Logseq over the local HTTP API. It does **not** create properties — over the HTTP API the caller is namespaced as `_test_plugin`, so it can only set values on properties that already exist. Schema setup is owned by a separate Logseq plugin.

At save time the extension discovers which properties the clip tag carries (its own + everything inherited via class `extends`) in one datascript query, matches each field by display title to a real `:db/ident`, and writes to it. Sharing the provider's namespace (today `:plugin.property.logseq-zotero/*`) means `#WebReference` and `#Zotero` pages carry the same property entities — so queries union and URL dedupe spans both.

## Roadmap

- SingleFile snapshot capture; append-to-journal mode.
- Zotero translator catalog (Embedded Metadata + a translator engine) for richer scholarly metadata.
- React-ify the popup for a Logseq-native UI (block editing, property chips).

## Upstream sync

```bash
git fetch upstream
git merge upstream/main
# resolve conflicts in src/manifest.*.json, src/utils/obsidian-note-creator.ts → logseq-page-creator.ts, etc.
```

Our additions (`logseq-shared/`, this README) live in their own directories and never conflict.

## License

MIT, inherited from obsidian-clipper.
