// Fork addition (not from upstream obsidian-clipper).
//
// A small floating note box for the in-reader annotation flow: write a thought
// and attach it to a highlight. Shared by two call sites —
//   1. the selection toolbar's "Note" action (reader.ts), which creates a
//      highlight + note in one step (Kindle-style), and
//   2. the existing-highlight "Note" action (highlighter-overlays.ts), which
//      adds or edits the note on a highlight that's already there.
//
// Self-contained: it injects its own styles (so it works on any page in reader
// mode without depending on the scss build) and lives in its own file to keep
// merges with upstream clean.

interface OpenNoteBoxOptions {
	/** Viewport-relative rect to anchor below (a selection or highlight box). */
	anchorRect: { left: number; top: number; right: number; bottom: number };
	/** Pre-fill text (when editing an existing note). */
	initialValue?: string;
	/** Called with the trimmed note when the user saves (may be empty). */
	onSubmit: (note: string) => void;
	/** Called when the box closes without saving. */
	onCancel?: () => void;
	/** Document to render into. Defaults to the global document. */
	doc?: Document;
}

const STYLE_ID = 'obsidian-note-box-style';
const BOX_WIDTH = 300;

let activeBox: HTMLElement | null = null;
let activeCleanup: (() => void) | null = null;

function injectStyle(doc: Document): void {
	if (doc.getElementById(STYLE_ID)) return;
	const style = doc.createElement('style');
	style.id = STYLE_ID;
	// Matches the dark pill aesthetic of the highlight/selection action buttons.
	style.textContent = `
.obsidian-note-box {
	position: absolute;
	z-index: 999999999;
	width: ${BOX_WIDTH}px;
	max-width: calc(100vw - 16px);
	box-sizing: border-box;
	display: flex;
	flex-direction: column;
	gap: 8px;
	padding: 10px;
	background: #353535;
	border: 1px solid #424242;
	border-radius: 12px;
	box-shadow: 0 4px 16px rgba(0, 0, 0, 0.3);
	font-family: ui-sans-serif, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Inter", sans-serif;
}
.obsidian-note-box textarea {
	width: 100%;
	min-height: 72px;
	resize: vertical;
	box-sizing: border-box;
	padding: 8px;
	background: #2a2a2a;
	color: #f0f0f0;
	border: 1px solid #4a4a4a;
	border-radius: 8px;
	font-family: inherit;
	font-size: 13px;
	line-height: 1.4;
	outline: none;
}
.obsidian-note-box textarea::placeholder { color: #9a9a9a; }
.obsidian-note-box textarea:focus { border-color: #6a6a6a; }
.obsidian-note-box-actions {
	display: flex;
	justify-content: flex-end;
	gap: 8px;
}
.obsidian-note-box-actions button {
	padding: 5px 12px;
	border-radius: 8px;
	font-family: inherit;
	font-size: 12px;
	font-weight: 500;
	line-height: 1;
	cursor: pointer;
	border: 1px solid transparent;
}
.obsidian-note-box-cancel {
	background: transparent;
	color: #cfcfcf;
	border-color: #4a4a4a;
}
.obsidian-note-box-cancel:hover { background: #424242; }
.obsidian-note-box-save {
	background: #f0f0f0;
	color: #1a1a1a;
}
.obsidian-note-box-save:hover { background: #ffffff; }
`;
	(doc.head ?? doc.documentElement).appendChild(style);
}

export function isNoteBoxOpen(): boolean {
	return activeBox !== null;
}

export function closeNoteBox(): void {
	if (activeCleanup) {
		const fn = activeCleanup;
		activeCleanup = null;
		fn();
	}
}

export function openNoteBox(opts: OpenNoteBoxOptions): void {
	const doc = opts.doc ?? document;
	closeNoteBox();
	injectStyle(doc);

	const box = doc.createElement('div');
	box.className = 'obsidian-note-box';

	const textarea = doc.createElement('textarea');
	textarea.placeholder = 'Add a note…';
	textarea.value = opts.initialValue ?? '';

	const actions = doc.createElement('div');
	actions.className = 'obsidian-note-box-actions';
	const cancelBtn = doc.createElement('button');
	cancelBtn.type = 'button';
	cancelBtn.className = 'obsidian-note-box-cancel';
	cancelBtn.textContent = 'Cancel';
	const saveBtn = doc.createElement('button');
	saveBtn.type = 'button';
	saveBtn.className = 'obsidian-note-box-save';
	saveBtn.textContent = 'Save';
	actions.appendChild(cancelBtn);
	actions.appendChild(saveBtn);

	box.appendChild(textarea);
	box.appendChild(actions);

	// Keep interactions inside the box from bubbling to page / highlighter
	// handlers (which would clear the selection or dismiss things mid-edit).
	box.addEventListener('mousedown', (e) => e.stopPropagation());
	box.addEventListener('click', (e) => e.stopPropagation());

	doc.body.appendChild(box);
	activeBox = box;

	// Position below the anchor, clamped to the viewport.
	const win = doc.defaultView ?? window;
	const boxWidth = box.offsetWidth || BOX_WIDTH;
	const clampedLeft = Math.max(8, Math.min(opts.anchorRect.left, win.innerWidth - boxWidth - 8));
	box.style.left = `${clampedLeft + win.scrollX}px`;
	box.style.top = `${opts.anchorRect.bottom + win.scrollY + 8}px`;

	let submitted = false;
	const onPointerDown = (e: Event) => {
		if (!box.contains(e.target as Node)) close();
	};
	const close = () => {
		doc.removeEventListener('pointerdown', onPointerDown, true);
		box.remove();
		if (activeBox === box) activeBox = null;
		activeCleanup = null;
		if (!submitted) opts.onCancel?.();
	};
	activeCleanup = close;

	const submit = () => {
		submitted = true;
		const value = textarea.value.trim();
		// Tear down first so focus returns to the page before onSubmit runs — the
		// selection-toolbar flow restores the saved range, which is only reliable
		// once the textarea has blurred.
		close();
		opts.onSubmit(value);
	};

	saveBtn.addEventListener('click', submit);
	cancelBtn.addEventListener('click', () => close());
	textarea.addEventListener('keydown', (e) => {
		if (e.key === 'Escape') {
			e.preventDefault();
			close();
		} else if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
			e.preventDefault();
			submit();
		}
	});

	// Click outside closes (cancels). Deferred + capture phase so the click that
	// opened the box doesn't immediately dismiss it.
	setTimeout(() => doc.addEventListener('pointerdown', onPointerDown, true), 0);

	textarea.focus();
	const len = textarea.value.length;
	textarea.setSelectionRange(len, len);
}
