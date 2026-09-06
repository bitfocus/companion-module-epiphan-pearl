const { describe, it, before, after } = require('node:test')
const assert = require('node:assert/strict')

const { createInstance, InstanceStatus } = require('./harness')
const { startMockPearl } = require('./mock-pearl')

const VARIABLE_ID_RE = /^[a-zA-Z0-9_-]+$/

function countCalls(instance, method) {
	const counter = { n: 0 }
	const original = instance[method]
	instance[method] = function (...args) {
		counter.n++
		return original.apply(this, args)
	}
	return counter
}

describe('poller diffing (D7 feedback ids)', () => {
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

	it('an unchanged device triggers no feedback checks and no definition updates', async () => {
		const actions = countCalls(instance, 'setActionDefinitions')
		instance.checkedFeedbacks.length = 0
		await instance.pollAll()
		// only the event countdown moves, and that is a variable, not a feedback
		assert.deepEqual(instance.checkedFeedbacks, [])
		assert.equal(actions.n, 0)
	})

	it('a publisher status change re-checks only stream_state', async () => {
		instance.checkedFeedbacks.length = 0
		mock.state.channels['1'].publishers['0'].status = { is_configured: true, started: true, state: 'started' }
		await instance.pollAll()
		assert.equal(instance.checkedFeedbacks.length, 1)
		const ids = instance.checkedFeedbacks[0]
		assert.deepEqual(ids, ['stream_state'])
		assert.equal(instance.variableValues.channel_1_publisher_0_state, 'started')
	})

	it('a recorder status change (via a real HTTP call) re-checks only recorder_state', async () => {
		instance.checkedFeedbacks.length = 0
		const res = await fetch(`${mock.url}/api/v2.0/recorders/2/control/start`, {
			method: 'POST',
			headers: { Authorization: 'Basic ' + Buffer.from('admin:x').toString('base64') },
		})
		assert.equal(res.status, 200)
		await instance.pollAll()
		assert.equal(instance.state.recorders['2'].status.state, 'started')
		assert.deepEqual(new Set(instance.checkedFeedbacks.flat()), new Set(['recorder_state']))
		mock.state.recorders['2'].status = { state: 'stopped' }
		await instance.pollAll()
	})

	it('layout, storage, single touch, system, afu and event changes map to their D7 feedback ids', async () => {
		const check = async (mutate, expected) => {
			instance.checkedFeedbacks.length = 0
			mutate()
			await instance.pollAll()
			const ids = new Set(instance.checkedFeedbacks.flat())
			assert.deepEqual(ids, new Set(expected), `expected exactly ${expected} in ${[...ids]}`)
		}
		await check(() => {
			for (const l of mock.state.channels['1'].layouts) l.active = l.id === '2'
		}, ['layout_active'])
		await check(() => {
			mock.state.storages.main.free = 5e8
		}, ['storage_level'])
		await check(() => {
			mock.state.singleTouch['0'].pressed = true
		}, ['singletouch_active'])
		// afu and systemStatus both map to the 'system' feedback: changing both in one poll checks it once
		await check(() => {
			mock.state.systemStatus.cpuload = 95
			mock.state.systemStatus.cpuload_high = true
			mock.state.afu[0].status.state = 'uploading'
		}, ['system'])
		await check(() => {
			mock.state.events[0].status = 'running'
		}, ['event_state', 'event_applies'])
		assert.equal(instance.variableValues.channel_1_active_layout, 'Picture in picture')
		assert.equal(instance.variableValues.afu_state, 'uploading')
		assert.equal(instance.variableValues.event_ongoing_status, 'running')
		mock.reset()
		await instance.pollAll()
	})

	it('carries the optimistic lastConfigPreset, presetStatus, powerStatus and lastError across a poll', async () => {
		// the Pearl API has no read endpoint for any of these; each is set only by its action and must
		// survive the state object being rebuilt from scratch on every poll
		instance.state.lastConfigPreset = { name: 'Show A', appliedAt: 12345 }
		instance.state.presetStatus = { text: 'Rebooting…', until: Date.now() + 60000 }
		instance.state.powerStatus = { text: 'Command sent', until: Date.now() + 30000 }
		instance.state.lastError = 'boom'
		await instance.pollAll()
		assert.deepEqual(instance.state.lastConfigPreset, { name: 'Show A', appliedAt: 12345 })
		assert.equal(instance.state.presetStatus.text, 'Rebooting…')
		assert.equal(instance.state.powerStatus.text, 'Command sent')
		assert.equal(instance.state.lastError, 'boom')
	})

	it('renaming a channel rebuilds the definitions and checks all feedbacks', async () => {
		const actions = countCalls(instance, 'setActionDefinitions')
		const feedbacks = countCalls(instance, 'setFeedbackDefinitions')
		const presets = countCalls(instance, 'setPresetDefinitions')
		instance.checkedFeedbacks.length = 0
		instance.calls.log.length = 0

		mock.state.channels['1'].name = 'Renamed channel'
		await instance.pollAll()

		assert.equal(actions.n, 1)
		assert.equal(feedbacks.n, 1)
		assert.equal(presets.n, 1)
		assert.deepEqual(instance.checkedFeedbacks, [[]])
		assert.ok(instance.calls.log.some((l) => l.level === 'info' && /configuration has changed/.test(l.message)))
		const layoutOption = instance.definitions.actions.layout.options.find((o) => o.id === 'layoutId')
		assert.ok(layoutOption.choices.some((c) => c.label === 'Renamed channel – Default'))
		assert.ok(instance.definitions.presets['layouts_1_1'])
		assert.match(instance.definitions.presets['layouts_1_1'].name, /Renamed channel/)
		assert.equal(instance.variableValues.channel_1_name, 'Renamed channel')
		mock.state.channels['1'].name = 'HDMI-A'
		await instance.pollAll()
	})

	it('a new publisher / input / preset also counts as a structure change', async () => {
		const actions = countCalls(instance, 'setActionDefinitions')
		mock.state.channels['2'].publishers['0'] = {
			id: '0',
			type: 'hls',
			name: 'HLS',
			status: { is_configured: true, started: false, state: 'stopped' },
			settings: { type: 'hls', hls: {}, common: { enabled: true, single_touch: false } },
		}
		await instance.pollAll()
		assert.equal(actions.n, 1)
		assert.ok(instance.definitions.presets['streaming_toggle_2-0'])
		assert.equal(instance.variableValues.channel_2_publisher_0_type, 'hls')
		mock.reset()
		await instance.pollAll()
		assert.equal(actions.n, 2)
	})

	it('slow-changing info is refreshed on the first and every 30th poll only', async () => {
		mock.requests.length = 0
		await instance.pollAll()
		assert.ok(!mock.requests.some((r) => r.path === '/api/v2.0/system/firmware'))
		assert.ok(!mock.requests.some((r) => r.path === '/api/v2.0/system/presets'))
		assert.equal(instance.state.firmware.version, '4.24.1')
		assert.deepEqual(
			instance.state.presets.map((p) => p.name),
			['Default', 'Show A'],
		)

		instance.pollCounter = 30
		mock.requests.length = 0
		await instance.pollAll()
		assert.ok(mock.requests.some((r) => r.path === '/api/v2.0/system/firmware'))
		assert.ok(mock.requests.some((r) => r.path === '/api/v2.0/system/ident'))
		const presetsReq = mock.requests.find((r) => r.path === '/api/v2.0/system/presets')
		assert.deepEqual(presetsReq.query, { details: 'true' })
	})

	it('overlapping polls share the running poll instead of starting a second one', async () => {
		mock.requests.length = 0
		const first = instance.pollAll()
		assert.ok(instance.pollPromise, 'the running poll is exposed as pollPromise')
		assert.equal(instance.pollInProgress, true)
		const second = instance.pollAll()
		await Promise.all([first, second])
		assert.equal(instance.pollPromise, undefined)
		assert.equal(instance.pollInProgress, false)
		assert.equal(mock.requests.filter((r) => r.path === '/api/v2.0/channels').length, 1)
	})

	it('schedulePollSoon coalesces into one poll', async () => {
		mock.requests.length = 0
		instance.schedulePollSoon()
		instance.schedulePollSoon()
		instance.schedulePollSoon()
		assert.ok(instance.pollSoonTimer)
		assert.equal(mock.requests.length, 0, 'nothing is requested before the delay')
		const deadline = Date.now() + 10000
		while (instance.pollSoonTimer || instance.pollInProgress || mock.requests.length === 0) {
			if (Date.now() > deadline) assert.fail('poll did not run within 10 s')
			await new Promise((resolve) => setTimeout(resolve, 50))
		}
		assert.equal(instance.pollSoonTimer, undefined)
		assert.equal(mock.requests.filter((r) => r.path === '/api/v2.0/channels').length, 1)
	})
})

