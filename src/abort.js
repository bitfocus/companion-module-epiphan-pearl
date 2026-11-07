const { AsyncLocalStorage } = require('node:async_hooks')

/**
 * Carries the abort signal Companion gives an action callback (`context.signal`, API 2.1+) down to
 * `request()`, so aborting a button's actions also cancels the request already on its way to the encoder.
 */
const actionSignal = new AsyncLocalStorage()

module.exports = { actionSignal }
