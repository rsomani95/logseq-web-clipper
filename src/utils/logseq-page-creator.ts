// Replaces obsidian-note-creator.ts. Pure logic — no DOM, no fetch directly.
// The HTTP transport is the injected LogseqAPI; the caller (background worker)
// instantiates it from settings.
//
// Phase 2 scope: create a new page, tag it, write properties matching the
// #WebClipping schema, append the markdown body as one block per paragraph.
// Append-to-page and append-to-journal modes land in Phase 3.

import { PROPERTIES, WEB_CLIPPING_TAG, getProperty, ident, type PropertyName } from '@logseq-web-clipper/shared'

import type { Property } from '../types/types'
import type { LogseqAPI } from './logseq-api'

export interface SaveToLogseqInput {
	noteName: string
	content: string
	properties: Property[]
}

export interface SaveToLogseqResult {
	pageUuid: string
	pageName: string
	graphName: string
	matchedPropertyCount: number
}

const SCHEMA_NAME_SET = new Set<string>(PROPERTIES.map((p) => p.name))

function isSchemaName(name: string): name is PropertyName {
	return SCHEMA_NAME_SET.has(name)
}

/**
 * Splits the rendered markdown body into one Logseq block per paragraph.
 * Logseq renders markdown inside a block, so headings (`# X`), lists, and
 * inline formatting survive. True markdown-to-outliner conversion (lists
 * become nested blocks, headings become parents, etc.) is a Phase 3 polish.
 */
function paragraphsToBlocks(md: string): { content: string }[] {
	return md
		.split(/\n{2,}/)
		.map((p) => p.trim())
		.filter((p) => p.length > 0)
		.map((content) => ({ content }))
}

export async function saveToLogseq(
	api: LogseqAPI,
	input: SaveToLogseqInput,
): Promise<SaveToLogseqResult> {
	const { noteName, content, properties } = input

	if (!noteName.trim()) {
		throw new Error('Page name is required')
	}

	const graph = await api.getCurrentGraph()
	if (!graph?.name) {
		throw new Error('No current graph in Logseq')
	}
	const isDb = await api.checkCurrentIsDbGraph()
	if (!isDb) {
		throw new Error(`Graph "${graph.name}" is a file graph — Web Clipper requires a DB graph.`)
	}

	const page = await api.createPage(noteName, {}, { redirect: false })
	if (!page?.uuid) {
		throw new Error('Logseq returned no uuid from createPage — page may already exist')
	}

	await api.addBlockTag(page.uuid, WEB_CLIPPING_TAG)

	// Property writes are best-effort per field. One bad value (a malformed
	// date, an unset schema entry) shouldn't abort the whole save — the page
	// + tag already exist, the user can fix the field manually. Node-typed
	// properties (authors, tags) are skipped here pending Phase 3 support
	// for "create-page-per-value-and-link-by-uuid" writes.
	let matched = 0
	for (const prop of properties) {
		if (!isSchemaName(prop.name)) continue
		if (!prop.value || prop.value.trim() === '') continue
		const def = getProperty(prop.name)
		if (def.type === 'node') {
			console.info(`[logseq-web-clipper] skipping node-typed property ${prop.name} (not yet supported)`)
			continue
		}
		try {
			await api.upsertBlockProperty(page.uuid, ident(prop.name), prop.value)
			matched++
		} catch (err) {
			console.warn(`[logseq-web-clipper] failed to set ${prop.name}:`, err)
		}
	}

	const blocks = paragraphsToBlocks(content)
	if (blocks.length > 0) {
		await api.insertBatchBlock(page.uuid, blocks)
	}

	// Focus the new page so the user lands on it. Non-fatal if it fails.
	try {
		await api.openPage(noteName)
	} catch (err) {
		console.warn('[logseq-web-clipper] openPage failed:', err)
	}

	return {
		pageUuid: page.uuid,
		pageName: noteName,
		graphName: graph.name,
		matchedPropertyCount: matched,
	}
}
