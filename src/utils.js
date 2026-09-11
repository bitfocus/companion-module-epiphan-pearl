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

/** units tried in order by bytesToHuman, base 1024 */
const BYTE_UNITS = ['B', 'KB', 'MB', 'GB', 'TB', 'PB']

/**
 * Bytes as a human readable string, base 1024: '0 B', '512 B', '1.5 KB', '11 GB', '128 GB'.
 * One decimal below 100 of the chosen unit (dropped when it would be '.0'), whole numbers at or above 100.
 * @param {number|string} bytes
 * @returns {string} '0 B' when not a finite positive number
 */
function bytesToHuman(bytes) {
	let value = Number(bytes)
	if (!Number.isFinite(value) || value <= 0) return '0 B'
	let unitIndex = 0
	while (value >= 1024 && unitIndex < BYTE_UNITS.length - 1) {
		value /= 1024
		unitIndex++
	}
	const unit = BYTE_UNITS[unitIndex]
	if (unitIndex === 0) return `${Math.round(value)} ${unit}`
	const text = value >= 100 ? String(Math.round(value)) : String(Math.round(value * 10) / 10)
	return `${text} ${unit}`
}

/**
 * Seconds as a compact duration: 'm:ss' below one hour, 'h:mm:ss' from one hour up.
 * @param {number|string} seconds
 * @returns {string} '0:00' when not a finite positive number
 */
function compactDuration(seconds) {
	const total = Number(seconds)
	const abs = Number.isFinite(total) && total > 0 ? Math.floor(total) : 0
	const h = Math.floor(abs / 3600)
	const m = Math.floor((abs % 3600) / 60)
	const s = abs % 60
	const two = (v) => String(v).padStart(2, '0')
	return h > 0 ? `${h}:${two(m)}:${two(s)}` : `${m}:${two(s)}`
}

/**
 * Seconds of uptime as '3d 4h' (days present), '4h 05m' (hours present) or '12m'.
 * @param {number|string} seconds
 * @returns {string} '0m' when not a finite positive number
 */
