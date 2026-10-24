/**
 * The target 3.0.0 action set: one action per Stream Deck action, D14 toggle
 * semantics, the D2 confirm gate, the D4 rotary coalescing and the D5 composite ids.
 */
const { describe, it, before, after, beforeEach } = require('node:test')
const assert = require('node:assert/strict')

const { createInstance, runAction, runRotate, runFeedback } = require('./harness')
const { startMockPearl } = require('./mock-pearl')

const V2 = '/api/v2.0'

/** every recorded request matching method and path */
function recorded(mock, method, path) {
	return mock.requests.filter((r) => (!method || r.method === method) && (!path || r.path === path))
}

function one(mock, method, path) {
	const list = recorded(mock, method, path)
	assert.equal(list.length, 1, `expected exactly one ${method} ${path}, got ${list.length}`)
	return list[0]
}

function none(mock, method, path) {
	assert.equal(recorded(mock, method, path).length, 0, `expected no ${method} ${path}`)
}

function logged(instance, level) {
	return instance.calls.log.filter((l) => l.level === level).map((l) => l.message)
}

async function waitFor(predicate, timeoutMs = 2000) {
	const deadline = Date.now() + timeoutMs
	for (;;) {
		if (predicate()) return
		if (Date.now() > deadline) throw new Error('timed out waiting for a condition')
		await new Promise((resolve) => setTimeout(resolve, 5))
	}
}

