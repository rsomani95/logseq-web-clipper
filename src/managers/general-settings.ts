import { getCommands } from '../utils/hotkeys';
import { initializeToggles, initializeSettingToggle } from '../utils/ui-utils';
import { generalSettings, loadSettings, saveSettings, setLocalStorage, getLocalStorage } from '../utils/storage-utils';
import { detectBrowser } from '../utils/browser-detection';
import { createLogseqAPI, LogseqAPIError } from '../utils/logseq-api';
import { createElementWithClass } from '../utils/dom-utils';
import { createDefaultTemplate, getTemplates, saveTemplateSettings } from '../managers/template-manager';
import { updateTemplateList, showTemplateEditor } from '../managers/template-ui';
import { exportAllSettings, importAllSettings } from '../utils/import-export';
import { Settings, Template } from '../types/types';
import { exportHighlights } from './highlights-manager';
import { getMessage, setupLanguageAndDirection } from '../utils/i18n';
import { debounce } from '../utils/debounce';
import browser from '../utils/browser-polyfill';
import { createUsageChart, aggregateUsageData } from '../utils/charts';
import { getClipHistory } from '../utils/storage-utils';
import dayjs from 'dayjs';
import weekOfYear from 'dayjs/plugin/weekOfYear';
import { hideModal, showModal } from '../utils/modal-utils';

dayjs.extend(weekOfYear);

const STORE_URLS = {
	chrome: 'https://chromewebstore.google.com/',
	firefox: 'https://addons.mozilla.org/',
	safari: 'https://apps.apple.com/',
	edge: 'https://microsoftedge.microsoft.com/addons/'
};

export async function setShortcutInstructions() {
	const shortcutInstructionsElement = document.querySelector('.shortcut-instructions');
	if (shortcutInstructionsElement) {
		const browser = await detectBrowser();
		// Clear content
		shortcutInstructionsElement.textContent = '';
		shortcutInstructionsElement.appendChild(document.createTextNode(getMessage('shortcutInstructionsIntro') + ' '));
		
		// Browser-specific instructions
		let instructionsText = '';
		let url = '';
		
		switch (browser) {
			case 'chrome':
				instructionsText = getMessage('shortcutInstructionsChrome', ['$URL']);
				url = 'chrome://extensions/shortcuts';
				break;
			case 'brave':
				instructionsText = getMessage('shortcutInstructionsBrave', ['$URL']);
				url = 'brave://extensions/shortcuts';
				break;
			case 'firefox':
				instructionsText = getMessage('shortcutInstructionsFirefox', ['$URL']);
				url = 'about:addons';
				break;
			case 'edge':
				instructionsText = getMessage('shortcutInstructionsEdge', ['$URL']);
				url = 'edge://extensions/shortcuts';
				break;
			case 'safari':
			case 'mobile-safari':
				instructionsText = getMessage('shortcutInstructionsSafari');
				break;
			default:
				instructionsText = getMessage('shortcutInstructionsDefault');
		}
		
		if (url) {
			// Split text around the URL placeholder and add strong element
			const parts = instructionsText.split('$URL');
			if (parts.length === 2) {
				shortcutInstructionsElement.appendChild(document.createTextNode(parts[0]));
				
				const strongElement = document.createElement('strong');
				strongElement.textContent = url;
				shortcutInstructionsElement.appendChild(strongElement);
				
				shortcutInstructionsElement.appendChild(document.createTextNode(parts[1]));
			} else {
				// Fallback if no placeholder found
				shortcutInstructionsElement.appendChild(document.createTextNode(instructionsText));
			}
		} else {
			// Safari and default cases (no URL needed)
			shortcutInstructionsElement.appendChild(document.createTextNode(instructionsText));
		}
	}
}

async function initializeVersionDisplay(): Promise<void> {
	const manifest = browser.runtime.getManifest();
	const versionNumber = document.getElementById('version-number');
	const updateAvailable = document.getElementById('update-available');
	const usingLatestVersion = document.getElementById('using-latest-version');

	if (versionNumber) {
		versionNumber.textContent = manifest.version;
	}

	// Only add update listener for browsers that support it
	const currentBrowser = await detectBrowser();
	if (currentBrowser !== 'safari' && currentBrowser !== 'mobile-safari' && browser.runtime.onUpdateAvailable) {
		browser.runtime.onUpdateAvailable.addListener((details) => {
			if (updateAvailable && usingLatestVersion) {
				updateAvailable.style.display = 'block';
				usingLatestVersion.style.display = 'none';
			}
		});
	} else {
		// For Safari, just hide the update status elements
		if (updateAvailable) {
			updateAvailable.style.display = 'none';
		}
		if (usingLatestVersion) {
			usingLatestVersion.style.display = 'none';
		}
	}
}

