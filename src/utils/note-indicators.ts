// Fork addition (not from upstream obsidian-clipper).
//
// Visual indicators that a highlight carries a note:
//   - Regular pages (we don't control the page layout): a small note icon
//     anchored at the end of the highlighted text. Click it to read/edit.
//   - Reader mode (we control the layout): the full note rendered as a card in
//     the right margin, vertically aligned with its highlight, Kindle-style.
//
// Self-contained: injects its own CSS (so it works on any page without the scss
// build) and owns its reposition listeners (scroll / resize / reflow), so the
// caller only pushes the current note set via syncNoteIndicators(). Isolated in
// its own file to keep merges with upstream clean.

import { setElementHTML } from './dom-utils';

// Viewport-relative geometry of a highlight's rendered region. `top`/`bottom`/
// `left`/`right` are the bounding box across all line rects; `end*` describe the
// last line (where the inline icon sits, after the highlighted text).
export interface NoteRect {
	top: number;
	bottom: number;
	left: number;
	right: number;
	endRight: number;
	endTop: number;
	endBottom: number;
}

export interface NoteItem {
	/** Highlight id the note edit targets (the group's first member). */
	id: string;
	/** The note text to display. */
	note: string;
	/** Live geometry of the highlight, recomputed on each reposition. */
	getRect: () => NoteRect | null;
}

export interface NoteIndicatorDeps {
	doc: Document;
	/** Open the note editor for a highlight, anchored to a viewport rect. */
	edit: (id: string, anchor: { left: number; top: number; right: number; bottom: number }) => void;
}

const STYLE_ID = 'obsidian-note-indicators-style';
const MARGIN_GAP = 10;
const MARGIN_MIN_WIDTH = 140;
const ICON_SIZE = 16;

const PEN_SVG = `<svg xmlns="http://www.w3.org/2000/svg" width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.25" stroke-linecap="round" stroke-linejoin="round"><path d="M12 20h9"/><path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4Z"/></svg>`;

let items: NoteItem[] = [];
let deps: NoteIndicatorDeps | null = null;
let lastMode: 'inline' | 'margin' | null = null;
const els = new Map<string, HTMLElement>();
let listenersAttached = false;
let resizeObserver: ResizeObserver | null = null;
let rafPending = false;

function injectStyle(doc: Document): void {
	if (doc.getElementById(STYLE_ID)) return;
	const style = doc.createElement('style');
	style.id = STYLE_ID;
	style.textContent = `
.obsidian-highlight-note-marker {
	position: absolute;
	width: ${ICON_SIZE}px;
	height: ${ICON_SIZE}px;
	display: flex;
	align-items: center;
	justify-content: center;
	padding: 0;
	margin: 0;
	background: #eab308;
	color: #1a1a1a;
	border: none;
	border-radius: 50%;
	box-shadow: 0 1px 3px rgba(0, 0, 0, 0.25);
	cursor: pointer;
	z-index: 999999997;
	transition: transform 0.1s ease, background 0.1s ease;
}
.obsidian-highlight-note-marker:hover {
	background: #f5c518;
	transform: scale(1.12);
}
.obsidian-highlight-note-marker svg { display: block; }
.obsidian-reader-note-card {
	position: absolute;
	left: 0;
	width: 100%;
	max-width: 280px;
	box-sizing: border-box;
	padding: 1px 0 1px 14px;
	border-left: 2px solid var(--obsidian-note-accent, #eab308);
	color: var(--text-muted, #6b7280);
	font-family: var(--font-ui, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif);
	font-size: 0.8em;
	line-height: 1.45;
	cursor: pointer;
	white-space: pre-wrap;
	overflow-wrap: anywhere;
	transition: color 0.12s ease, border-color 0.12s ease;
}
.obsidian-reader-note-card:hover {
	color: var(--text-normal, #111);
	border-left-color: #f5c518;
}
`;
	(doc.head ?? doc.documentElement).appendChild(style);
}

function isReaderMode(doc: Document): boolean {
	return doc.documentElement.classList.contains('obsidian-reader-active');
}

function getSidebar(doc: Document): HTMLElement | null {
	return doc.querySelector('.obsidian-reader-right-sidebar') as HTMLElement | null;
}

// Margin cards only when reader's right sidebar is present and wide enough to
// hold readable text; otherwise (regular pages, mobile reader) fall back to the
// inline icon, which is always visible.
function currentMode(doc: Document): 'inline' | 'margin' {
	const sb = getSidebar(doc);
	if (isReaderMode(doc) && sb && sb.clientWidth >= MARGIN_MIN_WIDTH) return 'margin';
	return 'inline';
}

function createIcon(doc: Document, item: NoteItem): HTMLElement {
	const btn = doc.createElement('button');
	btn.type = 'button';
	btn.className = 'obsidian-highlight-note-marker';
	btn.setAttribute('aria-label', 'View note');
	btn.title = item.note;
	setElementHTML(btn, PEN_SVG);
	btn.addEventListener('mousedown', (e) => { e.stopPropagation(); e.preventDefault(); });
	btn.addEventListener('click', (e) => {
		e.stopPropagation();
		e.preventDefault();
		const r = btn.getBoundingClientRect();
		deps?.edit(item.id, { left: r.left, top: r.top, right: r.right, bottom: r.bottom });
	});
	return btn;
}

