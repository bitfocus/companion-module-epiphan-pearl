/**
 * Coalescing of rotary ticks (and rapid presses) into one command per key.
 * Mixed into the instance prototype, so `this` is the instance.
 * See doc/ARCHITECTURE.md "Rotary coalescing (src/rotary.js)".
 */

/** default quiet time after the last tick before the accumulated delta is flushed */
const ROTARY_WINDOW_MS = 150

module.exports = {
	/**
	 * Add `delta` to the total pending for `key` and call `flush(total)` once no further call for the
	 * same key arrived for `windowMs`. Every call restarts the wait, so a burst of ticks produces one
	 * flush with the summed delta.
	 *
	 * @param {string} key       coalescing key, normally `${controlId} ${actionId} ${target}`
	 * @param {number} delta     value added to the pending total
	 * @param {(total: number) => any} flush called once with the summed delta; may return a promise
	 * @param {number} [windowMs=150]
	 */
	coalesce(key, delta, flush, windowMs = ROTARY_WINDOW_MS) {
		if (!(this.rotaryPending instanceof Map)) this.rotaryPending = new Map()
		const ms = Number(windowMs) > 0 ? Number(windowMs) : ROTARY_WINDOW_MS
		const previous = this.rotaryPending.get(key)
		if (previous?.timer) clearTimeout(previous.timer)
		const total = (previous?.total ?? 0) + (Number(delta) || 0)
		const timer = setTimeout(() => {
			const entry = this.rotaryPending?.get(key)
			this.rotaryPending?.delete(key)
			if (!entry) return
			try {
				const result = entry.flush(entry.total)
				if (result && typeof result.catch === 'function') {
					result.catch((error) => this.log('error', `Rotary flush failed: ${error?.message || error}`))
				}
			} catch (error) {
				this.log('error', `Rotary flush failed: ${error?.message || error}`)
			}
		}, ms)
		this.rotaryPending.set(key, { total, flush, timer })
	},

	/**
	 * Drop every pending coalesced total without flushing it. Call this from destroy().
	 */
	clearRotaryTimers() {
		if (!(this.rotaryPending instanceof Map)) return
		for (const entry of this.rotaryPending.values()) {
			if (entry?.timer) clearTimeout(entry.timer)
		}
		this.rotaryPending.clear()
	},
}

module.exports.ROTARY_WINDOW_MS = ROTARY_WINDOW_MS
