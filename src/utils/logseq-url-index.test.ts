import { describe, expect, test } from 'vitest'

import { normalizeUrl } from './logseq-url-index'

describe('normalizeUrl', () => {
	test('trims surrounding whitespace', () => {
		expect(normalizeUrl('  https://example.com  ')).toBe('https://example.com')
	})

	test('preserves case in path (paths are case-sensitive)', () => {
		expect(normalizeUrl('https://example.com/Foo/Bar')).toBe('https://example.com/Foo/Bar')
	})

	test('preserves trailing slash', () => {
		expect(normalizeUrl('https://example.com/foo/')).toBe('https://example.com/foo/')
	})

	test('preserves query params (incl. tracking)', () => {
		expect(normalizeUrl('https://example.com/?utm_source=x')).toBe('https://example.com/?utm_source=x')
	})

	test('returns null for null/undefined/empty/whitespace', () => {
		expect(normalizeUrl(null)).toBeNull()
		expect(normalizeUrl(undefined)).toBeNull()
		expect(normalizeUrl('')).toBeNull()
		expect(normalizeUrl('   ')).toBeNull()
	})

	test('returns null for non-string input', () => {
		expect(normalizeUrl(123 as unknown as string)).toBeNull()
	})
})