describe('poller options (D5 event list, poll_events)', () => {
	it('polls the CMS schedule (upcoming/ongoing/list?limit=10) when poll_events is on', async () => {
		const mock = await startMockPearl()
		const instance = await createInstance({ mock, config: { poll_events: true } })
		try {
			assert.ok(mock.requests.some((r) => r.path === '/api/v2.0/schedule/events/upcoming'))
			assert.ok(mock.requests.some((r) => r.path === '/api/v2.0/schedule/events/ongoing'))
			const listReq = mock.requests.find((r) => r.path === '/api/v2.0/schedule/events' && r.method === 'GET')
			assert.ok(listReq, 'the polled event list (D5, feeds choicesEventRefs) is fetched')
			assert.deepEqual(listReq.query, { limit: '10' })
			assert.equal(instance.state.events.list.length, 1)
			assert.equal(instance.state.events.list[0].title, 'Example event')
		} finally {
			await instance.destroy()
			await mock.close()
		}
	})

	it('poll_events false skips the schedule entirely', async () => {
		const mock = await startMockPearl()
		const instance = await createInstance({ mock, config: { poll_events: false } })
		try {
			assert.ok(!mock.requests.some((r) => r.path.startsWith('/api/v2.0/schedule/')))
			assert.equal(instance.state.events.upcoming, null)
			assert.deepEqual(instance.state.events.list, [])
			assert.equal(instance.variableValues.event_upcoming_title, '')
		} finally {
			await instance.destroy()
			await mock.close()
		}
	})
})

