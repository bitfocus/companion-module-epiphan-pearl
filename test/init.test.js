const { describe, it, before, after } = require('node:test')
const assert = require('node:assert/strict')

const { createInstance, InstanceStatus, DEFAULT_CONFIG, subscribeFeedback, runFeedback } = require('./harness')
const { startMockPearl } = require('./mock-pearl')

const VARIABLE_ID_RE = /^[a-zA-Z0-9_-]+$/

function lastStatus(instance) {
	return instance.calls.status[instance.calls.status.length - 1]
}

describe('init against a v2.0 device', () => {
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

	it('selects the v2.0 API base', () => {
		assert.equal(instance.apiBasePath, '/api/v2.0')
		assert.equal(instance.isV2, true)
		const probe = mock.requests.find((r) => r.path === '/api/v2.0/system/firmware/version')
		assert.ok(probe, 'firmware version probe was sent')
	})

	it('reports status Ok', () => {
		assert.equal(lastStatus(instance).status, InstanceStatus.Ok)
		assert.equal(instance.currentStatus, InstanceStatus.Ok)
	})

	it('populates every state domain', () => {
		const s = instance.state
		assert.deepEqual(Object.keys(s.channels).sort(), ['1', '2'])
		assert.equal(s.channels['1'].name, 'HDMI-A')
		assert.deepEqual(Object.keys(s.channels['1'].layouts).sort(), ['1', '2'])
		assert.equal(s.channels['1'].layouts['1'].active, true)
		assert.equal(s.channels['1'].layouts['2'].active, false)
		assert.equal(s.channels['1'].active_layout.id, '1')
		assert.deepEqual(Object.keys(s.channels['1'].publishers).sort(), ['0', '1'])
		assert.equal(s.channels['1'].publishers['1'].status.state, 'started')
		assert.equal(s.channels['1'].publishers['0'].type, 'rtmp')
		assert.equal(s.channels['1'].encoders.length, 2)
		assert.deepEqual(Object.keys(s.channels['2'].publishers), [])

		assert.deepEqual(Object.keys(s.recorders).sort(), ['1', '2', 'm1'])
		assert.equal(s.recorders['1'].status.state, 'started')
		assert.equal(s.recorders['m1'].multisource, true)
		assert.equal(s.recorders['1'].lastFile.name, 'HDMI-A_Dec11_17-32-30')

		assert.deepEqual(Object.keys(s.inputs).sort(), ['SRT1', 'USBA', 'analog-a', 'hdmi-a'])
		assert.equal(s.inputs['analog-a'].audio, true)
		assert.deepEqual(Object.keys(s.outputs), ['D1'])
		assert.equal(s.outputs.D1.source, undefined)
		assert.deepEqual(Object.keys(s.storages).sort(), ['external', 'main', 'maintenance'])
		assert.equal(s.storages.main.status.state, 'ready')
		assert.deepEqual(Object.keys(s.singleTouch), ['0'])
		assert.equal(s.singleTouch['0'].state.pressed, false)
		assert.deepEqual(
			s.presets.map((p) => p.name),
			['Default', 'Show A'],
		)
		assert.equal(s.events.upcoming.title, 'Example event')
		assert.equal(s.events.ongoing, null)
		assert.equal(s.afu[0].status.state, 'idle')
		assert.equal(s.systemStatus.cpuload, 25)
		assert.equal(s.firmware.version, '4.24.1')
		assert.equal(s.identity.name, 'Pearl Mini')
	})

	it('sends the v2 boolean flags to GET /channels', () => {
		const req = mock.requests.find((r) => r.method === 'GET' && r.path === '/api/v2.0/channels')
		assert.ok(req)
		assert.deepEqual(req.query, {
			publishers: 'true',
			'publishers-status': 'true',
			encoders: 'true',
			active_layout: 'true',
		})
	})

	it('fetches the legacy layouts and metadata per channel', () => {
		assert.ok(mock.requests.some((r) => r.path === '/api/channels/1/layouts'))
		assert.ok(mock.requests.some((r) => r.path === '/api/channels/2/layouts'))
		assert.ok(mock.requests.some((r) => r.path === '/admin/channel1/get_params.cgi'))
		assert.deepEqual(instance.metadata['1'], { title: 'Morning Show', author: 'Epiphan', rec_prefix: 'HDMI-A' })
	})

	it('exposes the expected variable values', () => {
		const v = instance.variableValues
		assert.equal(v.channel_1_name, 'HDMI-A')
		assert.equal(v.channel_1_active_layout, 'Default')
		assert.equal(v.channel_1_active_layout_id, '1')
		assert.equal(v.channel_1_resolution, '1920x1080')
		assert.equal(v.channel_1_publishers_count, 2)
		assert.equal(v.channel_1_streaming_count, 1)
		assert.equal(v.channel_1_metadata_title, 'Morning Show')
		assert.equal(v.stream_1_1_state, 'started')
		assert.equal(v.stream_1_1_bitrate, 3.61)
		assert.equal(v.stream_1_1_type, 'srt')
		assert.equal(v.stream_1_1_duration_hms, '00:03:08')
		assert.equal(v.stream_1_0_state, 'stopped')
		assert.equal(v.recorder_1_state, 'started')
		assert.equal(v.recorder_1_duration, 58)
		assert.equal(v.recorder_1_duration_hms, '00:00:58')
		assert.equal(v.recorder_1_last_file_name, 'HDMI-A_Dec11_17-32-30.mp4')
		assert.equal(v.recorder_1_last_file_size_mb, 388.3)
		assert.equal(v.recorders_active_count, 1)
		assert.equal(v.publishers_active_count, 1)
		assert.equal(v['input_hdmi-a_name'], 'HDMI-A')
		assert.equal(v['input_analog-a_type'], 'embedded')
		assert.equal(v.output_D1_name, 'HDMI')
		assert.equal(v.output_D1_source, '')
		assert.equal(v.storage_main_state, 'ready')
		assert.equal(v.storage_main_free_percent, 74.8)
		assert.equal(v.storage_main_total_gb, 14.7)
		assert.equal(v.storage_external_free_percent, '')
		assert.equal(v.stc_0_pressed, false)
		assert.equal(v.stc_0_status, true)
		assert.equal(v.stc_0_recorders_total, 3)
		assert.equal(v.event_upcoming_title, 'Example event')
		assert.equal(v.event_upcoming_id, '782ec0f4bbcc48e2a42a44eea5e69dc5')
		assert.match(String(v.event_upcoming_starts_in_hms), /^00:(59|60):\d\d$|^01:00:00$/)
		assert.equal(v.event_ongoing_title, '')
		assert.equal(v.afu_state, 'idle')
		assert.equal(v.afu_protocol, 'webdav')
		assert.equal(v.firmware_version, '4.24.1')
		assert.equal(v.product_name, 'Pearl Mini')
		assert.equal(v.product_id, 44)
		assert.equal(v.identity_name, 'Pearl Mini')
		assert.equal(v.system_status_cpuload, 25)
		assert.equal(v.system_status_uptime_hms, '01:31:30')
		assert.equal(v.config_presets, 'Default,Show A')
		assert.equal(v.connectivity_external_ip, '')
	})

	it('every variable id is valid and has a defined value', () => {
		const defs = instance.definitions.variables
		assert.ok(defs.length > 100, `expected >100 variables, got ${defs.length}`)
		const ids = new Set()
		for (const def of defs) {
			assert.match(def.variableId, VARIABLE_ID_RE, def.variableId)
			assert.ok(!ids.has(def.variableId), `duplicate id ${def.variableId}`)
			ids.add(def.variableId)
			assert.ok(typeof def.name === 'string' && def.name.length > 0)
			assert.notEqual(instance.variableValues[def.variableId], undefined, `${def.variableId} has no value`)
		}
	})

	it('defines all actions, feedbacks and presets consistently', () => {
		const actions = instance.definitions.actions
		const feedbacks = instance.definitions.feedbacks
		const presets = instance.definitions.presets

		assert.equal(Object.keys(actions).length, 36)
		assert.equal(Object.keys(feedbacks).length, 21)
		for (const [id, def] of Object.entries(actions)) {
			assert.equal(typeof def.callback, 'function', `action ${id} callback`)
			assert.ok(Array.isArray(def.options), `action ${id} options`)
			assert.ok(def.name, `action ${id} name`)
		}
		for (const [id, def] of Object.entries(feedbacks)) {
			assert.equal(typeof def.callback, 'function', `feedback ${id} callback`)
			assert.ok(['boolean', 'advanced'].includes(def.type), `feedback ${id} type`)
			if (def.type === 'boolean') assert.ok(def.defaultStyle, `feedback ${id} defaultStyle`)
		}

		const optionIds = (def) => new Set(def.options.map((o) => o.id))
		assert.ok(Object.keys(presets).length >= 40, `expected >=40 presets, got ${Object.keys(presets).length}`)
		for (const [id, preset] of Object.entries(presets)) {
			assert.match(id, VARIABLE_ID_RE, `preset id ${id}`)
			assert.equal(preset.type, 'button')
			assert.ok(preset.name && !('label' in preset), `preset ${id} uses name`)
			for (const step of preset.steps) {
				for (const action of [...step.down, ...step.up]) {
					const def = actions[action.actionId]
					assert.ok(def, `preset ${id} references unknown action ${action.actionId}`)
					const ids = optionIds(def)
					for (const key of Object.keys(action.options)) {
						assert.ok(ids.has(key), `preset ${id}: action ${action.actionId} has no option ${key}`)
					}
				}
			}
			for (const fb of preset.feedbacks) {
				const def = feedbacks[fb.feedbackId]
				assert.ok(def, `preset ${id} references unknown feedback ${fb.feedbackId}`)
				const ids = optionIds(def)
				for (const key of Object.keys(fb.options)) {
					assert.ok(ids.has(key), `preset ${id}: feedback ${fb.feedbackId} has no option ${key}`)
				}
			}
			// every $(pearl:var) in the text must be a defined variable
			const text = String(preset.style.text)
			for (const m of text.matchAll(/\$\(pearl:([^)]+)\)/g)) {
				assert.notEqual(instance.variableValues[m[1]], undefined, `preset ${id} uses unknown variable ${m[1]}`)
			}
		}
		const categories = new Set(Object.values(presets).map((p) => p.category))
		for (const cat of [
			'Channels',
			'Publishers',
			'Recorders',
			'Outputs',
			'Inputs',
			'Previews',
			'Single touch',
			'Storage',
			'System',
			'Events',
			'AFU',
			'Config presets',
		]) {
			assert.ok(categories.has(cat), `missing preset category ${cat}`)
		}
	})

	it('sends HTTP basic authentication on every request', () => {
		assert.ok(mock.requests.length > 0)
		const expected = 'Basic ' + Buffer.from('admin:x').toString('base64')
		for (const req of mock.requests) {
			assert.equal(req.headers.authorization, expected, `${req.method} ${req.path}`)
		}
	})
})

