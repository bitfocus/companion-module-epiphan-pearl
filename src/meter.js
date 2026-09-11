/**
 * Audio level meter: the pure drawing helpers for the `audio` feedback's image and the mixin methods
 * of the 500 ms level poll that feeds it.
 * Mixed into the instance prototype, so `this` is the instance in every method below.
 * See doc/ARCHITECTURE.md "Audio meter (src/meter.js)".
 */

const { HEX } = require('./style')
const variables = require('./variables')

/** gap between two level polls while at least one `audio` feedback is subscribed */
const METER_POLL_MS = 500
/** button size assumed when Companion does not tell the feedback how big its button is */
const METER_DEFAULT_SIZE = 72
/** dBFS at the bottom of a bar; 0 dBFS is the top */
const METER_FLOOR_DBFS = -60
/** fraction of a bar drawn green, then amber; above that it is red */
const GREEN_UNTIL = 0.62
const AMBER_UNTIL = 0.82
/** height of a peak tick, in pixels */
const PEAK_TICK_PX = 2

/**
 * '#rrggbb' -> [r, g, b]
 *
 * @param {string} hex
 * @returns {number[]}
 */
function rgb(hex) {
	const n = parseInt(hex.slice(1), 16)
	return [(n >> 16) & 0xff, (n >> 8) & 0xff, n & 0xff]
}

const TRACK_RGB = rgb(HEX.track)
const GREEN_RGB = rgb(HEX.green)
const AMBER_RGB = rgb(HEX.amber)
const RED_RGB = rgb(HEX.red)
const PEAK_RGB = rgb(HEX.text)

/**
 * Finite number or undefined
 *
 * @param {unknown} value
 * @returns {number|undefined}
 */
function num(value) {
	const n = typeof value === 'number' ? value : Number(value)
	return Number.isFinite(n) ? n : undefined
}

function clamp01(value) {
	const n = num(value)
	if (n === undefined) return 0
	return n < 0 ? 0 : n > 1 ? 1 : n
}

/**
 * Position of a dBFS value on a meter bar: 0 at -60 dBFS and below, 1 at 0 dBFS and above.
 *
 * @param {number} db level in dBFS
 * @returns {number} 0..1
 */
function dbfsToLinear(db) {
	if (db === Number.POSITIVE_INFINITY) return 1
	const n = num(db)
	if (n === undefined) return 0
	return clamp01((n - METER_FLOOR_DBFS) / -METER_FLOOR_DBFS)
}

/**
 * Geometry of the two bars on a button of the given size. All values are pixels; the bars sit against
 * the right edge, leaving the rest of the button to the text Companion draws underneath.
 *
 * @param {number} width
 * @param {number} height
 * @returns {{width: number, height: number, barWidth: number, gap: number, margin: number,
 *   top: number, bottom: number, barHeight: number, leftX: number, rightX: number}}
 */
function meterLayout(width, height) {
	const w = Math.max(1, Math.round(num(width) ?? METER_DEFAULT_SIZE))
	const h = Math.max(1, Math.round(num(height) ?? METER_DEFAULT_SIZE))
	const barWidth = Math.max(1, Math.round(w / 14))
	const gap = Math.max(1, Math.round(w / 36))
	const margin = Math.max(0, Math.round(w / 18))
	const top = Math.round(h / 8)
	const bottom = Math.max(top + 1, Math.round((h * 7) / 8))
	const rightX = Math.max(0, w - margin - barWidth)
	const leftX = Math.max(0, rightX - gap - barWidth)
	return { width: w, height: h, barWidth, gap, margin, top, bottom, barHeight: bottom - top, leftX, rightX }
}

/**
 * Colour of one row of a bar, by that row's fraction of the bar's height (bottom = 0, top = 1) — the
 * flat-band reading of the Stream Deck plugin's linear gradient.
 *
 * @param {number} fraction 0..1
 * @returns {number[]} [r, g, b]
 */
function gradientColour(fraction) {
	if (fraction <= GREEN_UNTIL) return GREEN_RGB
	if (fraction <= AMBER_UNTIL) return AMBER_RGB
	return RED_RGB
}