function createCard(doc: Document, item: NoteItem): HTMLElement {
	const card = doc.createElement('div');
	card.className = 'obsidian-reader-note-card';
	const text = doc.createElement('div');
	text.className = 'obsidian-reader-note-card-text';
	text.textContent = item.note;
	card.appendChild(text);
	card.addEventListener('mousedown', (e) => e.stopPropagation());
	card.addEventListener('click', (e) => {
		e.stopPropagation();
		const r = card.getBoundingClientRect();
		deps?.edit(item.id, { left: r.left, top: r.top, right: r.right, bottom: r.bottom });
	});
	return card;
}

function layoutInline(doc: Document): void {
	const win = doc.defaultView ?? window;
	const sx = win.scrollX;
	const sy = win.scrollY;
	for (const item of items) {
		const el = els.get(item.id);
		if (!el) continue;
		const r = item.getRect();
		if (!r) { el.style.display = 'none'; continue; }
		el.style.display = '';
		el.style.left = `${r.endRight + 4 + sx}px`;
		el.style.top = `${(r.endTop + r.endBottom) / 2 - ICON_SIZE / 2 + sy}px`;
	}
}

function layoutMargin(doc: Document): void {
	const sb = getSidebar(doc);
	if (!sb) return;
	if (getComputedStyle(sb).position === 'static') sb.style.position = 'relative';
	const sbTop = sb.getBoundingClientRect().top;

	// Order by the highlight's vertical position, then stack downward so notes
	// for nearby highlights don't overlap.
	const placed = items
		.map((item) => ({ item, el: els.get(item.id), rect: item.getRect() }))
		.filter((e): e is { item: NoteItem; el: HTMLElement; rect: NoteRect } => !!e.el && !!e.rect)
		.sort((a, b) => a.rect.top - b.rect.top);

	let cursor = -Infinity;
	for (const { el, rect } of placed) {
		const desired = rect.top - sbTop;
		const top = Math.max(desired, cursor + MARGIN_GAP);
		el.style.display = '';
		el.style.top = `${top}px`;
		cursor = top + el.offsetHeight;
	}

	// Hide cards whose highlight isn't currently resolvable.
	for (const item of items) {
		if (item.getRect()) continue;
		const el = els.get(item.id);
		if (el) el.style.display = 'none';
	}
}

function render(): void {
	if (!deps) return;
	const doc = deps.doc;
	const mode = currentMode(doc);

	// Mode flip (entered/left reader, or sidebar appeared): drop the old-mode
	// elements; they're rebuilt below in the new mode.
	if (lastMode && mode !== lastMode) {
		for (const el of els.values()) el.remove();
		els.clear();
	}
	lastMode = mode;

	const wanted = new Set(items.map((i) => i.id));
	for (const [id, el] of [...els]) {
		if (!wanted.has(id)) { el.remove(); els.delete(id); }
	}

	const parent = mode === 'margin' ? getSidebar(doc) : doc.body;
	if (!parent) return;

	for (const item of items) {
		let el = els.get(item.id);
		if (!el) {
			el = mode === 'margin' ? createCard(doc, item) : createIcon(doc, item);
			els.set(item.id, el);
			parent.appendChild(el);
		} else if (mode === 'margin') {
			const text = el.querySelector('.obsidian-reader-note-card-text');
			if (text && text.textContent !== item.note) text.textContent = item.note;
		} else {
			el.title = item.note;
		}
	}

	if (mode === 'margin') layoutMargin(doc);
	else layoutInline(doc);
}

function scheduleRender(): void {
	if (rafPending) return;
	rafPending = true;
	requestAnimationFrame(() => { rafPending = false; render(); });
}

function ensureListeners(doc: Document): void {
	if (listenersAttached) return;
	listenersAttached = true;
	const win = doc.defaultView ?? window;
	win.addEventListener('scroll', scheduleRender, { passive: true });
	win.addEventListener('resize', scheduleRender);
	// Catches article reflow that doesn't fire scroll/resize — e.g. reader
	// font-size / line-width changes, late-loading images.
	if (typeof ResizeObserver !== 'undefined') {
		resizeObserver = new ResizeObserver(() => scheduleRender());
		resizeObserver.observe(doc.body);
	}
}

// Push the current set of noted highlights. Reconciles the DOM (adds/removes/
// updates), positions everything, and ensures reposition listeners are live.
export function syncNoteIndicators(nextItems: NoteItem[], nextDeps: NoteIndicatorDeps): void {
	deps = nextDeps;
	items = nextItems;
	// Don't pay for styles / reposition listeners on pages that never get a
	// note. Once one exists the listeners stay (cheap, and they no-op when the
	// set later empties), so removal still repaints correctly.
	if (nextItems.length > 0) {
		injectStyle(nextDeps.doc);
		ensureListeners(nextDeps.doc);
	}
	render();
}

// Tear down all indicator DOM. Listeners stay attached (cheap; they no-op while
// there are no items) so a subsequent sync repaints without re-wiring.
export function removeNoteIndicators(): void {
	for (const el of els.values()) el.remove();
	els.clear();
	items = [];
	lastMode = null;
}
