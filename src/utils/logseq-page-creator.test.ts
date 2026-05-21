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
})

describe('buildClipBlocks', () => {
	test('always wraps content under a Page Content block', () => {
		expect(buildClipBlocks('Hello.', [])).toEqual([
			{ content: 'Page Content', children: [{ content: 'Hello.' }] },
		])
	})

	test('adds a Highlights section, with notes nested, when highlights exist', () => {
		expect(
			buildClipBlocks('Body.', [{ text: 'first' }, { text: 'second', note: 'note 2' }]),
		).toEqual([
			{ content: 'Page Content', children: [{ content: 'Body.' }] },
			{
				content: 'Highlights',
				children: [
					{ content: 'first' },
					{ content: 'second', children: [{ content: 'note 2' }] },
				],
			},
		])
	})

	test('omits the Highlights section when there are none', () => {
		expect(buildClipBlocks('Body.', []).some((b) => b.content === 'Highlights')).toBe(false)
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
