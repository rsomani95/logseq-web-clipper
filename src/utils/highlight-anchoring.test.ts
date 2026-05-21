import { describe, it, expect, beforeAll } from 'vitest';
import { parseHTML } from 'linkedom';
import { createAnchorContext, findQuoteSpan, normalizeText, sameImageSrc, AnchorContext } from './highlight-anchoring';

// The module walks the DOM with a TreeWalker, which needs NodeFilter. linkedom
// (the node-side DOM used here) doesn't expose it as a global; jsdom-style
// browsers do. Provide the standard constants when absent.
beforeAll(() => {
	const g = globalThis as unknown as { NodeFilter?: unknown };
	if (!g.NodeFilter) {
		g.NodeFilter = { SHOW_TEXT: 4, FILTER_ACCEPT: 1, FILTER_REJECT: 2, FILTER_SKIP: 3 };
	}
});

function ctxFor(html: string): AnchorContext {
	const { document } = parseHTML(`<!doctype html><html><body>${html}</body></html>`);
	const ctx = createAnchorContext(document as unknown as Document);
	if (!ctx) throw new Error('no anchor context');
	return ctx;
}

// Reconstruct the source text a normalized span points at, via the same
// node/offset arrays rangeFromSpan() uses to build the Range — so this exercises
// the offset mapping without needing DOM Range support.
function sourceForSpan(ctx: AnchorContext, span: [number, number]): string {
	let s = '';
	for (let i = span[0]; i < span[1]; i++) {
		s += (ctx.nodes[i].nodeValue ?? '')[ctx.offsets[i]];
	}
	return s.replace(/\s+/g, ' ');
}

describe('normalizeText', () => {
	it('collapses runs of whitespace and trims', () => {
		expect(normalizeText('  a\n\t b   c ')).toBe('a b c');
	});
});

describe('findQuoteSpan offset mapping', () => {
	it('maps a simple phrase back to the quote', () => {
		const ctx = ctxFor('<article><p>The quick brown fox jumps</p></article>');
		const span = findQuoteSpan('quick brown', ctx)!;
		expect(span).not.toBeNull();
		expect(sourceForSpan(ctx, span)).toBe('quick brown');
	});

	it('matches across element boundaries and collapsed whitespace', () => {
		const ctx = ctxFor('<article><p>Hello   <em>brave</em>\n  world!</p></article>');
		const span = findQuoteSpan('Hello brave world', ctx)!;
		expect(sourceForSpan(ctx, span)).toBe('Hello brave world');
	});

	it('handles a quote at the very start (offset 0)', () => {
		const ctx = ctxFor('<article><p>Start here then more</p></article>');
		const span = findQuoteSpan('Start here', ctx)!;
		expect(sourceForSpan(ctx, span)).toBe('Start here');
	});

	it('handles a trailing word (end-offset boundary)', () => {
		const ctx = ctxFor('<article><p>alpha beta gamma</p></article>');
		const span = findQuoteSpan('gamma', ctx)!;
		expect(sourceForSpan(ctx, span)).toBe('gamma');
	});

	it('returns null when the quote is absent', () => {
		const ctx = ctxFor('<article><p>nothing here</p></article>');
		expect(findQuoteSpan('absent phrase', ctx)).toBeNull();
	});

	it('returns null for an empty quote', () => {
		const ctx = ctxFor('<article><p>some text</p></article>');
		expect(findQuoteSpan('   ', ctx)).toBeNull();
	});
});

describe('findQuoteSpan disambiguation', () => {
	const html = '<article><p>a red cat sat</p><p>a big cat ran</p></article>';

	it('picks the first occurrence without context', () => {
		const ctx = ctxFor(html);
		const span = findQuoteSpan('cat', ctx)!;
		expect(ctx.norm.slice(span[0] - 4, span[0])).toBe('red ');
	});

	it('uses prefix/suffix context to pick the right occurrence', () => {
		const ctx = ctxFor(html);
		const span = findQuoteSpan('cat', ctx, { prefix: 'a big ', suffix: ' ran' })!;
		expect(ctx.norm.slice(span[0] - 4, span[0])).toBe('big ');
		expect(sourceForSpan(ctx, span)).toBe('cat');
	});
});

describe('sameImageSrc', () => {
	const base = 'https://example.com/articles/post';
	it('matches identical srcs', () => {
		expect(sameImageSrc('/img/a.png', '/img/a.png', base)).toBe(true);
	});
	it('matches by filename when paths differ (proxied/rewritten)', () => {
		expect(sameImageSrc('https://cdn.example.com/x/photo.jpg', '/assets/photo.jpg', base)).toBe(true);
	});
	it('does not match different filenames', () => {
		expect(sameImageSrc('/img/a.png', '/img/b.png', base)).toBe(false);
	});
	it('is false when either src is missing', () => {
		expect(sameImageSrc(null, '/img/a.png', base)).toBe(false);
	});
});