describe('D8 backoff drives the real timer chain (initInterval), not just the pure functions', () => {
	// Regression coverage for instance.js's initInterval(): it must chain via setTimeout, recomputing
	// the delay from nextPollDelayMs() after every real poll, rather than a fixed setInterval that would
	// keep firing at the base interval no matter how many consecutive polls fail.
	it('several consecutive real failures widen the gap between real pollAll() invocations', async () => {
		const mock = await startMockPearl()
		// 500 is pollIntervalMs()'s floor (D8 clamp), the smallest base this real chain can run at
		const instance = await createInstance({ mock, config: { poll_interval: 500 } })
		try {
			await mock.close() // every subsequent real poll now fails fast (connection refused)
			instance.pollFailureCount = 0

			const callTimes = []
			const originalPollAll = instance.pollAll.bind(instance)
			instance.pollAll = (...args) => {
				callTimes.push(Date.now())
				return originalPollAll(...args)
			}

			instance.initInterval() // (re)start the real chain against the small base interval
			// expected real schedule: ~500ms, ~1000ms, ~2000ms after start (base, then doubling per failure)
			await new Promise((resolve) => setTimeout(resolve, 4200))

			assert.ok(callTimes.length >= 3, `expected at least a few real polls, got ${callTimes.length}`)
			// a fixed setInterval(pollAll, 500) would fire ~8 times in 4200ms; backoff must hold it well below that
			assert.ok(
				callTimes.length <= 5,
				`backoff should hold the real timer well below a fixed 500 ms cadence, got ${callTimes.length} calls in 4200ms`,
			)
			const gaps = []
			for (let i = 1; i < callTimes.length; i++) gaps.push(callTimes[i] - callTimes[i - 1])
			// each real gap should be at least as wide as the one before it (the doubling backoff), allowing
			// a little slack for scheduler jitter
			for (let i = 1; i < gaps.length; i++) {
				assert.ok(
					gaps[i] >= gaps[i - 1] - 50,
					`expected real gaps to grow (D8 backoff), got ${gaps.join(', ')}`,
				)
			}
			assert.ok(
				gaps[gaps.length - 1] >= gaps[0] * 1.5,
				`expected the last real gap to be clearly wider than the first, got ${gaps.join(', ')}`,
			)
		} finally {
			await instance.destroy()
		}
	})
})

