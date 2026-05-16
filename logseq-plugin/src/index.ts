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
				`Logseq Web Clipper is a browser extension that pushes clipped pages into this graph and tags them with #${WEB_CLIPPING_TAG}. Run "Web Clipper: Set up schema" once to create the tag and its properties.`,
				'info',
				{ timeout: 6000 },
			)
		},
	)
}

logseq.ready(main).catch(console.error)
