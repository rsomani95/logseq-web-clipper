// Stubs for browser-only modules used in CLI build.
// These are aliased by esbuild so that transitive imports
// of browser-polyfill and storage-utils resolve without error.

import type { Settings } from '../types/types';

export default {} as any;

export const generalSettings: Settings = {
	logseqCaptureSettings: {
		pageContentBlockName: 'Page Content',
		highlightsBlockName: 'Highlights',
		useHeadingMarkers: false,
	},
	logseqApiBaseUrl: 'http://127.0.0.1:12315',
	logseqApiToken: '',
	betaFeatures: false,
	openBehavior: 'popup',
	highlighterEnabled: false,
	alwaysShowHighlights: false,
	syncHighlightsAcrossViews: true,
	persistentNoteConnectors: false,
	highlightBehavior: 'no-highlights',
	showMoreActionsButton: false,
	interpreterModel: '',
	models: [],
	providers: [],
	interpreterEnabled: false,
	interpreterAutoRun: false,
	defaultPromptContext: '',
	propertyTypes: [],
	readerSettings: {
		fontSize: 16,
		lineHeight: 1.5,
		maxWidth: 700,
		lightTheme: 'default',
		darkTheme: 'same',
		appearance: 'auto',
		fonts: [],
		defaultFont: '',
		blendImages: true,
		colorLinks: false,
		followLinks: true,
		pinPlayer: true,
		autoScroll: true,
		highlightActiveLine: true,
		customCss: '',
	},
	stats: {
		addToLogseq: 0,
		saveFile: 0,
		copyToClipboard: 0,
		share: 0,
	},
	history: [],
	ratings: [],
	saveBehavior: 'addToLogseq',
};

export const loadSettings = async () => {};
export const saveSettings = async () => {};
export const incrementStat = async () => {};
export const getLocalStorage = async () => ({});
export const setLocalStorage = async () => {};
