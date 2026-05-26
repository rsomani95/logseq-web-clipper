import { describe, expect, test } from 'vitest'

import type { LogseqAPI, LogseqBlockEntity } from './logseq-api'
import {
	buildClipBlocks,
	highlightToBlock,
	mergeHighlightsIntoExistingPage,
	normalizeHighlightText,
	type ClipHighlight,
} from './logseq-page-creator'
import type { BatchBlock } from './markdown-to-outliner'

describe('highlightToBlock', () => {
	test('emits a single-line highlight as a plain block (no blockquote prefix)', () => {
		expect(highlightToBlock({ text: 'hello world' })).toEqual({ content: 'hello world' })
	})

	test('emits multi-line text verbatim', () => {
		expect(highlightToBlock({ text: 'line one\n\nline two' })).toEqual({
			content: 'line one\n\nline two',
		})
	})

	test('attaches a note as an indented child block', () => {
		expect(highlightToBlock({ text: 'quote', note: 'my thought' })).toEqual({
			content: 'quote',
			children: [{ content: 'my thought' }],
		})
	})

	test('ignores a blank/whitespace-only note', () => {
		expect(highlightToBlock({ text: 'quote', note: '   ' })).toEqual({ content: 'quote' })
	})

	test('keeps a heading highlight verbatim when markers are on', () => {
		expect(highlightToBlock({ text: '## Quote heading' }, true)).toEqual({ content: '## Quote heading' })
	})

	test('bolds a heading highlight when markers are off', () => {
		expect(highlightToBlock({ text: '## Quote heading' }, false)).toEqual({ content: '**Quote heading**' })
	})
})

