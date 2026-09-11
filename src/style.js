const { combineRgb } = require('@companion-module/base')

/**
 * Palette of the Stream Deck plugin (its src/lib/svg.ts), as hex strings.
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
 * Style of every preset while at rest: dark background, light text (the plugin's rule: "dark background
 * and light text at rest" on every generated preset).
 *
 * @returns {{bgcolor: number, color: number}}
 */
function restStyle() {
	return { bgcolor: colors.bg, color: colors.text }
}

/**
 * Style of a feedback that represents a state: background becomes the state colour, text becomes the
 * dark badge text colour (the plugin's rule: "the feedback that represents the state sets the background
 * to the state colour with dark text").
 *
 * @param {number} color one of `colors.*` (a combineRgb() value)
 * @returns {{bgcolor: number, color: number}}
 */
function stateStyle(color) {
	return { bgcolor: color, color: colors.badgeText }
}

module.exports = { HEX, colors, restStyle, stateStyle }
