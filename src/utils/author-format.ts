// Fork-owned, pure (no browser/SDK imports → unit-testable in node). Formats a
// web page's flat author byline the same way the companion plugin renders Zotero
// creators, so the SAME person clipped from the web and imported from Zotero lands
// on an identically-named author page (and, in node mode, dedupes to one page
// instead of forking a duplicate).
//
// The plugin works from STRUCTURED creators ({firstName,lastName}) and renders them
// with `creatorNameTemplate` (e.g. "<% lastName %>, <% firstName %>") joined by
// `creatorSeparator` — see logseq-zoterolocal-plugin/src/services/resolve-templates.ts
// (`applyCreatorTemplate`). A web byline is ONE flat string ("John Smith, Jane Doe"),
// so we add the layer the plugin doesn't need: split the byline into individual
// names and infer first/last per name, then run the same template rules.
// `formatAuthorName` mirrors `applyCreatorTemplate` so the output matches Zotero's;
// `parseAuthors` / `parseOneName` are the byline → parts layer.
//
// Splitting and first/last inference are heuristic by necessity (the web gives no
// structure), but aim to cover the common byline shapes — author-format.test.ts is
// the spec. Two rules carry most of the weight: (1) the last whitespace token is
// the surname, with any leading nobiliary particles ("van"/"de"/"Le"/…) folded into
// it and a trailing generational suffix ("Jr.") kept attached; (2) a single-token
// or clearly-institutional name is used verbatim, never reordered. The one known
// gap: multiple "Surname, Given" authors separated by bare commas (no semicolon)
// are ambiguous — use semicolons for that, which we handle.

export interface CreatorNameParts {
	firstName?: string
	lastName?: string
	/** A name used verbatim (single-token person / mononym, or an institution) —
	 * bypasses the template, never reordered. */
	name?: string
}

export const DEFAULT_CREATOR_TEMPLATE = '<% firstName %> <% lastName %>'
export const DEFAULT_CREATOR_SEPARATOR = ', '

// ---------------------------------------------------------------------------
// Template substitution — mirrors the plugin's resolve-templates.ts so web output
// matches Zotero's character-for-character.
// ---------------------------------------------------------------------------

// Case-insensitive, whitespace-tolerant matcher for one placeholder name.
const token = (name: string, flags = 'gi'): RegExp => new RegExp(`<%\\s*${name}\\s*%>`, flags)
const hasAnyToken = (template: string, names: string[]): boolean => names.some((n) => token(n, 'i').test(template))
// Drop any leftover `<% … %>` the substitution didn't recognise.
const stripUnknownTokens = (s: string): string => s.replace(/<%[^%]*%>/g, '')

/**
 * Renders one creator's name through the template. Single-field creators
 * (mononyms, institutions) bypass the template and use their `name` verbatim.
 * Otherwise tolerant of placeholder case/whitespace, falls back to "First Last"
 * when the template has no recognised placeholder, and collapses the double space
 * left when only one of the two parts is present. Direct mirror of the plugin's
 * `applyCreatorTemplate`.
 */
export function formatAuthorName(template: string | undefined, creator: CreatorNameParts): string {
	if (creator.name) return creator.name.trim()
	const tpl = template || ''
	const base = hasAnyToken(tpl, ['firstName', 'lastName']) ? tpl : DEFAULT_CREATOR_TEMPLATE
	const out = stripUnknownTokens(
		base.replace(token('firstName'), creator.firstName ?? '').replace(token('lastName'), creator.lastName ?? ''),
	)
		.replace(/\s+/g, ' ')
		.trim()
	return out || [creator.firstName, creator.lastName].filter(Boolean).join(' ').trim() || 'Unknown'
}

// ---------------------------------------------------------------------------
// Byline parsing
// ---------------------------------------------------------------------------

// Nobiliary / patronymic particles that belong WITH the surname, not the given
// name. Compared lowercased (trailing dot stripped). Folded into the surname when
// they immediately precede the last token: "Ludwig van Beethoven" → "van Beethoven";
// "Oscar de la Renta" → "de la Renta"; "Ursula K. Le Guin" → "Le Guin".
const PARTICLES = new Set([
	'van', 'von', 'der', 'den', 'de', 'del', 'della', 'dello', 'di', 'da', 'das', 'dos',
	'du', 'la', 'le', 'lo', 'los', 'las', 'ter', 'ten', 'te', 'el', 'al', 'bin', 'ibn', 'zu', 'st',
])

// Generational / honorific suffixes that trail the surname. Compared lowercased
// with a trailing dot stripped ("Jr." → "jr").
const SUFFIXES = new Set(['jr', 'sr', 'ii', 'iii', 'iv', 'v', 'phd', 'md', 'esq'])