describe('buildClipBlocks', () => {
	test('wraps non-empty content under a Page Content block', () => {
		expect(buildClipBlocks('Hello.', []).blocks).toEqual([
			{ content: 'Page Content', children: [{ content: 'Hello.' }] },
		])
	})

	test('omits the Page Content block when the body is empty (highlights-only clip)', () => {
		expect(buildClipBlocks('', [{ text: 'just this' }]).blocks).toEqual([
			{ content: 'Highlights', children: [{ content: 'just this' }] },
		])
	})

	test('omits the Page Content block when the body is whitespace-only', () => {
		expect(buildClipBlocks('   \n\n', [{ text: 'h' }]).blocks.some((b) => b.content === 'Page Content')).toBe(false)
	})

	test('returns no blocks when there is neither content nor highlights', () => {
		expect(buildClipBlocks('', [])).toEqual({ blocks: [], fold: [] })
	})

	test('adds a Highlights section first, with notes nested, when highlights exist', () => {
		expect(
			buildClipBlocks('Body.', [{ text: 'first' }, { text: 'second', note: 'note 2' }]).blocks,
		).toEqual([
			{
				content: 'Highlights',
				children: [
					{ content: 'first' },
					{ content: 'second', children: [{ content: 'note 2' }] },
				],
			},
			{ content: 'Page Content', children: [{ content: 'Body.' }] },
		])
	})

	test('omits the Highlights section when there are none', () => {
		expect(buildClipBlocks('Body.', []).blocks.some((b) => b.content === 'Highlights')).toBe(false)
	})

	test('uses custom block names from options', () => {
		expect(
			buildClipBlocks('Body.', [{ text: 'h' }], {
				pageContentBlockName: 'Article',
				highlightsBlockName: 'Notes',
			}).blocks,
		).toEqual([
			{ content: 'Notes', children: [{ content: 'h' }] },
			{ content: 'Article', children: [{ content: 'Body.' }] },
		])
	})

	test('falls back to defaults when option block names are blank', () => {
		expect(
			buildClipBlocks('Body.', [], { pageContentBlockName: '  ', highlightsBlockName: '' }).blocks,
		).toEqual([{ content: 'Page Content', children: [{ content: 'Body.' }] }])
	})

	test('passes useHeadingMarkers through to the outliner (off → bold)', () => {
		expect(buildClipBlocks('# Title', [], { useHeadingMarkers: false }).blocks).toEqual([
			{ content: 'Page Content', children: [{ content: '**Title**' }] },
		])
	})

	test('applies the heading rule to highlight blocks too', () => {
		expect(
			buildClipBlocks('Body.', [{ text: '## Quoted heading' }], { useHeadingMarkers: false }).blocks,
		).toEqual([
			{ content: 'Highlights', children: [{ content: '**Quoted heading**' }] },
			{ content: 'Page Content', children: [{ content: 'Body.' }] },
		])
	})

	test('leads with an Abstract block (summary as a single child) above Highlights and Page Content', () => {
		expect(
			buildClipBlocks('Body.', [{ text: 'h' }], {}, '  A short summary.  ').blocks,
		).toEqual([
			{ content: 'Abstract', children: [{ content: 'A short summary.' }] },
			{ content: 'Highlights', children: [{ content: 'h' }] },
			{ content: 'Page Content', children: [{ content: 'Body.' }] },
		])
	})

	test('emits the Abstract block even for an abstract-only clip', () => {
		expect(buildClipBlocks('', [], {}, 'Just the summary.').blocks).toEqual([
			{ content: 'Abstract', children: [{ content: 'Just the summary.' }] },
		])
	})

	test('omits the Abstract block when the abstract is blank or whitespace', () => {
		expect(buildClipBlocks('Body.', [], {}, '   ').blocks.some((b) => b.content === 'Abstract')).toBe(false)
		expect(buildClipBlocks('Body.', []).blocks.some((b) => b.content === 'Abstract')).toBe(false)
	})

	test('uses a custom abstract block name from options', () => {
		expect(buildClipBlocks('', [], { abstractBlockName: 'Summary' }, 'Text.').blocks).toEqual([
			{ content: 'Summary', children: [{ content: 'Text.' }] },
		])
	})

	// — fold flags —
	test('fold is all-false by default, index-aligned with the emitted sections', () => {
		expect(buildClipBlocks('Body.', [{ text: 'h' }], {}, 'Summary.').fold).toEqual([false, false, false])
	})

	test('a per-section fold flag maps to that section only', () => {
		const r = buildClipBlocks('Body.', [{ text: 'h' }], { foldAbstract: true, foldPageContent: true }, 'Summary.')
		expect(r.blocks.map((b) => b.content)).toEqual(['Abstract', 'Highlights', 'Page Content'])
		expect(r.fold).toEqual([true, false, true])
	})

	test('fold flags track which sections are actually present', () => {
		// highlights-only clip: a single section, a single fold flag
		const r = buildClipBlocks('', [{ text: 'h' }], { foldHighlights: true, foldPageContent: true })
		expect(r.blocks.map((b) => b.content)).toEqual(['Highlights'])
		expect(r.fold).toEqual([true])
	})

	// — section order —
	test('sectionOrder reorders the emitted blocks and their fold flags together', () => {
		const r = buildClipBlocks(
			'Body.',
			[{ text: 'h' }],
			{ sectionOrder: ['pageContent', 'abstract', 'highlights'], foldPageContent: true },
			'Summary.',
		)
		expect(r.blocks.map((b) => b.content)).toEqual(['Page Content', 'Abstract', 'Highlights'])
		expect(r.fold).toEqual([true, false, false])
	})

	// — capture toggles —
	test('captureAbstract:false drops the Abstract even when a summary is present', () => {
		expect(
			buildClipBlocks('Body.', [], { captureAbstract: false }, 'Summary.').blocks.map((b) => b.content),
		).toEqual(['Page Content'])
	})

	test('capturePageContent:false drops the Page Content even when a body is present', () => {
		expect(
			buildClipBlocks('Body.', [{ text: 'h' }], { capturePageContent: false }).blocks.map((b) => b.content),
		).toEqual(['Highlights'])
	})

	test('Highlights has no capture toggle — always emitted when present', () => {
		const r = buildClipBlocks('Body.', [{ text: 'h' }], { captureAbstract: false, capturePageContent: false }, 'S.')
		expect(r.blocks.map((b) => b.content)).toEqual(['Highlights'])
	})
})

