const GB = 1e9 // decimal gigabytes, like the size printed on the drive

/**
 * Format a duration in seconds as hh:mm:ss, with days in front when it is longer than a day
 * (e.g. 3725 -> '01:02:05', 93784 -> '1d 02:03:04')
 *
 * @param {number|undefined} seconds
 * @param {boolean} [withSeconds=true]
 * @param {boolean} [withDays=true] - false shows all hours, e.g. '53:20' instead of '2d 05:20'
 * @returns {string} '' if the duration is unknown
 */
function formatDuration(seconds, withSeconds = true, withDays = true) {
	if (typeof seconds !== 'number' || !isFinite(seconds) || seconds < 0) return ''
	seconds = Math.floor(seconds)
	const days = withDays ? Math.floor(seconds / 86400) : 0
	const pad = (n) => String(n).padStart(2, '0')
	const time = [Math.floor((seconds - days * 86400) / 3600), Math.floor((seconds % 3600) / 60)]
	if (withSeconds) time.push(seconds % 60)
	return (days > 0 ? `${days}d ` : '') + time.map(pad).join(':')
}

/** Round to one decimal place, keeping it a number for use in expressions */
const round1 = (value) => Math.round(value * 10) / 10

/**
 * Sum of the current bitrate (kbit/s) of all channels which are being recorded right now.
 * Multi-source recorders are not included, it is not known which channels they record.
 *
 * @returns {number}
 */
function recordingBitrate(self) {
	let kbps = 0
	for (const [rid, recorder] of Object.entries(self.state.recorders)) {
		if (recorder.status?.state !== 'started' || recorder.multisource) continue
		// single-source recorders have the id of the channel they record
		kbps += Number(self.state.channels[rid]?.status?.bitrate) || 0
	}
	return kbps
}

