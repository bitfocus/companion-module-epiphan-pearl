const {
	safeId,
	formatHms,
	formatClock,
	compactDuration,
	bytesToHuman,
	formatUptime,
	round1,
	storageLevel,
} = require('./utils')
const { levelSummary, readGain, readDelay } = require('./audio')
const { CONFIRM_HINT } = require('./confirm')

/**
 * Normalise a value for a Companion variable: undefined/null become '' (never undefined),
 * everything else (numbers, booleans, strings) is passed through untouched.
 *
 * @param {*} value
 * @returns {string|number|boolean}
 */
function val(value) {
	return value === undefined || value === null ? '' : value
}

/**
 * Convert a value to a finite number, or undefined when that is not possible.
 *
 * @param {*} value
 * @returns {number|undefined}
 */
function num(value) {
	if (value === undefined || value === null || value === '') return undefined
	const n = Number(value)
	return Number.isFinite(n) ? n : undefined
}

/** HH:MM:SS for a duration in seconds, '' when unknown */
function hms(seconds) {
	const n = num(seconds)
	return n === undefined ? '' : val(formatHms(Math.max(0, n)))
}

/** m:ss / h:mm:ss for a duration in seconds, '' when unknown */
function compact(seconds) {
	const n = num(seconds)
	return n === undefined ? '' : val(compactDuration(Math.max(0, n)))
}

/** HH:MM local clock time for a unix timestamp in seconds, '' when unknown */
function clock(unixSeconds) {
	const n = num(unixSeconds)
	return n === undefined ? '' : val(formatClock(n))
}

/** text of a { text, until } marker (preset/power status) while `until` is in the future */
function activeText(marker) {
	if (!marker || typeof marker !== 'object') return ''
	const until = num(marker.until)
	if (until === undefined || Date.now() >= until) return ''
	return val(marker.text)
}

/** Human readable label prefix like "Channel 1 (HDMI-A)"; falls back to "Channel 1" when no name is known. */
function labelFor(kind, id, name) {
	const base = `${kind} ${id}`
	const n = typeof name === 'string' ? name.trim() : ''
	return n !== '' && n !== String(id) && n !== base ? `${base} (${n})` : base
}

/** Badge word for a recorder status: REC / PAUSED / ERR / OFF / ? */
function recorderWord(state) {
	switch (state) {
		case 'started':
		case 'starting':
			return 'REC'
		case 'paused':
			return 'PAUSED'
		case 'error':
			return 'ERR'
		case 'stopped':
		case 'disabled':
			return 'OFF'
		default:
			return '?'
	}
}

/** Badge word for a publisher status: LIVE / STARTING / LISTEN / ERR / OFF / ? */
function publisherWord(state) {
	switch (state) {
		case 'started':
			return 'LIVE'
		case 'starting':
			return 'STARTING'
		case 'listening':
			return 'LISTEN'
		case 'error':
			return 'ERR'
		case 'stopped':
			return 'OFF'
		default:
			return '?'
	}
}

const GB = 1e9 // decimal gigabytes, like the size printed on the drive

/** hh:mm for a duration in seconds (hours are not wrapped at 24) */
function hhmm(seconds) {
	const total = Math.max(0, Math.floor(seconds))
	return `${String(Math.floor(total / 3600)).padStart(2, '0')}:${String(Math.floor((total % 3600) / 60)).padStart(2, '0')}`
}

/**
 * Sum of the current bitrate (kbit/s) of all channels which are being recorded right now.
 * Multi-source recorders are not included, it is not known which channels they record.
 *
 * @param {object} state
 * @returns {number}
 */
function recordingBitrate(state) {
	let kbps = 0
	for (const [rid, recorder] of Object.entries(state.recorders || {})) {
		if (recorder?.status?.state !== 'started' || recorder.multisource) continue
		// single-source recorders have the id of the channel they record
		kbps += num(state.channels?.[rid]?.status?.bitrate) ?? 0
	}
	return kbps
}

