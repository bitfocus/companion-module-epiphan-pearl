/**
 * The target variable set: the exact id set for the seeded mock (and that no legacy id remains), the
 * word/format rules and the clock-skew countdown.
 */
const { describe, it, before, after } = require('node:test')
const assert = require('node:assert/strict')

const { createInstance } = require('./harness')
const { startMockPearl } = require('./mock-pearl')
const { buildVariables } = require('../src/variables')
const { emptyState } = require('../src/utils')

/**
 * Build the exact set of variable ids the module documents for a given instance state,
 * from the state's own entity ids (not a hand-typed literal) so this stays in step with whichever
 * recorders/channels/inputs/etc. the mock happens to seed.
 */
function expectedVariableIds(state) {
	const ids = new Set([
		'cpu_load',
		'cpu_temp',
		'uptime_seconds',
		'uptime',
		'system_status_text',
		'cpu_load_high',
		'cpu_temp_high',
		'afu_state',
		'afu_text',
		'afu_protocol',
		'afu_queue_files',
		'afu_error',
		'product_name',
		'firmware',
		'device_name',
		'api_version',
		'recorder_all_state_word',
		'recorders_active_count',
		'event_upcoming_id',
		'event_upcoming_title',
		'event_upcoming_start',
		'event_upcoming_start_time',
		'event_upcoming_starts_in_hms',
		'event_upcoming_time_text',
		'event_upcoming_state_word',
		'event_ongoing_id',
		'event_ongoing_title',
		'event_ongoing_status',
		'event_ongoing_finish',
		'event_ongoing_finish_time',
		'event_ongoing_remaining_hms',
		'event_ongoing_time_text',
		'event_ongoing_state_word',
		'event_ongoing_toggle_command',
		'event_title',
		'event_state',
		'event_remaining',
		'preset_names',
		'preset_last_applied',
		'preset_status',
		'power_status',
		'confirm_hint',
		'last_error',
	])
	for (const stid of Object.keys(state.storages || {})) {
		for (const suffix of [
			'state',
			'free',
			'total',
			'used_pct',
			'text',
			'level_word',
			'total_gb',
			'used_gb',
			'free_gb',
			'free_pct',
			'remaining_time',
			'remaining_minutes',
		]) {
			ids.add(`storage_${stid}_${suffix}`)
		}
	}
	for (const rid of Object.keys(state.recorders || {})) {
		for (const suffix of ['name', 'state', 'state_word', 'duration', 'duration_text', 'duration_hms']) {
			ids.add(`recorder_${rid}_${suffix}`)
		}
		ids.add(`recorder_${rid}_active`) // 2.2.x
	}
	for (const [cid, channel] of Object.entries(state.channels || {})) {
		ids.add(`channel_${cid}_name`)
		ids.add(`channel_${cid}_active_layout`)
		ids.add(`channel_${cid}_active_layout_id`)
		ids.add(`channel_${cid}_metadata_title`)
		ids.add(`channel_${cid}_metadata_author`)
		ids.add(`channel_${cid}_metadata_copyright`)
		ids.add(`channel_${cid}_metadata_comment`)
		ids.add(`channel_${cid}_metadata_description`)
		ids.add(`channel_${cid}_metadata_rec_prefix`)
		ids.add(`channel_${cid}_publishers_state_word`)
		if (channel.status) {
			ids.add(`channel_${cid}_signal`)
			ids.add(`channel_${cid}_total_bitrate`)
		}
		if ((channel.encoders || []).some((e) => e.type === 'video')) {
			for (const suffix of ['resolution', 'fps', 'bitrate']) ids.add(`channel_${cid}_${suffix}`)
		}
		for (const pid of Object.keys(channel.publishers || {})) {
			for (const suffix of ['name', 'type', 'state', 'state_word', 'error', 'duration', 'reconnections']) {
				ids.add(`channel_${cid}_publisher_${pid}_${suffix}`)
			}
			// the 2.2.x ids
			ids.add(`stream_${cid}_${pid}_name`)
			ids.add(`stream_${cid}_${pid}_state`)
			if (channel.publishers[pid].status?.statistics?.current?.send_rate !== undefined) {
				ids.add(`stream_${cid}_${pid}_bitrate`)
			}
		}
	}
	// the 2.2.x ids
	for (const id of [
		'system_status_date',
		'system_status_uptime',
		'system_status_cpuload',
		'system_status_cputemp',
		'firmware_version',
		'identity_name',
		'identity_location',
		'identity_description',
	]) {
		ids.add(id)
	}
	for (const stcid of Object.keys(state.singleTouch || {})) {
		for (const suffix of ['active', 'status_ok', 'summary', 'state_word']) {
			ids.add(`singletouch_${stcid}_${suffix}`)
		}
	}
	for (const [sid, input] of Object.entries(state.inputs || {})) {
		// _name exists for every input; the level/gain/delay fields are audio-only
		ids.add(`input_${sid}_name`)
		if (input.audio !== true) continue
		for (const suffix of ['peak_dbfs', 'peak_left', 'peak_right', 'level_text', 'gain', 'delay']) {
			ids.add(`input_${sid}_${suffix}`)
		}
	}
	for (const did of Object.keys(state.outputs || {})) {
		ids.add(`output_${did}_name`)
		ids.add(`output_${did}_source`)
	}
	return ids
}

