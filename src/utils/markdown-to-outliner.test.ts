import { describe, test, expect } from 'vitest'
import { markdownToBatchBlocks } from './markdown-to-outliner'

describe('markdownToBatchBlocks', () => {
	test('returns a single paragraph block', () => {
		expect(markdownToBatchBlocks('Hello world.')).toEqual([{ content: 'Hello world.' }])
	})

	test('splits paragraphs on blank lines', () => {
		const out = markdownToBatchBlocks('First.\n\nSecond.\n\nThird.')
		expect(out).toEqual([
			{ content: 'First.' },
			{ content: 'Second.' },
			{ content: 'Third.' },
		])
	})

	test('headings parent the content beneath them', () => {
		const md = '# Top\n\nintro.\n\n## A\n\na-text.\n\n## B\n\nb-text.\n'
		expect(markdownToBatchBlocks(md)).toEqual([
			{
				content: '# Top',
				children: [
					{ content: 'intro.' },
					{
						content: '## A',
						children: [{ content: 'a-text.' }],
					},
					{
						content: '## B',
						children: [{ content: 'b-text.' }],
					},
				],
			},
		])
	})

	test('headings of equal level become siblings', () => {
		const md = '## one\n\n## two\n'
		expect(markdownToBatchBlocks(md)).toEqual([
			{ content: '## one' },
			{ content: '## two' },
		])
	})

	test('deeper headings without an outer wrapper still render correctly', () => {
		const md = '### deep\n\nbody.\n'
		expect(markdownToBatchBlocks(md)).toEqual([
			{
				content: '### deep',
				children: [{ content: 'body.' }],
			},
		])
	})

	test('keeps heading markers by default', () => {
		expect(markdownToBatchBlocks('## A\n')).toEqual([{ content: '## A' }])
	})

	test('bolds headings (not plain) when useHeadingMarkers is false; nesting is unchanged', () => {
		const md = '# Top\n\nintro.\n\n## A\n\na-text.\n'
		expect(markdownToBatchBlocks(md, { useHeadingMarkers: false })).toEqual([
			{
				content: '**Top**',
				children: [
					{ content: 'intro.' },
					{
						content: '**A**',
						children: [{ content: 'a-text.' }],
					},
				],
			},
		])
	})

	test('flat unordered list', () => {
		const md = '- one\n- two\n- three\n'
		expect(markdownToBatchBlocks(md)).toEqual([
			{ content: '- one' },
			{ content: '- two' },
			{ content: '- three' },
		])
	})

	test('nested list by indentation', () => {
		const md = '- a\n  - a1\n  - a2\n- b\n'
		expect(markdownToBatchBlocks(md)).toEqual([
			{
				content: '- a',
				children: [{ content: '- a1' }, { content: '- a2' }],
			},
			{ content: '- b' },
		])
	})

	test('ordered list items are preserved with their markers', () => {
		const md = '1. first\n2. second\n'
		expect(markdownToBatchBlocks(md)).toEqual([
			{ content: '1. first' },
			{ content: '2. second' },
		])
	})

	test('lists live under their heading', () => {
		const md = '## items\n\n- one\n- two\n'
		expect(markdownToBatchBlocks(md)).toEqual([
			{
				content: '## items',
				children: [{ content: '- one' }, { content: '- two' }],
			},
		])
	})

	test('code fence becomes a single block', () => {
		const md = '```ts\nconst x = 1\n```\n'
		const out = markdownToBatchBlocks(md)
		expect(out).toHaveLength(1)
		expect(out[0].content).toBe('```ts\nconst x = 1\n```')
		expect(out[0].children).toBeUndefined()
	})

	test('code fence inside heading sits under it', () => {
		const md = '# code\n\n```\nx\n```\n'
		expect(markdownToBatchBlocks(md)).toEqual([
			{
				content: '# code',
				children: [{ content: '```\nx\n```' }],
			},
		])
	})

	test('blockquote and table become single blocks', () => {
		const md = '> quote line 1\n> quote line 2\n\n| a | b |\n|---|---|\n| 1 | 2 |\n'
		expect(markdownToBatchBlocks(md)).toEqual([
			{ content: '> quote line 1\n> quote line 2' },
			{ content: '| a | b |\n|---|---|\n| 1 | 2 |' },
		])
	})

	test('handles empty input', () => {
		expect(markdownToBatchBlocks('')).toEqual([])
		expect(markdownToBatchBlocks('\n\n\n')).toEqual([])
	})

	test('shallower heading pops deeper stack', () => {
		const md = '# A\n\n## A1\n\ntext.\n\n# B\n\nb-body.\n'
		expect(markdownToBatchBlocks(md)).toEqual([
			{
				content: '# A',
				children: [
					{
						content: '## A1',
						children: [{ content: 'text.' }],
					},
				],
			},
			{ content: '# B', children: [{ content: 'b-body.' }] },
		])
	})
})
