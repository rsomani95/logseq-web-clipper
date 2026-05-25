export function initializeToggles(container?: HTMLElement | string): void {
	let searchRoot: HTMLElement | Document;
	
	if (!container) {
		searchRoot = document;
	} else if (typeof container === 'string') {
		const containerElement = document.getElementById(container);
		if (!containerElement) {
			console.warn(`Container with ID "${container}" not found`);
			return;
		}
		searchRoot = containerElement;
	} else {
		searchRoot = container;
	}
	
	const checkboxContainers = searchRoot.querySelectorAll('.checkbox-container');
	
	checkboxContainers.forEach(container => {
		// Skip if already initialized
		if (container.hasAttribute('data-toggle-initialized')) {
			return;
		}

		const checkbox = container.querySelector('input[type="checkbox"]') as HTMLInputElement;
		
		if (checkbox) {
			// Update toggle state based on checkbox
			updateToggleState(container as HTMLElement, checkbox);

			// Listen for direct checkbox changes
			checkbox.addEventListener('change', () => {
				updateToggleState(container as HTMLElement, checkbox);
				
				// Dispatch a custom event for settings changes
				const event = new CustomEvent('settings-changed', {
					bubbles: true,
					detail: { 
						id: checkbox.id,
						checked: checkbox.checked 
					}
				});
				checkbox.dispatchEvent(event);
			});
			
			// Handle container clicks
			container.addEventListener('click', (event) => {
				// Prevent default only if clicking the container itself
				if (event.target === container || !checkbox.contains(event.target as Node)) {
					event.preventDefault();
					checkbox.checked = !checkbox.checked;
					
					// Manually trigger the change event
					const changeEvent = new Event('change', { bubbles: true });
					checkbox.dispatchEvent(changeEvent);
				}
			});

			// Mark as initialized
			container.setAttribute('data-toggle-initialized', 'true');
		}
	});
}

export function updateToggleState(container: HTMLElement, checkbox: HTMLInputElement): void {
	if (checkbox.checked) {
		
		container.classList.add('is-enabled');
	} else {
		container.classList.remove('is-enabled');
	}
}

export function adjustNoteNameHeight(textarea: HTMLTextAreaElement): void {
	textarea.style.minHeight = '2rem';
	textarea.style.minHeight = textarea.scrollHeight + 'px';
}

// Grow a textarea to fit its content. A CSS `max-height` (if set) caps the
// growth, after which the browser shows a vertical scrollbar. Used by the
// multi-line property fields (e.g. abstract) so a long value renders up to N
// lines then scrolls vertically instead of clipping to a single line.
export function autoSizeTextarea(textarea: HTMLTextAreaElement): void {
	textarea.style.height = 'auto';
	textarea.style.height = textarea.scrollHeight + 'px';
}

// Size a freshly-filled multi-line property field to its content and pin it to
// the first line. Two things conspire to park it mid-scroll otherwise:
//   1. Setting a textarea's `.value` scrolls it to the caret (the end), so a
//      long abstract opens scrolled to the bottom.
//   2. The extension popup re-lays-out a frame or two after first paint — Chrome
//      resizes the popup to fit its content, and a web font can swap in — and
//      that reflow re-parks a filled textarea's scroll.
// A single synchronous reset loses to #2, so we re-pin (and re-size, since the
// final width settles over those frames) on the next two animation frames.
export function sizeAndPinMultilineField(textarea: HTMLTextAreaElement): void {
	const pin = () => {
		autoSizeTextarea(textarea);
		textarea.scrollTop = 0;
	};
	// Caret at the start so any later scroll-to-caret lands at the top, not end.
	try { textarea.setSelectionRange(0, 0); } catch { /* selection isn't always settable */ }
	pin();
	requestAnimationFrame(() => {
		pin();
		requestAnimationFrame(pin);
	});
}

export function initializeSettingToggle(
	toggleId: string,
	initialValue: boolean,
	onChangeCallback: (checked: boolean) => void
): void {
	const toggle = document.getElementById(toggleId) as HTMLInputElement;
	if (!toggle) return;

	// Set initial state
	toggle.checked = initialValue;
	
	// Initialize the toggle state
	const container = toggle.closest('.checkbox-container');
	if (container) {
		updateToggleState(container as HTMLElement, toggle);
	}

	// Add change listener
	toggle.addEventListener('change', () => {
		onChangeCallback(toggle.checked);
		
		// Update toggle state
		const container = toggle.closest('.checkbox-container');
		if (container) {
			updateToggleState(container as HTMLElement, toggle);
		}
	});
}

export function initializeSettingDropdown<T extends string>(
    elementId: string, 
    initialValue: T,
    onChange: (newValue: T) => void
): void {
    const dropdown = document.getElementById(elementId) as HTMLSelectElement;
    if (!dropdown) return;

    // Set initial value
    dropdown.value = initialValue;

    // Add change listener
    dropdown.addEventListener('change', () => {
        onChange(dropdown.value as T);
    });
}
