// Fork-owned, pure (no browser/SDK imports → unit-testable in node). The join
// between the companion Logseq plugin's flat settings keys and the clipper's
// capture config, plus the last-resort defaults. The live read + caching live in
// `logseq-remote-settings.ts`; this file is just the mapping so it can be tested
// without pulling in webextension-polyfill. Contract: LOGSEQ_SETTINGS_INTEGRATION.md
// Part 2 §C.

import { WEB_CLIPPING_TAG } from '@logseq-web-clipper/shared'
import type { LogseqCaptureSettings } from '../types/types'
import { DEFAULT_CREATOR_SEPARATOR, DEFAULT_CREATOR_TEMPLATE } from './author-format'
import { parseSectionOrder, WEB_SECTION_DEFAULT_ORDER } from './web-sections'

// Last-resort defaults, used only when neither a live plugin read nor a cached
// value is available. Each MUST match the companion plugin's seed default for
// the same key (see settings.md, Page template) so the two agree whether or not
// a live read succeeds. clippingTag falls back to WEB_CLIPPING_TAG (kept aligned
// with the plugin's `webTag` default).
export const DEFAULT_CAPTURE_SETTINGS: LogseqCaptureSettings = {
	abstractBlockName: 'Abstract',
	pageContentBlockName: 'Page Content',
	highlightsBlockName: 'Highlights',
	useHeadingMarkers: false,
	populatePageTags: false,
	capturePageContent: true,
	captureAbstract: true,
	foldAbstract: false,
	foldHighlights: false,
	foldPageContent: true,
	sectionOrder: WEB_SECTION_DEFAULT_ORDER,
	clippingTag: WEB_CLIPPING_TAG,
	creatorNameTemplate: DEFAULT_CREATOR_TEMPLATE,
	creatorSeparator: DEFAULT_CREATOR_SEPARATOR,
}

// The plugin's flat settings keys the extension reads. If the plugin renames a
// key, change it here — this is the one join point between the two repos.
export const PLUGIN_SETTING_KEYS = {
	clippingTag: 'webTag',
	capturePageContent: 'webCapturePageContent',
	captureAbstract: 'webCaptureAbstract',
	abstractBlockName: 'webAbstractBlockName',
	pageContentBlockName: 'webPageContentBlockName',
	highlightsBlockName: 'webHighlightsBlockName',
	useHeadingMarkers: 'webUseHeadingMarkers',
	populatePageTags: 'webPopulatePageTags',
	foldAbstract: 'webFoldAbstract',
	foldHighlights: 'webFoldHighlights',
	foldPageContent: 'webFoldPageContent',
	sectionOrder: 'webSectionOrder',
	// Shared (not web-prefixed): the General → Authors panel applies to every
	// source. `creatorsAsNodes` is deliberately absent — the extension reads its
	// effect through the discovered `authors` property type (node vs default), not
	// the key. See LOGSEQ_SETTINGS_INTEGRATION.md / settings.md "Author formatting".
	creatorNameTemplate: 'creatorNameTemplate',
	creatorSeparator: 'creatorSeparator',
} as const

/**
 * Map the plugin's raw settings object → the clipper's capture shape. Defensive:
 * a missing or wrong-typed key degrades to its default, so a partial or older
 * plugin never throws or yields garbage. A leading `#` on the tag is stripped
 * (saveToLogseq also strips/falls back, so either form is safe). `sectionOrder`
 * is parsed from the comma-separated `webSectionOrder` string and always yields
 * all three section ids exactly once.
 */
export function mapPluginSettings(raw: Record<string, unknown>): LogseqCaptureSettings {
	const str = (v: unknown, d: string) => (typeof v === 'string' && v.trim() ? v.trim() : d)
	const bool = (v: unknown, d: boolean) => (typeof v === 'boolean' ? v : d)
	// Whitespace-significant variant: a separator like ", " must NOT be trimmed
	// (trimming would drop the trailing space). Only an empty/non-string falls back.
	const sep = (v: unknown, d: string) => (typeof v === 'string' && v.length > 0 ? v : d)
	const K = PLUGIN_SETTING_KEYS
	return {
		clippingTag: str(raw[K.clippingTag], DEFAULT_CAPTURE_SETTINGS.clippingTag).replace(/^#/, ''),
		capturePageContent: bool(raw[K.capturePageContent], DEFAULT_CAPTURE_SETTINGS.capturePageContent),
		captureAbstract: bool(raw[K.captureAbstract], DEFAULT_CAPTURE_SETTINGS.captureAbstract),
		abstractBlockName: str(raw[K.abstractBlockName], DEFAULT_CAPTURE_SETTINGS.abstractBlockName),
		pageContentBlockName: str(raw[K.pageContentBlockName], DEFAULT_CAPTURE_SETTINGS.pageContentBlockName),
		highlightsBlockName: str(raw[K.highlightsBlockName], DEFAULT_CAPTURE_SETTINGS.highlightsBlockName),
		useHeadingMarkers: bool(raw[K.useHeadingMarkers], DEFAULT_CAPTURE_SETTINGS.useHeadingMarkers),
		populatePageTags: bool(raw[K.populatePageTags], DEFAULT_CAPTURE_SETTINGS.populatePageTags),
		foldAbstract: bool(raw[K.foldAbstract], DEFAULT_CAPTURE_SETTINGS.foldAbstract),
		foldHighlights: bool(raw[K.foldHighlights], DEFAULT_CAPTURE_SETTINGS.foldHighlights),
		foldPageContent: bool(raw[K.foldPageContent], DEFAULT_CAPTURE_SETTINGS.foldPageContent),
		sectionOrder: parseSectionOrder(raw[K.sectionOrder]),
		creatorNameTemplate: str(raw[K.creatorNameTemplate], DEFAULT_CAPTURE_SETTINGS.creatorNameTemplate),
		creatorSeparator: sep(raw[K.creatorSeparator], DEFAULT_CAPTURE_SETTINGS.creatorSeparator),
	}
}
