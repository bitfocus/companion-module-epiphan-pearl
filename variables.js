module.exports = {
	updateVariables(self) {
		const variables = []
		const values = {}

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

			const videoEncoder = (channel.encoders || []).find((e) => e.type === 'video')
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
				values[`channel_${cid}_fps`] = encStatus.framerate ?? videoEncoder.framerate ?? ''
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
			values['system_status_date'] = self.state.systemStatus.date || ''
			values['system_status_uptime'] = self.state.systemStatus.uptime || ''
			values['system_status_cpuload'] = self.state.systemStatus.cpuload || ''
			values['system_status_cputemp'] = self.state.systemStatus.cputemp || ''
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

		self.setVariableDefinitions(variables)
		self.setVariableValues(values)
	},
}