describe('D8 poll interval and failure backoff', () => {
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

	it('pollIntervalMs reads config.poll_interval, clamped 500..300000', () => {
		instance.config.poll_interval = 2000
		assert.equal(instance.pollIntervalMs(), 2000)
		instance.config.poll_interval = 50
		assert.equal(instance.pollIntervalMs(), 500)
		instance.config.poll_interval = 999999
		assert.equal(instance.pollIntervalMs(), 300000)
		instance.config.poll_interval = 2000
	})

	it('nextPollDelayMs doubles per consecutive failure, capped at 15 s, base while healthy', () => {
		instance.pollFailureCount = 0
		assert.equal(instance.nextPollDelayMs(), instance.pollIntervalMs())
		instance.pollFailureCount = 1
		assert.equal(instance.nextPollDelayMs(), instance.pollIntervalMs() * 2)
		instance.pollFailureCount = 2
		assert.equal(instance.nextPollDelayMs(), instance.pollIntervalMs() * 4)
		instance.pollFailureCount = 10
		assert.equal(instance.nextPollDelayMs(), 15000)
		instance.pollFailureCount = 0
	})

	it('a real failed poll increments pollFailureCount; a success resets it to 0', async () => {
		assert.equal(instance.pollFailureCount, 0)
		await mock.close()
		await instance.pollAll()
		assert.equal(instance.pollFailureCount, 1)
		await instance.pollAll()
		assert.equal(instance.pollFailureCount, 2)
		assert.equal(instance.nextPollDelayMs(), Math.min(15000, instance.pollIntervalMs() * 4))

		const restarted = await startMockPearl({ port: mock.port })
		try {
			await instance.pollAll()
			assert.equal(instance.pollFailureCount, 0, 'reset by the first successful poll')
			assert.equal(instance.nextPollDelayMs(), instance.pollIntervalMs())
		} finally {
			await restarted.close()
		}
	})

	it('configUpdated() resets the failure count instead of inheriting the old backoff', async () => {
		const { DEFAULT_CONFIG } = require('./harness')
		const fresh = await startMockPearl()
		try {
			instance.pollFailureCount = 5
			await instance.configUpdated({ ...DEFAULT_CONFIG, host_port: fresh.port })
			await instance.startupPromise
			assert.equal(instance.pollFailureCount, 0)
		} finally {
			await fresh.close()
		}
	})
})

describe('variables across polls', () => {
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

	it('definitions are not re-set while the variable set is unchanged', async () => {
		const defs = countCalls(instance, 'setVariableDefinitions')
		const values = countCalls(instance, 'setVariableValues')
		await instance.pollAll()
		await instance.pollAll()
		assert.equal(defs.n, 0)
		assert.equal(values.n, 2)
	})

	it('definitions are re-set once when an entity appears, and again when it disappears', async () => {
		const defs = countCalls(instance, 'setVariableDefinitions')
		mock.state.recorders['3'] = { id: '3', name: 'Extra', multisource: false, status: { state: 'stopped' } }
		await instance.pollAll()
		await instance.pollAll()
		assert.equal(defs.n, 1)
		assert.equal(instance.variableValues.recorder_3_name, 'Extra')
		delete mock.state.recorders['3']
		await instance.pollAll()
		assert.equal(defs.n, 2)
		assert.ok(!instance.definitions.variables.some((d) => d.variableId === 'recorder_3_name'))
	})

	it('odd entity ids are sanitised', async () => {
		mock.state.inputs['D2P496187.hdmi b'] = {
			id: 'D2P496187.hdmi b',
			name: 'Odd',
			real_device_name: 'Odd',
			audio: true,
			video: true,
			type: 'usb',
			settings: { audio: { delay: 0 } },
		}
		await instance.pollAll()
		for (const def of instance.definitions.variables) assert.match(def.variableId, VARIABLE_ID_RE, def.variableId)
		assert.equal(instance.variableValues.input_D2P496187_hdmi_b_name, 'Odd')
		assert.ok(instance.definitions.presets['previews_input_D2P496187_hdmi_b'])
		assert.equal(
			instance.definitions.presets['previews_input_D2P496187_hdmi_b'].style.text,
			'$(pearl:input_D2P496187_hdmi_b_name)',
		)
		delete mock.state.inputs['D2P496187.hdmi b']
		await instance.pollAll()
	})

	it('a real 0 is reported as 0, not as empty', async () => {
		mock.state.systemStatus.cpuload = 0
		mock.state.recorders['1'].status.duration = 0
		await instance.pollAll()
		assert.equal(instance.variableValues.cpu_load, 0)
		assert.equal(instance.variableValues.recorder_1_duration, 0)
		assert.equal(instance.variableValues.recorder_1_duration_hms, '00:00:00')
		mock.reset()
		await instance.pollAll()
	})
})

