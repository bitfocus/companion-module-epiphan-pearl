/**
 * Two-press confirm gate for the destructive actions (power, preset, storage).
 * Mixed into the instance prototype, so `this` is the instance.
 */

/** window between the arming press and the confirming press, overridable with this.confirmWindowMs */
const CONFIRM_WINDOW_MS = 3000
/** value of the confirm_hint variable while a press is armed */
const CONFIRM_HINT = 'Press again'

module.exports = {
	/**
	 * Gate a destructive action behind a second press of the same button.
	 *
	 * @param {{ controlId?: string, actionId?: string }} action the action event Companion passed to the callback
	 * @param {string} label action name used in the log line
	 * @returns {boolean} true when this press is the confirmation (the caller sends the command),
	 *                    false when it only armed the button (the caller sends nothing)
	 */
	confirmGate(action, label) {
		const windowMs = Number(this.confirmWindowMs) > 0 ? Number(this.confirmWindowMs) : CONFIRM_WINDOW_MS
		const controlId = String(action?.controlId ?? '')
		const actionId = String(action?.actionId ?? '')
		const key = `${controlId}\u0000${actionId}`
		const now = Date.now()
		const pending = this.confirmPending

		if (pending && pending.key === key && now < pending.until) {
			this.clearConfirm()
			return true
		}

		if (this.confirmTimer) clearTimeout(this.confirmTimer)
		this.confirmPending = { key, controlId, actionId, label, until: now + windowMs }
		this.setVariableValues({ confirm_hint: CONFIRM_HINT })
		this.checkFeedbacks('confirm_pending')
		this.confirmTimer = setTimeout(() => this.clearConfirm(), windowMs)
		this.log('info', `${label}: press again within ${Math.round(windowMs / 100) / 10} s to confirm`)
		return false
	},

	/**
	 * true while a confirm is armed for this button
	 *
	 * @param {string} controlId
	 * @returns {boolean}
	 */
	isConfirmPending(controlId) {
		const pending = this.confirmPending
		if (!pending) return false
		if (Date.now() >= pending.until) return false
		return pending.controlId === String(controlId ?? '')
	},

	/**
	 * Drop an armed confirm and clear the hint variable and the confirm_pending feedback.
	 */
	clearConfirm() {
		if (this.confirmTimer) clearTimeout(this.confirmTimer)
		this.confirmTimer = undefined
		if (!this.confirmPending) return
		this.confirmPending = undefined
		this.setVariableValues({ confirm_hint: '' })
		this.checkFeedbacks('confirm_pending')
	},

	/**
	 * Drop an armed confirm without touching variables or feedbacks. Call this from destroy().
	 */
	clearConfirmTimer() {
		if (this.confirmTimer) clearTimeout(this.confirmTimer)
		this.confirmTimer = undefined
		this.confirmPending = undefined
	},
}

module.exports.CONFIRM_HINT = CONFIRM_HINT