// High-precision institutional words: tokens that are essentially never personal
// surnames, so a name containing one is treated as an institution (verbatim, never
// reordered). Deliberately tight — failing to reorder a real person is a gentler
// error than mangling an org, and reordering is opt-in anyway.
const INSTITUTION_RE =
	/\b(organization|organisation|university|institute|department|association|foundation|committee|commission|council|agency|ministry|bureau|gmbh|llc|inc|incorporated|corporation)\b/i

// Strong, unambiguous author separators: a semicolon, or the conjunctions "and" /
// "&" (with an optional leading Oxford comma). None of these occur inside a single
// person's name, so they always split authors.
const STRONG_SEPARATOR = /\s*;\s*|\s*,?\s+(?:and|&)\s+/i

const isSingleWord = (s: string): boolean => !/\s/.test(s.trim())
const stripDot = (s: string): string => s.replace(/\.$/, '')

/**
 * Parse one author string into {firstName,lastName} (or {name} when it should be
 * used verbatim). Rules, in order:
 *  - institutional (matches INSTITUTION_RE) → {name} verbatim.
 *  - contains a comma → "Last, First" form: left of the first comma is the surname,
 *    the rest is the given name(s).
 *  - one token → {name} verbatim (mononym).
 *  - else → the last token is the surname, with any immediately-preceding particles
 *    folded in and a trailing generational suffix kept attached; the rest is the
 *    given name(s).
 */
export function parseOneName(raw: string): CreatorNameParts {
	const s = raw.trim()
	if (!s) return { name: '' }
	if (INSTITUTION_RE.test(s)) return { name: s }

	const comma = s.indexOf(',')
	if (comma >= 0) {
		const last = s.slice(0, comma).trim()
		const first = s.slice(comma + 1).trim()
		if (!first) return { name: last }
		if (!last) return { name: first }
		return { firstName: first, lastName: last }
	}

	const tokens = s.split(/\s+/)
	if (tokens.length === 1) return { name: tokens[0] }

	// Detach a trailing generational suffix (re-attached to the surname below).
	// Guarded to ≥3 tokens so a 2-token name isn't split into surname + suffix.
	let suffix = ''
	if (tokens.length >= 3 && SUFFIXES.has(stripDot(tokens[tokens.length - 1]).toLowerCase())) {
		suffix = tokens.pop() as string
	}

	// Surname = last token + any leading particles. The `i >= 1` floor keeps at
	// least one token for the given name, so a particle is never consumed as the
	// whole first name.
	let i = tokens.length - 1
	const surname: string[] = [tokens[i]]
	i--
	while (i >= 1 && PARTICLES.has(stripDot(tokens[i]).toLowerCase())) {
		surname.unshift(tokens[i])
		i--
	}
	let lastName = surname.join(' ')
	if (suffix) lastName = `${lastName} ${suffix}`
	const firstName = tokens.slice(0, i + 1).join(' ')
	if (!firstName) return { name: s }
	return { firstName, lastName }
}

/**
 * Split a flat byline into individual creators. Strong separators (`;`, ` and `,
 * ` & `, including a leading Oxford comma) always split authors. Then:
 *  - a semicolon byline → each strong chunk is one author and a comma inside it is
 *    a "Last, First" marker (so multi-word surnames survive);
 *  - otherwise → commas separate authors (the common "First Last, First Last" web
 *    byline), EXCEPT a lone "Surname, Given" pair (exactly two single-word parts),
 *    which is one person in Last-First order.
 * A leading "By " lead-in is stripped.
 */
export function parseAuthors(byline: string): CreatorNameParts[] {
	const s = (byline || '').trim().replace(/^by\s+/i, '').trim()
	if (!s) return []

	const semicolonStyle = s.includes(';')
	const chunks = s.split(STRONG_SEPARATOR).map((t) => t.trim()).filter(Boolean)

	const rawNames: string[] = []
	for (const chunk of chunks) {
		if (semicolonStyle) {
			rawNames.push(chunk) // comma inside is "Last, First", not an author boundary
			continue
		}
		const parts = chunk.split(',').map((t) => t.trim()).filter(Boolean)
		if (parts.length <= 1) {
			rawNames.push(chunk)
		} else if (parts.length === 2 && isSingleWord(parts[0]) && isSingleWord(parts[1])) {
			rawNames.push(`${parts[0]}, ${parts[1]}`) // one person, "Last, First"
		} else {
			rawNames.push(...parts) // each "First Last" is its own author
		}
	}

	return rawNames.map(parseOneName).filter((c) => c.name || c.firstName || c.lastName)
}

/**
 * The public one-shot: a flat byline + the creator-name template → the list of
 * formatted author display names, in document order. node-typed `authors` links
 * one page per entry; default-typed joins them with `creatorSeparator`. An
 * undefined template renders "First Last".
 */
export function formatAuthors(byline: string, template?: string): string[] {
	return parseAuthors(byline)
		.map((c) => formatAuthorName(template, c).trim())
		.filter(Boolean)
}
