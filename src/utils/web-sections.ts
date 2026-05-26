// Fork-owned, pure (no browser/SDK imports → unit-testable in node). Mirrors the
// companion plugin's `src/web-sections.ts`: the clipper writes up to three
// top-level section blocks onto a clipped page — Abstract, Highlights, Page
// Content — and the plugin owns their order via a `webSectionOrder` setting the
// extension reads over the HTTP API. `parseSectionOrder` here MUST stay
// byte-for-byte equivalent to the plugin's so both sides agree on what a stored
// value means (see LOGSEQ_SETTINGS_INTEGRATION.md, Page template). The two repos
// don't share code, so this is a deliberate mirror, not an import.

export type WebSectionId = 'abstract' | 'highlights' | 'pageContent'

export const WEB_SECTION_DEFAULT_ORDER: WebSectionId[] = ['abstract', 'highlights', 'pageContent']

const isWebSectionId = (v: string): v is WebSectionId =>
	v === 'abstract' || v === 'highlights' || v === 'pageContent'

/**
 * `webSectionOrder` persists as a comma-separated id list. Parsing is defensive:
 * keep recognised ids in their stored order (deduped), drop anything unknown,
 * then append any section the stored value omitted in canonical order. The result
 * always lists all three ids exactly once, so a stale/partial/hand-edited value
 * can never strand a section. Mirrors the plugin's parser exactly.
 */
export function parseSectionOrder(raw: unknown): WebSectionId[] {
	const stored = typeof raw === 'string' ? raw.split(',') : []
	const seen = new Set<WebSectionId>()
	const order: WebSectionId[] = []
	for (const part of stored) {
		const id = part.trim()
		if (isWebSectionId(id) && !seen.has(id)) {
			seen.add(id)
			order.push(id)
		}
	}
	for (const id of WEB_SECTION_DEFAULT_ORDER) {
		if (!seen.has(id)) order.push(id)
	}
	return order
}

export const serializeSectionOrder = (order: WebSectionId[]): string => order.join(',')
