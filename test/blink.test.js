/**
 * The paused blink (src/blink.js): a 500 ms phase that runs only while a recorder is paused, read by the
 * `recorder_blink` feedback so the Recording presets' Pause / Resume key can flash its amber play glyph.
 */
const { describe, it, before, after } = require('node:test')
const assert = require('node:assert/strict')

const { createInstance, runFeedback } = require('./harness')
const { startMockPearl } = require('./mock-pearl')

const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

describe('paused blink', () => {
	let mock
	let instance

	before(async () => {
		mock = await startMockPearl()
		instance = await createInstance({ mock })
		instance.schedulePollSoon = () => {}
		instance.blinkMs = 30
	})

	after(async () => {
		await instance.destroy()
		await mock.close()
	})

	it('runs only while a recorder is paused, flips the feedback, and stops again', async () => {
		assert.equal(instance.blinkTimer, undefined, 'nothing paused at start: no timer')
		assert.equal(await runFeedback(instance, 'recorder_blink', { recorderId: '1' }), false)

		mock.state.recorders['1'].status = { state: 'paused', duration: 10 }
		await instance.pollAll()
		assert.ok(instance.blinkTimer, 'a paused recorder starts the blink')
		assert.equal(instance.blinkPhase, true, 'the blink starts in its "on" half')
		assert.equal(await runFeedback(instance, 'recorder_blink', { recorderId: '1' }), true, 'that recorder')
		assert.equal(await runFeedback(instance, 'recorder_blink', { recorderId: 'all' }), true, 'any recorder')
		assert.equal(
			await runFeedback(instance, 'recorder_blink', { recorderId: '2' }),
			false,
			'a recorder that is not paused',
		)

		const seen = new Set()
		for (let i = 0; i < 12 && seen.size < 2; i++) {
			await wait(15)
			seen.add(instance.blinkPhase)
		}
		assert.deepEqual([...seen].sort(), [false, true], 'the phase alternates')
		assert.ok(
			instance.checkedFeedbacks.some((ids) => ids.includes('recorder_blink')),
			'every flip rechecks the feedback',
		)

		mock.state.recorders['1'].status = { state: 'started', duration: 20 }
		await instance.pollAll()
		assert.equal(instance.blinkTimer, undefined, 'nothing paused any more: the timer stops')
		assert.equal(instance.blinkPhase, false)
		assert.equal(await runFeedback(instance, 'recorder_blink', { recorderId: '1' }), false)
	})

	it('stopTimers() (configUpdated / destroy) clears a running blink', async () => {
		mock.state.recorders['1'].status = { state: 'paused', duration: 10 }
		await instance.pollAll()
		assert.ok(instance.blinkTimer)
		instance.stopTimers()
		assert.equal(instance.blinkTimer, undefined)
		assert.equal(instance.blinkPhase, false)
		mock.state.recorders['1'].status = { state: 'stopped' }
		await instance.pollAll()
	})
})