/** ids from a legacy id pattern that must never reappear */
const LEGACY_IDS = [
	'channel_1_publishers_count',
	'channel_1_streaming_count',
	'stream_1_0_duration',
	'stream_1_0_configured',
	'recorder_1_total',
	'recorder_1_last_file_name',
	'publishers_active_count',
	'input_analog-a_type',
	'storage_main_media_type',
	'storage_main_free_percent',
	'stc_0_pressed',
	'stc_0_status',
	'afu_queue_size_mb',
	'afu_file_name',
	'afu_file_progress_percent',
	'system_status_uptime_hms',
	'system_cpuload_high',
	'system_cputemp_threshold',
	'firmware_revision',
	'product_id',
	'connectivity_external_ip',
	'connectivity_mdns',
	'connectivity_dns',
	'connectivity_icmp',
	'connectivity_vtun',
	'speedtest_bandwidth_mbps',
	'speedtest_protocol',
	'config_presets',
	'last_config_preset',
]

describe('variables: exact id set for the seeded mock', () => {
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

	it('matches exactly the ids derived from the current state (the new set)', () => {
		const actual = new Set(instance.definitions.variables.map((d) => d.variableId))
		const expected = expectedVariableIds(instance.state)
		assert.deepEqual([...actual].sort(), [...expected].sort())
	})

	it('every variable id is valid, unique and has a defined value', () => {
		const defs = instance.definitions.variables
		const ids = new Set()
		for (const def of defs) {
			assert.match(def.variableId, /^[a-zA-Z0-9_-]+$/, def.variableId)
			assert.ok(!ids.has(def.variableId), `duplicate id ${def.variableId}`)
			ids.add(def.variableId)
			assert.ok(typeof def.name === 'string' && def.name.length > 0)
			assert.notEqual(instance.variableValues[def.variableId], undefined, `${def.variableId} has no value`)
		}
	})

	it('no variable id of the intermediate development versions came back', () => {
		for (const id of LEGACY_IDS) {
			assert.equal(instance.variableValues[id], undefined, `legacy variable ${id} still exists`)
			assert.ok(
				!instance.definitions.variables.some((d) => d.variableId === id),
				`legacy variable ${id} still defined`,
			)
		}
	})

	it('keeps the 2.2.x variable ids with the values 2.2.x gave them', () => {
		const v = instance.variableValues
		assert.equal(v.channel_1_resolution, '1920x1080')
		assert.equal(v.channel_1_fps, 30)
		assert.equal(v.channel_1_bitrate, 3000)
		assert.equal(v.stream_1_1_name, v.channel_1_publisher_1_name)
		assert.equal(v.stream_1_1_state, 'started')
		assert.equal(v.stream_1_1_bitrate, 3.61)
		assert.equal(v.recorder_1_active, '1')
		assert.equal(v.system_status_date, '2025-02-14T08:41:09-05:00')
		assert.equal(v.system_status_uptime, v.uptime_seconds)
		assert.equal(v.system_status_cpuload, v.cpu_load)
		assert.equal(v.system_status_cputemp, v.cpu_temp)
		assert.equal(v.firmware_version, v.firmware)
		assert.equal(v.identity_name, v.device_name)
		assert.equal(v.identity_location, 'Home')
		assert.equal(v.identity_description, 'Pearl Mini at Home')
	})

	it('reports the input signal, total bitrate, stream duration, warnings and storage numbers', () => {
		const v = instance.variableValues
		assert.equal(v.channel_1_signal, 'OK')
		assert.equal(v.channel_1_total_bitrate, 3128)
		assert.match(String(v.channel_1_publisher_1_duration), /^\d\d:\d\d:\d\d$/)
		assert.equal(v.channel_1_publisher_1_reconnections, 0)
		assert.equal(v.cpu_load_high, false)
		assert.equal(v.cpu_temp_high, false)
		assert.equal(typeof v.storage_main_total_gb, 'number')
		assert.equal(v.storage_main_total_gb, Math.round((v.storage_main_used_gb + v.storage_main_free_gb) * 10) / 10)
		// recorder 1 records channel 1 at 3128 kbit/s: the remaining time is computed from the free space
		assert.match(String(v.storage_main_remaining_time), /^\d+:\d\d$/)
		assert.equal(typeof v.storage_main_remaining_minutes, 'number')
	})

	it('key word values for the seeded state', () => {
		assert.equal(instance.variableValues.recorder_1_state_word, 'REC')
		assert.equal(instance.variableValues.recorder_2_state_word, 'OFF')
		assert.equal(instance.variableValues.channel_1_publisher_1_state_word, 'LIVE')
		assert.equal(instance.variableValues.channel_1_publisher_0_state_word, 'OFF')
		assert.equal(instance.variableValues.event_upcoming_state_word, 'SCHED')
		assert.equal(instance.variableValues.event_ongoing_state_word, '—')
		assert.equal(instance.variableValues.recorder_all_state_word, 'REC')
		assert.equal(instance.variableValues.channel_1_publishers_state_word, 'LIVE')
		assert.equal(instance.variableValues.singletouch_0_state_word, '')
		assert.match(String(instance.variableValues.storage_main_free), /GB$/)
		assert.equal(instance.variableValues.storage_main_level_word, '')
		assert.equal(instance.variableValues.storage_external_text, 'No media')
		assert.match(String(instance.variableValues.storage_main_text), /^of /)
		// nothing ongoing, but the upcoming event is scheduled -> falls back to START
		assert.equal(
			instance.variableValues.event_ongoing_toggle_command,
			'',
			'nothing running or paused: the toggle has nothing to pause or resume (the upcoming event starts from its own button)',
		)
		assert.equal(instance.variableValues.confirm_hint, '')
		assert.equal(instance.variableValues.last_error, '')
	})

	it('confirm_hint / last_error / power_status / preset_status track instance state across a poll', async () => {
		instance.state.lastError = 'boom'
		instance.state.powerStatus = { text: 'Command sent', until: Date.now() + 1000 }
		instance.state.presetStatus = { text: 'Rebooting…', until: Date.now() - 1000 } // already expired
		await instance.pollAll()
		assert.equal(instance.variableValues.last_error, 'boom')
		assert.equal(instance.variableValues.power_status, 'Command sent')
		assert.equal(instance.variableValues.preset_status, '')
	})
})

