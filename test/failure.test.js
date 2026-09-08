/**
 * Visible failure flash (src/failure.js) and the audio nudge queue (src/actions.js nudgeInputAudio), both
 * from the 2026-09-08 QA pass: a rejected command flags its own button for a short window, the
 * `action_failed` feedback reads it, every command preset carries that feedback, and a settings call the
 * Pearl refuses with 405 is retried once instead of failing the nudge.
 */
const { describe, it, before, after } = require('node:test')
const assert = require('node:assert/strict')

const { createInstance, runAction, runFeedback } = require('./harness')
const { startMockPearl } = require('./mock-pearl')
const { colors, stateStyle } = require('../src/style')

const V2 = '/api/v2.0'
const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms))
/** settings PATCHes of analog-a recorded after index `at` */
const patchesSince = (mock, at) =>
	mock.requests.slice(at).filter((r) => r.method === 'PATCH' && r.path === `${V2}/inputs/analog-a/settings`)

async function waitFor(predicate, message, timeoutMs = 3000) {
	const deadline = Date.now() + timeoutMs
	while (!(await predicate())) {
		if (Date.now() > deadline) assert.fail(`timed out waiting for ${message}`)
		await wait(10)
	}
}

describe('action_failed flash', () => {
	let mock
	let instance

	before(async () => {
		mock = await startMockPearl()
		instance = await createInstance({ mock })
		instance.schedulePollSoon = () => {}
		instance.failureFlashMs = 80
	})

	after(async () => {
		await instance.destroy()
		await mock.close()
	})

	it('a rejected command flags its own button only, then clears after the window', async () => {
		mock.failNext('POST', `${V2}/recorders/1/control/start`, 409, {
			status: 'error',
			message: 'injected: recorder busy',
		})
		await runAction(instance, 'recorder', { recorderId: '1', op: 'start' }, { controlId: 'c1' })
		assert.equal(await runFeedback(instance, 'action_failed', {}, { controlId: 'c1' }), true, 'the failed button')
		assert.equal(await runFeedback(instance, 'action_failed', {}, { controlId: 'c2' }), false, 'another button')
		assert.match(String(instance.state.lastError), /injected/, 'the message is recorded as the last error')
		await wait(130)
		assert.equal(await runFeedback(instance, 'action_failed', {}, { controlId: 'c1' }), false, 'cleared')
	})

	it('a successful command does not flag the button', async () => {
		await runAction(instance, 'recorder', { recorderId: '1', op: 'stop' }, { controlId: 'c3' })
		assert.equal(await runFeedback(instance, 'action_failed', {}, { controlId: 'c3' }), false)
	})

	it('every command preset carries action_failed last (red, "Failed"); display-only presets do not', () => {
		const presets = instance.definitions.presets
		let commands = 0
		let displays = 0
		for (const [id, preset] of Object.entries(presets)) {
			const step = preset.steps[0]
			const hasCommands =
				(step.down?.length ?? 0) + (step.rotate_left?.length ?? 0) + (step.rotate_right?.length ?? 0) > 0
			const last = preset.feedbacks[preset.feedbacks.length - 1]
			if (hasCommands) {
				commands += 1
				assert.equal(last?.feedbackId, 'action_failed', `${id}: action_failed is the last feedback`)
				assert.deepEqual(last.style, { ...stateStyle(colors.red), text: 'Failed' }, `${id}: failure style`)
			} else {
				displays += 1
				assert.ok(
					!preset.feedbacks.some((f) => f.feedbackId === 'action_failed'),
					`${id}: a display-only preset has nothing to fail`,
				)
			}
		}
		assert.ok(commands > 0 && displays > 0, 'the mock yields both kinds of preset')
	})
})

describe('audio nudge: one at a time per input, 405 retried once', () => {
	let mock
	let instance

	before(async () => {
		mock = await startMockPearl()
		instance = await createInstance({ mock })
		instance.schedulePollSoon = () => {}
		instance.settingsRetryMs = 20
		instance.failureFlashMs = 80
	})

	after(async () => {
		await instance.destroy()
		await mock.close()
	})

	it('a 405 on the settings PATCH is retried and the nudge still lands once', async () => {
		mock.state.inputs['analog-a'].settings.local_audio.gain = 10
		mock.failNext('PATCH', `${V2}/inputs/analog-a/settings`, 405, {
			status: 'error',
			message: 'Source settings are not supported',
		})
		const at = mock.requests.length
		await runAction(
			instance,
			'audio',
			{ inputId: 'analog-a', control: 'gain', direction: 'up', step: 1 },
			{ controlId: 'c9' },
		)
		await waitFor(() => patchesSince(mock, at).length >= 2, 'the refused PATCH and its retry')
		await wait(30)
		assert.equal(patchesSince(mock, at).length, 2, 'exactly one retry')
		assert.equal(mock.state.inputs['analog-a'].settings.local_audio.gain, 11, 'applied exactly once')
		assert.equal(await runFeedback(instance, 'action_failed', {}, { controlId: 'c9' }), false, 'not a failure')
	})

	it('a nudge that fails twice flags the button', async () => {
		mock.failNext('GET', `${V2}/inputs/analog-a/settings`, 405, { status: 'error', message: 'busy' })
		mock.failNext('GET', `${V2}/inputs/analog-a/settings`, 405, { status: 'error', message: 'busy' })
		await runAction(
			instance,
			'audio',
			{ inputId: 'analog-a', control: 'gain', direction: 'down', step: 1 },
			{ controlId: 'c10' },
		)
		await waitFor(() => runFeedback(instance, 'action_failed', {}, { controlId: 'c10' }), 'the failure flash')
	})
})
