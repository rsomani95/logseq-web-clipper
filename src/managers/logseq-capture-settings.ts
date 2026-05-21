// Fork-owned. The "Logseq Capture" settings tab — how a clip is shaped in the
// graph (block names, heading style). These thread into the write pipeline via
// generalSettings.logseqCaptureSettings → background.ts → saveToLogseq.
// API connection settings (base URL/token) live in General, not here.

import { generalSettings, loadSettings, saveSettings } from '../utils/storage-utils';
import { initializeSettingToggle } from '../utils/ui-utils';
import { debounce } from '../utils/debounce';

export async function initializeLogseqCaptureSettings(): Promise<void> {
	const form = document.getElementById('logseq-capture-settings-form');
	if (!form) return;

	await loadSettings();

	const pageBlockInput = document.getElementById('logseq-capture-page-block') as HTMLInputElement | null;
	if (pageBlockInput) {
		pageBlockInput.value = generalSettings.logseqCaptureSettings.pageContentBlockName;
		pageBlockInput.addEventListener('input', debounce(() => {
			// Persist the raw value; buildClipBlocks falls back to "Page Content"
			// if it's blank, so an empty field can't produce an unnamed block.
			saveSettings({
				...generalSettings,
				logseqCaptureSettings: { ...generalSettings.logseqCaptureSettings, pageContentBlockName: pageBlockInput.value },
			});
		}, 400));
	}

	const highlightsBlockInput = document.getElementById('logseq-capture-highlights-block') as HTMLInputElement | null;
	if (highlightsBlockInput) {
		highlightsBlockInput.value = generalSettings.logseqCaptureSettings.highlightsBlockName;
		highlightsBlockInput.addEventListener('input', debounce(() => {
			saveSettings({
				...generalSettings,
				logseqCaptureSettings: { ...generalSettings.logseqCaptureSettings, highlightsBlockName: highlightsBlockInput.value },
			});
		}, 400));
	}

	initializeSettingToggle(
		'logseq-capture-heading-markers',
		generalSettings.logseqCaptureSettings.useHeadingMarkers,
		(checked) => {
			saveSettings({
				...generalSettings,
				logseqCaptureSettings: { ...generalSettings.logseqCaptureSettings, useHeadingMarkers: checked },
			});
		},
	);
}