describe('actions against a v2.0 device', () => {
	let mock
	let instance

	before(async () => {
		mock = await startMockPearl()
		instance = await createInstance({ mock })
	})

	after(async () => {
		await instance.destroy()
		await mock.close()
	})

	beforeEach(() => {
		mock.requests.length = 0
		instance.calls.log.length = 0
		instance.checkedFeedbacks.length = 0
		instance.clearConfirm()
		instance.clearRotaryTimers()
		instance.confirmWindowMs = undefined
		instance.rotaryWindowMs = undefined
	})

	it('defines exactly the target action set with the Stream Deck names', () => {
		assert.deepEqual(Object.keys(instance.definitions.actions).sort(), [
			'audio',
			'bookmark',
			'event',
			'getContentMetadata',
			'layout',
			'output',
			'power',
			'preset',
			'recorder',
			'setContentMetadata',
			'singletouch',
			'stream',
		])
		const names = Object.fromEntries(
			Object.entries(instance.definitions.actions).map(([id, def]) => [id, def.name]),
		)
		assert.deepEqual(names, {
			recorder: 'Recorder',
			stream: 'Stream',
			layout: 'Layout',
			singletouch: 'Single Touch',
			bookmark: 'Bookmark',
			output: 'Output Source',
			preset: 'Apply Preset',
			event: 'Event',
			power: 'Reboot / Shutdown',
			audio: 'Audio',
			getContentMetadata: 'Get Content Metadata',
			setContentMetadata: 'Set Content Metadata',
		})
		for (const [id, def] of Object.entries(instance.definitions.actions)) {
			assert.ok(def.name.length <= 30, `${id}: name longer than 30 characters`)
			assert.equal(typeof def.description, 'string')
			assert.ok(def.description.length > 0)
		}
	})

	it('offers the D5 composite/aliased choices (layout, publisher, event, output source)', () => {
		const layout = instance.definitions.actions.layout.options.find((o) => o.id === 'layoutId')
		assert.deepEqual(layout.choices, [
			{ id: '1-1', label: 'HDMI-A – Default' },
			{ id: '1-2', label: 'HDMI-A – Picture in picture' },
			{ id: '2-1', label: 'Multi – Default' },
		])
		const publisher = instance.definitions.actions.stream.options.find((o) => o.id === 'publisherId')
		assert.deepEqual(publisher.choices, [
			{ id: '1-all', label: 'HDMI-A – All publishers' },
			{ id: '1-0', label: 'HDMI-A – Stream 1 (rtmp)' },
			{ id: '1-1', label: 'HDMI-A – Stream 2 (srt)' },
		])
		const recorder = instance.definitions.actions.recorder.options.find((o) => o.id === 'recorderId')
		assert.equal(recorder.default, 'all')
		assert.deepEqual(recorder.choices[0], { id: 'all', label: 'All recorders' })
		const eventRef = instance.definitions.actions.event.options.find((o) => o.id === 'eventRef')
		assert.equal(eventRef.default, 'ongoing')
		assert.equal(eventRef.allowCustom, true)
		assert.deepEqual(
			eventRef.choices.map((c) => c.label),
			[
				'Upcoming (next scheduled)',
				'Ongoing (running or paused)',
				'Running',
				'Paused',
				'Completed (most recent)',
				'Example event (scheduled)',
			],
		)
		const source = instance.definitions.actions.output.options.find((o) => o.id === 'source')
		assert.deepEqual(source.choices.slice(0, 3), [
			{ id: 'multiview', label: 'Built-in: Multiview' },
			{ id: 'deviceinfo', label: 'Built-in: Device info' },
			{ id: 'console', label: 'Built-in: Console' },
		])
	})

	// ------------------------------------------------------------------
	// Recorder (D14 toggle: start when stopped/disabled/error/unknown, stop when started/starting/paused)
	// ------------------------------------------------------------------

	describe('recorder', () => {
		it('Start / Stop starts a stopped recorder and stops a started one', async () => {
			instance.state.recorders['2'].status = { state: 'stopped' }
			await runAction(instance, 'recorder', { recorderId: '2', op: 'toggle' })
			one(mock, 'POST', `${V2}/recorders/2/control/start`)
			assert.equal(mock.state.recorders['2'].status.state, 'started')

			mock.state.recorders['1'].status = { state: 'started', duration: 30 }
			instance.state.recorders['1'].status = { state: 'started', duration: 30 }
			await runAction(instance, 'recorder', { recorderId: '1', op: 'toggle' })
			one(mock, 'POST', `${V2}/recorders/1/control/stop`)
			assert.equal(mock.state.recorders['1'].status.state, 'stopped')
		})

		it('Pause / Resume pauses a started recorder, resumes a paused one, does nothing while stopped', async () => {
			mock.state.recorders['1'].status = { state: 'started', duration: 30 }
			instance.state.recorders['1'].status = { state: 'started', duration: 30 }
			await runAction(instance, 'recorder', { recorderId: '1', op: 'pause_resume' })
			one(mock, 'POST', `${V2}/recorders/1/control/pause`)
			assert.equal(mock.state.recorders['1'].status.state, 'paused')

			instance.state.recorders['1'].status = { state: 'paused', duration: 30 }
			await runAction(instance, 'recorder', { recorderId: '1', op: 'pause_resume' })
			one(mock, 'POST', `${V2}/recorders/1/control/resume`)
			assert.equal(mock.state.recorders['1'].status.state, 'started')

			instance.state.recorders['1'].status = { state: 'stopped' }
			mock.requests.length = 0
			await runAction(instance, 'recorder', { recorderId: '1', op: 'pause_resume' })
			assert.equal(mock.requests.length, 0)
			assert.match(logged(instance, 'info').join('\n'), /nothing to pause or resume/)
		})

		it('start, stop, pause and resume are no longer actions of their own', async () => {
			for (const op of ['start', 'stop', 'pause', 'resume']) {
				instance.calls.log.length = 0
				await runAction(instance, 'recorder', { recorderId: '1', op })
				assert.match(logged(instance, 'error').join('\n'), new RegExp(`unknown action ${op}`))
			}
			assert.equal(mock.requests.length, 0)
		})

		it('reset falls back to the legacy base (recorder reset is legacy-only)', async () => {
			await runAction(instance, 'recorder', { recorderId: '1', op: 'reset' })
			one(mock, 'POST', `${V2}/recorders/1/control/reset`) // the silent v2.0 attempt that 404s
			one(mock, 'POST', `/api/recorders/1/control/reset`) // the fallback that succeeds
		})

		it('toggle: a stopped recorder starts, a started/paused one stops (D14 both directions)', async () => {
			instance.state.recorders['2'].status = { state: 'stopped' }
			await runAction(instance, 'recorder', { recorderId: '2', op: 'toggle' })
			one(mock, 'POST', `${V2}/recorders/2/control/start`)

			mock.requests.length = 0
			instance.state.recorders['2'].status = { state: 'started' }
			await runAction(instance, 'recorder', { recorderId: '2', op: 'toggle' })
			one(mock, 'POST', `${V2}/recorders/2/control/stop`)

			mock.requests.length = 0
			instance.state.recorders['2'].status = { state: 'paused' }
			await runAction(instance, 'recorder', { recorderId: '2', op: 'toggle' })
			one(mock, 'POST', `${V2}/recorders/2/control/stop`)
		})

		it('toggle "all" stops when any recorder is active, starts when none are (D14 aggregate)', async () => {
			instance.state.recorders['1'].status = { state: 'started' }
			instance.state.recorders['2'].status = { state: 'stopped' }
			instance.state.recorders['m1'].status = { state: 'stopped' }
			await runAction(instance, 'recorder', { recorderId: 'all', op: 'toggle' })
			one(mock, 'POST', `${V2}/recorders/control/stop`)

			mock.requests.length = 0
			instance.state.recorders['1'].status = { state: 'stopped' }
			instance.state.recorders['2'].status = { state: 'stopped' }
			instance.state.recorders['m1'].status = { state: 'stopped' }
			await runAction(instance, 'recorder', { recorderId: 'all', op: 'toggle' })
			one(mock, 'POST', `${V2}/recorders/control/start`)
		})

		it('reset "all" also falls back to the legacy base', async () => {
			await runAction(instance, 'recorder', { recorderId: 'all', op: 'reset' })
			one(mock, 'POST', `${V2}/recorders/control/reset`)
			one(mock, 'POST', `/api/recorders/control/reset`)
		})

		it('an unknown recorder is reported, nothing is sent', async () => {
			await runAction(instance, 'recorder', { recorderId: 'nope', op: 'toggle' })
			assert.equal(mock.requests.length, 0)
			assert.match(logged(instance, 'error').join('\n'), /unknown recorder nope/)
			assert.match(instance.state.lastError, /unknown recorder nope/)
		})

		it('an unrecognised op logs an error and sends nothing', async () => {
			await runAction(instance, 'recorder', { recorderId: '2', op: 'explode' })
			assert.equal(mock.requests.length, 0)
			assert.match(logged(instance, 'error').join('\n'), /unknown action explode/)
		})
	})

	// ------------------------------------------------------------------
	// Stream (D14 toggle: start when stopped/error/unknown, otherwise stop)
	// ------------------------------------------------------------------

	describe('stream', () => {
		it('start a single publisher', async () => {
			await runAction(instance, 'stream', { channelId: '1', publisherId: '1-0', op: 'start' })
			one(mock, 'POST', `${V2}/channels/1/publishers/0/control/start`)
			assert.equal(mock.state.channels['1'].publishers['0'].status.state, 'started')
		})

		it('stop a single publisher', async () => {
			mock.state.channels['1'].publishers['1'].status = { is_configured: true, started: true, state: 'started' }
			await runAction(instance, 'stream', { channelId: '1', publisherId: '1-1', op: 'stop' })
			one(mock, 'POST', `${V2}/channels/1/publishers/1/control/stop`)
			assert.equal(mock.state.channels['1'].publishers['1'].status.state, 'stopped')
		})

		it('toggle: stopped starts, started/listening stops (both directions)', async () => {
			instance.state.channels['1'].publishers['0'].status = { state: 'stopped' }
			await runAction(instance, 'stream', { channelId: '1', publisherId: '1-0', op: 'toggle' })
			one(mock, 'POST', `${V2}/channels/1/publishers/0/control/start`)

			mock.requests.length = 0
			instance.state.channels['1'].publishers['0'].status = { state: 'started' }
			await runAction(instance, 'stream', { channelId: '1', publisherId: '1-0', op: 'toggle' })
			one(mock, 'POST', `${V2}/channels/1/publishers/0/control/stop`)

			mock.requests.length = 0
			instance.state.channels['1'].publishers['0'].status = { state: 'listening' }
			await runAction(instance, 'stream', { channelId: '1', publisherId: '1-0', op: 'toggle' })
			one(mock, 'POST', `${V2}/channels/1/publishers/0/control/stop`)
		})

		it('toggle "all publishers" stops while one is live, starts when none are (D14 aggregate)', async () => {
			instance.state.channels['1'].publishers['0'].status = { state: 'stopped' }
			instance.state.channels['1'].publishers['1'].status = { state: 'started' }
			await runAction(instance, 'stream', { channelId: '1', publisherId: '1-all', op: 'toggle' })
			one(mock, 'POST', `${V2}/channels/1/publishers/control/stop`)

			mock.requests.length = 0
			instance.state.channels['1'].publishers['0'].status = { state: 'stopped' }
			instance.state.channels['1'].publishers['1'].status = { state: 'stopped' }
			await runAction(instance, 'stream', { channelId: '1', publisherId: '1-all', op: 'toggle' })
			one(mock, 'POST', `${V2}/channels/1/publishers/control/start`)
		})

		it('an unknown channel or publisher is reported, nothing is sent', async () => {
			await runAction(instance, 'stream', { channelId: '99', publisherId: '', op: 'start' })
			assert.match(logged(instance, 'error').join('\n'), /unknown channel 99/)

			instance.calls.log.length = 0
			await runAction(instance, 'stream', { channelId: '1', publisherId: '1-9', op: 'start' })
			assert.match(logged(instance, 'error').join('\n'), /unknown publisher 9/)
			assert.equal(mock.requests.length, 0)
		})
	})

	// ------------------------------------------------------------------
	// Layout
	// ------------------------------------------------------------------

	describe('layout', () => {
		it('sends the layout id as both query and body', async () => {
			await runAction(instance, 'layout', { channelId: '1', layoutId: '1-2' })
			const req = one(mock, 'PUT', `${V2}/channels/1/layouts/active`)
			assert.equal(req.query.id, '2')
			assert.deepEqual(req.body, { id: 2 })
			assert.equal(mock.state.channels['1'].layouts.find((l) => l.id === '2').active, true)
		})

		it('an unknown channel or layout, or no layout at all, is reported and nothing is sent', async () => {
			await runAction(instance, 'layout', { channelId: '1', layoutId: '99-1' })
			assert.match(logged(instance, 'error').join('\n'), /unknown channel 99/)

			instance.calls.log.length = 0
			await runAction(instance, 'layout', { channelId: '1', layoutId: '1-9' })
			assert.match(logged(instance, 'error').join('\n'), /unknown layout 9/)
			assert.equal(recorded(mock, 'PUT').length, 0)

			instance.calls.log.length = 0
			await runAction(instance, 'layout', { channelId: '1', layoutId: '' })
			assert.match(logged(instance, 'error').join('\n'), /no layout selected/)
		})
	})

	// ------------------------------------------------------------------
	// Single touch
	// ------------------------------------------------------------------

	describe('singletouch', () => {
		it('toggles the control', async () => {
			await runAction(instance, 'singletouch', { stcId: '0' })
			one(mock, 'POST', `${V2}/system/singletouchcontrol/0/control/toggle`)
			assert.equal(mock.state.singleTouch['0'].pressed, true)
		})

		it('an unknown control is reported, nothing is sent', async () => {
			await runAction(instance, 'singletouch', { stcId: '7' })
			assert.match(logged(instance, 'error').join('\n'), /unknown single touch control 7/)
			assert.equal(mock.requests.length, 0)
		})
	})

	// ------------------------------------------------------------------
	// Bookmark
	// ------------------------------------------------------------------

	describe('bookmark', () => {
		it('appends the local time when asked', async () => {
			await runAction(instance, 'bookmark', { channelId: '1', text: 'Marker', appendTime: true })
			const req = one(mock, 'POST', `${V2}/channels/1/bookmarks`)
			assert.match(req.query.text, /^Marker \d\d:\d\d:\d\d$/)
			assert.equal(req.body.text, req.query.text)
		})

		it('an empty text falls back to "Marker" and appendTime off sends the text verbatim', async () => {
			await runAction(instance, 'bookmark', { channelId: '1', text: '', appendTime: false })
			const req = one(mock, 'POST', `${V2}/channels/1/bookmarks`)
			assert.equal(req.query.text, 'Marker')
		})

		it('an unknown channel is reported, nothing is sent', async () => {
			await runAction(instance, 'bookmark', { channelId: '99', text: 'x', appendTime: false })
			assert.match(logged(instance, 'error').join('\n'), /unknown channel 99/)
			assert.equal(mock.requests.length, 0)
		})
	})

	// ------------------------------------------------------------------
	// Output source
	// ------------------------------------------------------------------

	describe('output', () => {
		it('sets the source and remembers it with a timestamp for output_set (5 s window)', async () => {
			const before = Date.now()
			await runAction(instance, 'output', { outputId: 'D1', source: 'console' })
			const req = one(mock, 'PUT', `${V2}/outputs/D1/settings`)
			assert.equal(req.query.source, 'console')
			assert.equal(instance.state.outputs.D1.source, 'console')
			assert.ok(instance.state.outputs.D1.setAt >= before)
			assert.ok(instance.checkedFeedbacks.some((ids) => ids.includes('output_set')))

			assert.equal(await runFeedback(instance, 'output_set', { outputId: 'D1', source: 'console' }), true)
			instance.state.outputs.D1.setAt = Date.now() - 6000
			assert.equal(
				await runFeedback(instance, 'output_set', { outputId: 'D1', source: 'console' }),
				false,
				'expires after 5 s',
			)
		})

		it('an unknown output or blank source is reported, nothing is sent', async () => {
			await runAction(instance, 'output', { outputId: 'nope', source: 'console' })
			assert.match(logged(instance, 'error').join('\n'), /unknown output nope/)

			instance.calls.log.length = 0
			await runAction(instance, 'output', { outputId: 'D1', source: '' })
			assert.match(logged(instance, 'error').join('\n'), /no source selected/)
			assert.equal(mock.requests.length, 0)
		})
	})

	// ------------------------------------------------------------------
	// Configuration preset
	// ------------------------------------------------------------------

	describe('preset', () => {
		it('applies the whole preset and reports a reboot for 60 s', async () => {
			const before = Date.now()
			await runAction(instance, 'preset', { presetName: 'Show A', sections: [], confirm: false })
			const req = one(mock, 'POST', `${V2}/system/presets/Show%20A/control/apply`)
			assert.equal(req.body, null)
			assert.equal(instance.state.lastConfigPreset.name, 'Show A')
			assert.equal(instance.state.presetStatus.text, 'Rebooting…')
			assert.ok(instance.state.presetStatus.until >= before + 59000)
		})

		it('sends only the picked sections, and no reboot is reported when the device does not ask for one', async () => {
			await runAction(instance, 'preset', {
				presetName: 'Show A',
				sections: ['channels', 'sources'],
				confirm: false,
			})
			const req = one(mock, 'POST', `${V2}/system/presets/Show%20A/control/apply`)
			assert.deepEqual(req.body, { sections: ['channels', 'sources'] })
			assert.equal(instance.state.presetStatus, undefined)
		})

		it('an unknown preset is reported, nothing is sent', async () => {
			await runAction(instance, 'preset', { presetName: '', sections: [], confirm: false })
			assert.match(logged(instance, 'error').join('\n'), /no preset selected/)
			assert.equal(mock.requests.length, 0)
		})
	})

	// ------------------------------------------------------------------
	// CMS event
	// ------------------------------------------------------------------

	describe('event', () => {
		it('toggle starts a scheduled event, using its concrete id', async () => {
			mock.state.events[0].status = 'scheduled'
			const id = mock.state.events[0].id
			await runAction(instance, 'event', { eventRef: 'upcoming', op: 'toggle', extendSeconds: 300 })
			one(mock, 'GET', `${V2}/schedule/events/upcoming`)
			one(mock, 'POST', `${V2}/schedule/events/${id}/control/start`)
			assert.equal(mock.state.events[0].status, 'running')
		})

		it('toggle pauses a running event, resumes a paused one', async () => {
			mock.state.events[0].status = 'running'
			const id = mock.state.events[0].id
			await runAction(instance, 'event', { eventRef: 'ongoing', op: 'toggle', extendSeconds: 300 })
			one(mock, 'POST', `${V2}/schedule/events/${id}/control/pause`)
			assert.equal(mock.state.events[0].status, 'paused')

			mock.requests.length = 0
			await runAction(instance, 'event', { eventRef: 'ongoing', op: 'toggle', extendSeconds: 300 })
			one(mock, 'POST', `${V2}/schedule/events/${id}/control/resume`)
			assert.equal(mock.state.events[0].status, 'running')
		})

		it('a fixed command that does not apply to the event state warns and sends nothing', async () => {
			mock.state.events[0].status = 'running'
			const id = mock.state.events[0].id
			await runAction(instance, 'event', { eventRef: 'ongoing', op: 'start', extendSeconds: 300 })
			none(mock, 'POST', `${V2}/schedule/events/${id}/control/start`)
			assert.match(logged(instance, 'warn').join('\n'), /cannot start/)
		})

		it('Pause / Resume pauses a running event and resumes a paused one', async () => {
			mock.state.events[0].status = 'running'
			const id = mock.state.events[0].id
			const options = { eventRef: 'ongoing', op: 'toggle', op_event: 'start', extendSeconds: 300 }
			await runAction(instance, 'event', options)
			one(mock, 'POST', `${V2}/schedule/events/${id}/control/pause`)
			assert.equal(mock.state.events[0].status, 'paused')
			await runAction(instance, 'event', options)
			one(mock, 'POST', `${V2}/schedule/events/${id}/control/resume`)
			assert.equal(mock.state.events[0].status, 'running')
		})

		it('extend sends the seconds as finish', async () => {
			mock.state.events[0].status = 'running'
			const id = mock.state.events[0].id
			const finishBefore = mock.state.events[0].finish
			await runAction(instance, 'event', { eventRef: 'ongoing', op: 'extend', extendSeconds: 600 })
			const req = one(mock, 'POST', `${V2}/schedule/events/${id}/control/extend`)
			assert.deepEqual(req.body, { finish: 600 })
			assert.equal(mock.state.events[0].finish, finishBefore + 600)
		})

		it('the upcoming event only ever starts, whatever the dropdowns hold; a specific event takes its own action', async () => {
			mock.state.events[0].status = 'scheduled'
			const id = mock.state.events[0].id
			await runAction(instance, 'event', {
				eventRef: 'upcoming',
				op: 'stop',
				op_event: 'stop',
				extendSeconds: 300,
			})
			one(mock, 'POST', `${V2}/schedule/events/${id}/control/start`)
			assert.equal(mock.state.events[0].status, 'running')

			mock.requests.length = 0
			await runAction(instance, 'event', { eventRef: id, op: 'toggle', op_event: 'stop', extendSeconds: 300 })
			one(mock, 'POST', `${V2}/schedule/events/${id}/control/stop`)
		})

		it('an eventRef that resolves to nothing warns and sends nothing', async () => {
			await runAction(instance, 'event', { eventRef: 'no-such-event-id', op: 'start', extendSeconds: 300 })
			assert.match(logged(instance, 'warn').join('\n'), /no event matches/)
			assert.equal(recorded(mock, 'POST').length, 0)
			mock.state.events[0].status = 'scheduled'
		})
	})

	// ------------------------------------------------------------------
	// Power
	// ------------------------------------------------------------------

	describe('power', () => {
		it('reboot reports the command sent for 30 s', async () => {
			const before = Date.now()
			await runAction(instance, 'power', { op: 'reboot', confirm: false })
			one(mock, 'POST', `${V2}/system/control/reboot`)
			assert.equal(instance.state.powerStatus.text, 'Command sent')
			assert.ok(instance.state.powerStatus.until >= before + 29000)
		})

		it('shutdown sends the shutdown command', async () => {
			await runAction(instance, 'power', { op: 'shutdown', confirm: false })
			one(mock, 'POST', `${V2}/system/control/shutdown`)
		})
	})

	// ------------------------------------------------------------------
	// Audio
	// ------------------------------------------------------------------

	describe('audio', () => {
		it('a gain nudge on a stereo pair reads the settings first and patches once', async () => {
			mock.state.inputs['analog-a'].settings.local_audio.gain = 27
			instance.rotaryWindowMs = 10
			await runAction(instance, 'audio', { inputId: 'analog-a', control: 'gain', direction: 'up', step: 3 })
			await waitFor(() => recorded(mock, 'PATCH', `${V2}/inputs/analog-a/settings`).length === 1)
			one(mock, 'GET', `${V2}/inputs/analog-a/settings`)
			const req = one(mock, 'PATCH', `${V2}/inputs/analog-a/settings`)
			assert.deepEqual(req.body, { local_audio: { gain: 30 } })
		})

		it('stereo_pair false patches both channels to the same value', async () => {
			mock.state.inputs['analog-b'].settings.local_audio.channels.channelA.gain = 20
			mock.state.inputs['analog-b'].settings.local_audio.channels.channelB.gain = 24
			instance.rotaryWindowMs = 10
			await runAction(instance, 'audio', { inputId: 'analog-b', control: 'gain', direction: 'up', step: 2 })
			await waitFor(() => recorded(mock, 'PATCH', `${V2}/inputs/analog-b/settings`).length === 1)
			const req = one(mock, 'PATCH', `${V2}/inputs/analog-b/settings`)
			// read from channel A (20 + 2), both channels move to that value
			assert.deepEqual(req.body, {
				local_audio: { channels: { channelA: { gain: 22 }, channelB: { gain: 22 } } },
			})
		})

		it('presses inside the coalescing window are summed into one patch (D4)', async () => {
			mock.state.inputs['analog-b'].settings.local_audio.channels.channelA.gain = 20
			mock.state.inputs['analog-b'].settings.local_audio.channels.channelB.gain = 24
			instance.rotaryWindowMs = 80
			const options = { inputId: 'analog-b', control: 'gain', direction: 'up', step: 2 }
			await runAction(instance, 'audio', options)
			await runAction(instance, 'audio', options)
			await runAction(instance, 'audio', options)
			await waitFor(() => recorded(mock, 'PATCH', `${V2}/inputs/analog-b/settings`).length === 1)
			await new Promise((resolve) => setTimeout(resolve, 150))
			const list = recorded(mock, 'PATCH', `${V2}/inputs/analog-b/settings`)
			assert.equal(list.length, 1)
			assert.deepEqual(list[0].body, {
				local_audio: { channels: { channelA: { gain: 26 }, channelB: { gain: 26 } } },
			})
		})

		it('three rotate_right ticks of the gain dial within 150 ms make one patch of +3 (D4)', async () => {
			mock.state.inputs['analog-a'].settings.local_audio.gain = 27
			// the real 150 ms window, and the options a hand-built rotary button carries (the Audio preset group
			// is not generated any more, see src/presets.js)
			instance.rotaryWindowMs = undefined
			const tick = {
				actionId: 'audio',
				options: { inputId: 'analog-a', control: 'gain', direction: 'up', step: 1 },
			}

			// a spin of the dial: the three ticks are handed over in one go, well inside the 150 ms window
			const start = Date.now()
			await Promise.all([
				runRotate(instance, tick.actionId, tick.options),
				runRotate(instance, tick.actionId, tick.options),
				runRotate(instance, tick.actionId, tick.options),
			])
			assert.ok(Date.now() - start < 150, 'the three ticks arrived inside the coalescing window')
			assert.equal(recorded(mock, 'PATCH', `${V2}/inputs/analog-a/settings`).length, 0, 'nothing sent yet')

			await waitFor(() => recorded(mock, 'PATCH', `${V2}/inputs/analog-a/settings`).length === 1)
			await new Promise((resolve) => setTimeout(resolve, 200))
			const list = recorded(mock, 'PATCH', `${V2}/inputs/analog-a/settings`)
			assert.equal(list.length, 1, 'one request for the three ticks')
			assert.deepEqual(list[0].body, { local_audio: { gain: 30 } }, '27 + 3')
		})

		it('rotary steps flush the same way runAction does (runRotate)', async () => {
			mock.state.inputs['analog-a'].settings.local_audio.gain = 50
			instance.rotaryWindowMs = 10
			await runRotate(instance, 'audio', { inputId: 'analog-a', control: 'gain', direction: 'down', step: 5 })
			await waitFor(() => recorded(mock, 'PATCH', `${V2}/inputs/analog-a/settings`).length === 1)
			assert.deepEqual(one(mock, 'PATCH', `${V2}/inputs/analog-a/settings`).body, { local_audio: { gain: 45 } })
		})

		it('delay path detection: audio.delay, hdmi.audio.delay, sdi.audio.delay', async () => {
			instance.rotaryWindowMs = 10

			mock.state.inputs['analog-a'].settings.audio.delay = 0
			await runAction(instance, 'audio', { inputId: 'analog-a', control: 'delay', direction: 'up', step: 5 })
			await waitFor(() => recorded(mock, 'PATCH', `${V2}/inputs/analog-a/settings`).length === 1)
			assert.deepEqual(one(mock, 'PATCH', `${V2}/inputs/analog-a/settings`).body, { audio: { delay: 5 } })

			mock.requests.length = 0
			mock.state.inputs['hdmi-b'].settings.hdmi.audio.delay = 0
			await runAction(instance, 'audio', { inputId: 'hdmi-b', control: 'delay', direction: 'up', step: 40 })
			await waitFor(() => recorded(mock, 'PATCH', `${V2}/inputs/hdmi-b/settings`).length === 1)
			assert.deepEqual(one(mock, 'PATCH', `${V2}/inputs/hdmi-b/settings`).body, {
				hdmi: { audio: { delay: 40 } },
			})

			mock.requests.length = 0
			mock.state.inputs['sdi-a'].settings.sdi.audio.delay = 0
			await runAction(instance, 'audio', { inputId: 'sdi-a', control: 'delay', direction: 'down', step: 20 })
			await waitFor(() => recorded(mock, 'PATCH', `${V2}/inputs/sdi-a/settings`).length === 1)
			assert.deepEqual(one(mock, 'PATCH', `${V2}/inputs/sdi-a/settings`).body, { sdi: { audio: { delay: -20 } } })
		})

		it('gain on an input that is not analog is ignored: the action adjusts the delay instead', async () => {
			instance.rotaryWindowMs = 10
			assert.equal(instance.isAnalogInput('analog-a'), true)
			assert.equal(instance.isAnalogInput('sdi-a'), false)
			mock.state.inputs['sdi-a'].settings.sdi.audio.delay = 0
			await runAction(instance, 'audio', { inputId: 'sdi-a', control: 'gain', direction: 'up', step: 5 })
			await waitFor(() => recorded(mock, 'PATCH', `${V2}/inputs/sdi-a/settings`).length === 1)
			assert.deepEqual(one(mock, 'PATCH', `${V2}/inputs/sdi-a/settings`).body, { sdi: { audio: { delay: 5 } } })
		})

		it('an input with no gain/delay setting warns (from the coalesced flush) and sends nothing', async () => {
			instance.rotaryWindowMs = 10
			// an input whose settings carry no delay: the nudge reads them, finds nothing to move and warns
			const saved = mock.state.inputs.SRT1.settings.audio
			delete mock.state.inputs.SRT1.settings.audio
			try {
				await runAction(instance, 'audio', { inputId: 'SRT1', control: 'delay', direction: 'up', step: 1 })
				await new Promise((resolve) => setTimeout(resolve, 60))
				assert.equal(recorded(mock, 'PATCH').length, 0)
				assert.match(logged(instance, 'warn').join('\n'), /no audio delay setting/)
			} finally {
				mock.state.inputs.SRT1.settings.audio = saved
			}
		})

		it('an unknown input is reported, nothing is sent', async () => {
			await runAction(instance, 'audio', { inputId: 'nope', control: 'gain', direction: 'up', step: 1 })
			assert.match(logged(instance, 'error').join('\n'), /unknown input nope/)
			assert.equal(mock.requests.length, 0)
		})
	})

	// ------------------------------------------------------------------
	// Confirm gate (D2)
	// ------------------------------------------------------------------

	describe('confirm gate (D2)', () => {
		it('first press only arms the button (no request, confirm_hint set, confirm_pending true)', async () => {
			await runAction(instance, 'power', { op: 'reboot', confirm: true }, { controlId: 'confirm1' })
			none(mock, 'POST', `${V2}/system/control/reboot`)
			assert.equal(instance.variableValues.confirm_hint, 'Press again')
			assert.ok(instance.checkedFeedbacks.some((ids) => ids.includes('confirm_pending')))
			assert.equal(instance.isConfirmPending('confirm1'), true)
			assert.equal(instance.isConfirmPending('other'), false)
		})

		it('a second press of the same button within the window sends the command', async () => {
			await runAction(instance, 'power', { op: 'reboot', confirm: true }, { controlId: 'confirm2' })
			none(mock, 'POST', `${V2}/system/control/reboot`)
			await runAction(instance, 'power', { op: 'reboot', confirm: true }, { controlId: 'confirm2' })
			one(mock, 'POST', `${V2}/system/control/reboot`)
			assert.equal(instance.variableValues.confirm_hint, '')
			assert.equal(instance.isConfirmPending('confirm2'), false)
		})

		it('a third press within the status window re-arms without leaving both confirm_hint and power_status set (regression)', async () => {
			await runAction(instance, 'power', { op: 'reboot', confirm: true }, { controlId: 'confirm5' })
			await runAction(instance, 'power', { op: 'reboot', confirm: true }, { controlId: 'confirm5' })
			one(mock, 'POST', `${V2}/system/control/reboot`)
			assert.equal(instance.variableValues.confirm_hint, '')
			assert.notEqual(instance.variableValues.power_status, '')

			// a third press on the same button, still inside power_status's 30 s window, only re-arms
			await runAction(instance, 'power', { op: 'reboot', confirm: true }, { controlId: 'confirm5' })
			assert.equal(recorded(mock, 'POST', `${V2}/system/control/reboot`).length, 1, 'no second command sent')
			assert.equal(instance.variableValues.confirm_hint, 'Press again')
			assert.equal(
				instance.variableValues.power_status,
				'',
				'stale power_status must not linger alongside confirm_hint',
			)
			assert.equal(instance.state.powerStatus, undefined)
		})

		it('a press after the window has expired only re-arms (shortened confirmWindowMs)', async () => {
			instance.confirmWindowMs = 20
			await runAction(instance, 'power', { op: 'reboot', confirm: true }, { controlId: 'confirm3' })
			await new Promise((resolve) => setTimeout(resolve, 60))
			await runAction(instance, 'power', { op: 'reboot', confirm: true }, { controlId: 'confirm3' })
			assert.equal(mock.requests.length, 0)
			assert.equal(instance.variableValues.confirm_hint, 'Press again')
			assert.equal(instance.isConfirmPending('confirm3'), true)
		})

		it('pressing a *different* button re-arms instead of confirming the first one (a single pending slot)', async () => {
			await runAction(instance, 'power', { op: 'reboot', confirm: true }, { controlId: 'confirmA' })
			assert.equal(instance.isConfirmPending('confirmA'), true)
			await runAction(instance, 'power', { op: 'reboot', confirm: true }, { controlId: 'confirmB' })
			assert.equal(mock.requests.length, 0)
			assert.equal(instance.isConfirmPending('confirmB'), true)
			assert.equal(instance.isConfirmPending('confirmA'), false, 'arming a different button displaces the first')
		})

		it('an unticked confirm fires immediately, arming nothing', async () => {
			await runAction(instance, 'power', { op: 'shutdown', confirm: false }, { controlId: 'confirm4' })
			one(mock, 'POST', `${V2}/system/control/shutdown`)
			assert.equal(instance.isConfirmPending('confirm4'), false)
		})
	})

	// ------------------------------------------------------------------
	// Resilience
	// ------------------------------------------------------------------

	it('no action callback ever throws, even with garbage or empty options', async () => {
		for (const [id, def] of Object.entries(instance.definitions.actions)) {
			await assert.doesNotReject(
				() => def.callback({ actionId: id, options: {}, id: 'a', controlId: 'c' }, {}),
				`action ${id} threw with empty options`,
			)
			await assert.doesNotReject(
				() =>
					def.callback(
						{
							actionId: id,
							options: { channelId: 42, publisherId: null, recorderId: {}, layoutId: 7, storageId: [] },
							id: 'a',
							controlId: 'c',
						},
						{},
					),
				`action ${id} threw with garbage options`,
			)
		}
	})
})

