// Fork-owned, pure (no browser/SDK imports → unit-testable in node). The join
// between the companion Logseq plugin's flat settings keys and the clipper's
// capture config, plus the last-resort defaults. The live read + caching live in
// `logseq-remote-settings.ts`; this file is just the mapping so it can be tested
// without pulling in webextension-polyfill. Contract: LOGSEQ_SETTINGS_INTEGRATION.md
// Part 2 §C.

import { WEB_CLIPPING_TAG } from '@logseq-web-clipper/shared'
import type { LogseqCaptureSettings } from '../types/types'

// Last-resort defaults, used only when neither a live plugin read nor a cached
// value is available. clippingTag falls back to WEB_CLIPPING_TAG (kept aligned
// with the plugin's `webTag` default).
export const DEFAULT_CAPTURE_SETTINGS: LogseqCaptureSettings = {
	pageContentBlockName: 'Page Content',
	highlightsBlockName: 'Highlights',
	useHeadingMarkers: false,
	populatePageTags: false,
	capturePageContent: true,
	clippingTag: WEB_CLIPPING_TAG,
}

// The plugin's flat settings keys the extension reads. If the plugin renames a
// key, change it here — this is the one join point between the two repos.
export const PLUGIN_SETTING_KEYS = {
	clippingTag: 'webTag',
	capturePageContent: 'webCapturePageContent',
	pageContentBlockName: 'webPageContentBlockName',
	highlightsBlockName: 'webHighlightsBlockName',
	useHeadingMarkers: 'webUseHeadingMarkers',
	populatePageTags: 'webPopulatePageTags',
} as const

/**
 * Map the plugin's raw settings object → the clipper's capture shape. Defensive:
 * a missing or wrong-typed key degrades to its default, so a partial or older
 * plugin never throws or yields garbage. A leading `#` on the tag is stripped
 * (saveToLogseq also strips/falls back, so either form is safe).
 */
export function mapPluginSettings(raw: Record<string, unknown>): LogseqCaptureSettings {
	const str = (v: unknown, d: string) => (typeof v === 'string' && v.trim() ? v.trim() : d)
	const bool = (v: unknown, d: boolean) => (typeof v === 'boolean' ? v : d)
	const K = PLUGIN_SETTING_KEYS
	return {
		clippingTag: str(raw[K.clippingTag], DEFAULT_CAPTURE_SETTINGS.clippingTag).replace(/^#/, ''),
		capturePageContent: bool(raw[K.capturePageContent], DEFAULT_CAPTURE_SETTINGS.capturePageContent),
		pageContentBlockName: str(raw[K.pageContentBlockName], DEFAULT_CAPTURE_SETTINGS.pageContentBlockName),
		highlightsBlockName: str(raw[K.highlightsBlockName], DEFAULT_CAPTURE_SETTINGS.highlightsBlockName),
		useHeadingMarkers: bool(raw[K.useHeadingMarkers], DEFAULT_CAPTURE_SETTINGS.useHeadingMarkers),
		populatePageTags: bool(raw[K.populatePageTags], DEFAULT_CAPTURE_SETTINGS.populatePageTags),
	}
}
