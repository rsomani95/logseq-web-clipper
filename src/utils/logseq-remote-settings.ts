// Fork-owned. Resolves the clipper's "capture" config by READING it from the
// companion Logseq plugin's live settings over the HTTP API — editing lives in
// the plugin's setup UI (the extension can read plugin settings but not write
// them; see LOGSEQ_SETTINGS_INTEGRATION.md). Resilience chain:
//
//   live plugin read → cached last-known-good (storage.local) → hardcoded defaults
//
// A successful read is written through to the cache, so an unreachable Logseq, an
// uninstalled plugin, or a renamed internal state path degrades to stale-but-valid
// rather than breaking. The pure mapping/defaults live in `logseq-capture-mapping.ts`
// (kept browser-free so they're unit-testable); this file owns the I/O.

import browser from './browser-polyfill'
import { LogseqAPI } from './logseq-api'
import type { LogseqCaptureSettings } from '../types/types'
import { DEFAULT_CAPTURE_SETTINGS, mapPluginSettings } from './logseq-capture-mapping'

export { DEFAULT_CAPTURE_SETTINGS, mapPluginSettings } from './logseq-capture-mapping'

const CACHE_KEY = 'logseqCaptureSettingsCache'

/**
 * Resolve the active capture config: live plugin read → cached last-known-good →
 * hardcoded defaults. A successful read refreshes the cache. Never throws.
 */
export async function resolveLogseqCaptureSettings(api: LogseqAPI): Promise<LogseqCaptureSettings> {
	try {
		const raw = await api.getPluginSettings()
		if (raw && typeof raw === 'object') {
			const mapped = mapPluginSettings(raw as Record<string, unknown>)
			try {
				await browser.storage.local.set({ [CACHE_KEY]: mapped })
			} catch {
				// cache write is best-effort
			}
			return mapped
		}
	} catch {
		// live read failed (Logseq down / plugin absent / state path changed) — fall back
	}

	try {
		const cached = (await browser.storage.local.get(CACHE_KEY))?.[CACHE_KEY]
		if (cached && typeof cached === 'object') return cached as LogseqCaptureSettings
	} catch {
		// storage unavailable — defaults
	}
	return DEFAULT_CAPTURE_SETTINGS
}
