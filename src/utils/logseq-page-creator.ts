// Replaces obsidian-note-creator.ts. Pure logic — no DOM, no fetch directly.
// The HTTP transport is the injected LogseqAPI; the caller (background worker)
// instantiates it from settings.
//
// Pipeline: createPage → addBlockTag → per-property writes → insertBatchBlock.
// Node-typed properties (authors, tags) get one Logseq page per comma-separated
// value, linked via numeric page.id — mirrors the zoterolocal pattern.

import { PROPERTIES, WEB_CLIPPING_TAG, displayName, type PropertyName } from '@logseq-web-clipper/shared'

import type { Property } from '../types/types'
import type { LogseqAPI, LogseqBlockEntity } from './logseq-api'
import { buildTagPropertyIndex } from './logseq-schema-index'
import { findPageByUrl, normalizeUrl } from './logseq-url-index'
import { markdownToBatchBlocks, styleHeadingLines, type BatchBlock } from './markdown-to-outliner'

/** A highlight captured for a clip, ready to render into the Highlights section. */
export interface ClipHighlight {
	/** Markdown of the highlighted content. */
	text: string
	/** Optional single note the user attached to this highlight. */
	note?: string
}

export interface SaveToLogseqInput {
	noteName: string
	content: string
	properties: Property[]
	/** Highlights captured for this clip, in document order. */
	highlights?: ClipHighlight[]
}

