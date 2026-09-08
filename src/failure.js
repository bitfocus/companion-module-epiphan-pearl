/**
 * Visible failure flash for a button (Companion-only; the Stream Deck plugin shows the SDK's alert
 * triangle instead). When a device call fired from a button fails, that button is flagged for
 * FAILURE_FLASH_MS and the `action_failed` feedback (src/feedbacks.js) is true for it, so a preset can
 * turn red and read "Failed" without the operator opening Companion's log (found by QA on 2026-09-08: an
 * Extend rejected with 409 looked exactly like a successful one on the key). The message itself stays in
 * the `last_error` variable.
 *
 * Mixed into the instance prototype through src/actions.js (like src/confirm.js and src/rotary.js);
 * `this.failureFlashMs` overrides the window (tests).
 */
const FAILURE_FLASH_MS = 3000
/** Text the failure feedback puts on the key in place of the label */
const FAILED_TEXT = 'Failed'

module.exports = {
	/**
	 * Flag the button `controlId` as failed for the flash window and re-check the `action_failed` feedback.
	 * @param {string|undefined} controlId
	 */
	flagActionFailure(controlId) {
		const id = String(controlId ?? '')
		if (!id) return
		if (!(this.failedControls instanceof Map)) this.failedControls = new Map()
		const windowMs = Number(this.failureFlashMs) > 0 ? Number(this.failureFlashMs) : FAILURE_FLASH_MS
		const previous = this.failedControls.get(id)
		if (previous?.timer) clearTimeout(previous.timer)
		const timer = setTimeout(() => {
			this.failedControls.delete(id)
			try {
				this.checkFeedbacks('action_failed')
			} catch (error) {
				this.log('debug', `action_failed re-check failed: ${error?.message || error}`)
			}
		}, windowMs)
		if (typeof timer.unref === 'function') timer.unref()
		this.failedControls.set(id, { until: Date.now() + windowMs, timer })
		this.checkFeedbacks('action_failed')
	},

	/**
	 * true while the button `controlId` is inside its failure flash window
	 * @param {string|undefined} controlId
	 * @returns {boolean}
	 */
	isActionFailed(controlId) {
		if (!(this.failedControls instanceof Map)) return false
		const entry = this.failedControls.get(String(controlId ?? ''))
		return entry !== undefined && Date.now() < entry.until
	},

	/** Drop every pending flash. Called by destroy(). */
	clearFailureTimers() {
		if (!(this.failedControls instanceof Map)) return
		for (const entry of this.failedControls.values()) if (entry?.timer) clearTimeout(entry.timer)
		this.failedControls.clear()
	},
}

module.exports.FAILURE_FLASH_MS = FAILURE_FLASH_MS
module.exports.FAILED_TEXT = FAILED_TEXT
