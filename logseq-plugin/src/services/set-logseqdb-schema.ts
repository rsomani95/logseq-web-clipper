import type { PropertySchema } from '@logseq/libs/dist/LSPlugin'

import {
	PROPERTIES,
	PROPERTY_NAMESPACE,
	WEB_CLIPPING_TAG,
	ZOTERO_PROPERTY_NAMESPACE,
	ident,
	kebab,
} from '@logseq-web-clipper/shared'

// Sets up the #WebClipping tag and its properties. Mirrors zoterolocal's
// setLogseqDbSchema for our own (web-owned) fields, and reuses Zotero's
// existing properties for everything else — keeping #WebClipping and #Zotero
// pages on the same underlying property entities so cross-tag queries unify.
//
// Assumes the user has already run zoterolocal's "Add Zotero schema to
// Logseq" command. Missing Zotero properties are surfaced in the final
// notification with an actionable message; the tag still gets set up with
// whatever we could associate. Future work: a real wizard that detects
// the missing Zotero schema and offers to set it up first (or falls back
// to web-owned creation when the user doesn't have zoterolocal installed).
//
// Why we set hide/description on the property block instead of via
// `upsertProperty`'s options: per zoterolocal's notes, the `name` opt is a
// no-op in current Logseq-DB and the SDK rewrites `schema.hide` to the
// unqualified `:hide?` while the UI reads `:logseq.property/hide?`.

export async function setLogseqDbSchema(): Promise<void> {
	const settingUpMsg = await logseq.UI.showMsg('Setting up Web Clipper schema...', 'warning', {
		timeout: 0,
	})

	await logseq.Editor.createTag(WEB_CLIPPING_TAG)

	const missingZoteroProps: string[] = []

	for (const prop of PROPERTIES) {
		const propIdent = ident(prop.name)

		if (prop.ownedBy === 'zotero') {
			// Just verify the Zotero property exists; don't try to create or
			// modify it. If it's missing, the user hasn't set up Zotero's
			// schema yet — record it and continue so the rest of the setup
			// (web-owned fields, tag-property associations we can do) succeeds.
			const zoteroProp = await logseq.Editor.getProperty(propIdent)
			if (!zoteroProp?.uuid) {
				missingZoteroProps.push(prop.display)
				continue
			}
			await logseq.Editor.addTagProperty(WEB_CLIPPING_TAG, propIdent)
			continue
		}

		// web-owned: full create / configure / associate flow.
		const schema: Partial<PropertySchema> = {
			type: prop.type,
			cardinality: prop.cardinality,
		}
		await logseq.Editor.upsertProperty(kebab(prop.name), schema, { name: prop.display })

		const property = await logseq.Editor.getProperty(`${PROPERTY_NAMESPACE}/${kebab(prop.name)}`)
		if (!property?.uuid) continue

		if (property.title !== prop.display) {
			await logseq.Editor.updateBlock(property.uuid, prop.display)
		}
		await logseq.Editor.upsertBlockProperty(property.uuid, 'logseq.property/hide?', true)
		if (prop.description) {
			await logseq.Editor.upsertBlockProperty(
				property.uuid,
				'logseq.property/description',
				prop.description,
			)
		} else {
			await logseq.Editor.removeBlockProperty(property.uuid, 'logseq.property/description')
		}
		await logseq.Editor.addTagProperty(WEB_CLIPPING_TAG, propIdent)
	}

	logseq.UI.closeMsg(settingUpMsg)

	// Drop the user on the tag page so they can see what was just created
	// (schema panel + any existing #WebClipping items). pushState resolves by
	// the lowercased page name — same convention as `logseq.Editor.openPage`.
	await logseq.App.pushState('page', { name: WEB_CLIPPING_TAG.toLowerCase() })

	if (missingZoteroProps.length > 0) {
		await logseq.UI.showMsg(
			`#${WEB_CLIPPING_TAG} set up, but ${missingZoteroProps.length} Zotero properties were missing (${missingZoteroProps.join(', ')}). Run zoterolocal's "Add Zotero schema to Logseq" first, then re-run this command.`,
			'warning',
			{ timeout: 0 },
		)
		return
	}

	await logseq.UI.showMsg(
		`#${WEB_CLIPPING_TAG} schema set up. ${PROPERTIES.length} properties (${PROPERTIES.filter((p) => p.ownedBy === 'zotero').length} shared with Zotero, ${PROPERTIES.filter((p) => p.ownedBy === 'web').length} web-only).`,
		'success',
	)
}

// Re-export so callers don't need to know about the namespace constant directly.
export { ZOTERO_PROPERTY_NAMESPACE }
