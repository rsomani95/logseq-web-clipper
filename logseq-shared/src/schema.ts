// Single source of truth for which fields the clipper knows how to populate on
// the reference tag, plus the display title it matches each one against.
//
// The clipper does NOT store property `:db/ident`s here. Idents are owned by
// whatever plugin sets up the schema in Logseq (logseq-zotero today, anything
// later); at save time the extension DISCOVERS them from the clip tag's own +
// inherited properties and matches each field by display title — see
// `src/utils/logseq-schema-index.ts`. So this file only declares the field set
// (camelCase `name` + user-facing `display`); type/cardinality come from Logseq.

// The id of the Logseq plugin that owns the shared schema + web-clip settings.
// SINGLE SOURCE OF TRUTH — when the plugin is renamed, change this one line. It
// must be the plugin's real `id` (kebab-case): the namespace every property
// ident lives under (`:plugin.property.<id>/*`) and the key the extension reads
// with getStateFromStore(['plugin/installed-plugins', <id>, 'settings']).
export const LOGSEQ_PLUGIN_ID = 'logseq-reference-manager'

// Emergency fallback for the clip tag, used ONLY when the plugin's live `webTag`
// can't be read (Logseq unreachable / plugin absent) and nothing is cached. The
// real tag is whatever the user set in the plugin — read at runtime, never
// assumed. Kept aligned with the plugin's current `webTag` default.
export const WEB_CLIPPING_TAG = 'Web'

export interface PropertyDef {
	/** camelCase key — what clip templates use and the popup renders. */
	name: string
	/** User-facing label, matched (by normalized title) against the tag's
	 * discovered properties to find the real `:db/ident` to write to. */
	display: string
}

// Order is the order fields surface in the popup. The `display` values mirror
// the schema provider's property titles (logseq-zotero's) so that title-matching
// in logseq-schema-index resolves each field to its real ident.
export const PROPERTIES = [
	{ name: 'title', display: 'Title' },
	{ name: 'authors', display: 'Authors' },
	{ name: 'url', display: 'URL' },
	{ name: 'date', display: 'Date' },
	{ name: 'dateAdded', display: 'Date Added' },
	{ name: 'itemType', display: 'Item Type' },
	{ name: 'publisher', display: 'Publisher' },
	{ name: 'publicationTitle', display: 'Publication Title' },
	{ name: 'websiteTitle', display: 'Website Title' },
	{ name: 'blogTitle', display: 'Blog Title' },
	{ name: 'language', display: 'Language' },
	{ name: 'tags', display: 'Tags' },
] as const satisfies readonly PropertyDef[]

export type PropertyName = (typeof PROPERTIES)[number]['name']

/**
 * User-facing label for a property name. Schema fields return their registered
 * `display` (so the popup matches Logseq's capitalized property UI — `dateAdded`
 * → "Date Added", `url` → "URL"); names not in the schema (e.g. a custom template
 * field) fall back to a humanized camelCase → Title Case form.
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
