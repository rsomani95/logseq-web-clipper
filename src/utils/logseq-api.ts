// Typed client around Logseq's local HTTP API (POST {baseUrl}/api).
//
// The single `/api` endpoint reflects the entire @logseq/libs SDK — pass
// `method: "logseq.<Namespace>.<Method>"` and the args array, and the request
// is dispatched to the SDK as if it had been called from inside a plugin.
// We don't import @logseq/libs here; types are kept minimal and tight to the
// methods we actually call from the clipper.
//
// Auth: Bearer token from the user's Logseq HTTP server panel. CORS is
// wide-open on the server side (origin: *) since logseq/logseq#8651, but the
// extension still declares `host_permissions` for 127.0.0.1:12315 to keep
// MV3 fetches in the service worker out of CORS preflight quirks.

export interface LogseqAPIConfig {
	/** e.g. `http://127.0.0.1:12315` — no trailing slash. */
	baseUrl: string
	/** Bearer token, generated from Logseq → Settings → Features → HTTP APIs Server. */
	token: string
}

export interface LogseqGraphInfo {
	name: string
	url?: string
	path?: string
}

export interface LogseqPageEntity {
	/** Internal datascript entity id. Required when used as a node-property value. */
	id: number
	uuid: string
	name?: string
	originalName?: string
}

export interface LogseqBlockEntity {
	id?: number
	uuid: string
	/** Block text. DB graphs expose `title`; older/file builds use `content`. Read whichever is present. */
	content?: string
	title?: string
	children?: LogseqBlockEntity[]
}

export interface LogseqBatchBlock {
	content: string
	properties?: Record<string, unknown>
	children?: LogseqBatchBlock[]
}

export class LogseqAPIError extends Error {
	constructor(
		public readonly status: number,
		public readonly method: string,
		message: string,
	) {
		super(`Logseq API ${method} failed (${status}): ${message}`)
		this.name = 'LogseqAPIError'
	}
}

export class LogseqAPI {
	constructor(private readonly config: LogseqAPIConfig) {}

	/**
	 * Low-level dispatcher. Posts {method, args} to `${baseUrl}/api`. The HTTP
	 * server resolves `method` to the real SDK method via `(string/split "." method)`
	 * and forwards `args` verbatim, so any documented `@logseq/libs` method works.
	 */
	async call<T = unknown>(method: string, args: readonly unknown[] = []): Promise<T> {
		let res: Response
		try {
			res = await fetch(`${this.config.baseUrl}/api`, {
				method: 'POST',
				headers: {
					'Content-Type': 'application/json',
					Authorization: `Bearer ${this.config.token}`,
				},
				body: JSON.stringify({ method, args }),
			})
		} catch (cause) {
			throw new LogseqAPIError(
				0,
				method,
				`network error — is Logseq running with the HTTP server on? (${cause instanceof Error ? cause.message : String(cause)})`,
			)
		}

		if (!res.ok) {
			const body = await res.text().catch(() => '')
			throw new LogseqAPIError(res.status, method, body || res.statusText)
		}

		// Many SDK methods return null/undefined; tolerate empty bodies.
		const text = await res.text()
		if (!text) return undefined as T
		try {
			return JSON.parse(text) as T
		} catch {
			return text as T
		}
	}

	// — Connection / introspection —

	getCurrentGraph(): Promise<LogseqGraphInfo | null> {
		return this.call('logseq.App.getCurrentGraph')
	}

	checkCurrentIsDbGraph(): Promise<boolean> {
		return this.call('logseq.App.checkCurrentIsDbGraph')
	}

	/**
	 * Round-trip a `getCurrentGraph` to confirm the token + base URL work and the
	 * current graph is a DB graph. Returns the graph name on success; throws
	 * a `LogseqAPIError` otherwise.
	 */
	async testConnection(): Promise<{ graphName: string; isDbGraph: boolean }> {
		const graph = await this.getCurrentGraph()
		if (!graph?.name) throw new LogseqAPIError(0, 'getCurrentGraph', 'no current graph')
		const isDbGraph = await this.checkCurrentIsDbGraph()
		return { graphName: graph.name, isDbGraph }
	}