/**
 * Paint `width` pixels of one row.
 *
 * @param {Uint8Array} buffer
 * @param {number} imageWidth
 * @param {number} x
 * @param {number} y
 * @param {number} width
 * @param {number[]} colour [r, g, b]
 */
function paintRow(buffer, imageWidth, x, y, width, colour) {
	let offset = (y * imageWidth + x) * 4
	for (let i = 0; i < width; i++) {
		buffer[offset] = colour[0]
		buffer[offset + 1] = colour[1]
		buffer[offset + 2] = colour[2]
		buffer[offset + 3] = 0xff
		offset += 4
	}
}

/**
 * Draw one bar: the full-height track, the fill rising from the bottom, then the peak tick.
 *
 * @param {Uint8Array} buffer
 * @param {object} layout result of meterLayout()
 * @param {{x: number, value: number, peak: number|undefined}} bar
 */
function paintBar(buffer, layout, bar) {
	const { width, barWidth, barHeight, top, bottom } = layout
	const filled = Math.round(clamp01(bar.value) * barHeight)
	for (let y = top; y < bottom; y++) {
		const fraction = (bottom - y - 0.5) / barHeight
		const colour = y >= bottom - filled ? gradientColour(fraction) : TRACK_RGB
		paintRow(buffer, width, bar.x, y, barWidth, colour)
	}
	const peak = num(bar.peak)
	if (peak === undefined || peak <= 0) return
	const y = Math.min(bottom - PEAK_TICK_PX, Math.max(top, Math.round(bottom - clamp01(peak) * barHeight) - 1))
	for (let row = y; row < y + PEAK_TICK_PX && row < bottom; row++) {
		paintRow(buffer, width, bar.x, row, barWidth, PEAK_RGB)
	}
}

/**
 * Render the meter as an RGBA pixel buffer: transparent everywhere except the level bars on the right
 * edge, so Companion keeps drawing the button's own text underneath.
 *
 * @param {number} width  button width in pixels
 * @param {number} height button height in pixels
 * @param {{left: number, right?: number, peakLeft?: number, peakRight?: number}} levels 0..1 each
 *   (dbfsToLinear values); one bar is drawn when `right` is missing
 * @returns {Uint8Array} width * height * 4 bytes, RGBA
 */
function renderMeter(width, height, levels = {}) {
	const layout = meterLayout(width, height)
	const buffer = new Uint8Array(layout.width * layout.height * 4)
	const right = num(levels?.right)
	const bars =
		right === undefined
			? [{ x: layout.rightX, value: levels?.left, peak: levels?.peakLeft }]
			: [
					{ x: layout.leftX, value: levels?.left, peak: levels?.peakLeft },
					{ x: layout.rightX, value: right, peak: levels?.peakRight },
				]
	for (const bar of bars) paintBar(buffer, layout, bar)
	return buffer
}

/**
 * Turn one input of `state.inputs` into the 0..1 shape renderMeter() wants. RMS drives the bars and
 * the peak values drive the ticks; an input reporting only peak values still gets bars (the Stream
 * Deck plugin requires RMS, this is the more forgiving reading of the same data).
 *
 * @param {{levels?: {rms?: number[], peak?: number[]}}} input
 * @returns {{left: number, right?: number, peakLeft?: number, peakRight?: number}|undefined}
 *   undefined when the input has no levels at all (the feedback then draws nothing)
 */
function meterOf(input) {
	const rms = Array.isArray(input?.levels?.rms) ? input.levels.rms : []
	const peak = Array.isArray(input?.levels?.peak) ? input.levels.peak : []
	const left = num(rms[0]) ?? num(peak[0])
	if (left === undefined) return undefined
	const meter = { left: dbfsToLinear(left) }
	if (num(peak[0]) !== undefined) meter.peakLeft = dbfsToLinear(peak[0])
	const right = num(rms[1]) ?? num(peak[1])
	if (right !== undefined) {
		meter.right = dbfsToLinear(right)
		if (num(peak[1]) !== undefined) meter.peakRight = dbfsToLinear(peak[1])
	}
	return meter
}