describe('variables: word/format rules (via buildVariables, no device needed)', () => {
	function selfWith(overrides = {}) {
		return { state: { ...emptyState(), ...overrides.state }, confirmPending: overrides.confirmPending }
	}

	it('duration text is m:ss below one hour', () => {
		const self = selfWith({
			state: { recorders: { r1: { id: 'r1', name: 'R1', status: { state: 'started', duration: 65 } } } },
		})
		const { values } = buildVariables(self)
		assert.equal(values.recorder_r1_duration_text, '1:05')
		assert.equal(values.recorder_r1_duration_hms, '00:01:05')
	})

	it('duration text is h:mm:ss from one hour up', () => {
		const self = selfWith({
			state: { recorders: { r1: { id: 'r1', name: 'R1', status: { state: 'started', duration: 3725 } } } },
		})
		const { values } = buildVariables(self)
		assert.equal(values.recorder_r1_duration_text, '1:02:05')
	})

	it('upcoming event countdown reads "in 5:00"', () => {
		const nowSeconds = Math.floor(Date.now() / 1000)
		const self = selfWith({
			state: { events: { upcoming: { id: 'e1', title: 'T', start: nowSeconds + 300 }, ongoing: null, list: [] } },
		})
		const { values } = buildVariables(self)
		assert.equal(values.event_upcoming_time_text, 'in 5:00')
		assert.equal(values.event_upcoming_state_word, 'SCHED')
	})

	it('nothing scheduled reads "No Upcoming Event" (standard text)', () => {
		const self = selfWith({ state: { events: { upcoming: null, ongoing: null, list: [] } } })
		const { values } = buildVariables(self)
		assert.equal(values.event_upcoming_time_text, 'No Upcoming Event')
		assert.equal(values.event_upcoming_state_word, '—')
	})

	it('ongoing event countdown reads "12:30 left"', () => {
		const nowSeconds = Math.floor(Date.now() / 1000)
		const self = selfWith({
			state: {
				events: {
					upcoming: null,
					ongoing: { id: 'e1', title: 'Live show', status: 'running', finish: nowSeconds + 750 },
					list: [],
				},
			},
		})
		const { values } = buildVariables(self)
		assert.equal(values.event_ongoing_time_text, '12:30 left')
		assert.equal(values.event_ongoing_state_word, 'LIVE')
		assert.equal(values.event_ongoing_toggle_command, 'PAUSE')
	})

	it('no ongoing event reads "No Event Running" (standard text)', () => {
		const self = selfWith({ state: { events: { upcoming: null, ongoing: null, list: [] } } })
		const { values } = buildVariables(self)
		assert.equal(values.event_ongoing_time_text, 'No Event Running')
	})

	it('uptime reads "3d 4h" (days present)', () => {
		const self = selfWith({ state: { systemStatus: { uptime: 3 * 86400 + 4 * 3600 } } })
		const { values } = buildVariables(self)
		assert.equal(values.uptime, '3d 4h')
	})

	it('remaining recording time is calculated from the bitrate of the running recordings', () => {
		const self = selfWith({
			state: {
				channels: { 1: { id: '1', name: 'A', status: { bitrate: 8000 } } },
				recorders: { 1: { id: '1', name: 'A', multisource: false, status: { state: 'started' } } },
				// 36 GB free at 8000 kbit/s = 1 MB/s -> 36000 s = 10 h
				storages: { main: { id: 'main', status: { state: 'ready', total: 100e9, free: 36e9 } } },
			},
		})
		const { values } = buildVariables(self)
		assert.equal(values.storage_main_remaining_time, '10:00')
		assert.equal(values.storage_main_remaining_minutes, 600)
		assert.equal(values.storage_main_free_pct, 36)
		assert.equal(values.storage_main_used_gb, 64)

		self.state.recorders['1'].status.state = 'stopped'
		assert.equal(buildVariables(self).values.storage_main_remaining_time, '', 'nothing recorded, no estimate')
	})

	it('CPU temperature warning uses the threshold of the device', () => {
		const self = selfWith({ state: { systemStatus: { cputemp: 71, cputemp_threshold: 70, cpuload: 0 } } })
		const { values } = buildVariables(self)
		assert.equal(values.cpu_temp_high, true)
		assert.equal(values.system_status_cpuload, 0, 'a load of 0 is a value, not empty')
	})

	it('bytes read "1.5 GB"', () => {
		const self = selfWith({
			state: {
				storages: { main: { id: 'main', status: { state: 'ready', total: 2e9, free: 1.5 * 1024 ** 3 } } },
			},
		})
		const { values } = buildVariables(self)
		assert.equal(values.storage_main_free, '1.5 GB')
	})

	it('audio level reads "-18 dBFS" and "silent" at/below -99', () => {
		const self = selfWith({
			state: {
				inputs: {
					a: { id: 'a', name: 'A', audio: true, levels: { rms: [-18], peak: [] } },
					b: { id: 'b', name: 'B', audio: true, levels: { rms: [-99, -110], peak: [] } },
				},
			},
		})
		const { values } = buildVariables(self)
		assert.equal(values.input_a_level_text, '-18 dBFS')
		assert.equal(values.input_b_level_text, 'silent')
	})

	it('confirm_hint reflects a live confirmPending (mirrors CONFIRM_HINT)', () => {
		const self = selfWith({ confirmPending: { until: Date.now() + 5000 } })
		const { values } = buildVariables(self)
		assert.equal(values.confirm_hint, 'Press again')
		const expired = selfWith({ confirmPending: { until: Date.now() - 1 } })
		assert.equal(buildVariables(expired).values.confirm_hint, '')
	})
})

describe('variables: clock-skew countdown', () => {
	it('event countdowns use self.deviceNow(), not the host clock, when it is offset', () => {
		const nowSeconds = Math.floor(Date.now() / 1000)
		const state = {
			...emptyState(),
			events: { upcoming: { id: 'e1', title: 'T', start: nowSeconds + 300 }, ongoing: null, list: [] },
		}
		const uncorrected = buildVariables({ state })
		// a device clock running 60 s ahead shortens the countdown the module computes by ~60 s
		const corrected = buildVariables({ state, deviceNow: () => Date.now() + 60000 })
		assert.equal(uncorrected.values.event_upcoming_time_text, 'in 5:00')
		assert.equal(corrected.values.event_upcoming_time_text, 'in 4:00')
	})

	it('falls back to Date.now() when the instance has no deviceNow (e.g. a hand-built test double)', () => {
		const nowSeconds = Math.floor(Date.now() / 1000)
		const state = {
			...emptyState(),
			events: { upcoming: { id: 'e1', title: 'T', start: nowSeconds + 60 }, ongoing: null, list: [] },
		}
		const { values } = buildVariables({ state })
		assert.match(String(values.event_upcoming_time_text), /^in \d/)
	})
})