export interface SaveToLogseqResult {
	pageUuid: string
	pageName: string
	graphName: string
	matchedPropertyCount: number
	/**
	 * `created` — new page was written.
	 * `exists` — a page with this URL was already in the graph and had nothing
	 *   new to add; no writes happened. `pageUuid` / `pageName` point at it.
	 * `updated` — the page already existed, but new highlights were appended to
	 *   its "Highlights" block. See `addedHighlightCount`.
	 */
	status: 'created' | 'exists' | 'updated'
	/** For `updated`: number of new highlights appended to the existing page. */
	addedHighlightCount?: number
	/**
	 * Schema fields the clip tried to write but the reference tag doesn't carry —
	 * a schema-setup gap. Only populated on `created`; the popup warns when non-empty.
	 */
	missingProperties?: string[]
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

/**
 * Logseq-specific capture config (surfaced in the "Logseq Capture" settings
 * tab). Optional everywhere with sane defaults, so the pure builders stay
 * usable standalone in tests; real values flow from
 * generalSettings.logseqCaptureSettings via the background worker.
 */
export interface LogseqCaptureOptions {
	/** Block the clipped article body nests under. Default "Page Content". */
	pageContentBlockName?: string
	/** Block highlights nest under. Default "Highlights". */
	highlightsBlockName?: string
	/** Keep Markdown `#` markers on heading blocks. Default true. */
	useHeadingMarkers?: boolean
	/** The tag every clipped page carries (its schema class). A leading `#` is
	 * stripped; a blank value falls back to the shared `WEB_CLIPPING_TAG`. */
	clippingTag?: string
}

// Defaults for the block names above; also the dedupe anchor for re-imports.
const PAGE_CONTENT_HEADING = 'Page Content'
const HIGHLIGHTS_HEADING = 'Highlights'

/**
 * Canonical form of a highlight's text, for dedupe on re-import: strip leading
 * blockquote (legacy `> `) and heading (`#`) markers from each line, drop bold
 * styling, and collapse whitespace — so the dedup key is the *content*,
 * independent of how a heading highlight was rendered (`## Foo`, `**Foo**`, or
 * plain). Otherwise toggling the heading-marker setting between clips would make
 * the same highlight re-merge as a duplicate.
 */
export function normalizeHighlightText(text: string): string {
	return text
		.split(/\r?\n/)
		.map((line) => line.replace(/^\s*>\s?/, '').replace(/^\s*#{1,6}\s+/, ''))
		.join(' ')
		.replace(/\*\*(.+?)\*\*/g, '$1')
		.replace(/\s+/g, ' ')
		.trim()
}

/**
 * One highlight → a plain block, with its note (if any) as a child block.
 *
 * The text is emitted verbatim — deliberately NOT wrapped in a `> ` blockquote.
 * Logseq DB graphs dropped Markdown blockquote parsing (`> foo` now renders
 * literally), and a native quote is a block property
 * (`:logseq.property.node/display-type` = the keyword `:quote`) whose value
 * can't be set over the JSON HTTP API: the value arrives as a string and fails
 * Logseq's `keyword?` validation. A clean block is the correct, lossless shape.
 */
export function highlightToBlock(h: ClipHighlight, useHeadingMarkers: boolean = true): BatchBlock {
	// A highlight that is itself a heading follows the same rule as body
	// headings: keep `#` markers when on, bold when off.
	const block: BatchBlock = { content: styleHeadingLines(h.text, useHeadingMarkers) }
	const note = h.note?.trim()
	if (note) block.children = [{ content: note }]
	return block
}

/**
 * Builds the page body: a "Highlights" section (when the clip carries any)
 * followed by a "Page Content" wrapper around the clipped article. Highlights
 * lead — they're the reason the user clipped — so they sit at the top, above
 * the full-article body.
 *
 * The Page Content block is emitted only when the article body is non-empty. It
 * is empty when the user turned off "Capture page content" (the popup leaves the
 * content box blank) or cleared the box for this clip — a highlights-only
 * capture. Emitting it anyway would leave a bare, childless "Page Content"
 * block. Re-import doesn't depend on its presence: mergeHighlightsIntoExisting-
 * Page finds the Highlights block by name and creates it if absent.
 */
export function buildClipBlocks(
	contentMarkdown: string,
	highlights: ClipHighlight[],
	options: LogseqCaptureOptions = {},
): BatchBlock[] {
	const pageContentName = options.pageContentBlockName?.trim() || PAGE_CONTENT_HEADING
	const highlightsName = options.highlightsBlockName?.trim() || HIGHLIGHTS_HEADING
	const useHeadingMarkers = options.useHeadingMarkers ?? true
	const blocks: BatchBlock[] = []
	if (highlights.length > 0) {
		blocks.push({ content: highlightsName, children: highlights.map((h) => highlightToBlock(h, useHeadingMarkers)) })
	}
	const pageChildren = markdownToBatchBlocks(contentMarkdown, { useHeadingMarkers })
	if (pageChildren.length > 0) {
		blocks.push({ content: pageContentName, children: pageChildren })
	}
	return blocks
}

function blockText(b: LogseqBlockEntity): string {
	return (b.content ?? b.title ?? '').toString()
}

function findChildBlockByText(tree: LogseqBlockEntity[], text: string): LogseqBlockEntity | null {
	const want = text.trim().toLowerCase()
	for (const b of tree) {
		if (blockText(b).trim().toLowerCase() === want) return b
	}
	return null
}

/**
 * Re-import path: append highlights that aren't already on the page to its
 * "Highlights" block (creating that block if the page doesn't have one yet —
 * e.g. it was first clipped with no highlights, or imported via Zotero).
 * Returns the count actually added. Dedupe is by normalized highlight text.
 * Best-effort: any API failure logs and returns 0 so the caller still reports
 * the page as already-in-graph rather than surfacing an error.
 */
export async function mergeHighlightsIntoExistingPage(
	api: LogseqAPI,
	pageUuid: string,
	highlights: ClipHighlight[],
	highlightsBlockName: string = HIGHLIGHTS_HEADING,
	useHeadingMarkers: boolean = true,
): Promise<number> {
	if (highlights.length === 0) return 0

	let tree: LogseqBlockEntity[]
	try {
		tree = (await api.getPageBlocksTree(pageUuid)) ?? []
	} catch (err) {
		console.warn('[logseq-web-clipper] re-import: getPageBlocksTree failed; skipping highlight merge', err)
		return 0
	}

	const highlightsBlock = findChildBlockByText(tree, highlightsBlockName)
	const existing = new Set<string>()
	for (const child of highlightsBlock?.children ?? []) {
		const t = blockText(child)
		if (t) existing.add(normalizeHighlightText(t))
	}

	const fresh = highlights.filter((h) => !existing.has(normalizeHighlightText(h.text)))
	console.log(
		`[logseq-web-clipper] re-import: ${highlights.length} incoming highlight(s), ` +
			`${existing.size} already on page, ${fresh.length} new to add ` +
			`(Highlights block ${highlightsBlock ? 'found' : 'absent — will create'}).`,
	)
	if (fresh.length === 0) return 0

	const newBlocks = fresh.map((h) => highlightToBlock(h, useHeadingMarkers))
	try {
		if (highlightsBlock?.uuid) {
			await api.insertBatchBlock(highlightsBlock.uuid, newBlocks)
		} else {
			await api.insertBatchBlock(pageUuid, [{ content: highlightsBlockName, children: newBlocks }])
		}
	} catch (err) {
		console.warn('[logseq-web-clipper] re-import: failed to append highlights', err)
		return 0
	}
	return fresh.length
}

export async function saveToLogseq(
	api: LogseqAPI,
	input: SaveToLogseqInput,
	options: LogseqCaptureOptions = {},
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

	// The tag every clipped page carries (its schema class in Logseq). Configurable
	// via the Logseq Capture tab; a leading `#` is stripped and a blank value falls
	// back to the shared default. The companion plugin registers the property schema
	// on this same name, so the two must agree for the tag to carry that schema.
	const clipTag = (options.clippingTag ?? '').replace(/^#/, '').trim() || WEB_CLIPPING_TAG

	// Discover the properties #clipTag actually carries — its own plus everything
	// inherited via class `extends` — each mapped to the real `:db/ident`. We write
	// to discovered idents instead of deriving them from a plugin id + kebab guess:
	// whoever set up the schema owns the namespace, and we write to what exists.
	const schemaIndex = await buildTagPropertyIndex(api, clipTag)
	if (schemaIndex.size === 0) {
		// The tag carries no properties at all — the schema-setup plugin hasn't run
		// (or the tag doesn't exist / doesn't extend the schema class). Bail before
		// creating an orphan page; the popup shows this message verbatim.
		throw new Error(
			`Schema not set up — the "${clipTag}" tag carries no properties. ` +
				`Set up its schema in Logseq, then clip again.`,
		)
	}
	const urlIdent = schemaIndex.resolve(displayName('url'))?.ident

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
		const existing = await findPageByUrl(api, normalizedUrl, clipTag, urlIdent)
		if (existing) {
			// Don't duplicate the page — but if this clip carries highlights the
			// existing page doesn't have yet (e.g. it was clipped before they were
			// made), merge those in rather than no-op'ing.
			console.log(
				`[logseq-web-clipper] re-import: matched existing page; payload carries ` +
					`${(input.highlights ?? []).length} highlight(s).`,
			)
			const added = await mergeHighlightsIntoExistingPage(api, existing.uuid, input.highlights ?? [], options.highlightsBlockName, options.useHeadingMarkers ?? true)
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
				status: added > 0 ? 'updated' : 'exists',
				addedHighlightCount: added,
			}
		}
	}

	const page = await api.createPage(noteName, {}, { redirect: false })
	if (!page?.uuid) {
		throw new Error('Logseq returned no uuid from createPage — page may already exist')
	}

	await api.addBlockTag(page.uuid, clipTag)

	// Property writes are best-effort per field, each targeting the discovered
	// ident. A field the tag doesn't carry is skipped (collected below), never
	// invented: an unknown ident errors ("Plugins can only upsert its own
	// properties") and a bare name would fork the value into the caller's
	// `_test_plugin` namespace. One bad value shouldn't abort the save — the page
	// + tag already exist, so the user can fix any field by hand.
	let matched = 0
	const skipped: string[] = []
	for (const prop of properties) {
		if (!isSchemaName(prop.name)) continue
		if (!prop.value || prop.value.trim() === '') continue
		const discovered = schemaIndex.resolve(displayName(prop.name))
		if (!discovered) {
			skipped.push(prop.name)
			continue
		}

		if (discovered.type === 'node') {
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
					await api.upsertBlockProperty(page.uuid, discovered.ident, nodePage.id)
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
		if (discovered.type === 'date') {
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
				await api.upsertBlockProperty(page.uuid, discovered.ident, journalPage.id)
				matched++
			} catch (err) {
				console.warn(`[logseq-web-clipper] failed to set date property ${prop.name}:`, err)
			}
			continue
		}

		try {
			await api.upsertBlockProperty(page.uuid, discovered.ident, prop.value)
			matched++
		} catch (err) {
			console.warn(`[logseq-web-clipper] failed to set ${prop.name}:`, err)
		}
	}
	if (skipped.length > 0) {
		console.warn(
			`[logseq-web-clipper] ${skipped.length} field(s) not written — #${clipTag} doesn't carry: ` +
				`${skipped.join(', ')}. Is the schema set up for this tag?`,
		)
	}

	const blocks = buildClipBlocks(content, input.highlights ?? [], options)
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
		missingProperties: skipped,
	}
}
