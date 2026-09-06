const { InstanceStatus } = require('@companion-module/base')
const { fetch, Agent } = require('undici')
const { toQueryString, splitPair } = require('./utils')

const DEFAULT_TIMEOUT = 5000
/** changes of the device clock offset smaller than this (the Date header has 1 s resolution) are ignored */
const CLOCK_SLACK_MS = 2000

/**
 * Error thrown by the request layer for any failed request.
 * - status: HTTP status code (0 for network errors / timeouts)
 * - apiStatus: the `status` string of the Pearl JSON envelope when present (e.g. 'notfound', 'error')
 */
class PearlApiError extends Error {
	constructor(message, { status = 0, apiStatus = undefined, method = undefined, path = undefined } = {}) {
		super(message)
		this.name = 'PearlApiError'
		this.status = status
		this.apiStatus = apiStatus
		this.method = method
		this.path = path
	}
}

/**
 * Resolve the path prefix for a request base
 * @param {import('./instance').EpiphanPearl} self
 * @param {'auto'|'v1'|'raw'} base
 * @returns {string}
 */
function basePrefix(self, base) {
	switch (base) {
		case 'v1':
			return '/api'
		case 'raw':
			return ''
		default:
			return self.apiBasePath || '/api'
	}
}

/**
 * Strip a legacy '/api' or '/api/v2.0' prefix so callers may pass either style of path
 * @param {string} path
 * @returns {string}
 */
function normalisePath(path) {
	let p = String(path || '')
	if (!p.startsWith('/')) p = '/' + p
	if (p.startsWith('/api/v2.0/')) return p.slice('/api/v2.0'.length)
	if (p === '/api/v2.0') return ''
	if (p.startsWith('/api/')) return p.slice('/api'.length)
	return p
}

/**
 * Build the undici Agent for a configuration: a self-signed certificate is accepted only when the
 * connection uses HTTPS and `accept_self_signed` is on.
 * @param {object} config normalised config
 * @returns {Agent}
 */
function createDispatcher(config) {
	const acceptSelfSigned = config?.use_https === true && config?.accept_self_signed === true
	return new Agent({ connect: { rejectUnauthorized: !acceptSelfSigned } })
}

