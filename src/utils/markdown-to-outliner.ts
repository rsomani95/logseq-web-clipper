// Walks a markdown string and emits a tree of Logseq blocks (IBatchBlock).
//
// Why this exists: clipped content arrives as defuddle-produced markdown, but
// Logseq is an outliner — flat blocks lose the document's structure. This
// converter produces a hierarchy that matches reader intuition:
//
//   - Headings (`# H1`, `## H2`, …) become parent blocks; everything beneath a
//     heading is nested under it until a sibling or shallower heading appears.
//   - Lists (`-`, `*`, `+`, `1.`) become block trees; indentation maps to
//     nesting. Continuation lines fold into the previous item.
//   - Paragraphs (blank-line separated) become single blocks.
//   - Code fences are preserved verbatim as one block (markdown inside a
//     Logseq block renders, so the fence keeps highlighting + structure).
//   - Blockquotes, tables, HRs pass through as single blocks — Logseq's
//     markdown renderer handles them inside the block.
//
// We intentionally don't use a real markdown AST library; the input is
// defuddle-flavored markdown (predictable shape), and a line-level walk is
// small enough to keep here without an extra dep.

export interface BatchBlock {
	content: string
	children?: BatchBlock[]
}

interface ListItemContext {
	indent: number
	item: BatchBlock
}

const HEADING_RE = /^(#{1,6})\s+(.+)$/
const LIST_RE = /^(\s*)([-*+]|\d+[.)])\s+(.+)$/
const FENCE_RE = /^\s*(```|~~~)/

function isStructuralStart(line: string): boolean {
	if (HEADING_RE.test(line)) return true
	if (LIST_RE.test(line)) return true
	if (FENCE_RE.test(line)) return true
	return false
}

function leadingSpaces(line: string): number {
	const m = /^(\s*)/.exec(line)
	if (!m) return 0
	// Treat a tab as four spaces for nesting comparisons.
	return m[1].replace(/\t/g, '    ').length
}

/**
 * Consumes a contiguous run of list items starting at `start`. Returns the
 * built tree and the index of the next non-list line.
 */
function parseList(lines: string[], start: number): { items: BatchBlock[]; next: number } {
	const root: BatchBlock[] = []
	const stack: ListItemContext[] = []
	let i = start

	while (i < lines.length) {
		const line = lines[i]

		if (line.trim() === '') {
			// A blank line *might* end the list, but not if the next non-blank
			// line is a continuation/sublist at sufficient indent. Peek ahead.
			let j = i + 1
			while (j < lines.length && lines[j].trim() === '') j++
			if (j >= lines.length) break
			const nextLine = lines[j]
			const nextLead = leadingSpaces(nextLine)
			const minIndent = stack.length > 0 ? stack[stack.length - 1].indent + 1 : 0
			const isListLine = LIST_RE.test(nextLine)
			if (!isListLine && nextLead < minIndent) break
			// Continuation across the blank lines; resume from j.
			i = j
			continue
		}

		const listMatch = LIST_RE.exec(line)
		if (listMatch) {
			const indent = leadingSpaces(line)
			const marker = listMatch[2]
			const text = `${marker} ${listMatch[3].trim()}`
			const item: BatchBlock = { content: text }

			while (stack.length > 0 && stack[stack.length - 1].indent >= indent) {
				stack.pop()
			}

			if (stack.length === 0) {
				root.push(item)
			} else {
				const parent = stack[stack.length - 1].item
				if (!parent.children) parent.children = []
				parent.children.push(item)
			}
			stack.push({ indent, item })
			i++
			continue
		}

		// Non-list, non-blank line: continuation of the last item if indented
		// past it; otherwise the list is over.
		const lead = leadingSpaces(line)
		if (stack.length > 0 && lead > stack[stack.length - 1].indent) {
			const last = stack[stack.length - 1].item
			last.content = `${last.content}\n${line.trim()}`
			i++
			continue
		}
		break
	}

	return { items: root, next: i }
}

/**
 * Consumes a fenced code block starting at `start` (the fence line). Returns
 * the joined block content and the index past the closing fence.
 */
function parseFence(lines: string[], start: number): { content: string; next: number } {
	const fenceMatch = /^(\s*)(```+|~~~+)/.exec(lines[start])
	const fence = fenceMatch ? fenceMatch[2] : '```'
	const buf: string[] = [lines[start]]
	let i = start + 1
	while (i < lines.length) {
		buf.push(lines[i])
		if (lines[i].trim().startsWith(fence)) {
			i++
			break
		}
		i++
	}
	return { content: buf.join('\n'), next: i }
}

