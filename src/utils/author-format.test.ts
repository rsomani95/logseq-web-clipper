import { describe, expect, test } from 'vitest'

import {
	DEFAULT_CREATOR_TEMPLATE,
	formatAuthorName,
	formatAuthors,
	parseAuthors,
	parseOneName,
	type CreatorNameParts,
} from './author-format'

const FIRST_LAST = '<% firstName %> <% lastName %>'
const LAST_FIRST = '<% lastName %>, <% firstName %>'
const LAST_SPACE_FIRST = '<% lastName %> <% firstName %>'

describe('formatAuthorName — mirrors the plugin applyCreatorTemplate', () => {
	const jane: CreatorNameParts = { firstName: 'Jane', lastName: 'Doe' }

	test('First Last', () => expect(formatAuthorName(FIRST_LAST, jane)).toBe('Jane Doe'))
	test('Last, First', () => expect(formatAuthorName(LAST_FIRST, jane)).toBe('Doe, Jane'))
	test('Last First', () => expect(formatAuthorName(LAST_SPACE_FIRST, jane)).toBe('Doe Jane'))

	test('a verbatim {name} bypasses the template entirely', () => {
		expect(formatAuthorName(LAST_FIRST, { name: 'World Health Organization' })).toBe('World Health Organization')
	})

	test('a missing part collapses the leftover double space', () => {
		expect(formatAuthorName(FIRST_LAST, { lastName: 'Cher' })).toBe('Cher')
		expect(formatAuthorName(LAST_FIRST, { lastName: 'Plato' })).toBe('Plato,')
	})

	test('an unknown placeholder is stripped, not emitted', () => {
		expect(formatAuthorName('<% lastName %> <% middleName %>', jane)).toBe('Doe')
	})

	test('a template with no recognised token falls back to First Last', () => {
		expect(formatAuthorName('literal', jane)).toBe('Jane Doe')
	})

	test('undefined template renders First Last', () => {
		expect(formatAuthorName(undefined, jane)).toBe('Jane Doe')
	})
})

describe('parseOneName — first/last inference', () => {
	test('two-token "First Last"', () => {
		expect(parseOneName('John Smith')).toEqual({ firstName: 'John', lastName: 'Smith' })
	})

	test('three-token name → last token is the surname (multi-word given name)', () => {
		expect(parseOneName('Mary Jane Watson')).toEqual({ firstName: 'Mary Jane', lastName: 'Watson' })
	})

	test('nobiliary particle folds into the surname', () => {
		expect(parseOneName('Ludwig van Beethoven')).toEqual({ firstName: 'Ludwig', lastName: 'van Beethoven' })
		expect(parseOneName('Robert De Niro')).toEqual({ firstName: 'Robert', lastName: 'De Niro' })
		expect(parseOneName('Guido van Rossum')).toEqual({ firstName: 'Guido', lastName: 'van Rossum' })
	})

	test('consecutive particles all fold in', () => {
		expect(parseOneName('Oscar de la Renta')).toEqual({ firstName: 'Oscar', lastName: 'de la Renta' })
	})

	test('particle with initials in the given name', () => {
		expect(parseOneName('Ursula K. Le Guin')).toEqual({ firstName: 'Ursula K.', lastName: 'Le Guin' })
	})

	test('a mononym is used verbatim (single token → name)', () => {
		expect(parseOneName('Cher')).toEqual({ name: 'Cher' })
	})

	test('explicit "Last, First" input', () => {
		expect(parseOneName('Smith, John')).toEqual({ firstName: 'John', lastName: 'Smith' })
		expect(parseOneName('van Gogh, Vincent')).toEqual({ firstName: 'Vincent', lastName: 'van Gogh' })
	})

	test('generational suffix stays attached to the surname', () => {
		expect(parseOneName('Martin Luther King Jr.')).toEqual({ firstName: 'Martin Luther', lastName: 'King Jr.' })
		expect(parseOneName('Sammy Davis Jr.')).toEqual({ firstName: 'Sammy', lastName: 'Davis Jr.' })
	})

	test('institutional names are verbatim, never reordered', () => {
		expect(parseOneName('World Health Organization')).toEqual({ name: 'World Health Organization' })
		expect(parseOneName('University of California')).toEqual({ name: 'University of California' })
		expect(parseOneName('OpenAI, Inc.')).toEqual({ name: 'OpenAI, Inc.' })
	})
})

