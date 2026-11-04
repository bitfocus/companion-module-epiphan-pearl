/**
 * Pure helpers for the audio settings and levels of a Pearl input.
 * No instance access, no side effects; each helper explains its read-modify-write rule.
 */

const GAIN_MIN = 0
const GAIN_MAX = 100
const DELAY_MIN = -300
const DELAY_MAX = 300
/** at or below this dBFS value a level is reported as silent */
const SILENT_DBFS = -99

/** places an input's audio delay can live, in lookup order */
const DELAY_PATHS = ['audio', 'hdmi', 'sdi']

function num(value) {
	return typeof value === 'number' && Number.isFinite(value) ? value : undefined
}

function clampInt(value, min, max) {
	const n = typeof value === 'string' && value.trim() !== '' ? Number(value) : value
	if (typeof n !== 'number' || !Number.isFinite(n)) return undefined
	return Math.min(max, Math.max(min, Math.round(n)))
}

/**
 * true when the channels of an input are configured individually (`local_audio.stereo_pair === false`)
 * @param {object} settings result of GET /inputs/{sid}/settings
 * @returns {boolean}
 */
function isUnpaired(settings) {
	return settings?.local_audio?.stereo_pair === false
}

/**
 * Current gain of an input: `local_audio.gain` for a stereo pair, channel A (or B) when unpaired.
 * @param {object} settings
 * @returns {number|undefined} undefined when the input has no gain setting
 */
function readGain(settings) {
	const la = settings?.local_audio
	if (!la || typeof la !== 'object') return undefined
	if (!isUnpaired(settings)) return num(la.gain)
	return num(la.channels?.channelA?.gain) ?? num(la.channels?.channelB?.gain)
}

/**
 * PATCH body that sets the gain of an input to `newGain` (clamped 0..100): `local_audio.gain` for a
 * stereo pair, both `local_audio.channels.channelA/B.gain` when unpaired.
 * @param {object} settings
 * @param {number|string} newGain
 * @returns {object|undefined} undefined when the input has no gain setting or newGain is not a number
 */
function gainPatch(settings, newGain) {
	const gain = clampInt(newGain, GAIN_MIN, GAIN_MAX)
	if (gain === undefined || readGain(settings) === undefined) return undefined
	if (!isUnpaired(settings)) return { local_audio: { gain } }
	return { local_audio: { channels: { channelA: { gain }, channelB: { gain } } } }
}

/**
 * Current audio delay of an input and the settings path it lives at.
 * @param {object} settings
 * @returns {{ path: 'audio'|'hdmi'|'sdi', value: number }|undefined} undefined when the input has no delay setting
 */
function readDelay(settings) {
	if (!settings || typeof settings !== 'object') return undefined
	for (const path of DELAY_PATHS) {
		const value = path === 'audio' ? num(settings.audio?.delay) : num(settings[path]?.audio?.delay)
		if (value !== undefined) return { path, value }
	}
	return undefined
}

/**
 * PATCH body that sets the audio delay of an input to `newDelay` (clamped -300..300) at the path the
 * settings already contain (`audio.delay`, `hdmi.audio.delay` or `sdi.audio.delay`).
 * @param {object} settings
 * @param {number|string} newDelay
 * @returns {object|undefined} undefined when the input has no delay setting or newDelay is not a number
 */
function delayPatch(settings, newDelay) {
	const current = readDelay(settings)
	const delay = clampInt(newDelay, DELAY_MIN, DELAY_MAX)
	if (!current || delay === undefined) return undefined
	if (current.path === 'audio') return { audio: { delay } }
	return { [current.path]: { audio: { delay } } }
}

/**
 * Summarise the polled levels of an input (state.inputs[sid].levels / .audioState).
 * @param {{ levels?: { rms?: number[], peak?: number[] }, audioState?: string }} input
 * @returns {{ peak: number|undefined, left: number|undefined, right: number|undefined, text: string }}
 *   peak = highest peak (or RMS) value rounded; left/right = per-channel peak (RMS when no peak);
 *   text = '-18 dBFS', 'silent' at or below -99, 'No signal' when the audio state is inactive, '' when unknown
 */
function levelSummary(input) {
	const levels = input?.levels
	const rms = Array.isArray(levels?.rms) ? levels.rms.filter((v) => num(v) !== undefined) : []
	const peak = Array.isArray(levels?.peak) ? levels.peak.filter((v) => num(v) !== undefined) : []
	const all = [...peak, ...rms]
	if (all.length === 0) {
		return {
			peak: undefined,
			left: undefined,
			right: undefined,
			text: input?.audioState === 'inactive' ? 'No signal' : '',
		}
	}
	const top = Math.max(...all)
	return {
		peak: Math.round(top),
		left: peak[0] ?? rms[0],
		right: peak[1] ?? rms[1],
		text: top <= SILENT_DBFS ? 'silent' : `${Math.round(top)} dBFS`,
	}
}

module.exports = {
	readGain,
	gainPatch,
	readDelay,
	delayPatch,
	levelSummary,
}