describe('init against a legacy-only device (firmware 4.20.0)', () => {
	let mock
	let instance

	before(async () => {
		mock = await startMockPearl({ firmware: '4.20.0', legacyOnly: true })
		instance = await createInstance({ mock })
	})

	after(async () => {
		await instance.destroy()
		await mock.close()
	})

	it('falls back to the legacy API base', () => {
		assert.equal(instance.apiBasePath, '/api')
		assert.equal(instance.isV2, false)
		assert.equal(instance.currentStatus, InstanceStatus.Ok)
		assert.ok(instance.calls.log.some((l) => l.level === 'info' && /legacy API/.test(l.message)))
	})

	it('has channels, layouts, publishers and recorders', () => {
		const s = instance.state
		assert.deepEqual(Object.keys(s.channels).sort(), ['1', '2'])
		assert.equal(s.channels['1'].layouts['1'].active, true)
		assert.equal(s.channels['1'].active_layout.id, '1')
		assert.equal(s.channels['1'].publishers['1'].status.state, 'started')
		assert.equal(s.channels['1'].publishers['1'].type, 'srt')
		assert.equal(s.channels['1'].publishers['0'].name, 'Stream 1')
		assert.deepEqual(Object.keys(s.recorders).sort(), ['1', '2', 'm1'])
		assert.equal(s.recorders['1'].status.state, 'started')
		// v2-only domains stay empty
		assert.deepEqual(s.inputs, {})
		assert.deepEqual(s.outputs, {})
		assert.deepEqual(s.storages, {})
		assert.equal(s.systemStatus, undefined)
		assert.equal(instance.variableValues.stream_1_1_state, 'started')
		assert.equal(instance.variableValues.firmware_version, '')
	})

	it('uses the v1 flags and per-channel publisher endpoints', () => {
		const channels = mock.requests.find((r) => r.method === 'GET' && r.path === '/api/channels')
		assert.ok(channels)
		assert.deepEqual(channels.query, { publishers: 'yes', encoders: 'yes' })
		assert.ok(mock.requests.some((r) => r.path === '/api/channels/1/publishers/type'))
		assert.ok(mock.requests.some((r) => r.path === '/api/channels/1/publishers/status'))
		assert.ok(mock.requests.some((r) => r.path === '/api/recorders/status'))
	})

	it('makes no v2-only requests', () => {
		const v2 = mock.requests.filter((r) => r.path.startsWith('/api/v2.0/'))
		assert.deepEqual(
			v2.map((r) => r.path),
			['/api/v2.0/system/firmware/version'],
		)
		const forbidden =
			/\/(inputs|outputs|system\/status|system\/storages|system\/singletouchcontrol|schedule|afu|system\/presets|system\/firmware$|system\/ident)/
		for (const req of mock.requests) {
			if (req.path === '/api/v2.0/system/firmware/version') continue
			assert.doesNotMatch(req.path, forbidden, `${req.method} ${req.path}`)
		}
	})
})

