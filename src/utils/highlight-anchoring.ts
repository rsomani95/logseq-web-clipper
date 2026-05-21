// Fork addition (not from upstream obsidian-clipper).
//
// Cross-view highlight re-anchoring. A highlight stores an xpath + character
// offsets against the DOM it was made in. Reader view (Defuddle-extracted
// <article>) and native view (the original page) are structurally different
// DOMs for the same URL, so that xpath resolves to nothing — or the wrong
// node — in the other view. To show a highlight across views we instead locate
// it by its text (a TextQuoteSelector, like the W3C annotation model): find the
// quoted string in the current document and build a Range over it.
//
// Isolated in its own file to keep merges with upstream clean. Pure DOM, no
// extension APIs.

// Whitespace-collapsed comparison key. HTML collapses runs of whitespace and
// the two layouts indent differently, so we match on normalized text.
export function normalizeText(s: string): string {
	return s.replace(/\s+/g, ' ').trim();
}

// Collapse whitespace but keep boundary spaces — used for prefix/suffix
// context, where the space adjacent to the quote must stay aligned with the
// (single-spaced) haystack for the comparison to line up.
function collapseWhitespace(s: string): string {
	return s.replace(/\s+/g, ' ');
}

// Plain text of a stored highlight's HTML content — the quote we search for.
// Memoized: content is immutable per highlight and applyHighlights re-runs on
// resize, so parsing each highlight's HTML every pass would be wasteful.
const quoteCache = new Map<string, string>();
export function getQuoteText(content: string): string {
	const cached = quoteCache.get(content);
	if (cached !== undefined) return cached;
	let text = '';
	try {
		text = new DOMParser().parseFromString(content, 'text/html').body.textContent ?? '';
	} catch {
		text = '';
	}
	if (quoteCache.size > 500) quoteCache.clear();
	quoteCache.set(content, text);
	return text;
}

// src of the first <img> in an element highlight's content, if any.
export function findImageSrc(content: string): string | null {
	try {
		const doc = new DOMParser().parseFromString(content, 'text/html');
		return doc.querySelector('img')?.getAttribute('src') ?? null;
	} catch {
		return null;
	}
}

// Two image srcs refer to the same image. Exact match, else same filename —
// reader view often rewrites/proxies URLs but keeps the basename.
export function sameImageSrc(a: string | null, b: string | null, baseUri: string): boolean {
	if (!a || !b) return false;
	if (a === b) return true;
	const base = (s: string): string => {
		try { return new URL(s, baseUri).pathname.split('/').pop() || s; }
		catch { return s.split(/[?#]/)[0].split('/').pop() || s; }
	};
	return base(a) === base(b);
}

// A normalized index over a content root's text, mapping each normalized
// character back to its source (text node + offset) so a match can become a
// Range. Built once per render pass and shared across highlights.
export interface AnchorContext {
	doc: Document;
	norm: string;
	nodes: Text[];
	offsets: number[];
}

// Skip our own injected UI and non-content nodes so they can't match a quote.
const EXCLUDE_SELECTOR =
	'script, style, noscript, .obsidian-reader-settings, .obsidian-highlighter-menu, .obsidian-note-box, .obsidian-reader-note-card, .obsidian-highlight-note-marker, .obsidian-highlight-delete, .obsidian-selection-action';

// Prefer the article so chrome (nav/footer) can't yield false matches; fall
// back to the body when there's no <article> (common on native pages).
function getContentRoot(doc: Document): Element | null {
	return (doc.querySelector('.obsidian-reader-content article') as Element | null)
		?? (doc.querySelector('article') as Element | null)
		?? doc.body
		?? doc.documentElement;
}

export function createAnchorContext(doc: Document): AnchorContext | null {
	const root = getContentRoot(doc);
	if (!root) return null;
	const walker = doc.createTreeWalker(root, NodeFilter.SHOW_TEXT, {
		acceptNode(node) {
			const parent = node.parentElement;
			if (!parent) return NodeFilter.FILTER_REJECT;
			if (parent.closest(EXCLUDE_SELECTOR)) return NodeFilter.FILTER_REJECT;
			return node.nodeValue && node.nodeValue.length > 0
				? NodeFilter.FILTER_ACCEPT
				: NodeFilter.FILTER_REJECT;
		},
	});

	let norm = '';
	const nodes: Text[] = [];
	const offsets: number[] = [];
	let prevSpace = true; // drop leading whitespace
	let node: Node | null;
	while ((node = walker.nextNode())) {
		const text = (node as Text).nodeValue ?? '';
		for (let i = 0; i < text.length; i++) {
			if (/\s/.test(text[i])) {
				if (prevSpace) continue;
				norm += ' ';
				prevSpace = true;
			} else {
				norm += text[i];
				prevSpace = false;
			}
			nodes.push(node as Text);
			offsets.push(i);
		}
	}
	return { doc, norm, nodes, offsets };
}

function rangeFromSpan(ctx: AnchorContext, start: number, end: number): Range | null {
	if (start < 0 || end <= start || end > ctx.norm.length) return null;
	try {
		const range = ctx.doc.createRange();
		range.setStart(ctx.nodes[start], ctx.offsets[start]);
		const last = end - 1;
		range.setEnd(ctx.nodes[last], ctx.offsets[last] + 1);
		return range.collapsed ? null : range;
	} catch {
		return null;
	}
}

function commonSuffixLen(a: string, b: string): number {
	let n = 0;
	while (n < a.length && n < b.length && a[a.length - 1 - n] === b[b.length - 1 - n]) n++;
	return n;
}

function commonPrefixLen(a: string, b: string): number {
	let n = 0;
	while (n < a.length && n < b.length && a[n] === b[n]) n++;
	return n;
}

export interface QuoteContext {
	prefix?: string;
	suffix?: string;
}

// Locate the quote in the haystack and return its normalized [start, end)
// span, or null. When the quote occurs more than once, prefix/suffix context
// (captured at creation) disambiguates; without it, the first occurrence wins.
// Pure string logic, separated from Range building so it can be unit-tested.
export function findQuoteSpan(quote: string, ctx: AnchorContext, context?: QuoteContext): [number, number] | null {
	const q = normalizeText(quote);
	if (!q) return null;

	const matches: number[] = [];
	let idx = ctx.norm.indexOf(q);
	while (idx !== -1) {
		matches.push(idx);
		if (matches.length >= 100) break;
		idx = ctx.norm.indexOf(q, idx + 1);
	}
	if (matches.length === 0) return null;

	let chosen = matches[0];
	if (matches.length > 1 && context && (context.prefix || context.suffix)) {
		// Keep boundary spaces so the char adjacent to the quote stays aligned
		// with the single-spaced haystack.
		const pre = collapseWhitespace(context.prefix ?? '');
		const suf = collapseWhitespace(context.suffix ?? '');
		let bestScore = -1;
		for (const m of matches) {
			let score = 0;
			if (pre) score += commonSuffixLen(ctx.norm.slice(Math.max(0, m - pre.length), m), pre);
			if (suf) score += commonPrefixLen(ctx.norm.slice(m + q.length, m + q.length + suf.length), suf);
			if (score > bestScore) { bestScore = score; chosen = m; }
		}
	}

	return [chosen, chosen + q.length];
}

// Locate the quote in the current document and return a Range, or null.
export function findQuoteRange(quote: string, ctx: AnchorContext, context?: QuoteContext): Range | null {
	const span = findQuoteSpan(quote, ctx, context);
	return span ? rangeFromSpan(ctx, span[0], span[1]) : null;
}
