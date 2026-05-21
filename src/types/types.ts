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

// Logseq-specific capture config, surfaced in the "Logseq Capture" settings
// tab. Controls how a clip is shaped in the graph (block names, heading style)
// — distinct from the API connection settings (logseqApiBaseUrl/Token).
export interface LogseqCaptureSettings {
	/** Name of the block the clipped article body nests under. */
	pageContentBlockName: string;
	/** Name of the block highlights nest under. */
	highlightsBlockName: string;
	/** Keep Markdown `#` markers on heading blocks. Off → heading hierarchy is
	 * conveyed by indentation alone. */
	useHeadingMarkers: boolean;
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
	// highlight (vs only on hover/edit). Default off.
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
	logseqCaptureSettings: LogseqCaptureSettings;
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
