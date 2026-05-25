# Logseq Web Clipper

Browser extension that clips web pages into a Logseq-DB graph, forked from [obsidianmd/obsidian-clipper](https://github.com/obsidianmd/obsidian-clipper).

Targets the **DB graph** version of Logseq only. Talks to Logseq via its local HTTP API on `http://127.0.0.1:12315`.

## Status

Working end-to-end: clip a page → it lands in your DB graph as a `#WebReference` page with metadata properties, optional highlights (with per-highlight notes), and the article body. Re-clipping a URL dedupes (and merges any new highlights).

- `logseq-shared` — the field set the clipper populates (`title`, `authors`, `url`, `date`, …), each with a display title.
- Property idents aren't stored here — the extension **discovers** them from the clip tag at save time and writes to whatever the schema provider created.

## Install

Distributed outside the Chrome Web Store, so it installs in **developer mode**:

1. Download `logseq-web-clipper-<version>-chrome.zip` from the [latest release](https://github.com/rsomani95/logseq-web-clipper/releases) and unzip it.
2. Open `chrome://extensions` and turn on **Developer mode** (top-right).
3. Click **Load unpacked** and select the unzipped folder.

There's no auto-update for developer-mode extensions — to upgrade, download the new zip and repeat. You'll also need the `#WebReference` schema set up in your graph (see [Develop](#develop)).

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

## Releases & versioning

This fork has its **own** semver line, independent of obsidian-clipper's — it has diverged enough (Logseq-only, note-taking, the schema-discovery write path; no vaults/paths/`obsidian://`) that upstream's number no longer predicts its behaviour. The obsidian-clipper version it descends from is recorded as *provenance*, not mirrored:

- the Chrome manifest's `version_name` surfaces it in `chrome://extensions` — e.g. `0.1.0 (forked off obsidian-clipper 1.6.2)`;
- and here: **based on obsidian-clipper v1.6.2** — bump this line when you merge a newer upstream release.

To cut a release:

```bash
./scripts/bump-version.sh <X.Y.Z>     # updates package.json + manifests + version_name
git commit -am "release: v<X.Y.Z>"
git tag v<X.Y.Z> && git push origin v<X.Y.Z>
```

The `v*` tag triggers [`.github/workflows/release.yml`](.github/workflows/release.yml), which builds the Chrome zip and drafts a GitHub Release with it attached. Tags are **`v`-prefixed** so fork releases stay distinct from the inherited upstream tags (`0.9.x`–`1.6.2`) — a bare `1.6.2`-style tag won't trigger the workflow. For the first release at the current `0.1.0`, skip the bump and just tag `v0.1.0`. Optionally run `./scripts/generate-changelog.sh` first to write `changelogs/<version>.md`, which the workflow folds into the release notes.

## Upstream sync

```bash
git fetch upstream
git merge upstream/main
# resolve conflicts in src/manifest.*.json, src/utils/obsidian-note-creator.ts → logseq-page-creator.ts, etc.
```

Our additions (`logseq-shared/`, this README) live in their own directories and never conflict.

## License

MIT, inherited from obsidian-clipper.
