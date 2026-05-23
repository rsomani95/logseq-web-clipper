// URL-based dedupe index. Mirrors the zoterolocal plugin's `zotero-code-index`
// pattern but keys on the shared `url` property (`:plugin.property.logseq-
// zoterolocal-plugin/url`). Because 12 of the 13 #WebReference fields reuse
// Zotero's property namespace, a page tagged #Zotero with the same URL is also
// a hit — re-clipping a page already imported from Zotero won't dupe.
//
// Strategy: 1 datascript call to list candidate pages (tagged the clip tag or
// #Zotero, minus recycled), then 1 `getPageProperties` per candidate in
// parallel to read the URL value. N+1 calls per save, but `Promise.all` keeps
// wall-clock to ~one round trip for typical graphs.

import { WEB_CLIPPING_TAG, ident } from '@logseq-web-clipper/shared'

import type { LogseqAPI } from './logseq-api'

export const ZOTERO_TAG_NAME = 'Zotero'

/** A graph page that already carries a `url` property. */
export interface UrlIndexedPage {
	uuid: string
	/** Current display title. May differ from the name the page was created
	 * under if the user has since renamed it — fine, navigation uses this. */
	title: string
}

/**
 * Minimal URL normalization for dedupe matching: trim surrounding whitespace.
 * Intentionally conservative — case is preserved (paths are case-sensitive),
 * trailing slashes and tracking params are left intact. Tighten only when a
 * concrete case demands it; aggressive normalization risks two clearly-
 * different pages collapsing into one.
 */
export function normalizeUrl(url: string | null | undefined): string | null {
	if (typeof url !== 'string') return null
	const trimmed = url.trim()
	return trimmed.length > 0 ? trimmed : null
}

/** Query rows look like `[ {uuid, title, name?} ]` (single-element pull tuple). */
interface PulledPage {
	uuid: string
	title?: string
	name?: string
}

// Pages tagged either the clip tag (configurable; #WebReference by default) or
// #Zotero. Both can carry the shared `url` property, so either is a candidate
// for dedupe. `block/title` here is the *tag* page's display name — DB graphs
// store tag identity by entity, but matching against the tag page's title is
// what the zoterolocal plugin does and works in production.
function candidatePagesQuery(clipTag: string): string {
	return `
[:find (pull ?p [:block/uuid :block/title :block/name])
 :where
 [?p :block/tags ?t]
 (or [?t :block/title "${clipTag}"]
     [?t :block/title "${ZOTERO_TAG_NAME}"])]
`
}

// Recycled (soft-deleted) pages. Logseq DB keeps them around for 30 days; their
// tags and properties survive, so they'd otherwise count as in-graph dupes.
// Marker attribute is `:logseq.property/deleted-at` — `:public? false` in the
// Logseq schema, so this is best-effort; if the attribute is renamed in a
// future version we fall back to treating no pages as recycled.
const QUERY_RECYCLED_PAGE_UUIDS = `
[:find ?uuid
 :where
 [?p :logseq.property/deleted-at _]
 [?p :block/uuid ?uuid]]
`

const URL_IDENT = ident('url')

/**
 * Some Logseq builds return URL-typed property values as a bare string; others
 * wrap them in an entity-shaped object (`{ title: "https://…" }` or similar).
 * Both shapes have appeared in zoterolocal's read path, so accept either.
 */
function extractUrlValue(raw: unknown): string | null {
	if (typeof raw === 'string') return normalizeUrl(raw)
	if (raw && typeof raw === 'object') {
		const obj = raw as Record<string, unknown>
		for (const k of ['title', 'value', 'url']) {
			const v = obj[k]
			if (typeof v === 'string') {
				const n = normalizeUrl(v)
				if (n) return n
			}
		}
	}
	return null
}

/**
 * Looks up the URL value on a `getPageProperties` result, tolerating shape
 * variations across Logseq builds. The canonical key is the full ident
 * (`:plugin.property.logseq-zoterolocal-plugin/url`), but observed graphs have
 * also returned:
 *   - the same ident without the leading colon
 *   - the kebab name alone (`url`)
 *   - any key that ends with `/url`
 * Belt-and-suspenders so an ident-shape regression doesn't break dedupe.
 */
function readUrlFromProps(props: Record<string, unknown> | null | undefined): string | null {
	if (!props) return null
	const noColon = URL_IDENT.startsWith(':') ? URL_IDENT.slice(1) : URL_IDENT
	const directKeys = [URL_IDENT, noColon, 'url']
	for (const k of directKeys) {
		const v = props[k]
		const n = extractUrlValue(v)
		if (n) return n
	}
	// Fallback: any key ending in `/url` (covers a different plugin id, or a
	// case-shift in the ident). Doesn't risk false positives because `/url`
	// is a property suffix, not a substring that appears in unrelated keys.
	for (const [k, v] of Object.entries(props)) {
		if (k.endsWith('/url') || k === 'url') {
			const n = extractUrlValue(v)
			if (n) return n
		}
	}
	return null
}