export function initializeGeneralSettings(): void {
	loadSettings().then(async () => {
		await setupLanguageAndDirection();

		// Add version check initialization
		await initializeVersionDisplay();

		// Get clip history and ratings
		const history = await getClipHistory();
		const totalClips = history.length;
		const existingRatings = await getLocalStorage('ratings') || [];

		// Show rating section only total clips >= 20 and no previous ratings
		const rateExtensionSection = document.getElementById('rate-extension');
		if (rateExtensionSection && totalClips >= 20 && existingRatings.length === 0) {
			rateExtensionSection.classList.remove('is-hidden');
		}

		if (totalClips >= 20 && existingRatings.length === 0) {
			const starRating = document.querySelector('.star-rating');
			if (starRating) {
				const stars = starRating.querySelectorAll('.star');
				stars.forEach(star => {
					star.addEventListener('click', async () => {
						const rating = parseInt(star.getAttribute('data-rating') || '0');
						stars.forEach(s => {
							if (parseInt(s.getAttribute('data-rating') || '0') <= rating) {
								s.classList.add('is-active');
							} else {
								s.classList.remove('is-active');
							}
						});
						await handleRating(rating);
						
						// Hide the rating section after rating
						if (rateExtensionSection) {
							rateExtensionSection.style.display = 'none';
						}
					});
				});
			}
		}

		initializeLogseqSettings();
		initializeShowMoreActionsToggle();
		initializeBetaFeaturesToggle();
		initializeOpenBehaviorDropdown();
		initializeKeyboardShortcuts();
		initializeToggles();
		setShortcutInstructions();
		initializeAutoSave();
		initializeResetDefaultTemplateButton();
		initializeExportImportAllSettingsButtons();
		initializeHighlighterSettings();
		initializeExportHighlightsButton();
		await initializeUsageChart();

		// Initialize feedback modal close button
		const feedbackModal = document.getElementById('feedback-modal');
		const feedbackCloseBtn = feedbackModal?.querySelector('.feedback-close-btn');
		if (feedbackCloseBtn) {
			feedbackCloseBtn.addEventListener('click', () => hideModal(feedbackModal));
		}
	});
}

function initializeAutoSave(): void {
	const generalSettingsForm = document.getElementById('general-settings-form');
	if (generalSettingsForm) {
		// Listen for both input and change events
		generalSettingsForm.addEventListener('input', debounce(saveSettingsFromForm, 500));
		generalSettingsForm.addEventListener('change', debounce(saveSettingsFromForm, 500));
	}
}

function saveSettingsFromForm(): void {
	const openBehaviorDropdown = document.getElementById('open-behavior-dropdown') as HTMLSelectElement;
	const showMoreActionsToggle = document.getElementById('show-more-actions-toggle') as HTMLInputElement;
	const betaFeaturesToggle = document.getElementById('beta-features-toggle') as HTMLInputElement;
	const highlighterToggle = document.getElementById('highlighter-toggle') as HTMLInputElement;
	const alwaysShowHighlightsToggle = document.getElementById('highlighter-visibility') as HTMLInputElement;
	const highlightBehaviorSelect = document.getElementById('highlighter-behavior') as HTMLSelectElement;

	const updatedSettings = {
		...generalSettings,
		openBehavior: (openBehaviorDropdown?.value as Settings['openBehavior']) ?? generalSettings.openBehavior,
		showMoreActionsButton: showMoreActionsToggle?.checked ?? generalSettings.showMoreActionsButton,
		betaFeatures: betaFeaturesToggle?.checked ?? generalSettings.betaFeatures,
		highlighterEnabled: highlighterToggle?.checked ?? generalSettings.highlighterEnabled,
		alwaysShowHighlights: alwaysShowHighlightsToggle?.checked ?? generalSettings.alwaysShowHighlights,
		highlightBehavior: highlightBehaviorSelect?.value ?? generalSettings.highlightBehavior
	};

	saveSettings(updatedSettings);
}

