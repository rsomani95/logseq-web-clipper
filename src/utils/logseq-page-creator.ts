// Replaces obsidian-note-creator.ts. Pure logic — no DOM, no fetch directly.
// The HTTP transport is the injected LogseqAPI; the caller (background worker)
// instantiates it from settings.
//
// Pipeline: createPage → addBlockTag → per-property writes → insertBatchBlock.
// Node-typed properties (authors, tags) get one Logseq page per comma-separated
// value, linked via numeric page.id — mirrors the zoterolocal pattern.

import { PROPERTIES, WEB_CLIPPING_TAG, getProperty, ident, type PropertyName } from '@logseq-web-clipper/shared'

import type { Property } from '../types/types'
import type { LogseqAPI } from './logseq-api'
import { markdownToBatchBlocks } from './markdown-to-outliner'

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
 * Splits a property value into individual node-property entries. Used for
 * `authors` and `tags`, which are entered as comma-separated strings in the
 * template UI but stored as multiple linked pages on the clipped item.
 */
function splitNodeValues(value: string): string[] {
	return value
		.split(',')
		.map((s) => s.trim())
		.filter((s) => s.length > 0)
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
	// + tag already exist, the user can fix the field manually.
	let matched = 0
	for (const prop of properties) {
		if (!isSchemaName(prop.name)) continue
		if (!prop.value || prop.value.trim() === '') continue
		const def = getProperty(prop.name)

		if (def.type === 'node') {
			const values = splitNodeValues(prop.value)
			if (values.length === 0) continue
			let anySet = false
			for (const v of values) {
				try {
					const nodePage = await api.createPage(v, {}, { redirect: false })
					if (typeof nodePage?.id !== 'number') {
						console.warn(`[logseq-web-clipper] node page for ${prop.name}="${v}" returned no id`)
						continue
					}
					await api.upsertBlockProperty(page.uuid, ident(prop.name), nodePage.id)
					anySet = true
				} catch (err) {
					console.warn(`[logseq-web-clipper] failed to link node property ${prop.name}="${v}":`, err)
				}
			}
			if (anySet) matched++
			continue
		}

		try {
			await api.upsertBlockProperty(page.uuid, ident(prop.name), prop.value)
			matched++
		} catch (err) {
			console.warn(`[logseq-web-clipper] failed to set ${prop.name}:`, err)
		}
	}

	const blocks = markdownToBatchBlocks(content)
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
