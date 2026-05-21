// Fork addition (not from upstream obsidian-clipper).
//
// Visual indicators that a highlight carries a note:
//   - Regular pages (we don't control the layout): a small note icon anchored at
//     the end of the highlighted text. Click it to read/edit via the floating
//     note box (note-input.ts).
//   - Reader mode (we own the layout): the full note rendered as a card in the
//     right margin, vertically aligned with its highlight, Kindle-style. The card
//     is edited *in place* — the text itself becomes editable, no box, no mode
//     switch — and a muted dotted elbow connector ties each card to its highlight
//     (on hover, or always, per the persistentConnectors setting).
//
// Self-contained: injects its own CSS and owns its reposition listeners (scroll /
// resize / reflow), so callers push the current note set via syncNoteIndicators()
// and route edits via editNoteInMargin(). Isolated in its own file to keep merges
// with upstream clean.

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
	/** Persistently show every connector (vs only the hovered / edited one). */
	persistentConnectors: boolean;
	/** Inline (regular-page) editing: open the floating note box. */
	edit: (id: string, anchor: { left: number; top: number; right: number; bottom: number }) => void;
	/** Margin (reader) editing: persist an in-place edit. */
	setNote: (id: string, note: string) => void;
}

// Start editing a note in the reader margin. Returns false when not in margin
// mode (caller should fall back to the floating box). For a brand-new note (no
// card yet) pass `getRect` so the transient card can be positioned; pass
// `onCommit` to override how the result is persisted (the selection-toolbar
// "Note" flow creates the highlight on commit rather than calling setNote).
export interface EditNoteInMarginOptions {
	doc: Document;
	id?: string;
	initialValue?: string;
	getRect: () => NoteRect | null;
	onCommit?: (note: string) => void;
	/** Editing abandoned via Esc (vs committed). Used by note-on-selection to
	 *  revert the highlight it created up front. */
	onCancel?: () => void;
}

const STYLE_ID = 'obsidian-note-indicators-style';
const MARGIN_GAP = 10;
const MARGIN_MIN_WIDTH = 140;
const ICON_SIZE = 16;
const SVG_NS = 'http://www.w3.org/2000/svg';
const CORNER_RADIUS = 10;
const PENDING_ID = '__obsidian_pending_note__';

const PEN_SVG = `<svg xmlns="http://www.w3.org/2000/svg" width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.25" stroke-linecap="round" stroke-linejoin="round"><path d="M12 20h9"/><path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4Z"/></svg>`;

let items: NoteItem[] = [];
let deps: NoteIndicatorDeps | null = null;
let lastMode: 'inline' | 'margin' | null = null;
const els = new Map<string, HTMLElement>();
let listenersAttached = false;
let resizeObserver: ResizeObserver | null = null;
let rafPending = false;

// Connector overlay (margin mode only).
let connectorSvg: SVGSVGElement | null = null;
const connectorPaths = new Map<string, SVGPathElement>();

// Hover / edit state. The "active" highlight (its connector goes full-strength,
// its card brightens) is whichever is being edited, else whichever is hovered.
let hoveredId: string | null = null;
let editingId: string | null = null;
let editOriginal = '';
let editSynthetic = false;
let editOnCommit: ((note: string) => void) | null = null;
let editOnCancel: (() => void) | null = null;