describe('poller resilience', () => {
	it('keeps the previous state and reports ConnectionFailure when the device disappears', async () => {
		const mock = await startMockPearl()
		const instance = await createInstance({ mock, config: { timeout: 1000 } })
		try {
			assert.equal(Object.keys(instance.state.channels).length, 2)
			await mock.close()
			instance.calls.log.length = 0
			await instance.pollAll()
			assert.equal(Object.keys(instance.state.channels).length, 2)
			assert.equal(instance.state.channels['1'].publishers['1'].status.state, 'started')
			assert.equal(instance.currentStatus, InstanceStatus.ConnectionFailure)
			assert.equal(instance.calls.log.filter((l) => l.level === 'error').length, 1)
			// second failure is not logged at error level again
			await instance.pollAll()
			assert.equal(instance.calls.log.filter((l) => l.level === 'error').length, 1)
		} finally {
			await instance.destroy()
		}
	})

	it('recovers when the device comes back', async () => {
		const mock = await startMockPearl()
		const instance = await createInstance({ mock, config: { timeout: 1000 } })
		const port = mock.port
		try {
			await mock.close()
			await instance.pollAll()
			assert.equal(instance.currentStatus, InstanceStatus.ConnectionFailure)
			const again = await startMockPearl({ port })
			try {
				instance.calls.log.length = 0
				await instance.pollAll()
				assert.equal(instance.currentStatus, InstanceStatus.Ok)
				assert.ok(instance.calls.log.some((l) => l.level === 'info' && /restored/.test(l.message)))
			} finally {
				await again.close()
			}
		} finally {
			await instance.destroy()
		}
	})
})

describe('preview image fetching: concurrency cap and failure visibility', () => {
	let mock
	let instance

	before(async () => {
		mock = await startMockPearl()
		instance = await createInstance({ mock, config: { preview_interval: 1 } })
	})

	after(async () => {
		await instance.destroy()
		await mock.close()
	})

	it('fetches only a few images at a time, not every subscribed key at once', async () => {
		// eight placed preview buttons is a realistic page; firing eight simultaneous requests at the
		// device is what caused most of them to come back blank on real hardware
		const keys = Array.from({ length: 8 }, (_, i) => `channel:${i}`)
		instance.previewSubscriptions = new Map(keys.map((k) => [k, 1]))
		instance.previews = {}

		let active = 0
		let maxActive = 0
		instance.fetchPreviewImage = async () => {
			active++
			maxActive = Math.max(maxActive, active)
			await new Promise((resolve) => setTimeout(resolve, 5))
			active--
			return 'AAAA'
		}
		try {
			await instance.pollPreviews()
			assert.ok(maxActive <= 3, `expected at most 3 concurrent fetches, saw ${maxActive}`)
			assert.equal(Object.keys(instance.previews).length, 8, 'every subscribed key is still fetched eventually')
		} finally {
			delete instance.fetchPreviewImage
		}
	})

	it('logs a warning once while a preview stays unreachable, and once more when it recovers', async () => {
		instance.previewSubscriptions = new Map([['channel:1', 1]])
		instance.previews = {}
		instance.previewFailedKeys.clear()
		instance.calls.log.length = 0

		let fail = true
		instance.fetchPreviewImage = async () => (fail ? null : 'AAAA')
		try {
			await instance.pollPreviews()
			await instance.pollPreviews()
			await instance.pollPreviews()
			const warnings = instance.calls.log.filter(
				(l) => l.level === 'warn' && /could not be fetched/.test(l.message),
			)
			assert.equal(warnings.length, 1, 'a persistent failure is logged once, not on every poll')
			assert.ok(instance.previewFailedKeys.has('channel:1'))

			instance.calls.log.length = 0
			fail = false
			await instance.pollPreviews()
			assert.ok(instance.calls.log.some((l) => l.level === 'info' && /available again/.test(l.message)))
			assert.equal(instance.previewFailedKeys.has('channel:1'), false)

			// a second success in a row must not log a second recovery
			instance.calls.log.length = 0
			await instance.pollPreviews()
			assert.ok(!instance.calls.log.some((l) => l.level === 'info' && /available again/.test(l.message)))
		} finally {
			delete instance.fetchPreviewImage
		}
	})

	it('output_set is rechecked while the 5 s window could still be closing, and left alone otherwise', async () => {
		instance.checkedFeedbacks.length = 0
		// nothing was ever set: no extra check
		await instance.pollAll()
		assert.ok(!instance.checkedFeedbacks.flat().includes('output_set'))

		instance.state.outputs.D1.source = 'console'
		instance.state.outputs.D1.setAt = Date.now()
		instance.checkedFeedbacks.length = 0
		await instance.pollAll()
		assert.ok(
			instance.checkedFeedbacks.flat().includes('output_set'),
			'rechecked while the window could still close',
		)

		// past the 5 s window plus one full poll_interval's margin (the harness's default poll_interval
		// is 300000 ms, so the margin itself is generous - go well past it)
		instance.state.outputs.D1.setAt = Date.now() - (5000 + instance.pollIntervalMs() + 60000)
		instance.checkedFeedbacks.length = 0
		await instance.pollAll()
		assert.ok(
			!instance.checkedFeedbacks.flat().includes('output_set'),
			'the window has long closed, no more checks',
		)
	})
})