describe('normalizeHighlightText', () => {
	test('strips a leading blockquote marker per line', () => {
		expect(normalizeHighlightText('> foo\n> bar')).toBe('foo bar')
	})

	test('collapses whitespace and trims', () => {
		expect(normalizeHighlightText('  foo   bar \n baz ')).toBe('foo bar baz')
	})

	test('matches quoted and unquoted forms of the same text', () => {
		expect(normalizeHighlightText('> hello world')).toBe(normalizeHighlightText('hello world'))
	})

	test('canonicalizes a heading across `#`, bold, and plain forms (dedup stays stable)', () => {
		const plain = normalizeHighlightText('Section title')
		expect(normalizeHighlightText('## Section title')).toBe(plain)
		expect(normalizeHighlightText('**Section title**')).toBe(plain)
	})
})

// Minimal LogseqAPI stub: the merge path only touches getPageBlocksTree and
// insertBatchBlock. Cast through `unknown` since we implement just those two.
function stubApi(tree: LogseqBlockEntity[]) {
	const inserts: { parent: string; blocks: BatchBlock[] }[] = []
	const api = {
		getPageBlocksTree: async () => tree,
		insertBatchBlock: async (parent: string, blocks: BatchBlock[]) => {
			inserts.push({ parent, blocks })
		},
	} as unknown as LogseqAPI
	return { api, inserts }
}

describe('mergeHighlightsIntoExistingPage', () => {
	test('writes nothing when there are no incoming highlights', async () => {
		const { api, inserts } = stubApi([])
		expect(await mergeHighlightsIntoExistingPage(api, 'page-uuid', [])).toBe(0)
		expect(inserts).toHaveLength(0)
	})

	test('appends only new highlights under an existing Highlights block', async () => {
		const tree: LogseqBlockEntity[] = [
			{ uuid: 'pc', title: 'Page Content', children: [{ uuid: 'b1', title: 'Body.' }] },
			// 'h1' is a legacy `> `-prefixed highlight (clipped before we dropped
			// the blockquote prefix) — it must still dedupe against clean incoming.
			{ uuid: 'hl', title: 'Highlights', children: [{ uuid: 'h1', title: '> already here' }] },
		]
		const { api, inserts } = stubApi(tree)
		const incoming: ClipHighlight[] = [
			{ text: 'already here' }, // dup of the legacy entry (quote-insensitive)
			{ text: 'brand new', note: 'thought' },
		]
		expect(await mergeHighlightsIntoExistingPage(api, 'page-uuid', incoming)).toBe(1)
		expect(inserts).toHaveLength(1)
		expect(inserts[0].parent).toBe('hl')
		expect(inserts[0].blocks).toEqual([
			{ content: 'brand new', children: [{ content: 'thought' }] },
		])
	})

	test('creates a Highlights block at page level when none exists', async () => {
		const tree: LogseqBlockEntity[] = [
			{ uuid: 'pc', title: 'Page Content', children: [{ uuid: 'b1', title: 'Body.' }] },
		]
		const { api, inserts } = stubApi(tree)
		expect(await mergeHighlightsIntoExistingPage(api, 'page-uuid', [{ text: 'new one' }])).toBe(1)
		expect(inserts).toHaveLength(1)
		expect(inserts[0].parent).toBe('page-uuid')
		expect(inserts[0].blocks).toEqual([
			{ content: 'Highlights', children: [{ content: 'new one' }] },
		])
	})

	test('returns 0 when every incoming highlight already exists', async () => {
		const tree: LogseqBlockEntity[] = [
			{ uuid: 'hl', title: 'Highlights', children: [{ uuid: 'h1', title: '> dup' }] },
		]
		const { api, inserts } = stubApi(tree)
		expect(await mergeHighlightsIntoExistingPage(api, 'page-uuid', [{ text: 'dup' }])).toBe(0)
		expect(inserts).toHaveLength(0)
	})
})