describe('init edge cases', () => {
	it('uses the legacy API when use_api_v2 is disabled', async () => {
		const mock = await startMockPearl()
		const instance = await createInstance({ mock, config: { use_api_v2: false } })
		try {
			assert.equal(instance.apiBasePath, '/api')
			assert.ok(!mock.requests.some((r) => r.path.startsWith('/api/v2.0/')))
			assert.equal(Object.keys(instance.state.channels).length, 2)
		} finally {
			await instance.destroy()
			await mock.close()
		}
	})

	it('sets BadConfig for an invalid host and keeps the config', async () => {
		const mock = await startMockPearl()
		const instance = await createInstance({ mock, config: { host: 'not a host!' } })
		try {
			assert.equal(instance.currentStatus, InstanceStatus.BadConfig)
			assert.equal(instance.config.host, 'not a host!')
			assert.equal(mock.requests.length, 0)
			assert.equal(instance.timer, undefined)
		} finally {
			await instance.destroy()
			await mock.close()
		}
	})

	it('sets BadConfig for an invalid port', async () => {
		const mock = await startMockPearl()
		const instance = await createInstance({ mock, config: { host_port: '70000' } })
		try {
			assert.equal(instance.currentStatus, InstanceStatus.BadConfig)
		} finally {
			await instance.destroy()
			await mock.close()
		}
	})

	it('normalises out-of-range numeric config values', async () => {
		const mock = await startMockPearl()
		const instance = await createInstance({
			mock,
			config: { pollfreq: 9999, timeout: 10, preview_width: 10, preview_interval: -1 },
		})
		try {
			assert.equal(instance.config.pollfreq, 300)
			assert.equal(instance.config.timeout, 1000)
			assert.equal(instance.config.preview_width, 72)
			assert.equal(instance.config.preview_interval, 0)
		} finally {
			await instance.destroy()
			await mock.close()
		}
	})

	it('destroy stops timers and reports Disconnected', async () => {
		const mock = await startMockPearl()
		const instance = await createInstance({ mock })
		assert.ok(instance.timer)
		await instance.destroy()
		assert.equal(instance.timer, undefined)
		assert.equal(instance.currentStatus, InstanceStatus.Disconnected)
		await mock.close()
	})

	it('a bad config still publishes action, feedback and preset definitions', async () => {
		const mock = await startMockPearl()
		const instance = await createInstance({ mock, config: { host: 'not a host!' } })
		try {
			assert.equal(instance.currentStatus, InstanceStatus.BadConfig)
			assert.ok(instance.definitions.actions.refreshPoll, 'actions defined')
			assert.ok(instance.definitions.feedbacks.channelPreview, 'feedbacks defined')
			assert.equal(typeof instance.definitions.presets, 'object')
			assert.equal(mock.requests.length, 0)
		} finally {
			await instance.destroy()
			await mock.close()
		}
	})
})