describe('actions against a legacy-only device', () => {
	let mock
	let instance

	before(async () => {
		mock = await startMockPearl({ firmware: '4.20.0', legacyOnly: true })
		instance = await createInstance({ mock })
		mock.requests.length = 0
	})

	after(async () => {
		await instance.destroy()
		await mock.close()
	})

	it('actions that do not need v2 use the legacy /api base', async () => {
		await runAction(instance, 'layout', { channelId: '1', layoutId: '1-2' })
		const layoutReq = mock.requests.find((r) => r.method === 'PUT')
		assert.equal(layoutReq.path, '/api/channels/1/layouts/active')

		mock.requests.length = 0
		await runAction(instance, 'stream', { channelId: '1', publisherId: '1-0', op: 'start' })
		assert.equal(mock.requests[0].path, '/api/channels/1/publishers/0/control/start')

		mock.requests.length = 0
		await runAction(instance, 'bookmark', { channelId: '1', text: 'm', appendTime: false })
		assert.equal(mock.requests[0].path, '/api/channels/1/bookmarks')

		mock.requests.length = 0
		await runAction(instance, 'recorder', { recorderId: '2', op: 'toggle' })
		assert.equal(mock.requests[0].path, '/api/recorders/2/control/start')
	})

	it('v2-only actions (recorder all, singletouch, output, preset, event, audio) warn and send nothing', async () => {
		const v2Only = [
			['recorder', { recorderId: 'all', op: 'toggle' }],
			['singletouch', { stcId: '0' }],
			['output', { outputId: 'D1', source: 'console' }],
			['preset', { presetName: 'Default', sections: [], confirm: false }],
			['event', { eventRef: 'ongoing', op: 'toggle', op_event: 'start', extendSeconds: 300 }],
			['audio', { inputId: 'analog-a', control: 'gain', direction: 'up', step: 1 }],
		]
		for (const [id, options] of v2Only) {
			mock.requests.length = 0
			instance.calls.log.length = 0
			await runAction(instance, id, options)
			assert.equal(mock.requests.length, 0, `${id} sent a request on a legacy device`)
			assert.ok(
				instance.calls.log.some((l) => l.level === 'warn' && /API v2\.0/.test(l.message)),
				`${id} did not warn`,
			)
		}
	})
})