function initializeLogseqSettings(): void {
	const baseUrlInput = document.getElementById('logseq-base-url') as HTMLInputElement | null;
	const tokenInput = document.getElementById('logseq-token') as HTMLInputElement | null;
	const testBtn = document.getElementById('logseq-test-btn') as HTMLButtonElement | null;
	const status = document.getElementById('logseq-test-status') as HTMLDivElement | null;

	if (baseUrlInput) {
		baseUrlInput.value = generalSettings.logseqApiBaseUrl;
		baseUrlInput.addEventListener('change', () => {
			saveSettings({ logseqApiBaseUrl: baseUrlInput.value.trim() });
		});
	}

	if (tokenInput) {
		tokenInput.value = generalSettings.logseqApiToken;
		tokenInput.addEventListener('change', () => {
			saveSettings({ logseqApiToken: tokenInput.value.trim() });
		});
	}

	if (testBtn && status) {
		testBtn.addEventListener('click', async () => {
			const baseUrl = (baseUrlInput?.value || generalSettings.logseqApiBaseUrl).trim();
			const token = (tokenInput?.value || generalSettings.logseqApiToken).trim();
			if (!baseUrl || !token) {
				status.textContent = getMessage('logseqConnectionMissing');
				return;
			}
			testBtn.disabled = true;
			status.textContent = getMessage('logseqConnectionTesting');
			try {
				const api = createLogseqAPI({ baseUrl, token });
				const { graphName, isDbGraph } = await api.testConnection();
				status.textContent = isDbGraph
					? getMessage('logseqConnectionOk', [graphName])
					: getMessage('logseqConnectionFileGraph', [graphName]);
			} catch (err) {
				const msg = err instanceof LogseqAPIError ? err.message : String(err);
				status.textContent = getMessage('logseqConnectionFailed', [msg]);
			} finally {
				testBtn.disabled = false;
			}
		});
	}
}

function initializeShowMoreActionsToggle(): void {
	initializeSettingToggle('show-more-actions-toggle', generalSettings.showMoreActionsButton, (checked) => {
		saveSettings({ ...generalSettings, showMoreActionsButton: checked });
	});
}

async function initializeKeyboardShortcuts(): Promise<void> {
	const shortcutsList = document.getElementById('keyboard-shortcuts-list');
	if (!shortcutsList) return;

	const browser = await detectBrowser();

	if (browser === 'mobile-safari') {
		// For Safari, display a message about keyboard shortcuts not being available
		const messageItem = document.createElement('div');
		messageItem.className = 'shortcut-item';
		messageItem.textContent = getMessage('shortcutInstructionsSafari');
		shortcutsList.appendChild(messageItem);
	} else {
		// For other browsers, proceed with displaying the shortcuts
		getCommands().then(commands => {
			commands.forEach(command => {
				const shortcutItem = createElementWithClass('div', 'shortcut-item');
				
				const descriptionSpan = document.createElement('span');
				descriptionSpan.textContent = command.description;
				shortcutItem.appendChild(descriptionSpan);

				const hotkeySpan = createElementWithClass('span', 'setting-hotkey');
				hotkeySpan.textContent = command.shortcut || getMessage('shortcutNotSet');
				shortcutItem.appendChild(hotkeySpan);

				shortcutsList.appendChild(shortcutItem);
			});
		});
	}
}

function initializeBetaFeaturesToggle(): void {
	initializeSettingToggle('beta-features-toggle', generalSettings.betaFeatures, (checked) => {
		saveSettings({ ...generalSettings, betaFeatures: checked });
	});
}

function initializeOpenBehaviorDropdown(): void {
	initializeSettingDropdown(
		'open-behavior-dropdown',
		generalSettings.openBehavior,
		(value) => {
			saveSettings({ ...generalSettings, openBehavior: value as Settings['openBehavior'] });
		}
	);
}

function initializeResetDefaultTemplateButton(): void {
	const resetDefaultTemplateBtn = document.getElementById('reset-default-template-btn');
	if (resetDefaultTemplateBtn) {
		resetDefaultTemplateBtn.addEventListener('click', resetDefaultTemplate);
	}
}

