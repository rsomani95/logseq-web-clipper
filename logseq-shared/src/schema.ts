// Single source of truth for the #WebReference tag schema. Imported by both the
// browser extension (which writes values via the Logseq HTTP API) and the
// companion Logseq plugin (which creates the properties + tag via the SDK).
//
// Unification with zoterolocal: shared fields (everything except `excerpt`)
// reuse the Zotero plugin's properties directly — same `:db/ident`, same
// display name. A page tagged #WebReference and a page tagged #Zotero share
// the same `title`, `authors`, etc., so queries union naturally.
//
// Assumption: the user runs zoterolocal's "Add Zotero schema to Logseq"
// command BEFORE running our "Set up schema". If not, schema setup will warn
// for each missing Zotero property. Future work: a real wizard that detects
// missing Zotero schema and either creates the properties under Zotero's
// namespace or falls back to web-only ownership.

export const PLUGIN_ID = 'logseq-web-clipper'
export const ZOTERO_PLUGIN_ID = 'logseq-zoterolocal-plugin'
// The tag every clipped page carries. This is the DEFAULT and the value the
// companion plugin registers the property schema on; the extension also exposes
// it as a runtime "Reference tag" setting. Both must agree for the tag to carry
// that schema — change here (and rebuild the plugin) to move the default.
export const WEB_CLIPPING_TAG = 'WebReference'

// Qualified namespaces. `upsertProperty('foo', ...)` from inside our plugin
// creates `:plugin.property.logseq-web-clipper/foo`. Shared fields write/read
// at the Zotero namespace instead — see `ident()` below.
export const PROPERTY_NAMESPACE = `:plugin.property.${PLUGIN_ID}` as const
export const ZOTERO_PROPERTY_NAMESPACE = `:plugin.property.${ZOTERO_PLUGIN_ID}` as const

export type LogseqPropertyType = 'default' | 'date' | 'datetime' | 'node' | 'url'
export type LogseqCardinality = 'one' | 'many'
/** Which plugin owns this property's `:db/ident`. */
export type PropertyOwner = 'zotero' | 'web'

export interface PropertyDef {
	/** camelCase name. The Logseq ident is derived via `kebab()`. */
	name: string
	/** User-facing label shown in the Logseq property UI. */
	display: string
	/** Short description shown beneath the property in the tag schema UI. */
	description: string
	type: LogseqPropertyType
	cardinality: LogseqCardinality
	/** 'zotero' → reuse the Zotero plugin's property (assumes it's been
	 * created already). 'web' → owned and created by this plugin. */
	ownedBy: PropertyOwner
}

// Order matters: it determines the order properties appear on the #WebReference
// tag in Logseq. The first few are the at-a-glance fields a user wants to see
// without scrolling. Mirrors zoterolocal's PROP_PRIORITY_ORDER pattern.
export const PROPERTIES = [
	{
		name: 'title',
		display: 'Title',
		description: '',
		type: 'default',
		cardinality: 'one',
		ownedBy: 'zotero',
	},
	{
		name: 'authors',
		display: 'Authors',
		description: '',
		type: 'node',
		cardinality: 'many',
		ownedBy: 'zotero',
	},
	{
		name: 'url',
		display: 'URL',
		description: '',
		type: 'url',
		cardinality: 'one',
		ownedBy: 'zotero',
	},
	{
		// Publication date. Zoterolocal types this as `default` (accepts free-form
		// strings like "2025", "January 2025", or an ISO date) — mirror that here
		// so the extension writes the raw string instead of trying to coerce to a
		// journal page reference.
		name: 'date',
		display: 'Date',
		description: 'Publication date of the item',
		type: 'default',
		cardinality: 'one',
		ownedBy: 'zotero',
	},
	{
		// `date` type in Logseq-DB = a reference to a journal page, not an ISO
		// string. Zoterolocal types this as `date`, so the extension must
		// `createJournalPage(yyyy-MM-dd)` and write the returned page id.
		name: 'dateAdded',
		display: 'Date Added',
		description: 'Date the item was added to the graph',
		type: 'date',
		cardinality: 'one',
		ownedBy: 'zotero',
	},
	{
		name: 'itemType',
		display: 'Item Type',
		description: 'Inferred type (article, blog post, video, …)',
		type: 'default',
		cardinality: 'one',
		ownedBy: 'zotero',
	},
	{
		name: 'publisher',
		display: 'Publisher',
		description: 'Publisher of the item',
		type: 'default',
		cardinality: 'one',
		ownedBy: 'zotero',
	},
	{
		name: 'publicationTitle',
		display: 'Publication Title',
		description: 'Title of the publication (journal, magazine, etc.)',
		type: 'default',
		cardinality: 'one',
		ownedBy: 'zotero',
	},
	{
		name: 'websiteTitle',
		display: 'Website Title',
		description: '',
		type: 'default',
		cardinality: 'one',
		ownedBy: 'zotero',
	},
	{
		name: 'blogTitle',
		display: 'Blog Title',
		description: '',
		type: 'default',
		cardinality: 'one',
		ownedBy: 'zotero',
	},
	{
		name: 'language',
		display: 'Language',
		description: '',
		type: 'default',
		cardinality: 'one',
		ownedBy: 'zotero',
	},
	{
		name: 'tags',
		display: 'Tags',
		description: 'Tags applied to the item',
		type: 'node',
		cardinality: 'many',
		ownedBy: 'zotero',
	},
	{
		name: 'excerpt',
		display: 'Excerpt',
		description: 'Article excerpt or meta description',
		type: 'default',
		cardinality: 'one',
		ownedBy: 'web',
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

/**
 * Returns the fully qualified Logseq property `:db/ident` for a schema field.
 * Shared fields resolve to the Zotero plugin's namespace so #WebReference and
 * #Zotero pages share the same property entities.
 */
export function ident(name: PropertyName): string {
	const def = getProperty(name)
	const ns = def.ownedBy === 'zotero' ? ZOTERO_PROPERTY_NAMESPACE : PROPERTY_NAMESPACE
	return `${ns}/${kebab(name)}`
}

/** Indexed lookup; throws if `name` isn't in the schema. */
export function getProperty(name: PropertyName): PropertyDef {
	const found = PROPERTIES.find((p) => p.name === name)
	if (!found) throw new Error(`Unknown property: ${name}`)
	return found
}

/**
 * User-facing label for a property name. Schema fields return their registered
 * `display` (so the extension popup matches Logseq's capitalized property UI —
 * `dateAdded` → "Date Added", `url` → "URL"); names not in the schema (e.g. a
 * custom template field) fall back to a humanized camelCase → Title Case form.
 */
export function displayName(name: string): string {
	const def = PROPERTIES.find((p) => p.name === name)
	if (def) return def.display
	const spaced = name
		.replace(/[-_]+/g, ' ')
		.replace(/([a-z0-9])([A-Z])/g, '$1 $2')
		.trim()
	return spaced.charAt(0).toUpperCase() + spaced.slice(1)
}