describe('content metadata (legacy admin CGI)', () => {
	let mock
	let instance

	before(async () => {
		mock = await startMockPearl()
		instance = await createInstance({ mock })
	})

	after(async () => {
		await instance.destroy()
		await mock.close()
	})

	it('reads title, author and prefix of every channel into variables after the first poll', () => {
		assert.equal(instance.variableValues.channel_1_metadata_title, 'Morning Show')
		assert.equal(instance.variableValues.channel_1_metadata_author, 'Epiphan')
		assert.equal(instance.variableValues.channel_1_metadata_rec_prefix, 'HDMI-A')
		assert.equal(instance.variableValues.channel_2_metadata_title, '')
		assert.equal(instance.variableValues.channel_2_metadata_rec_prefix, 'Multi')
	})

	it('Set Content Metadata writes to the device and updates the variables', async () => {
		mock.requests.length = 0
		await runAction(instance, 'setContentMetadata', {
			channel: '1',
			title: 'Evening Show & Q=A',
			author: 'Jo',
			prefix: 'EVE',
		})
		const req = mock.requests.find((r) => r.path === '/admin/channel1/set_params.cgi')
		assert.ok(req, 'no set_params request')
		assert.equal(instance.variableValues.channel_1_metadata_title, 'Evening Show & Q=A')
		assert.equal(instance.variableValues.channel_1_metadata_author, 'Jo')
		assert.equal(instance.variableValues.channel_1_metadata_rec_prefix, 'EVE')

		// the device really stored it: Get re-reads it unchanged, special characters included
		await runAction(instance, 'getContentMetadata', { channel: '1' })
		assert.equal(instance.variableValues.channel_1_metadata_title, 'Evening Show & Q=A')
	})

	it('Get Content Metadata picks up a change made on the device', async () => {
		await runAction(instance, 'setContentMetadata', { channel: '2', title: 'x', author: '', prefix: 'p' })
		mock.state.channels['2'].metadata.title = 'Changed on device'
		await runAction(instance, 'getContentMetadata', { channel: '2' })
		assert.equal(instance.variableValues.channel_2_metadata_title, 'Changed on device')
	})

	it('a rejected Set leaves the variables as they were and reports a failure', async () => {
		const before = instance.variableValues.channel_1_metadata_title
		mock.failNext('GET', '/admin/channel1/set_params.cgi', 500, 'nope')
		instance.calls.log.length = 0
		await runAction(instance, 'setContentMetadata', { channel: '1', title: 'Rejected', author: '', prefix: '' })
		assert.equal(instance.variableValues.channel_1_metadata_title, before)
		assert.ok(instance.calls.log.some((l) => l.level === 'error'))
	})
})
