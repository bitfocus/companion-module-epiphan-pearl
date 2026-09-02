const { safeId, formatHms, formatClock, bytesToMb, bytesToGb, round1 } = require('./utils')

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

/**
 * HH:MM:SS for a duration in seconds, '' when unknown.
 *
 * @param {*} seconds
 * @returns {string}
 */
function hms(seconds) {
	const n = num(seconds)
	return n === undefined ? '' : val(formatHms(Math.max(0, n)))
}

/**
 * HH:MM local clock time for a unix timestamp in seconds, '' when unknown.
 *
 * @param {*} unixSeconds
 * @returns {string}
 */
function clock(unixSeconds) {
	const n = num(unixSeconds)
	return n === undefined ? '' : val(formatClock(n))
}

/**
 * Bytes -> megabytes (1 decimal), '' when unknown.
 *
 * @param {*} bytes
 * @returns {number|string}
 */
function mb(bytes) {
	const n = num(bytes)
	return n === undefined ? '' : val(bytesToMb(n))
}

/**
 * Bytes -> gigabytes (1 decimal), '' when unknown.
 *
 * @param {*} bytes
 * @returns {number|string}
 */
function gb(bytes) {
	const n = num(bytes)
	return n === undefined ? '' : val(bytesToGb(n))
}

/**
 * part / total * 100 rounded to 1 decimal, '' when total is unknown or zero.
 *
 * @param {*} part
 * @param {*} total
 * @returns {number|string}
 */
function percent(part, total) {
	const p = num(part)
	const t = num(total)
	if (p === undefined || t === undefined || t <= 0) return ''
	return val(round1((p / t) * 100))
}

/**
 * Human readable label prefix like "Channel 1 (HDMI-A)"; falls back to "Channel 1" when no name is known.
 *
 * @param {string} kind
 * @param {string} id
 * @param {string} [name]
 * @returns {string}
 */
function labelFor(kind, id, name) {
	const base = `${kind} ${id}`
	const n = typeof name === 'string' ? name.trim() : ''
	return n !== '' && n !== String(id) && n !== base ? `${base} (${n})` : base
}

/**
 * Build the complete set of variable definitions and values from the instance state.
 * Pure function of self.state, self.metadata and self.config; never throws on partial state.
 *
 * @param {object} self instance (only state, metadata and config are read)
 * @returns {{ definitions: Array<{variableId: string, name: string}>, values: object }}
 */
