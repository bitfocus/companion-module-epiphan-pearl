const { combineRgb } = require('@companion-module/base')

/**
 * Palette from doc/PARITY.md §3 (COMPANION-PARITY.md §3.1), as hex strings.
 */
const HEX = {
	bg: '#1b1d22',
	text: '#f4f6f8',
	muted: '#b8c0cc',
	track: '#2a2e35',
	badgeText: '#14161a',
	amber: '#f0a83c',
	red: '#e5484d',
	green: '#3ccf6a',
	grey: '#7a8390',
	cms: '#5aa9ff',
}

/**
 * Convert a '#rrggbb' hex string to a Companion combineRgb() number.
 *
 * @param {string} hex
 * @returns {number}
 */
function hexToRgb(hex) {
	const n = parseInt(hex.slice(1), 16)
	return combineRgb((n >> 16) & 0xff, (n >> 8) & 0xff, n & 0xff)
}

/** Same palette as combineRgb() numbers, for use in style/defaultStyle objects. */
const colors = Object.fromEntries(Object.entries(HEX).map(([key, hex]) => [key, hexToRgb(hex)]))

/**
 * State words (COMPANION-PARITY.md §3.2) — badges/state variables use exactly these strings, upper
 * case. `?` is "unknown", `—` is "nothing to show". `BLINK`, `TRACK`, `AUTO`, `MAN`, `1-PUSH` and
 * `FLIPPED` are EC20-only words, kept here so both modules share one source list.
 */
const STATE_WORDS = [
	'REC',
	'PAUSED',
	'ERR',
	'OFF',
	'LIVE',
	'STARTING',
	'LISTEN',
	'ACTIVE',
	'ON',
	'BLINK',
	'TRACK',
	'SET',
	'LOW',
	'FULL',
	'RO',
	'FMT',
	'MOUNT',
	'AFU',
	'HOT',
	'HIGH',
	'CPU',
	'AUTO',
	'MAN',
	'1-PUSH',
	'FLIPPED',
	'SCHED',
	'DONE',
	'?',
	'—',
]

/**
 * Standard texts (COMPANION-PARITY.md §3.3) shown in place of live data. The module's variable layer
 * (src/variables.js) already renders most of these dynamically (durations, countdowns, byte counts,
 * levels); this export exists so a preset that needs one of the fixed phrases verbatim does not have
 * to retype it.
 */
const TEXT = {
	LOADING: 'Loading…',
	OFFLINE: 'Offline',
	NO_MEDIA: 'No media',
	NOTHING_SCHEDULED: 'Nothing scheduled',
	NO_ONGOING_EVENT: 'No ongoing event',
	PICK_A_CHANNEL: 'Pick a channel',
	STARTING: 'Starting…',
	FINISHED: 'Finished',
}

/**
 * Style of every preset while at rest: dark background, light text (§3 — "dark background and light
 * text at rest" on every generated preset).
 *
 * @returns {{bgcolor: number, color: number}}
 */
function restStyle() {
	return { bgcolor: colors.bg, color: colors.text }
}

/**
 * Style of a feedback that represents a state: background becomes the state colour, text becomes the
 * dark badge text colour (§3 — "the feedback that represents the state sets the background to the
 * state colour with dark text").
 *
 * @param {number} color one of `colors.*` (a combineRgb() value)
 * @returns {{bgcolor: number, color: number}}
 */
function stateStyle(color) {
	return { bgcolor: color, color: colors.badgeText }
}

module.exports = { HEX, colors, STATE_WORDS, TEXT, restStyle, stateStyle }