function activeId(): string | null {
	return editingId ?? hoveredId;
}

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
	border-radius: 0 6px 6px 0;
	color: var(--text-muted, #6b7280);
	font-family: var(--font-ui, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif);
	font-size: 0.8em;
	line-height: 1.45;
	cursor: pointer;
	white-space: pre-wrap;
	overflow-wrap: anywhere;
	transition: top 0.18s ease, color 0.12s ease, border-color 0.12s ease, background 0.12s ease;
}
.obsidian-reader-note-card:hover,
.obsidian-reader-note-card.is-linked {
	color: var(--text-normal, #111);
	border-left-color: var(--obsidian-note-accent, #f5c518);
}
/* Seamless in-place editing: the card text itself becomes editable. No box,
   no mode switch — a caret and a whisper of background. */
.obsidian-reader-note-card.is-editing {
	color: var(--text-normal, #111);
	background: color-mix(in srgb, var(--text-muted, #888) 7%, transparent);
	outline: none;
	cursor: text;
}
.obsidian-reader-note-card.is-editing:empty::before {
	content: 'Add a note…';
	color: var(--text-faint, #9a9a9a);
}
.obsidian-reader-note-connectors {
	position: absolute;
	inset: 0;
	width: 100%;
	height: 100%;
	overflow: visible;
	pointer-events: none;
	z-index: 0;
}
.obsidian-reader-note-connectors path {
	fill: none;
	stroke: color-mix(in srgb, var(--text-muted, #888) 55%, transparent);
	stroke-width: 2;
	stroke-linecap: round;
	stroke-dasharray: 0.1 7;
	opacity: 0;
	transition: opacity 0.15s ease;
}
.obsidian-reader-note-connectors path.show { opacity: 0.4; }
.obsidian-reader-note-connectors path.show-strong { opacity: 1; }
`;
	(doc.head ?? doc.documentElement).appendChild(style);
}

function isReaderMode(doc: Document): boolean {
	return doc.documentElement.classList.contains('obsidian-reader-active');
}

function getSidebar(doc: Document): HTMLElement | null {
	return doc.querySelector('.obsidian-reader-right-sidebar') as HTMLElement | null;
}

// The reading column's text element — the connector starts at its right edge so
// it travels through the gutter without crossing body text.
function getContentEl(doc: Document): HTMLElement | null {
	return (doc.querySelector('.obsidian-reader-content article')
		?? doc.querySelector('article')
		?? doc.querySelector('.obsidian-reader-content')) as HTMLElement | null;
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
	card.textContent = item.note;
	// Keep page / highlighter handlers from clearing things on interaction.
	card.addEventListener('mousedown', (e) => e.stopPropagation());
	card.addEventListener('click', (e) => {
		e.stopPropagation();
		if (editingId !== item.id) startEdit(item.id);
	});
	card.addEventListener('mouseenter', () => setHovered(item.id));
	card.addEventListener('mouseleave', () => setHovered(null));
	card.addEventListener('input', () => {
		if (editingId !== item.id || !deps) return;
		layoutMargin(deps.doc);   // live reflow: neighbours move as the note grows
		redrawConnectors();
	});
	card.addEventListener('keydown', (e) => {
		if (editingId !== item.id) return;
		if (e.key === 'Escape') { e.preventDefault(); cancelEdit(); }
		else if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) { e.preventDefault(); commitEdit(); }
	});
	card.addEventListener('blur', () => { if (editingId === item.id) commitEdit(); });
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

// rounded-polyline path: straight runs, soft turns.
function roundedPath(pts: { x: number; y: number }[], r: number): string {
	if (pts.length < 2) return '';
	const len = (a: { x: number; y: number }, b: { x: number; y: number }) => Math.hypot(b.x - a.x, b.y - a.y);
	let d = `M ${pts[0].x} ${pts[0].y}`;
	for (let i = 1; i < pts.length - 1; i++) {
		const p0 = pts[i - 1], p1 = pts[i], p2 = pts[i + 1];
		const l1 = len(p0, p1) || 1, l2 = len(p1, p2) || 1;
		const r1 = Math.min(r, l1 / 2), r2 = Math.min(r, l2 / 2);
		const c1 = { x: p1.x + (p0.x - p1.x) / l1 * r1, y: p1.y + (p0.y - p1.y) / l1 * r1 };
		const c2 = { x: p1.x + (p2.x - p1.x) / l2 * r2, y: p1.y + (p2.y - p1.y) / l2 * r2 };
		d += ` L ${c1.x} ${c1.y} Q ${p1.x} ${p1.y} ${c2.x} ${c2.y}`;
	}
	const last = pts[pts.length - 1];
	return d + ` L ${last.x} ${last.y}`;
}

function ensureConnectorSvg(doc: Document): SVGSVGElement | null {
	const sb = getSidebar(doc);
	if (!sb) return null;
	if (connectorSvg && connectorSvg.parentNode === sb) return connectorSvg;
	if (connectorSvg) connectorSvg.remove();
	const svg = doc.createElementNS(SVG_NS, 'svg') as SVGSVGElement;
	svg.setAttribute('class', 'obsidian-reader-note-connectors');
	sb.insertBefore(svg, sb.firstChild);
	connectorSvg = svg;
	connectorPaths.clear();
	return svg;
}

function teardownConnectors(): void {
	if (connectorSvg) { connectorSvg.remove(); connectorSvg = null; }
	connectorPaths.clear();
}

function redrawConnectors(): void {
	if (!deps) return;
	const doc = deps.doc;
	if (currentMode(doc) !== 'margin') { teardownConnectors(); return; }
	const sb = getSidebar(doc);
	const svg = ensureConnectorSvg(doc);
	if (!sb || !svg) return;

	const sbRect = sb.getBoundingClientRect();
	const content = getContentEl(doc);
	const contentRight = content ? content.getBoundingClientRect().right : sbRect.left - 40;
	const active = activeId();
	const persistent = deps.persistentConnectors;

	const wanted = new Set(items.map((i) => i.id));
	for (const [id, p] of [...connectorPaths]) {
		if (!wanted.has(id)) { p.remove(); connectorPaths.delete(id); }
	}

	for (const item of items) {
		const card = els.get(item.id);
		const r = item.getRect();
		let p = connectorPaths.get(item.id);
		if (!card || !r || card.style.display === 'none') {
			if (p) p.classList.remove('show', 'show-strong');
			continue;
		}
		if (!p) {
			p = doc.createElementNS(SVG_NS, 'path') as SVGPathElement;
			svg.appendChild(p);
			connectorPaths.set(item.id, p);
		}
		// Sidebar-relative coordinates. The card sits at x=0 (its left edge); the
		// highlight is to the left of the sidebar, so startX is negative and the
		// elbow's vertical run lands in the gutter between column and margin.
		const startX = contentRight - sbRect.left;
		const startY = (r.top + r.bottom) / 2 - sbRect.top;
		const endX = 0;
		const endY = card.offsetTop + Math.min(16, card.offsetHeight / 2);
		const gutterX = startX + (endX - startX) * 0.5;
		p.setAttribute('d', roundedPath([
			{ x: startX, y: startY },
			{ x: gutterX, y: startY },
			{ x: gutterX, y: endY },
			{ x: endX, y: endY },
		], CORNER_RADIUS));
		p.classList.remove('show', 'show-strong');
		if (item.id === active) p.classList.add('show-strong');
		else if (persistent) p.classList.add('show');
	}
}

function setHovered(id: string | null): void {
	if (hoveredId === id) return;
	hoveredId = id;
	updateLinkClasses();
	redrawConnectors();
}

// Called from the highlighter's hover hit-test so hovering the highlighted text
// lights up its margin card + connector. `id` is the note's representative id
// (or null). Ignored while editing (the edit owns the active state).
export function setHoveredHighlight(id: string | null): void {
	if (editingId) return;
	if (!deps || currentMode(deps.doc) !== 'margin') return;
	setHovered(id);
}

function updateLinkClasses(): void {
	const active = activeId();
	for (const [id, el] of els) el.classList.toggle('is-linked', id === active);
}

function placeCaretEnd(el: HTMLElement): void {
	const doc = el.ownerDocument;
	const win = doc.defaultView ?? window;
	const range = doc.createRange();
	range.selectNodeContents(el);
	range.collapse(false);
	const sel = win.getSelection();
	if (sel) { sel.removeAllRanges(); sel.addRange(range); }
}

// Serialize a contenteditable's content to plain text deterministically.
//
// `innerText` is unreliable for this: a blank line between two paragraphs leaves
// Chrome with an empty `<div><br></div>`, and innerText counts *both* the block
// boundary and the filler <br> against it — so one blank line round-trips as two
// (the reported "gap expands" bug). We walk the DOM instead: a <br> is one
// newline, and a block element opens a new line only when content already
// precedes it (the *next* block contributes its own leading newline, so we never
// emit a trailing one that would double up).
const EDITABLE_BLOCK_TAGS = /^(DIV|P|LI|H[1-6]|BLOCKQUOTE|PRE|SECTION|ARTICLE|UL|OL|FIGURE|TABLE|TR)$/;
export function readEditableText(el: HTMLElement): string {
	let out = '';
	const walk = (node: Node): void => {
		for (const child of Array.from(node.childNodes)) {
			if (child.nodeType === Node.TEXT_NODE) {
				out += child.textContent ?? '';
			} else if (child.nodeName === 'BR') {
				out += '\n';
			} else if (child.nodeType === Node.ELEMENT_NODE) {
				if (EDITABLE_BLOCK_TAGS.test(child.nodeName) && out !== '' && !out.endsWith('\n')) {
					out += '\n';
				}
				walk(child);
			}
		}
	};
	walk(el);
	return out;
}

function startEdit(id: string): void {
	const item = items.find((i) => i.id === id);
	if (!item || !deps) return;
	editNoteInMargin({ doc: deps.doc, id, initialValue: item.note, getRect: item.getRect });
}

export function editNoteInMargin(opts: EditNoteInMarginOptions): boolean {
	const doc = opts.doc;
	if (currentMode(doc) !== 'margin') return false;
	injectStyle(doc);
	ensureListeners(doc);

	const id = opts.id ?? PENDING_ID;
	if (editingId && editingId !== id) commitEdit();

	let item = items.find((i) => i.id === id);
	let synthetic = false;
	if (!item) {
		// Brand-new note (no card yet): add a transient item so render/layout treat
		// it uniformly. It's dropped on cancel; on commit the real refresh replaces it.
		item = { id, note: opts.initialValue ?? '', getRect: opts.getRect };
		items.push(item);
		synthetic = true;
	}
	render();

	const card = els.get(id);
	if (!card) {
		if (synthetic) removeSynthetic(id);
		return false;
	}
	editingId = id;
	editOriginal = opts.initialValue ?? item.note;
	editSynthetic = synthetic;
	editOnCommit = opts.onCommit ?? ((note: string) => deps?.setNote(id, note));
	editOnCancel = opts.onCancel ?? null;
	card.classList.add('is-editing');
	card.setAttribute('contenteditable', 'true');
	card.spellcheck = false;
	card.textContent = editOriginal;
	setHovered(id);
	card.focus();
	placeCaretEnd(card);
	return true;
}

function commitEdit(): void {
	const id = editingId;
	if (!id) return;
	const card = els.get(id);
	const text = card ? readEditableText(card).trim() : '';
	const onCommit = editOnCommit;
	const synthetic = editSynthetic;
	editingId = null;
	editOnCommit = null;
	editOnCancel = null;
	editSynthetic = false;
	hoveredId = null;
	if (card) {
		card.removeAttribute('contenteditable');
		card.classList.remove('is-editing');
	}
	if (synthetic) removeSynthetic(id);
	// onCommit (setNote, or the toolbar's create-highlight) runs applyHighlights →
	// refreshNoteIndicators → syncNoteIndicators, which rebuilds cards from the
	// persisted state. Nothing more to do here.
	onCommit?.(text);
}

function cancelEdit(): void {
	const id = editingId;
	if (!id) return;
	const card = els.get(id);
	const synthetic = editSynthetic;
	const onCancel = editOnCancel;
	editingId = null;
	editOnCommit = null;
	editOnCancel = null;
	editSynthetic = false;
	hoveredId = null;
	if (card) {
		card.removeAttribute('contenteditable');
		card.classList.remove('is-editing');
		card.blur();
	}
	if (synthetic) {
		removeSynthetic(id);
	} else if (card) {
		card.textContent = editOriginal;
		if (deps) { layoutMargin(deps.doc); redrawConnectors(); }
	}
	// e.g. note-on-selection reverts the highlight it created up front.
	onCancel?.();
}

function removeSynthetic(id: string): void {
	items = items.filter((i) => i.id !== id);
	const el = els.get(id);
	if (el) { el.remove(); els.delete(id); }
	const p = connectorPaths.get(id);
	if (p) { p.remove(); connectorPaths.delete(id); }
	if (deps) { layoutMargin(deps.doc); redrawConnectors(); }
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
		teardownConnectors();
	}
	lastMode = mode;

	const wanted = new Set(items.map((i) => i.id));
	for (const [id, el] of [...els]) {
		if (id === editingId) continue;          // keep the card being edited
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
		} else if (item.id === editingId) {
			// Editing in progress — don't clobber the in-flight text.
		} else if (mode === 'margin') {
			if (el.textContent !== item.note) el.textContent = item.note;
		} else {
			el.title = item.note;
		}
	}

	if (mode === 'margin') {
		layoutMargin(doc);
		ensureConnectorSvg(doc);
		redrawConnectors();
		updateLinkClasses();
	} else {
		layoutInline(doc);
	}
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
	// Keep an in-progress synthetic edit alive across refreshes. note-on-selection
	// creates a highlight (→ applyHighlights → refreshNoteIndicators) and then opens
	// the editor on it; the note isn't persisted until commit, so it's absent from
	// nextItems. Re-merge it so the focused card keeps its place and connector.
	const editingItem = (editingId && editSynthetic) ? items.find((i) => i.id === editingId) : undefined;
	items = editingItem && !nextItems.some((i) => i.id === editingItem.id)
		? [...nextItems, editingItem]
		: nextItems;
	// Don't pay for styles / reposition listeners on pages that never get a note.
	// Once one exists the listeners stay (cheap, and they no-op when the set later
	// empties), so removal still repaints correctly.
	if (items.length > 0) {
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
	teardownConnectors();
	items = [];
	lastMode = null;
	hoveredId = null;
	editingId = null;
	editOnCommit = null;
	editOnCancel = null;
	editSynthetic = false;
}