describe('parseAuthors — splitting a flat byline', () => {
	const names = (byline: string) => parseAuthors(byline).map((c) => formatAuthorName(FIRST_LAST, c))

	test('single author', () => expect(names('Jane Doe')).toEqual(['Jane Doe']))

	test('comma-separated "First Last" authors', () => {
		expect(names('Jane Doe, John Smith')).toEqual(['Jane Doe', 'John Smith'])
	})

	test('conjunction-separated authors ("and" / "&")', () => {
		expect(names('Jane Doe and John Smith')).toEqual(['Jane Doe', 'John Smith'])
		expect(names('Jane Doe & John Smith')).toEqual(['Jane Doe', 'John Smith'])
	})

	test('Oxford-comma list', () => {
		expect(names('Jane Doe, John Smith, and Bob Jones')).toEqual(['Jane Doe', 'John Smith', 'Bob Jones'])
	})

	test('a lone "Surname, Given" is ONE author, not two', () => {
		expect(names('Smith, John')).toEqual(['John Smith'])
	})

	test('semicolons mark "Last, First" authors (multi-word surnames survive)', () => {
		expect(names('Doe, Jane; Smith, John')).toEqual(['Jane Doe', 'John Smith'])
		expect(names('Doe, Jane; van Gogh, Vincent; King, Martin Luther')).toEqual([
			'Jane Doe',
			'Vincent van Gogh',
			'Martin Luther King',
		])
	})

	test('semicolons with "First Last" authors', () => {
		expect(names('Jane Doe; John Smith')).toEqual(['Jane Doe', 'John Smith'])
	})

	test('a leading "By " lead-in is stripped', () => {
		expect(names('By Jane Doe')).toEqual(['Jane Doe'])
		expect(names('by Jane Doe and John Smith')).toEqual(['Jane Doe', 'John Smith'])
	})

	test('messy whitespace is tolerated', () => {
		expect(names('  Jane Doe ,  John Smith  ')).toEqual(['Jane Doe', 'John Smith'])
	})

	test('empty / whitespace byline → no authors', () => {
		expect(parseAuthors('')).toEqual([])
		expect(parseAuthors('   ')).toEqual([])
	})
})

describe('formatAuthors — byline + template, end to end', () => {
	test('the default (First Last) is a no-op on a First-Last byline', () => {
		expect(formatAuthors('John Smith, Jane Doe', DEFAULT_CREATOR_TEMPLATE)).toEqual(['John Smith', 'Jane Doe'])
		expect(formatAuthors('John Smith, Jane Doe')).toEqual(['John Smith', 'Jane Doe'])
	})

	test('"Last, First" reorders every author', () => {
		expect(formatAuthors('John Smith, Jane Doe', LAST_FIRST)).toEqual(['Smith, John', 'Doe, Jane'])
		expect(formatAuthors('Ludwig van Beethoven and Johann Bach', LAST_FIRST)).toEqual([
			'van Beethoven, Ludwig',
			'Bach, Johann',
		])
	})

	test('a clipped author page name matches what Zotero would write (cross-source dedupe)', () => {
		// Zotero stores {firstName:"John", lastName:"Smith"} → "Smith, John"; the web
		// byline "John Smith" must resolve to the SAME page name so the two unify.
		const fromWeb = formatAuthors('John Smith', LAST_FIRST)[0]
		const fromZotero = formatAuthorName(LAST_FIRST, { firstName: 'John', lastName: 'Smith' })
		expect(fromWeb).toBe(fromZotero)
		expect(fromWeb).toBe('Smith, John')
	})

	test('institutions are never reordered, even under "Last, First"', () => {
		expect(formatAuthors('World Health Organization', LAST_FIRST)).toEqual(['World Health Organization'])
	})

	test('mononyms are never reordered', () => {
		expect(formatAuthors('Cher and Madonna', LAST_FIRST)).toEqual(['Cher', 'Madonna'])
	})
})
