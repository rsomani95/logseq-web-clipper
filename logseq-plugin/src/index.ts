import '@logseq/libs'
import { WEB_CLIPPING_TAG } from '@logseq-web-clipper/shared'

import { setLogseqDbSchema } from './services/set-logseqdb-schema'

async function main(): Promise<void> {
	logseq.App.registerCommandPalette(
		{ key: 'logseq-web-clipper-setup-schema', label: 'Web Clipper: Set up schema' },
		async () => {
			const isDb = await logseq.App.checkCurrentIsDbGraph()
			if (!isDb) {
				await logseq.UI.showMsg(
					'Logseq Web Clipper requires a DB graph. Switch to one and try again.',
					'error',
				)
				return
			}
			await setLogseqDbSchema()
		},
	)

	logseq.App.registerCommandPalette(
		{ key: 'logseq-web-clipper-about', label: 'Web Clipper: About' },
		async () => {
			await logseq.UI.showMsg(
				`Logseq Web Clipper pushes clipped pages from the browser into this graph as #${WEB_CLIPPING_TAG}. Shared metadata (title, authors, url, etc.) reuses the zoterolocal plugin's properties so #${WEB_CLIPPING_TAG} and #Zotero unify. Run "Web Clipper: Set up schema" after Zotero's schema is in place.`,
				'info',
				{ timeout: 8000 },
			)
		},
	)
}

logseq.ready(main).catch(console.error)