describe('configUpdated', () => {
	it('keeps preview subscriptions and enables previews without a restart', async () => {
		const mock = await startMockPearl()
		const instance = await createInstance({ mock }) // DEFAULT_CONFIG has preview_interval 0
		try {
			await subscribeFeedback(instance, 'channelPreview', { channel: '1' })
			assert.equal(instance.previewSubscriptions.get('channel:1'), 1)
			assert.equal(instance.previewTimer, undefined)
			assert.deepEqual(await runFeedback(instance, 'channelPreview', { channel: '1' }), {})

			mock.requests.length = 0
			await instance.configUpdated({ ...DEFAULT_CONFIG, host_port: mock.port, preview_interval: 1 })
			await instance.startupPromise

			assert.ok(instance.previewTimer, 'preview timer started')
			assert.equal(instance.previewSubscriptions.get('channel:1'), 1, 'subscription preserved')
			// Companion is asked to re-send subscribe() for the placed preview feedbacks
			assert.deepEqual(instance.subscribeFeedbacksCalls.at(-1), [
				'channelPreview',
				'inputPreview',
				'outputPreview',
				'channelLayoutPreview',
			])
			await instance.pollPreviews()
			assert.ok(mock.requests.some((r) => r.path === '/api/v2.0/channels/1/preview'))
			const result = await runFeedback(instance, 'channelPreview', { channel: '1' })
			assert.equal(typeof result.png64, 'string')
		} finally {
			await instance.destroy()
			await mock.close()
		}
	})

	it('returns before the device is contacted, discards a stale poll and rebuilds the definitions', async () => {
		const mock = await startMockPearl()
		const instance = await createInstance({ mock })
		try {
			assert.equal(
				instance.systemUpdateCount,
				2,
				'init published empty definitions, then the first poll rebuilt them',
			)
			assert.equal(instance.pollCounter, 1)

			const running = instance.pollAll()
			assert.ok(instance.pollPromise)
			const update = instance.configUpdated({ ...DEFAULT_CONFIG, host_port: mock.port, pollfreq: 200 })
			await update
			assert.equal(instance.timer, undefined, 'configUpdated returned before the device was contacted')
			await Promise.all([running, instance.startupPromise])

			assert.equal(instance.config.pollfreq, 200)
			assert.equal(instance.pollCounter, 1, 'the poll that was running during the change does not count')
			assert.equal(Object.keys(instance.state.channels).length, 2)
			assert.equal(instance.systemUpdateCount, 4, 'empty definitions plus the first poll of the new config')
			assert.equal(instance.currentStatus, InstanceStatus.Ok)
			assert.deepEqual(
				instance.calls.log.filter((l) => l.level === 'error'),
				[],
			)
			assert.ok(instance.timer)
		} finally {
			await instance.destroy()
			await mock.close()
		}
	})

	it('resets the state for the new device and switches the API base', async () => {
		const v2 = await startMockPearl()
		const legacy = await startMockPearl({ legacyOnly: true, firmware: '4.20.0' })
		const instance = await createInstance({ mock: v2 })
		try {
			assert.equal(instance.apiBasePath, '/api/v2.0')
			legacy.requests.length = 0
			await instance.configUpdated({ ...DEFAULT_CONFIG, host_port: legacy.port })
			await instance.startupPromise
			assert.equal(instance.apiBasePath, '/api')
			assert.equal(Object.keys(instance.state.inputs).length, 0, 'no v2 state left over')
			assert.ok(legacy.requests.some((r) => r.path === '/api/channels'))
		} finally {
			await instance.destroy()
			await v2.close()
			await legacy.close()
		}
	})
})