function formatUptime(seconds) {
	const total = Number(seconds)
	const abs = Number.isFinite(total) && total > 0 ? Math.floor(total) : 0
	const d = Math.floor(abs / 86400)
	const h = Math.floor((abs % 86400) / 3600)
	const m = Math.floor((abs % 3600) / 60)
	if (d > 0) return `${d}d ${h}h`
	if (h > 0) return `${h}h ${String(m).padStart(2, '0')}m`
	return `${m}m`
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
 * recorder states in which a toggle press stops instead of starts. `error` is included: a recorder that
 * failed mid-recording is still running from the device's point of view, and a second start does
 * nothing, so the one toggle button an operator has must send the stop (QA 2026-09-08).
 */
const ACTIVE_RECORDER_STATES = ['started', 'starting', 'paused', 'error']
/** publisher states in which a toggle press stops instead of starts (`error`: same reasoning as above) */
const ACTIVE_PUBLISHER_STATES = ['started', 'starting', 'listening', 'error']

/**
 * Command a toggle press sends for a recorder: 'stop' when it (or, for 'all', any recorder) is
 * started, starting, paused or in error, otherwise 'start'.
 * @param {Record<string, {status?: {state?: string}}>} recorders state.recorders
 * @param {string} recorderId a recorder id or 'all'
 * @returns {'start'|'stop'}
 */
function recorderToggleOp(recorders, recorderId) {
	const list = recorderId === 'all' ? Object.values(recorders || {}) : [recorders?.[recorderId]].filter(Boolean)
	return list.some((r) => ACTIVE_RECORDER_STATES.includes(r?.status?.state)) ? 'stop' : 'start'
}

/**
 * Command a toggle press sends for a publisher: 'stop' when it (or, for 'all', any publisher of the
 * channel) reports `started: true` (the API's own running flag, true throughout an error state) or a
 * state of started, starting, listening or error, otherwise 'start'.
 * @param {Record<string, {status?: {state?: string, started?: boolean}}>} publishers channel.publishers
 * @param {string} publisherId a publisher id or 'all'
 * @returns {'start'|'stop'}
 */
function publisherToggleOp(publishers, publisherId) {
	const list = publisherId === 'all' ? Object.values(publishers || {}) : [publishers?.[publisherId]].filter(Boolean)
	return list.some((p) => p?.status?.started === true || ACTIVE_PUBLISHER_STATES.includes(p?.status?.state))
		? 'stop'
		: 'start'
}

/**
 * Command a toggle press sends for a scheduled event
 * @param {string|undefined} status event status
 * @returns {'pause'|'resume'|'start'|''} '' when no command applies
 */
function eventToggleOp(status) {
	switch (status) {
		case 'running':
			return 'pause'
		case 'paused':
			return 'resume'
		case 'scheduled':
			return 'start'
		default:
			return ''
	}
}

/**
 * true when a fixed event command applies to an event in this status
 * @param {string} op start, stop, pause, resume or extend
 * @param {string|undefined} status event status
 * @returns {boolean}
 */
function eventApplies(op, status) {
	switch (op) {
		case 'start':
			return status === 'scheduled'
		case 'stop':
		case 'extend':
			return status === 'running' || status === 'paused'
		case 'pause':
			return status === 'running'
		case 'resume':
			return status === 'paused'
		default:
			return false
	}
}

/**
 * Local wall clock time as HH:MM:SS
 * @param {Date} [date=new Date()]
 * @returns {string}
 */
function localTimeHms(date = new Date()) {
	const two = (v) => String(v).padStart(2, '0')
	return `${two(date.getHours())}:${two(date.getMinutes())}:${two(date.getSeconds())}`
}

/**
 * Text sent to the device by the bookmark action: the trimmed option ('Marker' when empty),
 * followed by ' HH:MM:SS' when appendTime is on.
 * @param {*} text
 * @param {boolean} appendTime
 * @param {Date} [date=new Date()]
 * @returns {string}
 */
function bookmarkText(text, appendTime, date = new Date()) {
	const base = String(text ?? '').trim() || 'Marker'
	return appendTime === true ? `${base} ${localTimeHms(date)}` : base
}

/** used-space thresholds of a storage: amber LOW at 90 %, red FULL at 97 % */
const STORAGE_LOW_PCT = 90
const STORAGE_FULL_PCT = 97
/** the three severity levels of a mounted storage, worst last */
const STORAGE_SEVERITY = ['ok', 'low', 'full']

/**
 * Severity of a storage from its StorageStatus: how full it is, which of the three severity levels
 * that lands in, and the badge word for it. The single source of the 90 % / 97 % thresholds, shared
 * by the storage_level feedback, the storage_<id>_level_word variable and the Storage presets.
 * The mount states (nodev / dev / devro / formatting) are *not* severity — callers check
 * `status.state` themselves and only ask this for a mounted ('ready' / 'devro') storage.
 *
 * @param {{total?: number|string, free?: number|string}} status
 * @returns {{usedPct: number|undefined, level: 'ok'|'low'|'full', word: string}} word is '' at 'ok'
 */
function storageLevel(status) {
	// blank / missing is unknown, not zero: a storage reporting free: '' has no severity at all
	const size = (value) => {
		if (value === undefined || value === null || value === '') return undefined
		const n = Number(value)
		return Number.isFinite(n) ? n : undefined
	}
	const total = size(status?.total)
	const free = size(status?.free)
	const usedPct = total !== undefined && total > 0 && free !== undefined ? ((total - free) / total) * 100 : undefined
	if (usedPct === undefined) return { usedPct, level: 'ok', word: '' }
	if (usedPct >= STORAGE_FULL_PCT) return { usedPct, level: 'full', word: 'FULL' }
	if (usedPct >= STORAGE_LOW_PCT) return { usedPct, level: 'low', word: 'LOW' }
	return { usedPct, level: 'ok', word: '' }
}

/**
 * The empty shape of the instance state
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
		events: { upcoming: null, ongoing: null, list: [] },
		systemStatus: undefined,
		firmware: undefined,
		identity: undefined,
		afu: [],
		// optimistic: the Pearl API has no read endpoint for the currently applied preset, so this only
		// reflects what was last applied through this connection, carried over across polls
		lastConfigPreset: undefined,
		// { text, until } set by the preset / power actions, cleared once `until` has passed
		presetStatus: undefined,
		powerStatus: undefined,
		// message of the last failed action, exposed as the last_error variable
		lastError: undefined,
	}
}

module.exports = {
	safeId,
	formatHms,
	formatClock,
	round1,
	bytesToHuman,
	compactDuration,
	formatUptime,
	splitPair,
	stableJson,
	parseJsonOption,
	nonBlank,
	toQueryString,
	firmwareVersionNumber,
	clampNumber,
	normaliseInputId,
	sameInputId,
	recorderToggleOp,
	publisherToggleOp,
	eventToggleOp,
	eventApplies,
	localTimeHms,
	bookmarkText,
	storageLevel,
	emptyState,
	STORAGE_LOW_PCT,
	STORAGE_FULL_PCT,
	STORAGE_SEVERITY,
}