/**
 * Comparable snapshot of every input's levels, used to skip the variable/feedback refresh when a tick
 * brought nothing new.
 *
 * @param {object} state
 * @returns {string}
 */
function levelsKey(state) {
	const parts = []
	for (const input of Object.values(state?.inputs || {})) {
		const rms = Array.isArray(input?.levels?.rms) ? input.levels.rms.join(',') : ''
		const peak = Array.isArray(input?.levels?.peak) ? input.levels.peak.join(',') : ''
		parts.push(`${input?.id}=${input?.audioState ?? ''}:${rms}:${peak}`)
	}
	return parts.join('|')
}

const meter = {
	/** gap between two level polls; `this.meterIntervalMs` overrides it (tests only) */
	meterPollIntervalMs() {
		const override = num(this.meterIntervalMs)
		return override !== undefined && override > 0 ? override : METER_POLL_MS
	},

	/**
	 * true while at least one `audio` feedback is subscribed (the feedback's subscribe/unsubscribe
	 * hooks maintain the ref counts in this.meterSubscriptions)
	 *
	 * @returns {boolean}
	 */
	hasMeterSubscriptions() {
		return this.meterSubscriptions instanceof Map && this.meterSubscriptions.size > 0
	},

	/**
	 * Start the level poll if a meter is subscribed and it is not already running. Chained via
	 * setTimeout so a slow device widens the gap instead of queueing ticks. Idempotent.
	 */
	startMeterTimer() {
		if (this.meterTimer || !this.hasMeterSubscriptions()) return
		const generation = this.configGeneration
		const stale = () => generation !== this.configGeneration || !this.hasMeterSubscriptions()
		const runOnce = () => {
			this.meterTimer = undefined
			if (stale()) return
			this.pollMeterLevels()
				.catch(() => {})
				.finally(() => {
					if (stale() || this.meterTimer) return
					this.meterTimer = setTimeout(runOnce, this.meterPollIntervalMs())
				})
		}
		this.meterTimer = setTimeout(runOnce, this.meterPollIntervalMs())
	},

	/** Stop the level poll. */
	stopMeterTimer() {
		if (this.meterTimer) clearTimeout(this.meterTimer)
		this.meterTimer = undefined
	},

	/**
	 * One level tick: a single legacy GET /sources/status for every input at once, whatever the number
	 * of subscribed meters. Never throws; a device without the endpoint simply reports no levels.
	 *
	 * @returns {Promise<void>}
	 */
	async pollMeterLevels() {
		if (this.meterPollPromise) return this.meterPollPromise
		this.meterPollPromise = this.pollMeterLevelsInner().finally(() => {
			this.meterPollPromise = undefined
		})
		return this.meterPollPromise
	},

	/**
	 * INTERNAL: body of pollMeterLevels()
	 */
	async pollMeterLevelsInner() {
		const generation = this.configGeneration
		let list
		try {
			list = await this.request('GET', '/sources/status', { base: 'v1', optional: true, silent: true })
		} catch (error) {
			this.log('debug', `Level poll failed: ${error?.message || error}`)
			list = []
		}
		if (generation !== this.configGeneration) return
		this.applyMeterSnapshot(list)
	},

	/**
	 * INTERNAL: replace every input's levels with the ones in `list` (an empty list clears them), then
	 * refresh the level variables and the meter feedback if anything actually changed.
	 *
	 * @param {Array} list legacy /sources/status entries
	 * @returns {boolean} true when something changed
	 */
	applyMeterSnapshot(list) {
		const before = levelsKey(this.state)
		for (const input of Object.values(this.state?.inputs || {})) {
			input.levels = undefined
			input.audioState = undefined
		}
		this.applyInputLevels(this.state, Array.isArray(list) ? list : [])
		if (levelsKey(this.state) === before) return false
		variables.updateVariables(this)
		this.checkFeedbacks('audio')
		return true
	},
}

module.exports = {
	...meter,
	dbfsToLinear,
	meterLayout,
	renderMeter,
	meterOf,
	METER_DEFAULT_SIZE,
}
