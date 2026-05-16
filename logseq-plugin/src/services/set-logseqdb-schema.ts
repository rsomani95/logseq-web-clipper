import type { PropertySchema } from '@logseq/libs/dist/LSPlugin'

import { PROPERTIES, PROPERTY_NAMESPACE, WEB_CLIPPING_TAG, kebab } from '@logseq-web-clipper/shared'

// Mirrors logseq-zoterolocal-plugin's setLogseqDbSchema pattern. The shared
// schema package gives us the property list + per-field type/cardinality, so
// this file just translates each entry into the SDK calls.
//
// Why we set hide/description directly on the property block instead of via
// `upsertProperty`'s options: per zoterolocal's notes, the `name` opt is a
// no-op in current Logseq-DB and the SDK rewrites `schema.hide` to the
// unqualified `:hide?` while the UI reads the qualified `:logseq.property/hide?`.
// Setting them on the block bypasses both bugs.

export async function setLogseqDbSchema(): Promise<void> {
	const settingUpMsg = await logseq.UI.showMsg('Setting up Web Clipper schema...', 'warning', {
		timeout: 0,
	})

	await logseq.Editor.createTag(WEB_CLIPPING_TAG)

	for (const prop of PROPERTIES) {
		const ident = kebab(prop.name)
		const schema: Partial<PropertySchema> = {
			type: prop.type,
			cardinality: prop.cardinality,
		}

		await logseq.Editor.upsertProperty(ident, schema, { name: prop.display })

		const property = await logseq.Editor.getProperty(`${PROPERTY_NAMESPACE}/${ident}`)
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
	}

	for (const prop of PROPERTIES) {
		await logseq.Editor.addTagProperty(WEB_CLIPPING_TAG, kebab(prop.name))
	}

	logseq.UI.closeMsg(settingUpMsg)
	await logseq.UI.showMsg(
		`#${WEB_CLIPPING_TAG} schema set up with ${PROPERTIES.length} properties.`,
		'success',
	)
}
