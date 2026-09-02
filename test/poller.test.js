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

describe('poller diffing', () => {
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

	it('a publisher state change re-checks only the publisher feedbacks', async () => {
		instance.checkedFeedbacks.length = 0
		mock.state.channels['1'].publishers['0'].status = { is_configured: true, started: true, state: 'started' }
		await instance.pollAll()
		assert.equal(instance.checkedFeedbacks.length, 1)
		const ids = instance.checkedFeedbacks[0]
		assert.ok(ids.includes('streamingState'))
		assert.ok(ids.includes('publisherState'))
		assert.ok(ids.includes('anyStreaming'))
		assert.ok(!ids.includes('recorderRecording'))
		assert.ok(!ids.includes('channelLayout'))
		assert.equal(instance.variableValues.stream_1_0_state, 'started')
	})

	it('a state change through the mock HTTP API is picked up on the next poll', async () => {
		instance.checkedFeedbacks.length = 0
		const res = await fetch(`${mock.url}/api/v2.0/recorders/2/control/start`, {
			method: 'POST',
			headers: { Authorization: 'Basic ' + Buffer.from('admin:x').toString('base64') },
		})
		assert.equal(res.status, 200)
		await instance.pollAll()
		assert.equal(instance.state.recorders['2'].status.state, 'started')
		const ids = instance.checkedFeedbacks.flat()
		assert.ok(ids.includes('recorderRecording'))
		assert.ok(ids.includes('recorderState'))
		assert.ok(ids.includes('anyRecording'))
		assert.ok(!ids.includes('streamingState'))
	})

	it('layout, storage, single touch, system, afu and event changes map to their feedback ids', async () => {
		const check = async (mutate, expected) => {
			instance.checkedFeedbacks.length = 0
			mutate()
			await instance.pollAll()
			const ids = new Set(instance.checkedFeedbacks.flat())
			for (const id of expected) assert.ok(ids.has(id), `expected ${id} in ${[...ids]}`)
		}
		await check(() => {
			for (const l of mock.state.channels['1'].layouts) l.active = l.id === '2'
		}, ['channelLayout'])
		await check(() => {
			mock.state.storages.main.free = 5e8
		}, ['storageState', 'storageFreeBelow'])
		await check(() => {
			mock.state.singleTouch['0'].pressed = true
		}, ['singleTouchPressed', 'singleTouchOk'])
		await check(() => {
			mock.state.systemStatus.cpuload = 95
			mock.state.systemStatus.cpuload_high = true
		}, ['cpuLoadHigh', 'cpuTempHigh'])
		await check(() => {
			mock.state.afu[0].status.state = 'uploading'
		}, ['afuState'])
		await check(() => {
			mock.state.events[0].status = 'running'
		}, ['eventStatus'])
		assert.equal(instance.variableValues.channel_1_active_layout, 'Picture in picture')
		assert.equal(instance.variableValues.system_cpuload_high, true)
		assert.equal(instance.variableValues.afu_state, 'uploading')
		assert.equal(instance.variableValues.event_ongoing_status, 'running')
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
		const layoutChoices = instance.definitions.actions.channelChangeLayout.options[0].choices
		assert.ok(layoutChoices.some((c) => c.label === 'Renamed channel - Default'))
		assert.ok(instance.definitions.presets['channels_layout_1-1'])
		assert.equal(instance.definitions.presets['channels_layout_1-1'].name, 'Renamed channel - Default')
		assert.equal(instance.variableValues.channel_1_name, 'Renamed channel')
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
		assert.ok(instance.definitions.presets['publishers_toggle_2-0'])
		assert.equal(instance.variableValues.stream_2_0_type, 'hls')
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
		const presets = mock.requests.find((r) => r.path === '/api/v2.0/system/presets')
		assert.deepEqual(presets.query, { details: 'true' })
	})

	it('overlapping polls are skipped', async () => {
		mock.requests.length = 0
		const first = instance.pollAll()
		const second = instance.pollAll()
		await Promise.all([first, second])
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

describe('poller options', () => {
	it('poll_events false skips the schedule and poll_archive false skips the archive', async () => {
		const mock = await startMockPearl()
		const instance = await createInstance({ mock, config: { poll_events: false, poll_archive: false } })
		try {
			assert.ok(!mock.requests.some((r) => r.path.startsWith('/api/v2.0/schedule/')))
			assert.ok(!mock.requests.some((r) => /\/archive\/files$/.test(r.path)))
			assert.equal(instance.state.events.upcoming, null)
			assert.equal(instance.variableValues.recorder_1_last_file_name, undefined)
			assert.equal(instance.variableValues.event_upcoming_title, '')
		} finally {
			await instance.destroy()
			await mock.close()
		}
	})

	it('poll_connectivity fetches the connectivity details on the first and every 6th poll', async () => {
		const mock = await startMockPearl()
		const instance = await createInstance({ mock, config: { poll_connectivity: true } })
		try {
			assert.ok(mock.requests.some((r) => r.path === '/api/v2.0/system/connectivity/details'))
			assert.equal(instance.variableValues.connectivity_external_ip, '174.115.41.91')
			mock.requests.length = 0
			await instance.pollAll() // poll 2
			assert.ok(!mock.requests.some((r) => r.path === '/api/v2.0/system/connectivity/details'))
			assert.equal(instance.variableValues.connectivity_external_ip, '174.115.41.91')
			instance.pollCounter = 6
			mock.requests.length = 0
			await instance.pollAll() // poll 7
			assert.ok(mock.requests.some((r) => r.path === '/api/v2.0/system/connectivity/details'))
		} finally {
			await instance.destroy()
			await mock.close()
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

	it('definitions are re-set once when an entity appears', async () => {
		const defs = countCalls(instance, 'setVariableDefinitions')
		mock.state.recorders['3'] = { id: '3', name: 'Extra', multisource: false, status: { state: 'stopped' } }
		mock.state.archive['3'] = []
		await instance.pollAll()
		await instance.pollAll()
		assert.equal(defs.n, 1)
		assert.equal(instance.variableValues.recorder_3_name, 'Extra')
		assert.equal(instance.variableValues.recorder_3_last_file_name, '')
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
		assert.equal(instance.variableValues.input_D2P496187_hdmi_b_type, 'usb')
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
		assert.equal(instance.variableValues.system_status_cpuload, 0)
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
