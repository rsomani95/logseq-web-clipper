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
import { findPageByUrl, normalizeUrl } from './logseq-url-index'
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
	/**
	 * `created` — new page was written.
	 * `exists` — a page with this URL was already in the graph; no writes
	 *   happened. `pageUuid` / `pageName` point at that existing page.
	 */
	status: 'created' | 'exists'
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

/**
 * Parses an ISO datetime (or plain `YYYY-MM-DD`) and returns the LOCAL calendar
 * date as `YYYY-MM-DD`. Local — not UTC — because journal pages represent
 * "what day was it for the user when they clipped this"; a late-evening
 * negative-offset clip should land on the local day, not roll forward to the
 * next UTC day.
 */
function toJournalDate(value: string): string | null {
	const d = new Date(value)
	if (Number.isNaN(d.getTime())) return null
	const yyyy = d.getFullYear()
	const mm = String(d.getMonth() + 1).padStart(2, '0')
	const dd = String(d.getDate()).padStart(2, '0')
	return `${yyyy}-${mm}-${dd}`
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

	// URL-based dedupe. The `url` property is shared with logseq-zoterolocal-
	// plugin (same `:db/ident`), so this also catches the case where the user
	// imported the page via Zotero before clipping it here. Pattern mirrors
	// zoterolocal's `zotero-code-index` — keyed on a stable identifier, not on
	// the page name, so renaming a clipped page doesn't reopen the door to a
	// duplicate. If URL lookup fails (no url property on input, or the index
	// build erroring out), fall through to a normal create — better to risk
	// a rare manual cleanup than block the save.
	const urlProp = properties.find((p) => p.name === 'url')
	const normalizedUrl = normalizeUrl(urlProp?.value)
	if (normalizedUrl) {
		const existing = await findPageByUrl(api, normalizedUrl)
		if (existing) {
			try {
				await api.openPage(existing.title)
			} catch (err) {
				console.warn('[logseq-web-clipper] openPage on existing dupe failed:', err)
			}
			return {
				pageUuid: existing.uuid,
				pageName: existing.title,
				graphName: graph.name,
				matchedPropertyCount: 0,
				status: 'exists',
			}
		}
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

		// Date-typed properties in Logseq-DB are *references to journal pages*,
		// not strings. Create/fetch the journal page for the day, then write
		// `page.id` — same pattern as zoterolocal's `handle-zot-db.ts`.
		if (def.type === 'date') {
			const ymd = toJournalDate(prop.value)
			if (!ymd) {
				console.warn(`[logseq-web-clipper] could not parse ${prop.name} as date: "${prop.value}"`)
				continue
			}
			// Anchor to local noon, not bare YYYY-MM-DD. Logseq's
			// `create_journal_page` calls `new Date(input)`, and JS parses
			// bare `2026-05-16` as midnight UTC — which is the previous day
			// in any negative-offset timezone. Appending `T12:00:00` (no
			// offset) is parsed as local noon, so the journal lands on the
			// intended local day regardless of timezone.
			const localNoon = `${ymd}T12:00:00`
			try {
				const journalPage = await api.createJournalPage(localNoon)
				if (typeof journalPage?.id !== 'number') {
					console.warn(`[logseq-web-clipper] createJournalPage(${ymd}) returned no id for ${prop.name}`)
					continue
				}
				await api.upsertBlockProperty(page.uuid, ident(prop.name), journalPage.id)
				matched++
			} catch (err) {
				console.warn(`[logseq-web-clipper] failed to set date property ${prop.name}:`, err)
			}
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
		status: 'created',
	}
}