	// — Page / block ops —

	createPage(
		name: string,
		properties: Record<string, unknown> = {},
		opts: { redirect?: boolean; createFirstBlock?: boolean; format?: 'markdown' | 'org' } = {},
	): Promise<LogseqPageEntity | null> {
		return this.call('logseq.Editor.createPage', [name, properties, opts])
	}

	/**
	 * Creates (or returns the existing) journal page for a YYYY-MM-DD date.
	 * Required for writing `:logseq.property/type :date` properties — those
	 * expect a page reference (numeric `page.id`), not an ISO string.
	 */
	createJournalPage(yyyyMmDd: string): Promise<LogseqPageEntity | null> {
		return this.call('logseq.Editor.createJournalPage', [yyyyMmDd])
	}

	getPage(nameOrUuid: string): Promise<LogseqPageEntity | null> {
		return this.call('logseq.Editor.getPage', [nameOrUuid])
	}

	/**
	 * Reads every property on a page. Returns a record keyed by the full
	 * property `:db/ident` (e.g. `:plugin.property.logseq-zotero/url`),
	 * with values shaped according to the property type (scalars for default/url,
	 * entity refs for node/date).
	 */
	getPageProperties(pageUuid: string): Promise<Record<string, unknown> | null> {
		return this.call('logseq.Editor.getPageProperties', [pageUuid])
	}

	/**
	 * Returns a page's full block tree (top-level blocks, each with nested
	 * `children`). Used by re-import to find an existing "Highlights" block so
	 * new highlights can be appended rather than duplicating the page.
	 */
	getPageBlocksTree(srcPage: string): Promise<LogseqBlockEntity[]> {
		return this.call('logseq.Editor.getPageBlocksTree', [srcPage])
	}

	/**
	 * Raw Datascript query against the graph. Args are forwarded verbatim and
	 * must already be in Datalog literal form — string values quoted (`"foo"`),
	 * uuids as `#uuid "…"`, etc.
	 */
	datascriptQuery<T = unknown>(query: string, ...args: string[]): Promise<T> {
		return this.call('logseq.DB.datascriptQuery', [query, ...args])
	}

	addBlockTag(uuid: string, tagName: string): Promise<unknown> {
		return this.call('logseq.Editor.addBlockTag', [uuid, tagName])
	}

	/**
	 * Sets a property on a block. `key` may be a kebab-case property name OR a
	 * fully qualified `:plugin.property.<id>/<kebab>` ident — the latter is
	 * what the clipper uses to target properties owned by the companion plugin.
	 */
	upsertBlockProperty(uuid: string, key: string, value: unknown): Promise<unknown> {
		return this.call('logseq.Editor.upsertBlockProperty', [uuid, key, value])
	}

	/**
	 * Inserts a nested block tree under a parent. NOTE: `IBatchBlock.properties`
	 * is silently ignored on DB graphs — set properties in a follow-up
	 * `upsertBlockProperty` call after the tree is created.
	 */
	insertBatchBlock(
		parentUuid: string,
		blocks: LogseqBatchBlock[],
		opts: { sibling?: boolean; before?: boolean; keepUUID?: boolean } = {},
	): Promise<unknown> {
		return this.call('logseq.Editor.insertBatchBlock', [parentUuid, blocks, opts])
	}

	appendBlockInPage(
		pageNameOrUuid: string,
		content: string,
		properties: Record<string, unknown> = {},
	): Promise<LogseqBlockEntity | null> {
		return this.call('logseq.Editor.appendBlockInPage', [pageNameOrUuid, content, properties])
	}

	// — Navigation —

	openPage(name: string): Promise<unknown> {
		return this.call('logseq.App.pushState', ['page', { name }])
	}
}

export function createLogseqAPI(config: LogseqAPIConfig): LogseqAPI {
	return new LogseqAPI(config)
}