/**
 * Consumes a contiguous block of non-blank, non-structural lines as a single
 * paragraph block.
 */
function parseParagraph(lines: string[], start: number): { content: string; next: number } {
	const buf: string[] = [lines[start]]
	let i = start + 1
	while (i < lines.length && lines[i].trim() !== '' && !isStructuralStart(lines[i])) {
		buf.push(lines[i])
		i++
	}
	return { content: buf.join('\n').trim(), next: i }
}

/**
 * Apply the heading-marker setting to a block of (possibly multi-line) text:
 * with markers on the text is returned unchanged; with markers off, each
 * Markdown heading line becomes bold (`**text**`) so it still stands out while
 * the `#` level styling gives way to indentation/nesting. Shared by the article
 * body and highlight blocks so a clipped heading reads the same in both.
 */
export function styleHeadingLines(text: string, useHeadingMarkers: boolean): string {
	if (useHeadingMarkers) return text
	return text
		.split(/\r?\n/)
		.map((line) => {
			const m = HEADING_RE.exec(line)
			return m ? `**${m[2].trim()}**` : line
		})
		.join('\n')
}

export function markdownToBatchBlocks(
	md: string,
	options: { useHeadingMarkers?: boolean } = {},
): BatchBlock[] {
	// Heading blocks keep their `#` markers by default; the Logseq Capture
	// setting can turn them off so heading depth reads from indentation alone
	// (the headingStack nesting below already encodes the hierarchy either way).
	const useHeadingMarkers = options.useHeadingMarkers ?? true
	const lines = md.split(/\r?\n/)
	const root: BatchBlock[] = []
	// headingStack[level] holds the most recent heading block at that level.
	// Children of a heading get appended into headingStack[level].children.
	const headingStack: (BatchBlock | null)[] = [null, null, null, null, null, null, null]

	const childrenOf = (b: BatchBlock | null): BatchBlock[] => {
		if (!b) return root
		if (!b.children) b.children = []
		return b.children
	}
	const currentContainer = (): BatchBlock[] => {
		for (let lv = 6; lv >= 1; lv--) {
			if (headingStack[lv]) return childrenOf(headingStack[lv])
		}
		return root
	}

	let i = 0
	while (i < lines.length) {
		const line = lines[i]

		if (line.trim() === '') {
			i++
			continue
		}

		const headingMatch = HEADING_RE.exec(line)
		if (headingMatch) {
			const level = headingMatch[1].length
			const headingText = headingMatch[2].trim()
			const block: BatchBlock = {
				content: useHeadingMarkers ? `${headingMatch[1]} ${headingText}` : `**${headingText}**`,
			}
			let parent: BatchBlock | null = null
			for (let lv = level - 1; lv >= 1; lv--) {
				if (headingStack[lv]) {
					parent = headingStack[lv]
					break
				}
			}
			childrenOf(parent).push(block)
			headingStack[level] = block
			for (let lv = level + 1; lv <= 6; lv++) headingStack[lv] = null
			i++
			continue
		}

		if (FENCE_RE.test(line)) {
			const { content, next } = parseFence(lines, i)
			currentContainer().push({ content })
			i = next
			continue
		}

		if (LIST_RE.test(line)) {
			const { items, next } = parseList(lines, i)
			for (const item of items) currentContainer().push(item)
			i = next
			continue
		}

		const { content, next } = parseParagraph(lines, i)
		if (content) currentContainer().push({ content })
		i = next
	}

	return root
}