function buildVariables(self) {
	const state = (self && self.state) || {}
	const metadata = (self && self.metadata) || {}
	const config = (self && self.config) || {}

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

	const nowSeconds = Math.floor(Date.now() / 1000)

	// ---------------------------------------------------------------- channels + publishers
	const channels = state.channels || {}
	let publishersActive = 0

	for (const rawCid of Object.keys(channels)) {
		const channel = channels[rawCid] || {}
		const cid = safeId(rawCid)
		const chLabel = labelFor('Channel', rawCid, channel.name)

		add(`channel_${cid}_name`, `${chLabel} Name`, channel.name)

		const layouts = Object.values(channel.layouts || {})
		const legacyActive = layouts.find((l) => l && l.active)
		const activeLayout = channel.active_layout || legacyActive
		add(`channel_${cid}_active_layout`, `${chLabel} Active Layout`, activeLayout ? activeLayout.name : '')
		add(`channel_${cid}_active_layout_id`, `${chLabel} Active Layout ID`, activeLayout ? activeLayout.id : '')

		const videoEncoder = (Array.isArray(channel.encoders) ? channel.encoders : []).find(
			(e) => e && e.type === 'video',
		)
		const encStatus = (videoEncoder && videoEncoder.status) || {}
		add(
			`channel_${cid}_resolution`,
			`${chLabel} Resolution`,
			videoEncoder ? (encStatus.resolution ?? videoEncoder.resolution) : '',
		)
		add(`channel_${cid}_fps`, `${chLabel} FPS`, videoEncoder ? (encStatus.framerate ?? videoEncoder.framerate) : '')
		add(
			`channel_${cid}_bitrate`,
			`${chLabel} Bitrate`,
			videoEncoder ? (encStatus.bitrate ?? videoEncoder.bitrate) : '',
		)

		const publishers = channel.publishers || {}
		const pids = Object.keys(publishers)
		let streamingCount = 0

		for (const rawPid of pids) {
			const pub = publishers[rawPid] || {}
			const pid = safeId(rawPid)
			const status = pub.status || {}
			const pubName = typeof pub.name === 'string' ? pub.name.trim() : ''
			const pubLabel = pubName !== '' ? `Stream ${rawCid}-${rawPid} (${pubName})` : `Stream ${rawCid}-${rawPid}`

			if (status.state === 'started') streamingCount++

			add(`stream_${cid}_${pid}_name`, `${pubLabel} Name`, pub.name)
			add(`stream_${cid}_${pid}_state`, `${pubLabel} State`, status.state)
			add(`stream_${cid}_${pid}_bitrate`, `${pubLabel} Bitrate`, status.statistics?.current?.send_rate)
			add(`stream_${cid}_${pid}_type`, `${pubLabel} Type`, pub.type)
			add(`stream_${cid}_${pid}_duration`, `${pubLabel} Duration (s)`, num(status.duration))
			add(`stream_${cid}_${pid}_duration_hms`, `${pubLabel} Duration (HH:MM:SS)`, hms(status.duration))
			add(
				`stream_${cid}_${pid}_configured`,
				`${pubLabel} Configured`,
				typeof status.is_configured === 'boolean' ? status.is_configured : '',
			)
		}

		publishersActive += streamingCount
		add(`channel_${cid}_publishers_count`, `${chLabel} Publishers Count`, pids.length)
		add(`channel_${cid}_streaming_count`, `${chLabel} Streaming Count`, streamingCount)

		// legacy content metadata (title/author/rec_prefix)
		const md = metadata[rawCid]
		if (md) {
			add(`channel_${cid}_metadata_title`, `${chLabel} Metadata Title`, md.title)
			add(`channel_${cid}_metadata_author`, `${chLabel} Metadata Author`, md.author)
			add(`channel_${cid}_metadata_rec_prefix`, `${chLabel} Filename Prefix`, md.rec_prefix)
		}
	}

	// metadata for channels that are not (yet / anymore) in state
	for (const rawCid of Object.keys(metadata)) {
		if (channels[rawCid]) continue
		const md = metadata[rawCid] || {}
		const cid = safeId(rawCid)
		const chLabel = labelFor('Channel', rawCid)
		add(`channel_${cid}_metadata_title`, `${chLabel} Metadata Title`, md.title)
		add(`channel_${cid}_metadata_author`, `${chLabel} Metadata Author`, md.author)
		add(`channel_${cid}_metadata_rec_prefix`, `${chLabel} Filename Prefix`, md.rec_prefix)
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
		add(`recorder_${rid}_duration`, `${recLabel} Duration (s)`, num(status.duration) ?? 0)
		add(`recorder_${rid}_duration_hms`, `${recLabel} Duration (HH:MM:SS)`, hms(status.duration ?? 0))
		add(`recorder_${rid}_active`, `${recLabel} Active`, status.active)
		add(`recorder_${rid}_total`, `${recLabel} Total`, status.total)

		if (config.poll_archive) {
			const file = rec.lastFile || {}
			let fileName = val(file.name)
			if (fileName !== '' && file.extension && !String(fileName).endsWith(`.${file.extension}`)) {
				fileName = `${fileName}.${file.extension}`
			}
			add(`recorder_${rid}_last_file_name`, `${recLabel} Last File Name`, fileName)
			add(`recorder_${rid}_last_file_size_mb`, `${recLabel} Last File Size (MB)`, mb(file.size))
			add(`recorder_${rid}_last_file_created`, `${recLabel} Last File Created`, file.created)
		}
	}

	add('recorders_active_count', 'Recorders Active Count', recordersActive)
	add('publishers_active_count', 'Publishers Active Count', publishersActive)

	// ---------------------------------------------------------------- inputs
	const inputs = state.inputs || {}
	for (const rawSid of Object.keys(inputs)) {
		const input = inputs[rawSid] || {}
		const sid = safeId(rawSid)
		const inLabel = labelFor('Input', rawSid, input.name)
		add(`input_${sid}_name`, `${inLabel} Name`, input.name)
		add(`input_${sid}_type`, `${inLabel} Type`, input.type)
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

	// ---------------------------------------------------------------- storages
	const storages = state.storages || {}
	for (const rawStid of Object.keys(storages)) {
		const storage = storages[rawStid] || {}
		const stid = safeId(rawStid)
		const status = storage.status || {}
		const stLabel = `Storage ${rawStid}`
		add(`storage_${stid}_state`, `${stLabel} State`, status.state)
		add(`storage_${stid}_media_type`, `${stLabel} Media Type`, status.media_type)
		add(`storage_${stid}_total_gb`, `${stLabel} Total (GB)`, gb(status.total))
		add(`storage_${stid}_free_gb`, `${stLabel} Free (GB)`, gb(status.free))
		add(`storage_${stid}_free_percent`, `${stLabel} Free (%)`, percent(status.free, status.total))
	}

	// ---------------------------------------------------------------- single touch control
	const singleTouch = state.singleTouch || {}
	for (const rawStcid of Object.keys(singleTouch)) {
		const stc = singleTouch[rawStcid] || {}
		const stcid = safeId(rawStcid)
		const st = stc.state || {}
		const stcLabel = `Single Touch ${rawStcid}`
		add(`stc_${stcid}_pressed`, `${stcLabel} Pressed`, typeof st.pressed === 'boolean' ? st.pressed : '')
		add(`stc_${stcid}_status`, `${stcLabel} Status OK`, typeof st.status === 'boolean' ? st.status : '')
		add(`stc_${stcid}_recorders_active`, `${stcLabel} Recorders Active`, num(st.recorders?.active))
		add(`stc_${stcid}_recorders_total`, `${stcLabel} Recorders Total`, num(st.recorders?.total))
		add(`stc_${stcid}_publishers_active`, `${stcLabel} Publishers Active`, num(st.publishers?.active))
		add(`stc_${stcid}_publishers_total`, `${stcLabel} Publishers Total`, num(st.publishers?.total))
	}

	// ---------------------------------------------------------------- AFU
	const afuList = Array.isArray(state.afu) ? state.afu : []
	const afuFirst = (afuList[0] && afuList[0].status) || {}
	add(
		'afu_state',
		'AFU State',
		afuList.map((a) => (a && a.status && a.status.state !== undefined ? a.status.state : '')).join(','),
	)
	add('afu_protocol', 'AFU Protocol', afuFirst.protocol)
	add('afu_queue_files', 'AFU Queue Files', num(afuFirst.queue?.files))
	add('afu_queue_size_mb', 'AFU Queue Size (MB)', mb(afuFirst.queue?.size))
	add('afu_file_name', 'AFU Uploading File Name', afuFirst.file?.id)
	add(
		'afu_file_progress_percent',
		'AFU Uploading File Progress (%)',
		percent(afuFirst.file?.uploaded, afuFirst.file?.size),
	)
	add('afu_error', 'AFU Error', afuFirst.error?.message)

	// ---------------------------------------------------------------- system status / firmware / identity
	const sys = state.systemStatus || {}
	add('system_status_date', 'System Status Date', sys.date)
	add('system_status_uptime', 'System Status Uptime (s)', num(sys.uptime))
	add('system_status_uptime_hms', 'System Status Uptime (HH:MM:SS)', hms(sys.uptime))
	add('system_status_cpuload', 'System CPU Load (%)', num(sys.cpuload))
	add('system_cpuload_high', 'System CPU Load High', typeof sys.cpuload_high === 'boolean' ? sys.cpuload_high : '')
	add('system_status_cputemp', 'System CPU Temp (C)', num(sys.cputemp))
	add('system_cputemp_threshold', 'System CPU Temp Threshold (C)', num(sys.cputemp_threshold))

	const fw = state.firmware || {}
	add('firmware_version', 'Firmware Version', fw.version)
	add('firmware_revision', 'Firmware Revision', fw.revision)
	add('product_name', 'Product Name', fw.product_name)
	add('product_id', 'Product ID', num(fw.product_id))

	const ident = state.identity || {}
	add('identity_name', 'Identity Name', ident.name)
	add('identity_location', 'Identity Location', ident.location)
	add('identity_description', 'Identity Description', ident.description)

	// ---------------------------------------------------------------- events
	const events = state.events || {}
	const upcoming = events.upcoming || null
	const ongoing = events.ongoing || null

	add('event_upcoming_id', 'Upcoming Event ID', upcoming ? upcoming.id : '')
	add('event_upcoming_title', 'Upcoming Event Title', upcoming ? upcoming.title : '')
	add('event_upcoming_start', 'Upcoming Event Start (unix)', upcoming ? num(upcoming.start) : '')
	add('event_upcoming_start_time', 'Upcoming Event Start Time (HH:MM)', upcoming ? clock(upcoming.start) : '')
	add(
		'event_upcoming_starts_in_hms',
		'Upcoming Event Starts In (HH:MM:SS)',
		upcoming && num(upcoming.start) !== undefined ? hms(num(upcoming.start) - nowSeconds) : '',
	)

	add('event_ongoing_id', 'Ongoing Event ID', ongoing ? ongoing.id : '')
	add('event_ongoing_title', 'Ongoing Event Title', ongoing ? ongoing.title : '')
	add('event_ongoing_status', 'Ongoing Event Status', ongoing ? ongoing.status : '')
	add('event_ongoing_finish', 'Ongoing Event Finish (unix)', ongoing ? num(ongoing.finish) : '')
	add('event_ongoing_finish_time', 'Ongoing Event Finish Time (HH:MM)', ongoing ? clock(ongoing.finish) : '')
	add(
		'event_ongoing_remaining_hms',
		'Ongoing Event Remaining (HH:MM:SS)',
		ongoing && num(ongoing.finish) !== undefined ? hms(num(ongoing.finish) - nowSeconds) : '',
	)

	// ---------------------------------------------------------------- connectivity
	const conn = state.connectivity || {}
	add('connectivity_external_ip', 'Connectivity External IP', conn.external_ip)
	add('connectivity_mdns', 'Connectivity mDNS Name', conn.mdns)
	add('connectivity_dns', 'Connectivity DNS', conn.dns)
	add('connectivity_http', 'Connectivity HTTP', conn.http)
	add('connectivity_https', 'Connectivity HTTPS', conn.https)
	add('connectivity_captive_portal', 'Connectivity Captive Portal', conn.captive_portal)
	add('connectivity_icmp', 'Connectivity ICMP', conn.icmp)
	add('connectivity_epiphan_edge', 'Connectivity Epiphan Edge', conn.epiphan_edge)
	add('connectivity_vtun', 'Connectivity VTUN', conn.vtun)

	// ---------------------------------------------------------------- speed test
	const speed = state.speedtest || {}
	const bandwidth = num(speed.bandwidth)
	add(
		'speedtest_bandwidth_mbps',
		'Speed Test Bandwidth (Mbps)',
		bandwidth === undefined ? '' : round1(bandwidth / 1000000),
	)
	add('speedtest_protocol', 'Speed Test Protocol', speed.protocol)
	add('speedtest_mode', 'Speed Test Mode', speed.mode)
	add('speedtest_duration', 'Speed Test Duration (s)', num(speed.duration))
	add('speedtest_udp_loss', 'Speed Test UDP Loss', num(speed.udp?.loss))

	// ---------------------------------------------------------------- configuration presets
	const presets = Array.isArray(state.presets) ? state.presets : []
	add(
		'config_presets',
		'Configuration Presets',
		presets
			.map((p) => (p && p.name !== undefined ? String(p.name) : ''))
			.filter((n) => n !== '')
			.join(','),
	)

	return { definitions, values }
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
			self.setVariableDefinitions(definitions)
		}
		self.setVariableValues(values)
	} catch (e) {
		if (self && typeof self.log === 'function') {
			self.log('error', `Failed to update variables: ${e && e.message ? e.message : e}`)
		}
	}
}

module.exports = { buildVariables, updateVariables }
