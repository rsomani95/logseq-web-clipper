import { describe, it, expect, beforeAll } from 'vitest';
import { parseHTML } from 'linkedom';
import { readEditableText } from './note-indicators';

// readEditableText walks the DOM by nodeType. linkedom (the node-side DOM used
// here) doesn't expose Node as a global the way browsers do; provide the two
// constants the serializer reads when absent.
beforeAll(() => {
	const g = globalThis as unknown as { Node?: { TEXT_NODE: number; ELEMENT_NODE: number } };
	if (!g.Node) g.Node = { TEXT_NODE: 3, ELEMENT_NODE: 1 };
});

// Build a container holding the given innerHTML and serialize it, simulating the
// markup a contenteditable card ends up with after the user types.
function read(html: string): string {
	const { document } = parseHTML('<!doctype html><html><body></body></html>');
	const div = document.createElement('div');
	div.innerHTML = html;
	return readEditableText(div as unknown as HTMLElement);
}

describe('readEditableText', () => {
	it('round-trips a plain text node (note loaded, unedited)', () => {
		expect(read('A\n\nB')).toBe('A\n\nB');
	});

	// The reported bug: one blank line must not become two. Chrome represents the
	// blank line as an empty <div><br></div>; innerText counted both the block
	// boundary and the filler <br>, doubling the gap.
	it('keeps one blank line as one (Chrome: leading bare text)', () => {
		expect(read('A<div><br></div><div>B</div>')).toBe('A\n\nB');
	});

	it('keeps one blank line as one (Chrome: every line wrapped)', () => {
		expect(read('<div>A</div><div><br></div><div>B</div>')).toBe('A\n\nB');
	});

	it('keeps one blank line as one (Firefox: <br> based)', () => {
		expect(read('A<br><br>B')).toBe('A\n\nB');
	});

	it('treats adjacent paragraphs as a single line break (Chrome)', () => {
		expect(read('A<div>B</div>')).toBe('A\nB');
	});

	it('treats adjacent paragraphs as a single line break (Firefox)', () => {
		expect(read('A<br>B')).toBe('A\nB');
	});

	it('preserves two blank lines as two', () => {
		expect(read('A<div><br></div><div><br></div><div>B</div>')).toBe('A\n\n\nB');
	});

	it('flattens inline spans without adding breaks', () => {
		expect(read('a <b>bold</b> c')).toBe('a bold c');
	});
});