export function resetDefaultTemplate(): void {
	const defaultTemplate = createDefaultTemplate();
	const currentTemplates = getTemplates();
	const defaultIndex = currentTemplates.findIndex((t: Template) => t.name === getMessage('defaultTemplateName'));
	
	if (defaultIndex !== -1) {
		currentTemplates[defaultIndex] = defaultTemplate;
	} else {
		currentTemplates.unshift(defaultTemplate);
	}

	saveTemplateSettings().then(() => {
		updateTemplateList();
		showTemplateEditor(defaultTemplate);
	}).catch(error => {
		console.error('Failed to reset default template:', error);
		alert(getMessage('failedToResetTemplate'));
	});
}

function initializeExportImportAllSettingsButtons(): void {
	const exportAllSettingsBtn = document.getElementById('export-all-settings-btn');
	if (exportAllSettingsBtn) {
		exportAllSettingsBtn.addEventListener('click', exportAllSettings);
	}

	const importAllSettingsBtn = document.getElementById('import-all-settings-btn');
	if (importAllSettingsBtn) {
		importAllSettingsBtn.addEventListener('click', importAllSettings);
	}
}

function initializeExportHighlightsButton(): void {
	const exportHighlightsBtn = document.getElementById('export-highlights');
	if (exportHighlightsBtn) {
		exportHighlightsBtn.addEventListener('click', exportHighlights);
	}
}

function initializeHighlighterSettings(): void {
	initializeSettingToggle('highlighter-toggle', generalSettings.highlighterEnabled, (checked) => {
		saveSettings({ ...generalSettings, highlighterEnabled: checked });
	});

	initializeSettingToggle('highlighter-visibility', generalSettings.alwaysShowHighlights, (checked) => {
		saveSettings({ ...generalSettings, alwaysShowHighlights: checked });
	});

	const highlightBehaviorSelect = document.getElementById('highlighter-behavior') as HTMLSelectElement;
	if (highlightBehaviorSelect) {
		highlightBehaviorSelect.value = generalSettings.highlightBehavior;
		highlightBehaviorSelect.addEventListener('change', () => {
			saveSettings({ ...generalSettings, highlightBehavior: highlightBehaviorSelect.value });
		});
	}
}

async function initializeUsageChart(): Promise<void> {
	const chartContainer = document.getElementById('usage-chart');
	const periodSelect = document.getElementById('usage-period-select') as HTMLSelectElement;
	const aggregationSelect = document.getElementById('usage-aggregation-select') as HTMLSelectElement;
	if (!chartContainer || !periodSelect || !aggregationSelect) return;

	const history = await getClipHistory();

	const updateChart = async () => {
		const options = {
			timeRange: periodSelect.value as '30d' | 'all',
			aggregation: aggregationSelect.value as 'day' | 'week' | 'month'
		};
		
		const chartData = aggregateUsageData(history, options);
		await createUsageChart(chartContainer, chartData);
	};

	// Initialize with default selections
	await updateChart();

	// Update when any selector changes
	periodSelect.addEventListener('change', updateChart);
	aggregationSelect.addEventListener('change', updateChart);
}

async function handleRating(rating: number) {
	// Get existing ratings from storage
	const existingRatings = await getLocalStorage('ratings') || [];
	
	// Add new rating
	const newRating = {
		rating,
		date: new Date().toISOString()
	};
	
	// Update both storage and generalSettings
	const updatedRatings = [...existingRatings, newRating];
	generalSettings.ratings = updatedRatings;
	
	// Save to storage
	await setLocalStorage('ratings', updatedRatings);
	await saveSettings();

	if (rating >= 4) {
		// Redirect to appropriate store
		const browser = await detectBrowser();
		let storeUrl = STORE_URLS.chrome; // Default to Chrome store

		switch (browser) {
			case 'firefox':
			case 'firefox-mobile':
				storeUrl = STORE_URLS.firefox;
				break;
			case 'safari':
			case 'mobile-safari':
			case 'ipad-os':
				storeUrl = STORE_URLS.safari;
				break;
			case 'edge':
				storeUrl = STORE_URLS.edge;
				break;
		}

		window.open(storeUrl, '_blank');
	} else {
		// Show feedback modal for ratings < 4
		const modal = document.getElementById('feedback-modal');
		showModal(modal);
	}
}

function initializeSettingDropdown(
	elementId: string,
	defaultValue: string,
	onChange: (newValue: string) => void
): void {
	const dropdown = document.getElementById(elementId) as HTMLSelectElement;
	if (!dropdown) return;
	dropdown.value = defaultValue;
	dropdown.addEventListener('change', () => {
		onChange(dropdown.value);
	});
}