module.exports = {
	/**
	 * INTERNAL: update the instance status but only when it changed (status or message)
	 *
	 * @param {InstanceStatus} status
	 * @param {string} [message]
	 */
	applyStatus(status, message = '') {
		if (this.currentStatus === status && this.currentStatusMessage === message) return
		this.currentStatus = status
		this.currentStatusMessage = message
		this.updateStatus(status, message)
	},

	/**
	 * INTERNAL: replace this.dispatcher with an Agent built from the current configuration.
	 * The previous Agent is closed gracefully so requests still in flight on it can finish.
	 */
	resetDispatcher() {
		const previous = this.dispatcher
		this.dispatcher = createDispatcher(this.config)
		if (previous) previous.close().catch(() => {})
	},

	/**
	 * INTERNAL: close this.dispatcher (graceful: in-flight requests finish or time out on their own)
	 */
	closeDispatcher() {
		const previous = this.dispatcher
		this.dispatcher = undefined
		if (previous) previous.close().catch(() => {})
	},

	/**
	 * INTERNAL: the Agent to send a request through, created on demand when none exists yet
	 * @returns {Agent}
	 */
	ensureDispatcher() {
		if (!this.dispatcher) this.dispatcher = createDispatcher(this.config)
		return this.dispatcher
	},

	/**
	 * INTERNAL: track the device clock from the Date header of a response.
	 * Offsets that moved by less than CLOCK_SLACK_MS are ignored.
	 *
	 * @param {Response} response
	 */
	syncClock(response) {
		const date = response?.headers?.get?.('date')
		if (!date) return
		const deviceMs = Date.parse(date)
		if (!Number.isFinite(deviceMs)) return
		const offset = deviceMs - Date.now()
		if (Math.abs(offset - (this.clockOffsetMs || 0)) < CLOCK_SLACK_MS) return
		this.clockOffsetMs = offset
	},

	/**
	 * Current time in ms according to the device clock (host clock corrected by the Date header offset)
	 * @returns {number}
	 */
	deviceNow() {
		return Date.now() + (this.clockOffsetMs || 0)
	},

	/**
	 * Perform a request against the Pearl.
	 *
	 * @param {'GET'|'POST'|'PUT'|'PATCH'|'DELETE'} method
	 * @param {string} path      path WITHOUT the /api prefix, e.g. '/channels/1/publishers/status'.
	 *                           For backwards compat a path starting with '/api/' has that prefix stripped.
	 * @param {object} [opts]
	 * @param {object} [opts.query]    key/value; booleans -> 'true'/'false'; undefined/null skipped
	 * @param {object} [opts.body]     JSON body (only for non-GET)
	 * @param {'auto'|'v1'|'raw'} [opts.base='auto']  auto = this.apiBasePath, v1 = '/api', raw = path used verbatim
	 * @param {number} [opts.timeout]  ms, default this.config.timeout (5000)
	 * @param {boolean} [opts.raw]     return Buffer of the response body instead of parsed JSON result
	 * @param {boolean} [opts.text]    return the response body as string (text/plain endpoints)
	 * @param {boolean} [opts.optional] 404/405 return null instead of throwing, and do not touch instance status
	 * @param {boolean} [opts.silent]  do not log errors (caller handles)
	 * @returns {Promise<any>} the `result` field of the JSON envelope, the whole body when there is no result field,
	 *                         `true` for an ok envelope without result, Buffer when raw, string when text,
	 *                         null when optional and not found.
	 * @throws {PearlApiError}
	 */
	async request(method, path, opts = {}) {
		const config = this.config || {}
		const base = opts.base || 'auto'
		const verb = String(method || 'GET').toUpperCase()
		const cleanPath = base === 'raw' ? String(path || '') : normalisePath(path)
		const scheme = config.use_https === true ? 'https' : 'http'
		const port = config.host_port || (config.use_https === true ? 443 : 80)
		const url = `${scheme}://${config.host}:${port}${basePrefix(this, base)}${cleanPath}${toQueryString(opts.query)}`
		const timeout =
			Number(opts.timeout) > 0
				? Number(opts.timeout)
				: Number(config.timeout) > 0
					? Number(config.timeout)
					: DEFAULT_TIMEOUT
		const errInfo = { method: verb, path: cleanPath }

		const headers = {
			Authorization:
				'Basic ' + Buffer.from(`${config.username ?? ''}:${config.password ?? ''}`).toString('base64'),
			Accept: opts.raw ? 'image/*, */*' : opts.text ? 'text/plain, */*' : 'application/json, */*',
		}
		const init = {
			method: verb,
			headers,
			signal: AbortSignal.timeout(timeout),
			dispatcher: this.ensureDispatcher(),
		}
		if (verb !== 'GET' && opts.body !== undefined) {
			headers['Content-Type'] = 'application/json'
			init.body = typeof opts.body === 'string' ? opts.body : JSON.stringify(opts.body)
		}

		if (config.verbose) {
			this.log('debug', `Request ${verb} ${url}${init.body ? ' body: ' + init.body : ''}`)
		}

		let response
		try {
			response = await fetch(url, init)
		} catch (error) {
			const isTimeout = error?.name === 'TimeoutError' || error?.name === 'AbortError'
			const cause = error?.cause
			const reason = `${cause?.message || error?.message || error}${cause?.code ? ` (${cause.code})` : ''}`
			const message = isTimeout
				? `Request timed out after ${timeout} ms: ${verb} ${url}`
				: `Connection failed: ${verb} ${url} - ${reason}`
			this.applyStatus(
				InstanceStatus.ConnectionFailure,
				isTimeout ? 'Request timed out' : cause?.code || error?.message || 'Connection failed',
			)
			if (!opts.silent) this.log('error', message)
			throw new PearlApiError(message, { status: 0, ...errInfo })
		}

		this.syncClock(response)

		if (response.status === 401 || response.status === 403) {
			const message = `Authentication failed (${response.status}) for ${verb} ${url}`
			this.applyStatus(InstanceStatus.AuthenticationFailure, 'Check username and password')
			if (!opts.silent) this.log('error', message)
			throw new PearlApiError(message, { status: response.status, ...errInfo })
		}

		if (opts.optional && (response.status === 404 || response.status === 405)) {
			if (config.verbose) this.log('debug', `Optional request ${verb} ${url} returned ${response.status}`)
			return null
		}

		if (!response.ok) {
			let apiStatus
			let detail = ''
			try {
				const text = await response.text()
				try {
					const parsed = JSON.parse(text)
					apiStatus = parsed?.status
					detail = parsed?.message || parsed?.error || ''
				} catch {
					detail = text.slice(0, 200)
				}
			} catch {
				// ignore body read problems
			}
			const message =
				`HTTP ${response.status} ${response.statusText || ''} for ${verb} ${url}${detail ? ' - ' + detail : ''}`.trim()
			if (!opts.silent) this.log('error', message)
			throw new PearlApiError(message, { status: response.status, apiStatus, ...errInfo })
		}

		let result
		if (opts.raw) {
			result = Buffer.from(await response.arrayBuffer())
			if (config.verbose) this.log('debug', `Response ${response.status} ${result.length} bytes`)
		} else {
			const text = await response.text()
			if (config.verbose)
				this.log(
					'debug',
					`Response ${response.status} ${text.length > 2000 ? text.slice(0, 2000) + '…' : text}`,
				)
			if (opts.text) {
				result = text
			} else if (text.trim() === '') {
				result = true
			} else {
				let body
				try {
					body = JSON.parse(text)
				} catch {
					body = text
				}
				if (body && typeof body === 'object' && !Array.isArray(body) && typeof body.status === 'string') {
					if (body.status !== 'ok') {
						const message = `Pearl returned status '${body.status}' for ${verb} ${url}${body.message ? ' - ' + body.message : ''}`
						if (!opts.silent) this.log('error', message)
						throw new PearlApiError(message, {
							status: response.status,
							apiStatus: body.status,
							...errInfo,
						})
					}
					result = 'result' in body ? body.result : true
				} else {
					result = body
				}
			}
		}

		if (this.currentStatus !== InstanceStatus.Ok) {
			this.applyStatus(InstanceStatus.Ok)
		}
		return result
	},

	/**
	 * Compatibility wrapper for the old request helper
	 *
	 * @param {string} type - get, post, put, patch, delete
	 * @param {string} url - API path (with or without /api prefix)
	 * @param {?object} body - optional body
	 */
	async sendRequest(type, url, body = undefined) {
		const method = String(type || 'GET').toUpperCase()
		return this.request(method, url, method === 'GET' ? {} : { body })
	},

	/**
	 * Fetch a preview image from the device.
	 *
	 * @param {'channel'|'input'|'output'|'layout'} kind
	 * @param {string} id - for kind 'layout', `${cid}-${lid}` (matches the channelIdlayoutId option format)
	 * @returns {Promise<string|null>} base64 encoded image or null when unavailable
	 */
	async fetchPreviewImage(kind, id) {
		const width = Number(this.config?.preview_width) >= 72 ? Math.round(Number(this.config.preview_width)) : 144
		if (id === undefined || id === null || id === '') return null

		if (kind === 'layout') {
			// Undocumented: not in the published Pearl REST API v2.0 spec. Confirmed by Epiphan:
			// GET /api/channels/{cid}/layouts/{lid}/preview?resolution=WxH -> JPEG, on the legacy base,
			// and it renders the given layout's own composition regardless of whether it is the channel's
			// active one. Since it is undocumented, only the parameters known to work are sent (no
			// `format` or `keep_aspect_ratio` — those are not confirmed for this endpoint), and, like every
			// other preview, a failure (wrong firmware, endpoint removed, ...) just yields null.
			const pair = splitPair(String(id))
			if (!pair) return null
			const [cid, lid] = pair
			try {
				const buffer = await this.request(
					'GET',
					`/channels/${encodeURIComponent(cid)}/layouts/${encodeURIComponent(lid)}/preview`,
					{
						base: 'v1',
						query: { resolution: `${width}x${Math.round((width * 9) / 16)}` },
						raw: true,
						optional: true,
						silent: true,
					},
				)
				if (!buffer || !Buffer.isBuffer(buffer) || buffer.length === 0) return null
				return buffer.toString('base64')
			} catch (error) {
				if (this.config?.verbose) this.log('debug', `Layout preview ${id} failed: ${error.message}`)
				return null
			}
		}

		let collection
		const query = { format: 'png' }
		switch (kind) {
			case 'channel':
			case 'channels':
				collection = 'channels'
				query.resolution = String(width)
				query.keep_aspect_ratio = true
				break
			case 'input':
			case 'inputs':
				collection = 'inputs'
				query.resolution = String(width)
				query.keep_aspect_ratio = true
				break
			case 'output':
			case 'outputs':
				collection = 'outputs'
				// the output preview endpoint has no 'auto', so request an explicit 16:9 size
				query.resolution = `${width}x${Math.round((width * 9) / 16)}`
				break
			default:
				this.log('warn', `fetchPreviewImage: unknown kind '${kind}'`)
				return null
		}

		try {
			const buffer = await this.request('GET', `/${collection}/${encodeURIComponent(String(id))}/preview`, {
				query,
				raw: true,
				optional: true,
				silent: true,
			})
			if (!buffer || !Buffer.isBuffer(buffer) || buffer.length === 0) return null
			return buffer.toString('base64')
		} catch (error) {
			if (this.config?.verbose) this.log('debug', `Preview ${kind} ${id} failed: ${error.message}`)
			return null
		}
	},
}

module.exports.PearlApiError = PearlApiError
