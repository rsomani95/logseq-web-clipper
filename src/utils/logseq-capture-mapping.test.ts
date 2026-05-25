import { describe, expect, test } from 'vitest'

import { DEFAULT_CAPTURE_SETTINGS, PLUGIN_SETTING_KEYS, mapPluginSettings } from './logseq-capture-mapping'

// A full, well-formed plugin settings object — mirrors what getStateFromStore
// returns for the companion plugin: the `web*` keys alongside unrelated settings.
const fullPluginSettings = {
	webTag: 'Web',
	webCapturePageContent: true,
	webPageContentBlockName: 'Page Content',
	webHighlightsBlockName: 'Highlights',
	webUseHeadingMarkers: false,
	webPopulatePageTags: false,
	// keys the plugin also stores that the clipper must ignore
	zotTag: 'Reference',
	propertyPreset: 'Essentials',
	tagRules: '[]',
}

describe('mapPluginSettings', () => {
	test('maps a full plugin settings object field-by-field, ignoring unrelated keys', () => {
		expect(mapPluginSettings(fullPluginSettings)).toEqual({
			clippingTag: 'Web',
			capturePageContent: true,
			pageContentBlockName: 'Page Content',
			highlightsBlockName: 'Highlights',
			useHeadingMarkers: false,
			populatePageTags: false,
		})
	})

	test('reads non-default values (proves it reads live, not just defaults)', () => {
		expect(
			mapPluginSettings({
				webTag: 'Clippings',
				webCapturePageContent: false,
				webPageContentBlockName: 'Body',
				webHighlightsBlockName: 'Quotes',
				webUseHeadingMarkers: true,
				webPopulatePageTags: true,
			}),
		).toEqual({
			clippingTag: 'Clippings',
			capturePageContent: false,
			pageContentBlockName: 'Body',
			highlightsBlockName: 'Quotes',
			useHeadingMarkers: true,
			populatePageTags: true,
		})
	})

	test('empty object → all defaults', () => {
		expect(mapPluginSettings({})).toEqual(DEFAULT_CAPTURE_SETTINGS)
	})

	test('missing individual keys fall back per field', () => {
		const result = mapPluginSettings({ webTag: 'OnlyTag' })
		expect(result.clippingTag).toBe('OnlyTag')
		expect(result.capturePageContent).toBe(DEFAULT_CAPTURE_SETTINGS.capturePageContent)
		expect(result.pageContentBlockName).toBe(DEFAULT_CAPTURE_SETTINGS.pageContentBlockName)
		expect(result.populatePageTags).toBe(DEFAULT_CAPTURE_SETTINGS.populatePageTags)
	})

	test('wrong-typed values degrade to defaults (never throw or coerce garbage)', () => {
		const result = mapPluginSettings({
			webTag: 123 as unknown as string,
			webCapturePageContent: 'yes' as unknown as boolean,
			webUseHeadingMarkers: null as unknown as boolean,
			webPageContentBlockName: 42 as unknown as string,
		})
		expect(result.clippingTag).toBe(DEFAULT_CAPTURE_SETTINGS.clippingTag)
		expect(result.capturePageContent).toBe(DEFAULT_CAPTURE_SETTINGS.capturePageContent)
		expect(result.useHeadingMarkers).toBe(DEFAULT_CAPTURE_SETTINGS.useHeadingMarkers)
		expect(result.pageContentBlockName).toBe(DEFAULT_CAPTURE_SETTINGS.pageContentBlockName)
	})

	test('strips a single leading # from the tag', () => {
		expect(mapPluginSettings({ webTag: '#Web' }).clippingTag).toBe('Web')
		expect(mapPluginSettings({ webTag: '##Web' }).clippingTag).toBe('#Web') // only the first
	})

	test('blank / whitespace tag falls back to the default', () => {
		expect(mapPluginSettings({ webTag: '   ' }).clippingTag).toBe(DEFAULT_CAPTURE_SETTINGS.clippingTag)
		expect(mapPluginSettings({ webTag: '' }).clippingTag).toBe(DEFAULT_CAPTURE_SETTINGS.clippingTag)
	})

	test('trims surrounding whitespace on string values', () => {
		const result = mapPluginSettings({ webTag: '  Web  ', webPageContentBlockName: '  Body  ' })
		expect(result.clippingTag).toBe('Web')
		expect(result.pageContentBlockName).toBe('Body')
	})

	test('contract keys match the documented plugin keys (the cross-repo join point)', () => {
		expect(PLUGIN_SETTING_KEYS).toEqual({
			clippingTag: 'webTag',
			capturePageContent: 'webCapturePageContent',
			pageContentBlockName: 'webPageContentBlockName',
			highlightsBlockName: 'webHighlightsBlockName',
			useHeadingMarkers: 'webUseHeadingMarkers',
			populatePageTags: 'webPopulatePageTags',
		})
	})
})
