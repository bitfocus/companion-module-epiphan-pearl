/**
 * Blink phase for the "paused" look of the Recording presets: a paused recorder shows a flashing amber
 * play key. Companion has no blinking style of its own, so while any recorder is paused a 500 ms timer
 * flips `blinkPhase` and rechecks the `recorder_blink` feedback, which is true in the "on" half only; a
 * preset puts that feedback after its Paused style so the two alternate. The timer runs only while
 * something is paused, so an idle connection costs nothing.
 *
 * Object mixin (Object.assign onto the instance prototype), like failure.js. `this.blinkMs` overrides the
 * period (tests).
 */

const BLINK_MS = 500

/** @param {Record<string, {status?: {state?: string}}>|undefined} recorders */
function anyPaused(recorders) {
	return Object.values(recorders || {}).some((r) => r?.status?.state === 'paused')
}

module.exports = {
	/**
	 * Is the recorder (or, for 'all', any recorder) paused right now?
	 * @param {string} recorderId
	 * @returns {boolean}
	 */
	recorderPaused(recorderId) {
		const recorders = this.state?.recorders || {}
		return recorderId === 'all' ? anyPaused(recorders) : recorders[recorderId]?.status?.state === 'paused'
	},

	/** Run the blink while any recorder is paused, stop it otherwise. Called after every poll. */
	syncBlinkTimer() {
		const paused = anyPaused(this.state?.recorders)
		if (paused && !this.blinkTimer) {
			this.blinkPhase = true
			this.blinkTimer = setInterval(() => {
				this.blinkPhase = !this.blinkPhase
				try {
					this.checkFeedbacks('recorder_blink')
				} catch (error) {
					this.log('debug', `blink recheck failed: ${error?.message ?? error}`)
				}
			}, this.blinkMs ?? BLINK_MS)
			// the blink must never be what keeps the process alive (the IPC link to Companion does that)
			if (typeof this.blinkTimer.unref === 'function') this.blinkTimer.unref()
		} else if (!paused && this.blinkTimer) {
			this.clearBlinkTimer()
			try {
				this.checkFeedbacks('recorder_blink')
			} catch (error) {
				this.log('debug', `blink recheck failed: ${error?.message ?? error}`)
			}
		}
	},

	/** Stop the blink. Called by stopTimers() (configUpdated / destroy) and when nothing is paused any more. */
	clearBlinkTimer() {
		if (this.blinkTimer) clearInterval(this.blinkTimer)
		this.blinkTimer = undefined
		this.blinkPhase = false
	},
}

module.exports.BLINK_MS = BLINK_MS