/**
 * Aggregate status of a list of {status:{state}} entities: the first status of `order` found among
 * them, or `fallback` when none matches (including an empty list). Mirrors the recorder_state /
 * stream_state feedbacks' "all" aggregate so the *_all_state_word / *_publishers_state_word variables
 * agree with the buttons that use those feedbacks.
 *
 * @param {Array<{status?: {state?: string}}>} entities
 * @param {string[]} order states checked in priority order
 * @param {string} fallback
 * @returns {string}
 */
function aggregateState(entities, order, fallback) {
	const states = new Set(entities.map((e) => e?.status?.state))
	for (const candidate of order) {
		if (states.has(candidate)) return candidate
	}
	return fallback
}
const RECORDER_AGGREGATE_ORDER = ['started', 'starting', 'paused', 'error']
const PUBLISHER_AGGREGATE_ORDER = ['started', 'starting', 'listening', 'error']

/** Command a toggle would send for an event in `status`, or '' when nothing applies (see utils.eventToggleOp). */
function toggleWord(status) {
	switch (status) {
		case 'running':
			return 'PAUSE'
		case 'paused':
			return 'RESUME'
		default:
			return ''
	}
}

/** "12:30 left" / "in 5:00" / "Starting…" text for an event that is running, paused or scheduled. */
function ongoingTimeText(ongoing, nowSeconds) {
	if (!ongoing) return 'No Event Running'
	const remaining = compact(Math.max(0, num(ongoing.finish) - nowSeconds))
	return `${remaining} left`
}
function upcomingTimeText(upcoming, nowSeconds) {
	if (!upcoming) return 'No Upcoming Event'
	const untilStart = num(upcoming.start) - nowSeconds
	return untilStart > 0 ? `in ${compact(untilStart)}` : 'Starting…'
}

/** "Uploading" / "Idle" / "Paused" / "Error" / "AFU off" for the active AFU entry (or none). */
function pickAfu(afuList) {
	const list = Array.isArray(afuList) ? afuList : []
	if (list.length === 0) return undefined
	return list.find((a) => a?.status?.state !== 'disabled') ?? list[0]
}
function afuWord(afu) {
	switch (afu?.status?.state) {
		case 'uploading':
			return 'Uploading'
		case 'paused':
			return 'Paused'
		case 'error':
			return 'Error'
		case 'idle':
			return 'Idle'
		default:
			return 'AFU off'
	}
}

/**
 * Build the complete set of variable definitions and values from the instance state.
 * Pure function of self.state and self.confirmPending; never throws on partial state.
 *
 * @param {object} self instance (only state and confirmPending are read)
 * @returns {{ definitions: Array<{variableId: string, name: string}>, values: object }}
 */
