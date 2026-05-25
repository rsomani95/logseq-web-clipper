// Runtime property discovery. Instead of *deriving* a property's `:db/ident`
// from a hardcoded plugin id + a guessed kebab spelling, we ASK Logseq which
// properties the clip tag actually carries — its own plus everything inherited
// through `:logseq.property.class/extends` — and write values to whatever idents
// genuinely exist. This decouples the clipper from *who* set up the schema
// (logseq-zotero today, anything later) and *how* they spelled the idents: we
// match our schema fields to discovered properties by display title — an exact,
// no-fallback match, so a title we don't find means the tag genuinely lacks that
// property (a schema-setup gap the caller surfaces, never papers over).
//
// Why a full ident is non-negotiable (not a bare name): over the HTTP API the
// caller identity is `_test_plugin`, so a bare key like `url` resolves/creates
// `:plugin.property._test_plugin/url` — a *different* property from the shared
// `:plugin.property.logseq-zotero/url`. Writing by the discovered full ident is
// the only way to land on the shared property; an unknown ident errors with
// "Plugins can only upsert its own properties". See logseq-page-creator.ts.
//
// One recursive datascript pull builds the whole map (verified against a live
// graph: WebReference → extends → Zotero → its `:logseq.property.class/properties`,
// terminating at the Root Tag).

import type { LogseqAPI } from './logseq-api'

/** A property the clip tag carries, as Logseq itself reports it. */
export interface DiscoveredProperty {
	/** Full `:db/ident`, e.g. `:plugin.property.logseq-zotero/date-added`. */
	ident: string
	/** Display title as stored, e.g. "Date Added". */
	title: string
	/** Logseq's `:logseq.property/type`: `node` | `date` | `url` | `default` | … */
	type: string
	/** Decoded from `:db.cardinality/*`. */
	cardinality: 'one' | 'many'
}

// The HTTP API serializes datascript pull results with a mix of key forms:
// common attributes are simplified (`:db/ident`→`ident`, `:block/title`→`title`,
// `:db/cardinality`→`cardinality`) while others keep their namespaced keyword
// (`:logseq.property/type`, `:logseq.property.class/properties`,
// `:logseq.property.class/extends`). These interfaces mirror that exactly.
interface RawProperty {
	ident?: unknown
	title?: unknown
	':logseq.property/type'?: unknown
	cardinality?: unknown
}
interface RawClass {
	title?: unknown
	':logseq.property.class/properties'?: unknown
	':logseq.property.class/extends'?: unknown
}

function decodeCardinality(raw: unknown): 'one' | 'many' {
	return raw === ':db.cardinality/many' || raw === 'many' ? 'many' : 'one'
}

function normalizeTitle(title: string): string {
	return title.trim().toLowerCase()
}

/**
 * The query shipped at save time: the clip tag's own properties plus every
 * ancestor's, each with ident + title + type + cardinality, in one round trip.
 * `{:logseq.property.class/extends ...}` recurses the enclosing pattern, so each
 * class in the chain contributes its `:logseq.property.class/properties`; it
 * terminates at a class with no `extends`. Matched by the tag page's
 * `:block/title` (case-sensitive) — same join the url-index uses.
 */
export function tagPropertiesQuery(clipTag: string): string {
	const safe = clipTag.replace(/\\/g, '\\\\').replace(/"/g, '\\"')
	return `
[:find (pull ?t [:block/title
                 {:logseq.property.class/properties [:db/ident :block/title :logseq.property/type :db/cardinality]}
                 {:logseq.property.class/extends ...}])
 :where [?t :block/title "${safe}"]]
`
}

/**
 * Walks a `tagPropertiesQuery` result into a flat, de-duplicated property list.
 * Pure (no API) so it's unit-testable against captured fixtures. Collects each
 * class node's own properties, then recurses through `extends`; dedupes by ident
 * (a diamond in the class graph would otherwise list a property twice).
 */
export function parseTagProperties(queryResult: unknown): DiscoveredProperty[] {
	const byIdent = new Map<string, DiscoveredProperty>()

	const visitClass = (node: unknown): void => {
		if (!node || typeof node !== 'object') return
		const cls = node as RawClass

		const props = cls[':logseq.property.class/properties']
		if (Array.isArray(props)) {
			for (const raw of props) {
				if (!raw || typeof raw !== 'object') continue
				const p = raw as RawProperty
				if (typeof p.ident !== 'string' || byIdent.has(p.ident)) continue
				byIdent.set(p.ident, {
					ident: p.ident,
					title: typeof p.title === 'string' ? p.title : '',
					type: typeof p[':logseq.property/type'] === 'string' ? (p[':logseq.property/type'] as string) : 'default',
					cardinality: decodeCardinality(p.cardinality),
				})
			}
		}

		const ext = cls[':logseq.property.class/extends']
		if (Array.isArray(ext)) for (const parent of ext) visitClass(parent)
	}

	// Result rows are single-element pull tuples: `[ [ {tag node} ] ]`.
	if (Array.isArray(queryResult)) {
		for (const row of queryResult) visitClass(Array.isArray(row) ? row[0] : row)
	}

	return [...byIdent.values()]
}

/**
 * Resolves clipper schema fields → real Logseq properties. Lookup is by display
 * title first (the stable cross-plugin contract — our `display` values mirror
 * the provider's titles), falling back to `kebab(name)` === the ident's last
 * segment so a title drift still resolves. A field with no match is genuinely
 * absent from the tag and gets skipped by the caller.
 */
export class TagPropertyIndex {
	private readonly byTitle = new Map<string, DiscoveredProperty>()

	constructor(readonly properties: DiscoveredProperty[]) {
		for (const p of properties) {
			if (p.title) this.byTitle.set(normalizeTitle(p.title), p)
		}
	}

	get size(): number {
		return this.properties.length
	}

	/**
	 * Resolves a schema field to a real Logseq property by display title — the
	 * cross-plugin contract (our `display` mirrors the provider's title). No fuzzy
	 * fallback: an unfound title means the tag doesn't carry that property, and the
	 * caller treats it as a schema-setup gap rather than inventing an ident.
	 */
	resolve(display: string): DiscoveredProperty | undefined {
		return this.byTitle.get(normalizeTitle(display))
	}
}

/**
 * Builds the index for a clip tag. Best-effort: any failure (tag missing,
 * schema not set up, query error) yields an empty index — the caller then skips
 * property writes rather than erroring, so the page + tag still land and the
 * user can fix fields by hand.
 */
export async function buildTagPropertyIndex(api: LogseqAPI, clipTag: string): Promise<TagPropertyIndex> {
	try {
		const raw = await api.datascriptQuery<unknown[]>(tagPropertiesQuery(clipTag))
		const props = parseTagProperties(raw)
		if (props.length === 0) {
			console.warn(
				`[logseq-web-clipper] schema-index: #${clipTag} carries no properties — does the tag exist and ` +
					`extend the schema class? Property values will be skipped this save.`,
			)
		} else {
			console.log(`[logseq-web-clipper] schema-index: #${clipTag} carries ${props.length} property(ies) (own + inherited).`)
		}
		return new TagPropertyIndex(props)
	} catch (err) {
		console.error(`[logseq-web-clipper] schema-index: discovery failed for #${clipTag}; property values skipped this save`, err)
		return new TagPropertyIndex([])
	}
}