/**
 * Builds a `normalizedUrl → page` map of every clipped/imported page in the
 * graph. Empty on any failure (logged, not thrown) — callers then fall through
 * to create-as-normal, which is still correct, just not dedupe-protected.
 */
export async function buildClipUrlIndex(
	api: LogseqAPI,
	clipTag: string = WEB_CLIPPING_TAG,
): Promise<Map<string, UrlIndexedPage>> {
	const index = new Map<string, UrlIndexedPage>()

	try {
		const [pagesRaw, recycledRaw] = await Promise.all([
			api.datascriptQuery<unknown[]>(candidatePagesQuery(clipTag)),
			api.datascriptQuery<unknown[]>(QUERY_RECYCLED_PAGE_UUIDS),
		])

		const recycledUuids = new Set<string>(
			(Array.isArray(recycledRaw) ? recycledRaw : [])
				.map((row) => (Array.isArray(row) ? row[0] : null))
				.filter((u): u is string => typeof u === 'string'),
		)

		const candidates: PulledPage[] = (Array.isArray(pagesRaw) ? pagesRaw : [])
			.flat()
			.filter(
				(p): p is PulledPage =>
					!!p &&
					typeof (p as PulledPage).uuid === 'string' &&
					!recycledUuids.has((p as PulledPage).uuid),
			)

		console.log(
			`[logseq-web-clipper] url-index: ${candidates.length} candidate page(s) tagged #${clipTag} or #${ZOTERO_TAG_NAME} ` +
				`(${recycledUuids.size} recycled excluded). URL ident in use: "${URL_IDENT}".`,
		)

		if (candidates.length === 0) return index

		// Read all candidates' properties in parallel. Failures on individual
		// reads are isolated — one missing page shouldn't drop the whole index.
		const withUrl = await Promise.all(
			candidates.map(async (page) => {
				try {
					const props = await api.getPageProperties(page.uuid)
					const url = readUrlFromProps(props)
					return { page, url, props }
				} catch (err) {
					console.warn(`[logseq-web-clipper] url-index: getPageProperties failed for ${page.uuid}`, err)
					return { page, url: null, props: null as Record<string, unknown> | null }
				}
			}),
		)

		for (const { page, url } of withUrl) {
			if (!url) continue
			// First match wins — a URL should map to one page; if a stray
			// duplicate already exists, keep whichever the query returned first.
			if (!index.has(url)) {
				index.set(url, {
					uuid: page.uuid,
					title: page.title ?? page.name ?? url,
				})
			}
		}

		// Signal: we found candidates, but couldn't pull a URL off any of them.
		// That's the shape-mismatch failure mode — dump the first candidate's
		// raw props so the actual storage shape is visible without a re-run.
		// Happy path keeps the log noise tight.
		if (index.size === 0 && withUrl[0]) {
			const sample = withUrl[0]
			console.warn(
				`[logseq-web-clipper] url-index: ${candidates.length} candidate(s) but 0 URLs extracted — ` +
					`likely an ident/shape mismatch. Sample candidate "${sample.page.title ?? sample.page.uuid}" raw props =`,
				sample.props,
			)
		} else {
			console.log(`[logseq-web-clipper] url-index built — ${index.size}/${candidates.length} candidate(s) carried a URL.`)
		}
	} catch (err) {
		console.error(
			'[logseq-web-clipper] url-index build failed; dedupe will be skipped for this save',
			err,
		)
	}

	return index
}

/** Convenience: build the index and look up `url` in one call. */
export async function findPageByUrl(
	api: LogseqAPI,
	url: string,
	clipTag: string = WEB_CLIPPING_TAG,
): Promise<UrlIndexedPage | null> {
	const normalized = normalizeUrl(url)
	if (!normalized) {
		console.warn('[logseq-web-clipper] dedupe: input URL is empty/non-string, skipping dedupe check')
		return null
	}
	console.log(`[logseq-web-clipper] dedupe: looking up URL "${normalized}"`)
	const index = await buildClipUrlIndex(api, clipTag)
	const hit = index.get(normalized) ?? null
	if (hit) {
		console.log(`[logseq-web-clipper] dedupe: MATCH — existing page "${hit.title}" (uuid=${hit.uuid})`)
	} else {
		console.log(
			`[logseq-web-clipper] dedupe: NO MATCH for "${normalized}". ` +
				`If you expect this to dedupe, compare the searched URL above with the "Indexed URLs" log line.`,
		)
	}
	return hit
}
