import type { WebSectionId } from '../utils/web-sections';

export interface Template {
	id: string;
	name: string;
	behavior: 'create' | 'append-specific' | 'append-daily' | 'prepend-specific' | 'prepend-daily' | 'overwrite';
	noteNameFormat: string;
	noteContentFormat: string;
	properties: Property[];
	triggers?: string[];
	context?: string;
}

export interface Property {
	id?: string;
	name: string;
	value: string;
	type?: string;
}

export interface ExtractedContent {
	[key: string]: string;
}

export type FilterFunction = (value: string, param?: string) => string | any[];

export interface PromptVariable {
	key: string;
	prompt: string;
	filters?: string;
}

export interface PropertyType {
	name: string;
	type: string;
	defaultValue?: string;
}

export interface Provider {
	id: string;
	name: string;
	baseUrl: string;
	apiKey: string;
	apiKeyRequired?: boolean;
	presetId?: string;
}

export interface Rating {
	rating: number;
	date: string;
}

export type SaveBehavior = 'addToLogseq' | 'saveFile' | 'copyToClipboard';

export interface ReaderSettings {
	fontSize: number;
	lineHeight: number;
	maxWidth: number;
	lightTheme: string;
	darkTheme: string;
	appearance: 'auto' | 'light' | 'dark';
	fonts: string[];
	defaultFont: string;
	blendImages: boolean;
	colorLinks: boolean;
	followLinks: boolean;
	pinPlayer: boolean;
	autoScroll: boolean;
	highlightActiveLine: boolean;
	customCss: string;
}

// Logseq-specific capture config: how a clip is shaped in the graph (block
// names, heading style, clip tag, pre-fill toggles) — distinct from the API
// connection settings (logseqApiBaseUrl/Token), which stay extension-owned.
//
// No longer an editable extension setting: it's RESOLVED at runtime from the
// companion plugin's live settings over the HTTP API (see
// `logseq-remote-settings.ts`); this interface is the resolver's return shape.
// Editing happens in the plugin's setup UI.
export interface LogseqCaptureSettings {
	/** Name of the block the abstract/summary nests under. */
	abstractBlockName: string;
	/** Name of the block the clipped article body nests under. */
	pageContentBlockName: string;
	/** Name of the block highlights nest under. */
	highlightsBlockName: string;
	/** Keep Markdown `#` markers on heading blocks. Off → heading hierarchy is
	 * conveyed by indentation alone. */
	useHeadingMarkers: boolean;
	/** Pre-fill the `tags` field from the page's own keywords. Off by default —
	 * page keywords are usually noise. When off the `tags` field still shows in
	 * the popup (so you can tag manually), it just starts empty. */
	populatePageTags: boolean;
	/** Capture the article body as a "Page Content" block. On by default. Off →
	 * the popup's content box starts empty so a clip carries just highlights; the
	 * box stays editable (like the tags field), so content typed in for a single
	 * clip still saves. */
	capturePageContent: boolean;
	/** Capture the page's own summary as an "Abstract" block. On by default; off
	 * → the abstract block is never written even when the page carries a summary. */
	captureAbstract: boolean;
	/** Import each section collapsed (`:block/collapsed?`). The companion plugin's
	 * Page template defaults: Page Content folded, Abstract/Highlights open. */
	foldAbstract: boolean;
	foldHighlights: boolean;
	foldPageContent: boolean;
	/** Order the section blocks are written in. Defensively parsed from the
	 * plugin's `webSectionOrder`, so it always lists all three ids exactly once. */
	sectionOrder: WebSectionId[];
	/** The tag every clipped page carries (its schema class in Logseq). Read from
	 * the plugin's `webTag`; a leading `#` is stripped and a blank value falls back
	 * to the shared `WEB_CLIPPING_TAG`. The companion plugin owns the property
	 * schema on this tag (its class must `extends` the shared base), so a tag the
	 * plugin hasn't set up carries no schema and the clip aborts. */
	clippingTag: string;
}

export interface Settings {
	logseqApiBaseUrl: string;
	logseqApiToken: string;
	showMoreActionsButton: boolean;
	betaFeatures: boolean;
	openBehavior: 'popup' | 'embedded' | 'reader';
	highlighterEnabled: boolean;
	alwaysShowHighlights: boolean;
	// Re-anchor highlights by their text so a highlight made in reader view is
	// visible in native view (and vice versa). Default on.
	syncHighlightsAcrossViews: boolean;
	// Always show the dotted connector tying a reader margin note to its
	// highlight (vs only on hover/edit). Default on.
	persistentNoteConnectors: boolean;
	highlightBehavior: string;
	interpreterModel?: string;
	models: ModelConfig[];
	providers: Provider[];
	interpreterEnabled: boolean;
	interpreterAutoRun: boolean;
	defaultPromptContext: string;
	propertyTypes: PropertyType[];
	readerSettings: ReaderSettings;
	stats: {
		addToLogseq: number;
		saveFile: number;
		copyToClipboard: number;
		share: number;
	};
	history: HistoryEntry[];
	ratings: Rating[];
	saveBehavior: SaveBehavior;
}

export interface ModelConfig {
	id: string;
	providerId: string;
	providerModelId: string;
	name: string;
	enabled: boolean;
}

export interface HistoryEntry {
	datetime: string;
	url: string;
	action: 'addToLogseq' | 'saveFile' | 'copyToClipboard' | 'share';
	title?: string;
	graphName?: string;
}

export interface ConversationMessage {
	author: string;
	content: string;
	timestamp?: string;
	metadata?: Record<string, any>;
}

export interface ConversationMetadata {
	title?: string;
	description?: string;
	site: string;
	url: string;
	messageCount: number;
	startTime?: string;
	endTime?: string;
}

export interface Footnote {
	url: string;
	text: string;
}