module.exports = {
	formatDuration,

	updateVariables(self) {
		const variables = []
		const values = {}
		const add = (variableId, name, value) => {
			variables.push({ variableId, name })
			values[variableId] = value
		}

		for (const cid of Object.keys(self.state.channels)) {
			const channel = self.state.channels[cid]
			variables.push({
				variableId: `channel_${cid}_name`,
				name: `Channel ${cid} Name`,
			})
			values[`channel_${cid}_name`] = channel.name
			const activeLayout = Object.values(channel.layouts || {}).find((l) => l.active)
			variables.push({
				variableId: `channel_${cid}_active_layout`,
				name: `Channel ${cid} Active Layout`,
			})
			values[`channel_${cid}_active_layout`] = activeLayout ? activeLayout.name : ''

			// channel status of the v1 API: input signal and the current total bitrate (video + audio)
			if (channel.status) {
				add(
					`channel_${cid}_signal`,
					`Channel ${cid} Signal`,
					channel.status.nosignal === undefined ? '' : channel.status.nosignal ? 'No signal' : 'OK',
				)
				add(
					`channel_${cid}_total_bitrate`,
					`Channel ${cid} Total Bitrate (kbit/s)`,
					channel.status.bitrate ?? '',
				)
			}

			// API v2.0 marks the video encoder with type 'video', the v1 API has no type, there the video
			// encoder is the one reporting a resolution
			const encoders = channel.encoders || []
			const videoEncoder =
				encoders.find((e) => e.type === 'video') ??
				encoders.find((e) => e.type === undefined && (e.status?.resolution || e.resolution))
			if (videoEncoder) {
				const encStatus = videoEncoder.status ?? {}
				variables.push({
					variableId: `channel_${cid}_resolution`,
					name: `Channel ${cid} Resolution`,
				})
				variables.push({
					variableId: `channel_${cid}_fps`,
					name: `Channel ${cid} FPS`,
				})
				variables.push({
					variableId: `channel_${cid}_bitrate`,
					name: `Channel ${cid} Bitrate`,
				})
				values[`channel_${cid}_resolution`] = encStatus.resolution ?? videoEncoder.resolution ?? ''
				// the current values from the channel status come first ('fps' there), the encoder settings
				// ('framerate') are only the fallback
				values[`channel_${cid}_fps`] = encStatus.fps ?? encStatus.framerate ?? videoEncoder.framerate ?? ''
				values[`channel_${cid}_bitrate`] = encStatus.bitrate ?? videoEncoder.bitrate ?? ''
			}

			for (const pid of Object.keys(channel.publishers || {})) {
				const pub = channel.publishers[pid]
				variables.push({
					variableId: `stream_${cid}_${pid}_name`,
					name: `Stream ${cid}-${pid} Name`,
				})
				values[`stream_${cid}_${pid}_name`] = pub.name
				variables.push({
					variableId: `stream_${cid}_${pid}_state`,
					name: `Stream ${cid}-${pid} State`,
				})
				values[`stream_${cid}_${pid}_state`] = pub.status?.state || ''
				if (pub.status?.statistics?.current?.send_rate !== undefined) {
					variables.push({
						variableId: `stream_${cid}_${pid}_bitrate`,
						name: `Stream ${cid}-${pid} Bitrate`,
					})
					values[`stream_${cid}_${pid}_bitrate`] = pub.status.statistics.current.send_rate
				}
				// duration, reconnections and the error text are only reported while the stream runs
				// or after it failed, otherwise the values are empty
				add(
					`stream_${cid}_${pid}_duration`,
					`Stream ${cid}-${pid} Duration`,
					formatDuration(pub.status?.duration),
				)
				add(
					`stream_${cid}_${pid}_reconnections`,
					`Stream ${cid}-${pid} Reconnections`,
					pub.status?.reconnections ?? '',
				)
				add(
					`stream_${cid}_${pid}_error`,
					`Stream ${cid}-${pid} Error`,
					pub.status?.state === 'error' ? pub.status.description || 'error' : '',
				)
			}
		}

		for (const rid of Object.keys(self.state.recorders)) {
			const rec = self.state.recorders[rid]
			variables.push({
				variableId: `recorder_${rid}_state`,
				name: `Recorder ${rid} State`,
			})
			values[`recorder_${rid}_state`] = rec.status?.state || ''
			variables.push({
				variableId: `recorder_${rid}_duration`,
				name: `Recorder ${rid} Duration`,
			})
			values[`recorder_${rid}_duration`] = rec.status?.duration || 0
			add(
				`recorder_${rid}_duration_hms`,
				`Recorder ${rid} Duration (hh:mm:ss)`,
				formatDuration(rec.status?.state === 'started' ? rec.status.duration || 0 : 0),
			)
			variables.push({
				variableId: `recorder_${rid}_active`,
				name: `Recorder ${rid} Active`,
			})
			values[`recorder_${rid}_active`] = rec.status?.active || ''
		}

		if (self.state.systemStatus) {
			variables.push({
				variableId: 'system_status_date',
				name: 'System Status Date',
			})
			variables.push({
				variableId: 'system_status_uptime',
				name: 'System Status Uptime',
			})
			variables.push({
				variableId: 'system_status_cpuload',
				name: 'System CPU Load',
			})
			variables.push({
				variableId: 'system_status_cputemp',
				name: 'System CPU Temp',
			})
			const status = self.state.systemStatus
			values['system_status_date'] = status.date || ''
			// Fix: a value of 0 (e.g. 0 % CPU load) was shown as empty
			values['system_status_uptime'] = status.uptime ?? ''
			values['system_status_cpuload'] = status.cpuload ?? ''
			values['system_status_cputemp'] = status.cputemp ?? ''
			add('system_status_uptime_hms', 'System Uptime (d hh:mm:ss)', formatDuration(status.uptime))
			// the Pearl reports its own thresholds, so the warnings match the Pearl's admin panel
			add('system_status_cpuload_high', 'System CPU Load High', status.cpuload_high === true)
			add(
				'system_status_cputemp_high',
				'System CPU Temp High',
				typeof status.cputemp === 'number' && typeof status.cputemp_threshold === 'number'
					? status.cputemp >= status.cputemp_threshold
					: false,
			)
		}

		// storages (API v2.0): 'main' is the internal drive, 'external' and 'maintenance' are USB
		if (self.state.storages) {
			const recordingKbps = recordingBitrate(self)
			for (const [sid, storage] of Object.entries(self.state.storages)) {
				const label = `Storage ${sid}`
				add(`storage_${sid}_state`, `${label} State`, storage.state ?? '')
				const hasSize =
					typeof storage.total === 'number' && storage.total > 0 && typeof storage.free === 'number'
				const used = hasSize ? storage.total - storage.free : 0
				add(`storage_${sid}_total_gb`, `${label} Total (GB)`, hasSize ? round1(storage.total / GB) : '')
				add(`storage_${sid}_used_gb`, `${label} Used (GB)`, hasSize ? round1(used / GB) : '')
				add(`storage_${sid}_free_gb`, `${label} Free (GB)`, hasSize ? round1(storage.free / GB) : '')
				add(
					`storage_${sid}_used_percent`,
					`${label} Used (%)`,
					hasSize ? round1((used / storage.total) * 100) : '',
				)
				add(
					`storage_${sid}_free_percent`,
					`${label} Free (%)`,
					hasSize ? round1((storage.free / storage.total) * 100) : '',
				)
				// estimated from the bitrate of the running recordings, empty while nothing is recorded
				const remainingSeconds =
					hasSize && recordingKbps > 0 ? (storage.free * 8) / (recordingKbps * 1000) : undefined
				add(
					`storage_${sid}_remaining_time`,
					`${label} Remaining Recording Time (hh:mm)`,
					formatDuration(remainingSeconds, false, false),
				)
				add(
					`storage_${sid}_remaining_minutes`,
					`${label} Remaining Recording Time (minutes)`,
					remainingSeconds === undefined ? '' : Math.floor(remainingSeconds / 60),
				)
			}
		}

		if (self.state.afu) {
			variables.push({ variableId: 'afu_state', name: 'AFU State' })
			values['afu_state'] = Array.isArray(self.state.afu)
				? self.state.afu.map((a) => a.status.state).join(',')
				: ''
		}
		if (self.state.firmware) {
			variables.push({
				variableId: 'firmware_version',
				name: 'Firmware Version',
			})
			variables.push({ variableId: 'product_name', name: 'Product Name' })
			values['firmware_version'] = self.state.firmware.version || ''
			values['product_name'] = self.state.firmware.product_name || ''
		}
		if (self.state.identity) {
			variables.push({ variableId: 'identity_name', name: 'Identity Name' })
			variables.push({
				variableId: 'identity_location',
				name: 'Identity Location',
			})
			variables.push({
				variableId: 'identity_description',
				name: 'Identity Description',
			})
			values['identity_name'] = self.state.identity.name || ''
			values['identity_location'] = self.state.identity.location || ''
			values['identity_description'] = self.state.identity.description || ''
		}
		if (self.metadata) {
			for (const cid of Object.keys(self.metadata)) {
				const md = self.metadata[cid]
				variables.push({
					variableId: `channel_${cid}_metadata_title`,
					name: `Channel ${cid} Metadata Title`,
				})
				variables.push({
					variableId: `channel_${cid}_metadata_author`,
					name: `Channel ${cid} Metadata Author`,
				})
				variables.push({
					variableId: `channel_${cid}_metadata_rec_prefix`,
					name: `Channel ${cid} Filename Prefix`,
				})
				values[`channel_${cid}_metadata_title`] = md.title || ''
				values[`channel_${cid}_metadata_author`] = md.author || ''
				values[`channel_${cid}_metadata_rec_prefix`] = md.rec_prefix || ''
			}
		}

		// module-base 2.x: variable definitions are an object keyed by the variable id instead of an array
		self.setVariableDefinitions(Object.fromEntries(variables.map((v) => [v.variableId, { name: v.name }])))
		self.setVariableValues(values)
	},
}