function buildVariables(self) {
	const state = (self && self.state) || {}

	const definitions = []
	const values = {}
	const seen = new Set()

	const add = (variableId, name, value) => {
		if (!seen.has(variableId)) {
			seen.add(variableId)
			definitions.push({ variableId, name })
		}
		values[variableId] = val(value)
	}

	const nowSeconds = Math.floor((self?.deviceNow?.() ?? Date.now()) / 1000)

	// ---------------------------------------------------------------- system / identity / firmware / AFU
	const sys = state.systemStatus || {}
	const cpuLoad = num(sys.cpuload)
	const cpuTemp = num(sys.cputemp)
	const uptimeSeconds = num(sys.uptime)
	add('cpu_load', 'CPU Load (%)', cpuLoad)
	add('cpu_temp', 'CPU Temperature (C)', cpuTemp)
	add('uptime_seconds', 'Uptime (s)', uptimeSeconds)
	add('uptime', 'Uptime', uptimeSeconds === undefined ? '' : formatUptime(uptimeSeconds))
	const statusParts = []
	if (cpuTemp !== undefined) statusParts.push(`${Math.round(cpuTemp)}°C`)
	if (uptimeSeconds !== undefined && uptimeSeconds > 0) statusParts.push(`up ${formatUptime(uptimeSeconds)}`)
	add('system_status_text', 'System Status', statusParts.join(' · '))
	// the device reports its own thresholds, so the warnings match its admin panel (and the system feedback)
	const cpuTempThreshold = num(sys.cputemp_threshold)
	add('cpu_load_high', 'CPU Load High', sys.cpuload_high === true)
	add(
		'cpu_temp_high',
		'CPU Temperature High',
		cpuTemp !== undefined && cpuTempThreshold !== undefined ? cpuTemp >= cpuTempThreshold : false,
	)

	const afuList = Array.isArray(state.afu) ? state.afu : []
	const afuActive = pickAfu(afuList)
	add(
		'afu_state',
		'AFU State',
		afuList.map((a) => (a && a.status && a.status.state !== undefined ? a.status.state : '')).join(','),
	)
	add('afu_text', 'AFU Text', afuWord(afuActive))
	add('afu_protocol', 'AFU Protocol', afuActive?.status?.protocol)
	add('afu_queue_files', 'AFU Queue Files', num(afuActive?.status?.queue?.files))
	add('afu_error', 'AFU Error', afuActive?.status?.error?.message)

	const fw = state.firmware || {}
	add('product_name', 'Product Name', fw.product_name)
	add('firmware', 'Firmware Version', fw.version)
	add('device_name', 'Device Name', state.identity?.name)
	add('api_version', 'REST API in use', self?.apiDetected ? (self.isV2 ? '2.0' : 'legacy') : '')

	// ---------------------------------------------------------------- storages
	const storages = state.storages || {}
	const recordingKbps = recordingBitrate(state)
	for (const rawStid of Object.keys(storages)) {
		const storage = storages[rawStid] || {}
		const stid = safeId(rawStid)
		const status = storage.status || {}
		const state_ = status.state
		const total = num(status.total)
		const free = num(status.free)
		// the 90 % / 97 % thresholds live in one place (utils.storageLevel), shared with the
		// storage_level feedback and the Storage presets
		const severity = storageLevel(status)
		const usedPct = severity.usedPct

		add(`storage_${stid}_state`, `Storage ${rawStid} State`, state_)
		add(`storage_${stid}_free`, `Storage ${rawStid} Free`, free === undefined ? '' : bytesToHuman(free))
		add(`storage_${stid}_total`, `Storage ${rawStid} Total`, total === undefined ? '' : bytesToHuman(total))
		add(`storage_${stid}_used_pct`, `Storage ${rawStid} Used (%)`, usedPct === undefined ? '' : round1(usedPct))
		// numbers for expressions, decimal gigabytes like the size printed on the drive
		const hasSize = total !== undefined && total > 0 && free !== undefined
		add(`storage_${stid}_total_gb`, `Storage ${rawStid} Total (GB)`, hasSize ? round1(total / GB) : '')
		add(`storage_${stid}_used_gb`, `Storage ${rawStid} Used (GB)`, hasSize ? round1((total - free) / GB) : '')
		add(`storage_${stid}_free_gb`, `Storage ${rawStid} Free (GB)`, hasSize ? round1(free / GB) : '')
		add(`storage_${stid}_free_pct`, `Storage ${rawStid} Free (%)`, hasSize ? round1((free / total) * 100) : '')
		// estimated from the bitrate of the running recordings, empty while nothing is recorded
		const remainingSeconds = hasSize && recordingKbps > 0 ? (free * 8) / (recordingKbps * 1000) : undefined
		add(
			`storage_${stid}_remaining_time`,
			`Storage ${rawStid} Remaining Recording Time (hh:mm)`,
			remainingSeconds === undefined ? '' : hhmm(remainingSeconds),
		)
		add(
			`storage_${stid}_remaining_minutes`,
			`Storage ${rawStid} Remaining Recording Time (minutes)`,
			remainingSeconds === undefined ? '' : Math.floor(remainingSeconds / 60),
		)

		let text
		let levelWord = ''
		switch (state_) {
			case 'ready':
				text = total === undefined ? 'No data' : `of ${bytesToHuman(total)}`
				levelWord = severity.word
				break
			case 'devro':
				text = total === undefined ? 'No data' : `of ${bytesToHuman(total)}`
				levelWord = 'RO'
				break
			case 'nodev':
				text = 'No media'
				break
			case 'dev':
				text = 'Not ready'
				break
			case 'formatting':
				text = 'Formatting…'
				break
			default:
				text = 'No data'
		}
		add(`storage_${stid}_text`, `Storage ${rawStid} Text`, text)
		add(`storage_${stid}_level_word`, `Storage ${rawStid} Level Word`, levelWord)
	}

	// ---------------------------------------------------------------- recorders
	const recorders = state.recorders || {}
	let recordersActive = 0
	for (const rawRid of Object.keys(recorders)) {
		const rec = recorders[rawRid] || {}
		const rid = safeId(rawRid)
		const status = rec.status || {}
		const recLabel = labelFor('Recorder', rawRid, rec.name)
		if (status.state === 'started') recordersActive++

		add(`recorder_${rid}_name`, `${recLabel} Name`, rec.name)
		add(`recorder_${rid}_state`, `${recLabel} State`, status.state)
		add(`recorder_${rid}_state_word`, `${recLabel} State Word`, recorderWord(status.state))
		add(`recorder_${rid}_duration`, `${recLabel} Duration (s)`, num(status.duration) ?? 0)
		add(`recorder_${rid}_duration_text`, `${recLabel} Duration`, compact(status.duration ?? 0))
		add(`recorder_${rid}_duration_hms`, `${recLabel} Duration (HH:MM:SS)`, hms(status.duration ?? 0))
	}
	add(
		'recorder_all_state_word',
		'All Recorders State Word',
		recorderWord(aggregateState(Object.values(recorders), RECORDER_AGGREGATE_ORDER, 'stopped')),
	)
	add('recorders_active_count', 'Recorders Active Count', recordersActive)

	// ---------------------------------------------------------------- channels + publishers
	const channels = state.channels || {}
	for (const rawCid of Object.keys(channels)) {
		const channel = channels[rawCid] || {}
		const cid = safeId(rawCid)
		const chLabel = labelFor('Channel', rawCid, channel.name)

		add(`channel_${cid}_name`, `${chLabel} Name`, channel.name)
		const activeLayout = channel.active_layout
		add(`channel_${cid}_active_layout`, `${chLabel} Active Layout`, activeLayout ? activeLayout.name : '')
		add(`channel_${cid}_active_layout_id`, `${chLabel} Active Layout ID`, activeLayout ? activeLayout.id : '')
		const md = self?.metadata?.[cid]
		add(`channel_${cid}_metadata_title`, `${chLabel} Metadata Title`, md?.title)
		add(`channel_${cid}_metadata_author`, `${chLabel} Metadata Author`, md?.author)
		add(`channel_${cid}_metadata_copyright`, `${chLabel} Metadata Copyright`, md?.copyright)
		add(`channel_${cid}_metadata_comment`, `${chLabel} Metadata Comment`, md?.comment)
		add(`channel_${cid}_metadata_description`, `${chLabel} Metadata Description`, md?.description)
		add(`channel_${cid}_metadata_rec_prefix`, `${chLabel} Metadata Filename Prefix`, md?.rec_prefix)

		// the legacy channel status reports the input signal and the current total bitrate (video + audio)
		if (channel.status) {
			const noSignal = channel.status.nosignal
			add(
				`channel_${cid}_signal`,
				`${chLabel} Input Signal`,
				noSignal === undefined ? '' : noSignal ? 'No signal' : 'OK',
			)
			add(`channel_${cid}_total_bitrate`, `${chLabel} Total Bitrate (kbit/s)`, num(channel.status.bitrate))
		}

		const publishers = channel.publishers || {}
		for (const rawPid of Object.keys(publishers)) {
			const pub = publishers[rawPid] || {}
			const pid = safeId(rawPid)
			const status = pub.status || {}
			const pubLabel = labelFor('Publisher', `${rawCid}-${rawPid}`, pub.name)

			add(`channel_${cid}_publisher_${pid}_name`, `${pubLabel} Name`, pub.name)
			add(`channel_${cid}_publisher_${pid}_type`, `${pubLabel} Type`, pub.type)
			add(`channel_${cid}_publisher_${pid}_state`, `${pubLabel} State`, status.state)
			add(`channel_${cid}_publisher_${pid}_state_word`, `${pubLabel} State Word`, publisherWord(status.state))
			add(`channel_${cid}_publisher_${pid}_error`, `${pubLabel} Error`, status.description)
			add(`channel_${cid}_publisher_${pid}_duration`, `${pubLabel} Duration (HH:MM:SS)`, hms(status.duration))
			add(`channel_${cid}_publisher_${pid}_reconnections`, `${pubLabel} Reconnections`, num(status.reconnections))
		}
		add(
			`channel_${cid}_publishers_state_word`,
			`${chLabel} Publishers State Word`,
			publisherWord(aggregateState(Object.values(publishers), PUBLISHER_AGGREGATE_ORDER, 'stopped')),
		)
	}

	// ---------------------------------------------------------------- single touch control
	const singleTouch = state.singleTouch || {}
	for (const rawStcid of Object.keys(singleTouch)) {
		const stc = singleTouch[rawStcid] || {}
		const stcid = safeId(rawStcid)
		const st = stc.state || {}
		const stcLabel = `Single Touch ${rawStcid}`
		const pressed = typeof st.pressed === 'boolean' ? st.pressed : undefined
		const statusOk = typeof st.status === 'boolean' ? st.status : undefined

		add(`singletouch_${stcid}_active`, `${stcLabel} Active`, pressed)
		add(`singletouch_${stcid}_status_ok`, `${stcLabel} Status OK`, statusOk)
		const recA = num(st.recorders?.active)
		const recT = num(st.recorders?.total)
		const pubA = num(st.publishers?.active)
		const pubT = num(st.publishers?.total)
		add(
			`singletouch_${stcid}_summary`,
			`${stcLabel} Summary`,
			recT === undefined && pubT === undefined
				? ''
				: `rec ${recA ?? 0}/${recT ?? 0} · str ${pubA ?? 0}/${pubT ?? 0}`,
		)
		add(
			`singletouch_${stcid}_state_word`,
			`${stcLabel} State Word`,
			statusOk === false ? 'ERR' : pressed === true ? 'ON' : '',
		)
	}

	// ---------------------------------------------------------------- events (CMS schedule)
	const events = state.events || {}
	const upcoming = events.upcoming || null
	const ongoing = events.ongoing || null

	add('event_upcoming_id', 'Upcoming Event ID', upcoming ? upcoming.id : '')
	add('event_upcoming_title', 'Upcoming Event Title', upcoming ? upcoming.title : '')
	add('event_upcoming_start', 'Upcoming Event Start (unix)', upcoming ? num(upcoming.start) : '')
	add('event_upcoming_start_time', 'Upcoming Event Start Time', upcoming ? clock(upcoming.start) : '')
	add(
		'event_upcoming_starts_in_hms',
		'Upcoming Event Starts In (HH:MM:SS)',
		upcoming ? hms(num(upcoming.start) - nowSeconds) : '',
	)
	add('event_upcoming_time_text', 'Upcoming Event Time', upcomingTimeText(upcoming, nowSeconds))
	add('event_upcoming_state_word', 'Upcoming Event State Word', upcoming ? 'SCHED' : '—')

	add('event_ongoing_id', 'Ongoing Event ID', ongoing ? ongoing.id : '')
	add('event_ongoing_title', 'Ongoing Event Title', ongoing ? ongoing.title : '')
	add('event_ongoing_status', 'Ongoing Event Status', ongoing ? ongoing.status : '')
	add('event_ongoing_finish', 'Ongoing Event Finish (unix)', ongoing ? num(ongoing.finish) : '')
	add('event_ongoing_finish_time', 'Ongoing Event Finish Time', ongoing ? clock(ongoing.finish) : '')
	add(
		'event_ongoing_remaining_hms',
		'Ongoing Event Remaining (HH:MM:SS)',
		ongoing ? hms(num(ongoing.finish) - nowSeconds) : '',
	)
	add('event_ongoing_time_text', 'Ongoing Event Time', ongoingTimeText(ongoing, nowSeconds))
	add(
		'event_ongoing_state_word',
		'Ongoing Event State Word',
		ongoing?.status === 'running' ? 'LIVE' : ongoing?.status === 'paused' ? 'PAUSED' : '—',
	)
	// PAUSE / RESUME for the ongoing event, empty while nothing is running or paused (the upcoming event is
	// started from its own button, never by the toggle)
	add('event_ongoing_toggle_command', 'Ongoing Event Toggle Command', toggleWord(ongoing?.status))

	// aliases of the ongoing event
	add('event_title', 'Event Title', ongoing ? ongoing.title : '')
	add('event_state', 'Event State', ongoing ? ongoing.status : '')
	add('event_remaining', 'Event Remaining (HH:MM:SS)', ongoing ? hms(num(ongoing.finish) - nowSeconds) : '')

	// ---------------------------------------------------------------- inputs (name always; audio-only fields gated)
	const inputs = state.inputs || {}
	for (const rawSid of Object.keys(inputs)) {
		const input = inputs[rawSid] || {}
		const sid = safeId(rawSid)
		const inLabel = labelFor('Input', rawSid, input.name)
		// _name exists for every input (video-only included - the Previews preset text needs it for a
		// video-capable input that carries no audio); only the level/gain/delay fields are audio-only
		add(`input_${sid}_name`, `${inLabel} Name`, input.name)
		if (input.audio !== true) continue
		const level = levelSummary(input)
		add(`input_${sid}_peak_dbfs`, `${inLabel} Peak (dBFS)`, level.peak)
		add(`input_${sid}_peak_left`, `${inLabel} Peak Left (dBFS)`, level.left)
		add(`input_${sid}_peak_right`, `${inLabel} Peak Right (dBFS)`, level.right)
		add(`input_${sid}_level_text`, `${inLabel} Level`, level.text)
		const settings = input.settings
		add(`input_${sid}_gain`, `${inLabel} Gain`, settings ? readGain(settings) : undefined)
		add(`input_${sid}_delay`, `${inLabel} Delay (ms)`, settings ? readDelay(settings)?.value : undefined)
	}

	// ---------------------------------------------------------------- outputs
	const outputs = state.outputs || {}
	for (const rawDid of Object.keys(outputs)) {
		const output = outputs[rawDid] || {}
		const did = safeId(rawDid)
		const outLabel = labelFor('Output', rawDid, output.name)
		add(`output_${did}_name`, `${outLabel} Name`, output.name)
		add(`output_${did}_source`, `${outLabel} Source`, output.source)
	}

	// ---------------------------------------------------------------- configuration presets
	const presets = Array.isArray(state.presets) ? state.presets : []
	add(
		'preset_names',
		'Configuration Preset Names',
		presets
			.map((p) => (p && p.name !== undefined ? String(p.name) : ''))
			.filter((n) => n !== '')
			.join(','),
	)
	// optimistic: last preset applied through this connection, not confirmed by the device (no read endpoint)
	add('preset_last_applied', 'Last Applied Configuration Preset', state.lastConfigPreset?.name)
	add('preset_status', 'Configuration Preset Status', activeText(state.presetStatus))

	// ---------------------------------------------------------------- power / confirm / errors
	add('power_status', 'Power Status', activeText(state.powerStatus))
	const pending = self?.confirmPending
	add('confirm_hint', 'Confirm Hint', pending && Date.now() < pending.until ? CONFIRM_HINT : '')
	add('last_error', 'Last Error', state.lastError)

	addCompatibilityVariables(state, add)

	return { definitions, values }
}

