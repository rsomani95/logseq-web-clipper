// Single source of truth for the #WebClipping tag schema. Imported by both the
// browser extension (which writes values via the Logseq HTTP API) and the
// companion Logseq plugin (which creates the properties + tag via the SDK).
//
// Field naming follows zoterolocal's convention: camelCase property names,
// kebab-case as the actual Logseq ident — except `DOI`/`ISSN`/`ISBN` which
// stay uppercase. Display labels and descriptions mirror zoterolocal's
// `PROP_DISPLAY_NAMES` / `PROP_DESCRIPTIONS` exactly where a field overlaps,
// so eventual unification with the Zotero plugin is a rename-only operation.

export const PLUGIN_ID = 'logseq-web-clipper'
export const WEB_CLIPPING_TAG = 'WebClipping'

// The qualified namespace plugins write under. `upsertProperty('title', ...)`
// from inside the plugin actually creates `:plugin.property.logseq-web-clipper/title`.
// The browser extension targets the same idents over the HTTP API.
export const PROPERTY_NAMESPACE = `:plugin.property.${PLUGIN_ID}` as const

export type LogseqPropertyType = 'default' | 'date' | 'datetime' | 'node' | 'url'
export type LogseqCardinality = 'one' | 'many'

export interface PropertyDef {
	/** camelCase name. The Logseq ident is derived via `kebab()`. */
	name: string
	/** User-facing label shown in the Logseq property UI. */
	display: string
	/** Short description shown beneath the property in the tag schema UI. */
	description: string
	type: LogseqPropertyType
	cardinality: LogseqCardinality
	/** Marks this property as web-clipper-only (no zoterolocal equivalent). */
	webOnly?: boolean
}

// Order matters: it determines the order properties appear on the #WebClipping
// tag in Logseq. The first few are the at-a-glance fields a user wants to see
// without scrolling. Mirrors zoterolocal's PROP_PRIORITY_ORDER pattern.
export const PROPERTIES = [
	{
		name: 'title',
		display: 'Title',
		description: '',
		type: 'default',
		cardinality: 'one',
	},
	{
		name: 'authors',
		display: 'Authors',
		description: '',
		type: 'node',
		cardinality: 'many',
	},
	{
		name: 'url',
		display: 'URL',
		description: '',
		type: 'url',
		cardinality: 'one',
	},
	{
		name: 'date',
		display: 'Date',
		description: 'Publication date of the item',
		type: 'date',
		cardinality: 'one',
	},
	{
		name: 'dateAdded',
		display: 'Date Added',
		description: 'Date the item was added to the graph',
		type: 'date',
		cardinality: 'one',
	},
	{
		name: 'itemType',
		display: 'Item Type',
		description: 'Inferred type (article, blog post, video, …)',
		type: 'default',
		cardinality: 'one',
	},
	{
		name: 'publisher',
		display: 'Publisher',
		description: 'Publisher of the item',
		type: 'default',
		cardinality: 'one',
	},
	{
		name: 'publicationTitle',
		display: 'Publication Title',
		description: 'Title of the publication (journal, magazine, etc.)',
		type: 'default',
		cardinality: 'one',
	},
	{
		name: 'websiteTitle',
		display: 'Website Title',
		description: '',
		type: 'default',
		cardinality: 'one',
	},
	{
		name: 'blogTitle',
		display: 'Blog Title',
		description: '',
		type: 'default',
		cardinality: 'one',
	},
	{
		name: 'language',
		display: 'Language',
		description: '',
		type: 'default',
		cardinality: 'one',
	},
	{
		name: 'tags',
		display: 'Tags',
		description: 'Tags applied to the item',
		type: 'node',
		cardinality: 'many',
	},
	{
		name: 'excerpt',
		display: 'Excerpt',
		description: 'Article excerpt or meta description',
		type: 'default',
		cardinality: 'one',
		webOnly: true,
	},
] as const satisfies readonly PropertyDef[]

export type PropertyName = (typeof PROPERTIES)[number]['name']

// Acronyms preserved in their original case — matches zoterolocal's behavior so
// `DOI`/`ISSN`/`ISBN` show up consistently across both plugins. Add to this set
// if you introduce a property whose camelCase contains another acronym.
const PRESERVED_ACRONYMS = new Set(['DOI', 'ISBN', 'ISSN'])

/**
 * camelCase → kebab-case, preserving the acronyms in `PRESERVED_ACRONYMS`.
 * Examples: `dateAdded` → `date-added`; `DOI` → `DOI`; `itemType` → `item-type`.
 */
export function kebab(name: string): string {
	if (PRESERVED_ACRONYMS.has(name)) return name
	return name.replace(/[A-Z]/g, (m, i: number) => (i === 0 ? m.toLowerCase() : `-${m.toLowerCase()}`))
}

/** Returns the fully qualified Logseq property ident for a schema field. */
export function ident(name: PropertyName): string {
	return `${PROPERTY_NAMESPACE}/${kebab(name)}`
}

/** Indexed lookup; throws if `name` isn't in the schema. */
export function getProperty(name: PropertyName): PropertyDef {
	const found = PROPERTIES.find((p) => p.name === name)
	if (!found) throw new Error(`Unknown property: ${name}`)
	return found
}
