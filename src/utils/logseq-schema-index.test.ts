import { describe, expect, test } from 'vitest'

import type { LogseqAPI } from './logseq-api'
import { buildTagPropertyIndex, parseTagProperties, tagPropertiesQuery, TagPropertyIndex } from './logseq-schema-index'

// Mirrors the real `tagPropertiesQuery` result over the HTTP API: a single-element
// pull tuple, common attrs simplified (`ident`/`title`/`cardinality`) and
// namespaced ones kept (`:logseq.property/type`, `:logseq.property.class/*`). The
// tag has no own properties; everything is inherited from the Zotero class, whose
// own parent (Root Tag) carries none — so the recursion terminates there.
const liveShapeResult = [
	[
		{
			title: 'WebReference',
			':logseq.property.class/extends': [
				{
					title: 'Zotero',
					':logseq.property.class/extends': [{ title: 'Root Tag' }],
					':logseq.property.class/properties': [
						{ title: 'Authors', cardinality: ':db.cardinality/many', ident: ':plugin.property.logseq-zotero/authors', ':logseq.property/type': 'node' },
						{ title: 'Title', cardinality: ':db.cardinality/one', ident: ':plugin.property.logseq-zotero/title', ':logseq.property/type': 'default' },
						{ title: 'URL', cardinality: ':db.cardinality/one', ident: ':plugin.property.logseq-zotero/url', ':logseq.property/type': 'url' },
						{ title: 'Date Added', cardinality: ':db.cardinality/one', ident: ':plugin.property.logseq-zotero/date-added', ':logseq.property/type': 'date' },
					],
				},
			],
		},
	],
]

describe('parseTagProperties', () => {
	test('flattens own + inherited properties with type and cardinality', () => {
		const props = parseTagProperties(liveShapeResult)
		expect(props).toHaveLength(4)

		const byIdent = Object.fromEntries(props.map((p) => [p.ident, p]))
		expect(byIdent[':plugin.property.logseq-zotero/authors']).toMatchObject({
			title: 'Authors',
			type: 'node',
			cardinality: 'many',
		})
		expect(byIdent[':plugin.property.logseq-zotero/url']).toMatchObject({ type: 'url', cardinality: 'one' })
		expect(byIdent[':plugin.property.logseq-zotero/date-added']).toMatchObject({ type: 'date', cardinality: 'one' })
		expect(byIdent[':plugin.property.logseq-zotero/title']).toMatchObject({ type: 'default', cardinality: 'one' })
	})

	test('includes a tag’s own (directly-attached) properties, not just inherited', () => {
		const result = [
			[
				{
					title: 'Custom',
					':logseq.property.class/properties': [
						{ title: 'Note', cardinality: ':db.cardinality/one', ident: ':plugin.property.acme/note', ':logseq.property/type': 'default' },
					],
				},
			],
		]
		const props = parseTagProperties(result)
		expect(props).toHaveLength(1)
		expect(props[0].ident).toBe(':plugin.property.acme/note')
	})

	test('dedupes a property that appears on both the tag and an ancestor', () => {
		const result = [
			[
				{
					title: 'Child',
					':logseq.property.class/properties': [
						{ title: 'URL', cardinality: ':db.cardinality/one', ident: ':plugin.property.logseq-zotero/url', ':logseq.property/type': 'url' },
					],
					':logseq.property.class/extends': [
						{
							title: 'Parent',
							':logseq.property.class/properties': [
								{ title: 'URL', cardinality: ':db.cardinality/one', ident: ':plugin.property.logseq-zotero/url', ':logseq.property/type': 'url' },
							],
						},
					],
				},
			],
		]
		expect(parseTagProperties(result)).toHaveLength(1)
	})

	test('defaults missing type to "default" and missing cardinality to "one"', () => {
		const result = [[{ title: 'T', ':logseq.property.class/properties': [{ title: 'Bare', ident: ':plugin.property.acme/bare' }] }]]
		expect(parseTagProperties(result)[0]).toMatchObject({ type: 'default', cardinality: 'one' })
	})

	test('tolerates empty / malformed results', () => {
		expect(parseTagProperties([])).toEqual([])
		expect(parseTagProperties(null)).toEqual([])
		expect(parseTagProperties([[{ title: 'NoProps' }]])).toEqual([])
	})
})

describe('TagPropertyIndex.resolve', () => {
	const index = new TagPropertyIndex(parseTagProperties(liveShapeResult))

	test('matches by display title', () => {
		expect(index.resolve('URL')?.ident).toBe(':plugin.property.logseq-zotero/url')
		expect(index.resolve('Date Added')?.ident).toBe(':plugin.property.logseq-zotero/date-added')
	})

	test('is case- and whitespace-insensitive on the title', () => {
		expect(index.resolve('  date added  ')?.ident).toBe(':plugin.property.logseq-zotero/date-added')
	})

	test('returns undefined for a title the tag does not carry — no fuzzy fallback', () => {
		expect(index.resolve('Excerpt')).toBeUndefined()
		// Would have resolved under the old kebab/last-segment fallback; must not now.
		expect(index.resolve('Authors!!')).toBeUndefined()
	})
})

describe('buildTagPropertyIndex', () => {
	const fakeApi = (impl: () => Promise<unknown>): LogseqAPI => ({ datascriptQuery: impl } as unknown as LogseqAPI)

	test('builds a populated index from the query result', async () => {
		const index = await buildTagPropertyIndex(fakeApi(async () => liveShapeResult), 'WebReference')
		expect(index.size).toBe(4)
		expect(index.resolve('Title')?.type).toBe('default')
	})

	test('returns an empty index when discovery throws (schema-setup gap)', async () => {
		const index = await buildTagPropertyIndex(
			fakeApi(async () => {
				throw new Error('boom')
			}),
			'WebReference',
		)
		expect(index.size).toBe(0)
	})
})

describe('tagPropertiesQuery', () => {
	test('embeds the tag title and escapes embedded quotes', () => {
		expect(tagPropertiesQuery('WebReference')).toContain('"WebReference"')
		expect(tagPropertiesQuery('a"b')).toContain('"a\\"b"')
	})
})