/**
 * The variables of module 2.2.x under their original ids, so button text written for 2.2.x keeps working.
 * They are defined under the same conditions as before (only when the device reported the data). New
 * buttons should use the ids documented in the help: stream_C_P_name/_state are channel_C_publisher_P_name/_state,
 * system_status_* are cpu_load, cpu_temp, uptime_seconds, firmware_version is firmware and identity_name
 * is device_name.
 *
 * @param {object} state
 * @param {(variableId: string, name: string, value: *) => void} add
 */
function addCompatibilityVariables(state, add) {
	for (const rawCid of Object.keys(state.channels || {})) {
		const channel = state.channels[rawCid] || {}
		const cid = safeId(rawCid)

		// API v2.0 marks the video encoder with type 'video', the v1 API has no type, there the video encoder
		// is the one reporting a resolution
		const encoders = Array.isArray(channel.encoders) ? channel.encoders : []
		const videoEncoder =
			encoders.find((e) => e?.type === 'video') ??
			encoders.find((e) => e && e.type === undefined && (e.status?.resolution || e.resolution))
		if (videoEncoder) {
			const encStatus = videoEncoder.status ?? {}
			add(
				`channel_${cid}_resolution`,
				`Channel ${rawCid} Resolution`,
				encStatus.resolution ?? videoEncoder.resolution,
			)
			// the current values of the channel status come first, the encoder settings are only the fallback
			add(
				`channel_${cid}_fps`,
				`Channel ${rawCid} FPS`,
				encStatus.fps ?? encStatus.framerate ?? videoEncoder.framerate,
			)
			add(`channel_${cid}_bitrate`, `Channel ${rawCid} Bitrate`, encStatus.bitrate ?? videoEncoder.bitrate)
		}

		for (const rawPid of Object.keys(channel.publishers || {})) {
			const pub = channel.publishers[rawPid] || {}
			const pid = safeId(rawPid)
			add(`stream_${cid}_${pid}_name`, `Stream ${rawCid}-${rawPid} Name`, pub.name)
			add(`stream_${cid}_${pid}_state`, `Stream ${rawCid}-${rawPid} State`, pub.status?.state)
			const sendRate = pub.status?.statistics?.current?.send_rate
			if (sendRate !== undefined)
				add(`stream_${cid}_${pid}_bitrate`, `Stream ${rawCid}-${rawPid} Bitrate`, sendRate)
		}
	}

	for (const rawRid of Object.keys(state.recorders || {})) {
		add(`recorder_${safeId(rawRid)}_active`, `Recorder ${rawRid} Active`, state.recorders[rawRid]?.status?.active)
	}

	const sys = state.systemStatus
	if (sys) {
		add('system_status_date', 'System Status Date', sys.date)
		add('system_status_uptime', 'System Status Uptime', num(sys.uptime))
		add('system_status_cpuload', 'System CPU Load', num(sys.cpuload))
		add('system_status_cputemp', 'System CPU Temp', num(sys.cputemp))
	}
	if (state.firmware) add('firmware_version', 'Firmware Version', state.firmware.version)
	if (state.identity) {
		add('identity_name', 'Identity Name', state.identity.name)
		add('identity_location', 'Identity Location', state.identity.location)
		add('identity_description', 'Identity Description', state.identity.description)
	}
}

/**
 * Push variable definitions (only when the id set changed) and values to Companion.
 * Never throws.
 *
 * @param {object} self instance
 */
function updateVariables(self) {
	try {
		const { definitions, values } = buildVariables(self)
		const idList = definitions
			.map((d) => d.variableId)
			.sort()
			.join(',')
		if (idList !== self.lastVariableIds) {
			self.lastVariableIds = idList
			// module-base 2.x: definitions are an object keyed by the variable id
			self.setVariableDefinitions(Object.fromEntries(definitions.map((d) => [d.variableId, { name: d.name }])))
		}
		self.setVariableValues(values)
	} catch (e) {
		if (self && typeof self.log === 'function') {
			self.log('error', `Failed to update variables: ${e && e.message ? e.message : e}`)
		}
	}
}

module.exports = { buildVariables, updateVariables }
