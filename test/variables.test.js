/**
 * The target variable set (doc/PARITY.md §1, §2.5): the exact id set for the seeded mock (and that no
 * legacy id remains), the §3.3 word/format rules and the clock-skew countdown.
 */
const { describe, it, before, after } = require('node:test')
const assert = require('node:assert/strict')

const { createInstance } = require('./harness')
const { startMockPearl } = require('./mock-pearl')
const { buildVariables } = require('../src/variables')
const { emptyState } = require('../src/utils')

/**
 * Build the exact set of variable ids the briefing's §5 list documents for a given instance state,
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
		'afu_state',
		'afu_text',
		'afu_protocol',
		'afu_queue_files',
		'afu_error',
		'product_name',
		'firmware',
		'device_name',
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
		for (const suffix of ['state', 'free', 'total', 'used_pct', 'text', 'level_word', 'hint']) {
			ids.add(`storage_${stid}_${suffix}`)
		}
	}
	for (const rid of Object.keys(state.recorders || {})) {
		for (const suffix of ['name', 'state', 'state_word', 'duration', 'duration_text', 'duration_hms']) {
			ids.add(`recorder_${rid}_${suffix}`)
		}
	}
	for (const [cid, channel] of Object.entries(state.channels || {})) {
		ids.add(`channel_${cid}_name`)
		ids.add(`channel_${cid}_active_layout`)
		ids.add(`channel_${cid}_active_layout_id`)
		ids.add(`channel_${cid}_publishers_state_word`)
		for (const pid of Object.keys(channel.publishers || {})) {
			for (const suffix of ['name', 'type', 'state', 'state_word', 'error']) {
				ids.add(`channel_${cid}_publisher_${pid}_${suffix}`)
			}
		}
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

/** ids from a legacy id pattern that must never reappear (doc/PARITY.md §2.5) */
const LEGACY_IDS = [
	'channel_1_resolution',
	'channel_1_fps',
	'channel_1_bitrate',
	'channel_1_publishers_count',
	'channel_1_streaming_count',
	'channel_1_metadata_title',
	'stream_1_0_bitrate',
	'stream_1_0_duration',
	'stream_1_0_configured',
	'recorder_1_active',
	'recorder_1_total',
	'recorder_1_last_file_name',
	'publishers_active_count',
	'input_analog-a_type',
	'storage_main_media_type',
	'storage_main_total_gb',
	'storage_main_free_gb',
	'storage_main_free_percent',
	'stc_0_pressed',
	'stc_0_status',
	'afu_queue_size_mb',
	'afu_file_name',
	'afu_file_progress_percent',
	'system_status_date',
	'system_status_uptime',
	'system_status_uptime_hms',
	'system_status_cpuload',
	'system_status_cputemp',
	'system_cpuload_high',
	'system_cputemp_threshold',
	'firmware_version',
	'firmware_revision',
	'product_id',
	'identity_name',
	'identity_location',
	'identity_description',
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

	it('matches exactly the ids derived from the current state (§2.5 new set)', () => {
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

	it('no legacy variable id (§2.5 removed column) survived the rewrite', () => {
		for (const id of LEGACY_IDS) {
			assert.equal(instance.variableValues[id], undefined, `legacy variable ${id} still exists`)
			assert.ok(
				!instance.definitions.variables.some((d) => d.variableId === id),
				`legacy variable ${id} still defined`,
			)
		}
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
		assert.equal(instance.variableValues.event_ongoing_toggle_command, 'START')
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

describe('variables: §3.3 word/format rules (via buildVariables, no device needed)', () => {
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

	it('nothing scheduled reads "Nothing scheduled" (§3.3 standard text)', () => {
		const self = selfWith({ state: { events: { upcoming: null, ongoing: null, list: [] } } })
		const { values } = buildVariables(self)
		assert.equal(values.event_upcoming_time_text, 'Nothing scheduled')
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

	it('no ongoing event reads "No ongoing event" (§3.3 standard text)', () => {
		const self = selfWith({ state: { events: { upcoming: null, ongoing: null, list: [] } } })
		const { values } = buildVariables(self)
		assert.equal(values.event_ongoing_time_text, 'No ongoing event')
	})

	it('uptime reads "3d 4h" (days present)', () => {
		const self = selfWith({ state: { systemStatus: { uptime: 3 * 86400 + 4 * 3600 } } })
		const { values } = buildVariables(self)
		assert.equal(values.uptime, '3d 4h')
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

describe('variables: clock-skew countdown (doc/ARCHITECTURE.md "Request layer")', () => {
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
