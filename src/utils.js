/**
 * Pure helper functions shared by the module. No instance access, no side effects,
 * so everything in here is unit-test friendly.
 */

/**
 * Make a string safe for use inside a Companion variable id ([a-zA-Z0-9_-] only)
 * @param {*} str
 * @returns {string}
 */
function safeId(str) {
	return String(str ?? '').replace(/[^a-zA-Z0-9_-]/g, '_')
}

/**
 * Format a number of seconds as HH:MM:SS (hours are not wrapped at 24)
 * @param {number|string} seconds
 * @returns {string} '' when the input is not a finite number
 */
function formatHms(seconds) {
	const total = Number(seconds)
	if (!Number.isFinite(total)) return ''
	const sign = total < 0 ? '-' : ''
	const abs = Math.floor(Math.abs(total))
	const h = Math.floor(abs / 3600)
	const m = Math.floor((abs % 3600) / 60)
	const s = abs % 60
	return `${sign}${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`
}

/**
 * Format a unix timestamp (seconds) as local HH:MM
 * @param {number|string} unixSeconds
 * @returns {string} '' when the input is not a finite number
 */
function formatClock(unixSeconds) {
	const ts = Number(unixSeconds)
	if (!Number.isFinite(ts) || ts <= 0) return ''
	const d = new Date(ts * 1000)
	if (Number.isNaN(d.getTime())) return ''
	return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`
}

/**
 * Round a number to one decimal
 * @param {number|string} n
 * @returns {number|''} '' when not a finite number
 */
function round1(n) {
	const num = Number(n)
	if (!Number.isFinite(num)) return ''
	return Math.round(num * 10) / 10
}

/**
 * Convert bytes to megabytes (1 decimal)
 * @param {number|string} n
 * @returns {number|''}
 */
function bytesToMb(n) {
	const num = Number(n)
	if (!Number.isFinite(num)) return ''
	return round1(num / (1024 * 1024))
}

/**
 * Convert bytes to gigabytes (1 decimal)
 * @param {number|string} n
 * @returns {number|''}
 */
function bytesToGb(n) {
	const num = Number(n)
	if (!Number.isFinite(num)) return ''
	return round1(num / (1024 * 1024 * 1024))
}

/**
 * Split a combined option value like '1-2' into its two parts.
 * Only the first dash is used as the separator so the second part may contain dashes.
 * @param {*} str
 * @returns {[string, string]|null} null when the input is not a string containing a dash with two non-empty parts
 */
function splitPair(str) {
	if (typeof str !== 'string') return null
	const idx = str.indexOf('-')
	if (idx <= 0 || idx === str.length - 1) return null
	return [str.slice(0, idx), str.slice(idx + 1)]
}

/**
 * JSON.stringify with recursively sorted object keys, so structurally equal objects produce equal strings.
 * @param {*} obj
 * @returns {string}
 */
function stableJson(obj) {
	return JSON.stringify(sortKeys(obj))
}

function sortKeys(value) {
	if (Array.isArray(value)) return value.map(sortKeys)
	if (value && typeof value === 'object' && !(value instanceof Date)) {
		const out = {}
		for (const key of Object.keys(value).sort()) {
			out[key] = sortKeys(value[key])
		}
		return out
	}
	return value
}

/**
 * Parse a JSON text option into an object.
 * @param {string} text
 * @returns {object}
 * @throws {Error} with a readable message when the text is not a JSON object
 */
function parseJsonOption(text) {
	const trimmed = typeof text === 'string' ? text.trim() : ''
	if (trimmed === '') return {}
	let parsed
	try {
		parsed = JSON.parse(trimmed)
	} catch (e) {
		throw new Error(`Option is not valid JSON: ${e.message}`)
	}
	if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
		throw new Error('Option must be a JSON object (e.g. {"key": "value"})')
	}
	return parsed
}

/**
 * Return a shallow copy of obj without '' / undefined / null values
 * @param {object} obj
 * @returns {object}
 */
function nonBlank(obj) {
	const out = {}
	if (!obj || typeof obj !== 'object') return out
	for (const [key, value] of Object.entries(obj)) {
		if (value === '' || value === undefined || value === null) continue
		out[key] = value
	}
	return out
}

/**
 * Build a URL query string from a key/value object.
 * Booleans become 'true'/'false', undefined/null values are skipped, arrays are joined with commas.
 * @param {object} [query]
 * @returns {string} '' or '?a=b&c=d'
 */
function toQueryString(query) {
	if (!query || typeof query !== 'object') return ''
	const params = new URLSearchParams()
	for (const [key, value] of Object.entries(query)) {
		if (value === undefined || value === null) continue
		if (Array.isArray(value)) {
			params.set(key, value.join(','))
		} else if (typeof value === 'boolean') {
			params.set(key, value ? 'true' : 'false')
		} else {
			params.set(key, String(value))
		}
	}
	const str = params.toString()
	return str ? `?${str}` : ''
}

/**
 * Parse a legacy "key=value" per line text response (get_params.cgi) into an object
 * @param {string} text
 * @returns {Record<string,string>}
 */
function parseKeyValueText(text) {
	const out = {}
	if (typeof text !== 'string') return out
	for (const line of text.split(/\r?\n/)) {
		const idx = line.indexOf('=')
		if (idx <= 0) continue
		const key = line.slice(0, idx).trim()
		if (!key) continue
		out[key] = line.slice(idx + 1).trim()
	}
	return out
}

/**
 * Convert a firmware version string like '4.24.1' to a comparable integer (4*10000 + 24*100 + 1 = 42401)
 * @param {string} version
 * @returns {number|null} null when unparseable
 */
function firmwareVersionNumber(version) {
	if (typeof version !== 'string') return null
	const match = version.trim().match(/^(\d+)\.(\d+)(?:\.(\d+))?/)
	if (!match) return null
	return Number(match[1]) * 10000 + Number(match[2]) * 100 + Number(match[3] ?? 0)
}

/**
 * Coerce a value to a number within [min, max], falling back to def when not numeric
 * @param {*} value
 * @param {number} def
 * @param {number} min
 * @param {number} max
 * @returns {number}
 */
function clampNumber(value, def, min, max) {
	const num = typeof value === 'string' && value.trim() !== '' ? Number(value) : value
	if (typeof num !== 'number' || !Number.isFinite(num)) return def
	return Math.min(max, Math.max(min, num))
}

/** base back-off between metadata retries (multiplied by the number of failed attempts, capped at 10) */
const METADATA_RETRY_BASE_MS = 60000
const METADATA_RETRY_MAX_FACTOR = 10

/**
 * Decide whether the legacy content metadata of a channel has to be (re)fetched.
 * `entry` is `this.metadata[cid]`: undefined (never fetched) -> true; a successful entry -> false;
 * a failure marker `{ _failedAt, _attempts }` -> true once `60 s * min(attempts, 10)` have passed.
 * @param {object|undefined} entry
 * @param {number} [now=Date.now()]
 * @returns {boolean}
 */
function metadataRetryDue(entry, now = Date.now()) {
	if (!entry || typeof entry !== 'object') return true
	const failedAt = Number(entry._failedAt)
	if (!Number.isFinite(failedAt)) return false
	const attempts = Math.min(Math.max(1, Number(entry._attempts) || 1), METADATA_RETRY_MAX_FACTOR)
	return now - failedAt > METADATA_RETRY_BASE_MS * attempts
}

/** `D2P<serial>.` prefix carried by the ids of the legacy /sources/status list but not by the v2.0 /inputs ids */
const INPUT_ID_PREFIX_RE = /^D2P[^.]*\./

/**
 * Strip the `D2P<serial>.` device prefix from an input id
 * @param {*} id
 * @returns {string}
 */
function normaliseInputId(id) {
	return String(id ?? '').replace(INPUT_ID_PREFIX_RE, '')
}

/**
 * true when two input ids name the same input once the device prefix is ignored
 * @param {*} a
 * @param {*} b
 * @returns {boolean}
 */
function sameInputId(a, b) {
	return normaliseInputId(a) === normaliseInputId(b)
}

/**
 * The empty shape of the instance state, see doc/ARCHITECTURE.md "Instance state"
 * @returns {object}
 */
function emptyState() {
	return {
		channels: {},
		recorders: {},
		inputs: {},
		outputs: {},
		storages: {},
		singleTouch: {},
		presets: [],
		events: { upcoming: null, ongoing: null },
		systemStatus: undefined,
		firmware: undefined,
		identity: undefined,
		afu: [],
		connectivity: undefined,
		speedtest: undefined,
		// optimistic: the Pearl API has no read endpoint for the currently applied preset, so this only
		// reflects what was last applied through this connection, carried over across polls like speedtest
		lastConfigPreset: undefined,
	}
}

module.exports = {
	safeId,
	formatHms,
	formatClock,
	round1,
	bytesToMb,
	bytesToGb,
	splitPair,
	stableJson,
	parseJsonOption,
	nonBlank,
	toQueryString,
	parseKeyValueText,
	firmwareVersionNumber,
	clampNumber,
	metadataRetryDue,
	normaliseInputId,
	sameInputId,
	emptyState,
}
