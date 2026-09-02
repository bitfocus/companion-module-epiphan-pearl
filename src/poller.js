const variables = require('./variables')
const { stableJson, emptyState, metadataRetryDue } = require('./utils')

/** every Nth poll the slow changing system information is refreshed */
const STRUCTURE_REFRESH_EVERY = 30
/** every Nth poll the connectivity details are refreshed (when enabled) */
const CONNECTIVITY_EVERY = 6

/**
 * Return the fulfilled value of a Promise.allSettled entry or `fallback`
 */
function settled(entry, fallback = undefined) {
	return entry && entry.status === 'fulfilled' ? entry.value : fallback
}

/**
 * Feedback ids to re-check per state domain when that domain changed
 */
const DOMAIN_FEEDBACKS = {
	// channelLayoutPreview shows/hides its image based on which layout is active, same trigger as channelLayout
	layouts: ['channelLayout', 'channelLayoutPreview'],
	publishers: ['streamingState', 'publisherState', 'anyStreaming'],
	recorders: ['recorderRecording', 'recorderState', 'anyRecording'],
	storages: ['storageState', 'storageFreeBelow'],
	singleTouch: ['singleTouchPressed', 'singleTouchOk'],
	afu: ['afuState'],
	systemStatus: ['cpuLoadHigh', 'cpuTempHigh'],
	events: ['eventStatus'],
}

/**
 * Extract the per-domain slices used for change detection
 */
function domainSlices(state) {
	const channels = Object.values(state.channels || {})
	return {
		layouts: channels.map((c) => ({
			id: c.id,
			active: c.active_layout?.id ?? null,
			layouts: Object.values(c.layouts || {}).map((l) => [l.id, !!l.active]),
		})),
		publishers: channels.map((c) => ({
			id: c.id,
			publishers: Object.values(c.publishers || {}).map((p) => [p.id, p.status ?? null]),
		})),
		recorders: Object.values(state.recorders || {}).map((r) => [r.id, r.status ?? null]),
		storages: Object.values(state.storages || {}).map((s) => [s.id, s.status ?? null]),
		singleTouch: Object.values(state.singleTouch || {}).map((s) => [s.id, s.state ?? null]),
		afu: state.afu ?? [],
		systemStatus: state.systemStatus ?? null,
		events: state.events ?? null,
	}
}

module.exports = {
	/**
	 * Structure key: JSON of ids and names of everything that feeds dropdown choices and presets.
	 * When it changes the action/feedback/preset definitions are rebuilt.
	 *
	 * @param {object} state
	 * @returns {string}
	 */
	structureKey(state) {
		const s = state || emptyState()
		return stableJson({
			channels: Object.values(s.channels || {}).map((c) => ({
				id: c.id,
				name: c.name,
				layouts: Object.values(c.layouts || {}).map((l) => [l.id, l.name]),
				publishers: Object.values(c.publishers || {}).map((p) => [p.id, p.name, p.type]),
			})),
			recorders: Object.values(s.recorders || {}).map((r) => [r.id, r.name]),
			inputs: Object.values(s.inputs || {}).map((i) => [i.id, i.name, i.type, !!i.audio]),
			outputs: Object.values(s.outputs || {}).map((o) => [o.id, o.name]),
			storages: Object.values(s.storages || {}).map((st) => st.id),
			singleTouch: Object.values(s.singleTouch || {}).map((st) => st.id),
			presets: (s.presets || []).map((p) => p.name),
		})
	},

	/**
	 * Poll everything. Never throws. An overlapping call does not start a second poll but
	 * returns the promise of the poll that is already running.
	 */
	async pollAll() {
		if (this.pollPromise) {
			if (this.config?.verbose) this.log('debug', 'Poll skipped, previous poll still running')
			return this.pollPromise
		}
		this.pollInProgress = true
		this.pollPromise = this.pollAllInner()
			.catch((error) => {
				this.log('error', `Poll failed: ${error?.message || error}`)
			})
			.finally(() => {
				this.pollInProgress = false
				this.pollPromise = undefined
			})
		return this.pollPromise
	},

	/**
	 * INTERNAL: the actual poll, may throw (caught by pollAll)
	 */
	async pollAllInner() {
		if (!this.config || !this.config.host) return

		// configUpdated() bumps the generation; a poll started before that must not swap in its result
		const gen = this.configGeneration
		this.pollCounter = (this.pollCounter || 0) + 1
		const firstPoll = this.pollCounter === 1
		const refreshSystemInfo = firstPoll || (this.pollCounter - 1) % STRUCTURE_REFRESH_EVERY === 0
		const refreshConnectivity =
			this.config.poll_connectivity === true && (firstPoll || (this.pollCounter - 1) % CONNECTIVITY_EVERY === 0)
		const isV2 = this.isV2
		const prev = this.state || emptyState()
		const state = emptyState()
		const req = (method, path, opts = {}) => this.request(method, path, { silent: true, ...opts })

		// ---- 1. core (both API versions)
		const coreResults = await Promise.allSettled([
			isV2
				? req('GET', '/channels', {
						query: { publishers: true, 'publishers-status': true, encoders: true, active_layout: true },
					})
				: req('GET', '/channels', { query: { publishers: 'yes', encoders: 'yes' } }),
			req('GET', '/recorders'),
			req('GET', '/recorders/status'),
		])
		const [channelsRes, recordersRes, recordersStatusRes] = coreResults

		if (channelsRes.status !== 'fulfilled' || recordersRes.status !== 'fulfilled') {
			const reason = (channelsRes.status === 'rejected' ? channelsRes.reason : recordersRes.reason)?.message
			const message = `No valid answer from device${reason ? ': ' + reason : ''}`
			if (!this.pollErrorLogged) {
				this.log('error', message)
				this.pollErrorLogged = true
			} else if (this.config.verbose) {
				this.log('debug', message)
			}
			return
		}
		if (this.pollErrorLogged) {
			this.log('info', 'Connection to device restored')
			this.pollErrorLogged = false
		}

		const channels = Array.isArray(channelsRes.value) ? channelsRes.value : []
		const recorders = Array.isArray(recordersRes.value) ? recordersRes.value : []
		const recordersStatus = Array.isArray(settled(recordersStatusRes, [])) ? settled(recordersStatusRes, []) : []

		this.applyChannels(state, channels, isV2)
		this.applyRecorders(state, recorders, recordersStatus)

		// ---- 2. second round: legacy layouts (+ v1 publishers), and v2-only collections
		const round2 = []
		const cids = Object.keys(state.channels)
		for (const cid of cids) {
			round2.push(
				req('GET', `/channels/${cid}/layouts`, { base: 'v1' }).then((layouts) =>
					this.applyLayouts(state, cid, layouts),
				),
			)
			if (!isV2) {
				round2.push(
					req('GET', `/channels/${cid}/publishers/type`).then((types) =>
						this.applyPublisherTypes(state, cid, types),
					),
				)
				round2.push(
					req('GET', `/channels/${cid}/publishers/status`).then((statuses) =>
						this.applyPublisherStatuses(state, cid, statuses),
					),
				)
			}
		}

		if (isV2) {
			round2.push(
				req('GET', '/system/status').then((status) => {
					state.systemStatus = status && typeof status === 'object' ? status : undefined
				}),
			)
			round2.push(
				req('GET', '/afu/status', { optional: true }).then((afu) => {
					state.afu = Array.isArray(afu) ? afu : []
				}),
			)
			round2.push(
				req('GET', '/inputs').then((inputs) => {
					for (const input of Array.isArray(inputs) ? inputs : []) {
						if (!input || input.id === undefined) continue
						state.inputs[input.id] = {
							id: String(input.id),
							name: input.name ?? String(input.id),
							type: input.type,
							audio: input.audio === true,
							video: input.video === true,
							real_device_name: input.real_device_name,
						}
					}
				}),
			)
			round2.push(
				req('GET', '/outputs').then((outputs) => {
					for (const output of Array.isArray(outputs) ? outputs : []) {
						if (!output || output.id === undefined) continue
						state.outputs[output.id] = {
							id: String(output.id),
							name: output.name ?? String(output.id),
							source: prev.outputs?.[output.id]?.source,
						}
					}
				}),
			)
			round2.push(
				req('GET', '/system/storages').then(async (storages) => {
					const list = Array.isArray(storages) ? storages : []
					for (const storage of list) {
						if (!storage || storage.id === undefined) continue
						state.storages[storage.id] = { id: String(storage.id), status: undefined }
					}
					await Promise.allSettled(
						list
							.filter((storage) => storage && storage.id !== undefined)
							.map((storage) =>
								req('GET', `/system/storages/${encodeURIComponent(storage.id)}/status`, {
									optional: true,
								}).then((status) => {
									if (status && typeof status === 'object') state.storages[storage.id].status = status
								}),
							),
					)
				}),
			)
			round2.push(
				req('GET', '/system/singletouchcontrol', { optional: true }).then(async (controls) => {
					const list = Array.isArray(controls) ? controls : []
					for (const stc of list) {
						if (!stc || stc.id === undefined) continue
						state.singleTouch[stc.id] = { id: String(stc.id), state: undefined }
					}
					await Promise.allSettled(
						list
							.filter((stc) => stc && stc.id !== undefined)
							.map((stc) =>
								req('GET', `/system/singletouchcontrol/${encodeURIComponent(stc.id)}/state`, {
									optional: true,
								}).then((stcState) => {
									if (stcState && typeof stcState === 'object')
										state.singleTouch[stc.id].state = stcState
								}),
							),
					)
				}),
			)
			if (this.config.poll_events === true) {
				round2.push(
					req('GET', '/schedule/events/upcoming', { optional: true }).then((event) => {
						state.events.upcoming = event && typeof event === 'object' ? event : null
					}),
				)
				round2.push(
					req('GET', '/schedule/events/ongoing', { optional: true }).then((event) => {
						state.events.ongoing = event && typeof event === 'object' ? event : null
					}),
				)
			}

			// ---- 3. slow changing system information
			if (refreshSystemInfo) {
				round2.push(
					req('GET', '/system/firmware').then((firmware) => {
						state.firmware = firmware && typeof firmware === 'object' ? firmware : prev.firmware
					}),
				)
				round2.push(
					req('GET', '/system/ident').then((identity) => {
						state.identity = identity && typeof identity === 'object' ? identity : prev.identity
					}),
				)
				round2.push(
					req('GET', '/system/presets', { query: { details: true }, optional: true }).then((presets) => {
						state.presets = Array.isArray(presets)
							? presets
									.filter((p) => p && typeof p.name === 'string')
									.map((p) => ({
										name: p.name,
										description: p.description ?? '',
										sections: Array.isArray(p.sections) ? p.sections : [],
										readonly: p.readonly === true,
									}))
							: prev.presets || []
					}),
				)
			} else {
				state.firmware = prev.firmware
				state.identity = prev.identity
				state.presets = prev.presets || []
			}

			// ---- 4. conditional
			if (this.config.poll_archive === true) {
				for (const rid of Object.keys(state.recorders)) {
					round2.push(
						req('GET', `/recorders/${encodeURIComponent(rid)}/archive/files`, {
							query: { from: 0, limit: 1 },
							optional: true,
						}).then((files) => {
							state.recorders[rid].lastFile =
								Array.isArray(files) && files.length > 0 ? files[0] : undefined
						}),
					)
				}
			}
			if (refreshConnectivity) {
				round2.push(
					req('GET', '/system/connectivity/details', { optional: true }).then((details) => {
						state.connectivity = details && typeof details === 'object' ? details : prev.connectivity
					}),
				)
			} else {
				state.connectivity = prev.connectivity
			}
		} else {
			// v1: nothing beyond channels/layouts/publishers/recorders is available
			state.firmware = prev.firmware
			state.identity = prev.identity
		}
		state.speedtest = prev.speedtest
		// optimistic, set by the applyConfigPreset action; the API has no read endpoint for it
		state.lastConfigPreset = prev.lastConfigPreset

		const round2Results = await Promise.allSettled(round2)
		if (this.config.verbose) {
			for (const entry of round2Results) {
				if (entry.status === 'rejected')
					this.log('debug', `Poll request failed: ${entry.reason?.message || entry.reason}`)
			}
		}

		// keep optimistic output sources for outputs that were not (re)listed above
		for (const [did, output] of Object.entries(prev.outputs || {})) {
			if (state.outputs[did] && state.outputs[did].source === undefined) state.outputs[did].source = output.source
		}

		// ---- 5./6. swap state and diff
		if (gen !== this.configGeneration) {
			if (this.config.verbose) this.log('debug', 'Poll result discarded, configuration changed meanwhile')
			return
		}
		const structureChanged = this.structureKey(prev) !== this.structureKey(state)
		const feedbacksToCheck = []
		if (!structureChanged) {
			const before = domainSlices(prev)
			const after = domainSlices(state)
			for (const [domain, ids] of Object.entries(DOMAIN_FEEDBACKS)) {
				if (stableJson(before[domain]) !== stableJson(after[domain])) feedbacksToCheck.push(...ids)
			}
		}

		this.state = state

		if (structureChanged) {
			this.updateSystem()
			this.checkFeedbacks()
			if (!firstPoll) this.log('info', 'Pearl configuration has changed, choices and presets updated.')
		} else if (feedbacksToCheck.length > 0) {
			this.checkFeedbacks(...feedbacksToCheck)
		}

		// ---- 7. variables
		try {
			variables.updateVariables(this)
		} catch (error) {
			this.log('error', `Updating variables failed: ${error?.message || error}`)
		}

		// ---- 8. metadata for channels we have not seen yet (or whose failed fetch is due for a retry)
		const now = Date.now()
		const missing = Object.keys(this.state.channels).filter((cid) => metadataRetryDue(this.metadata?.[cid], now))
		if (missing.length > 0) {
			await Promise.allSettled(missing.map((cid) => this.fetchMetadata(cid)))
		}
	},

	/**
	 * INTERNAL: fill state.channels from the /channels result
	 */
	applyChannels(state, channels, isV2) {
		for (const channel of channels) {
			if (!channel || channel.id === undefined) continue
			const cid = String(channel.id)
			const entry = {
				id: cid,
				name: channel.name ?? cid,
				layouts: {},
				publishers: {},
				encoders: Array.isArray(channel.encoders) ? channel.encoders : [],
				active_layout: undefined,
			}
			if (
				isV2 &&
				channel.active_layout &&
				typeof channel.active_layout === 'object' &&
				channel.active_layout.id !== undefined
			) {
				entry.active_layout = { id: String(channel.active_layout.id), name: channel.active_layout.name }
			}
			if (Array.isArray(channel.publishers)) {
				for (const publisher of channel.publishers) {
					if (!publisher || publisher.id === undefined) continue
					entry.publishers[publisher.id] = {
						id: String(publisher.id),
						type: publisher.type,
						name: publisher.name ?? String(publisher.id),
						status: publisher.status && typeof publisher.status === 'object' ? publisher.status : undefined,
					}
				}
			}
			state.channels[cid] = entry
		}
	},

	/**
	 * INTERNAL: fill state.recorders from /recorders and /recorders/status
	 */
	applyRecorders(state, recorders, recordersStatus) {
		for (const recorder of recorders) {
			if (!recorder || recorder.id === undefined) continue
			state.recorders[recorder.id] = {
				id: String(recorder.id),
				name: recorder.name ?? String(recorder.id),
				multisource: recorder.multisource === true,
				status: undefined,
				lastFile: undefined,
			}
		}
		for (const entry of recordersStatus) {
			if (!entry || entry.id === undefined) continue
			if (!state.recorders[entry.id]) {
				// a recorder appeared between the two requests
				state.recorders[entry.id] = {
					id: String(entry.id),
					name: entry.name ?? String(entry.id),
					multisource: false,
					status: undefined,
					lastFile: undefined,
				}
			}
			state.recorders[entry.id].status =
				entry.status && typeof entry.status === 'object' ? entry.status : undefined
		}
	},

	/**
	 * INTERNAL: fill layouts of one channel from the legacy layouts list, honouring v2 active_layout when present
	 */
	applyLayouts(state, cid, layouts) {
		const channel = state.channels[cid]
		if (!channel) return
		const activeId = channel.active_layout?.id
		for (const layout of Array.isArray(layouts) ? layouts : []) {
			if (!layout || layout.id === undefined) continue
			const lid = String(layout.id)
			channel.layouts[lid] = {
				id: lid,
				name: layout.name ?? lid,
				active: activeId !== undefined ? lid === String(activeId) : layout.active === true,
			}
		}
		if (activeId === undefined) {
			const active = Object.values(channel.layouts).find((l) => l.active)
			if (active) channel.active_layout = { id: active.id, name: active.name }
		}
	},

	/**
	 * INTERNAL (v1): merge /publishers/type into a channel
	 */
	applyPublisherTypes(state, cid, types) {
		const channel = state.channels[cid]
		if (!channel) return
		for (const publisher of Array.isArray(types) ? types : []) {
			if (!publisher || publisher.id === undefined) continue
			const existing = channel.publishers[publisher.id] || { id: String(publisher.id), status: undefined }
			existing.type = publisher.type
			existing.name = publisher.name ?? existing.name ?? String(publisher.id)
			channel.publishers[publisher.id] = existing
		}
	},

	/**
	 * INTERNAL (v1): merge /publishers/status into a channel
	 */
	applyPublisherStatuses(state, cid, statuses) {
		const channel = state.channels[cid]
		if (!channel) return
		for (const publisher of Array.isArray(statuses) ? statuses : []) {
			if (!publisher || publisher.id === undefined) continue
			const existing = channel.publishers[publisher.id] || {
				id: String(publisher.id),
				name: String(publisher.id),
			}
			existing.status = publisher.status && typeof publisher.status === 'object' ? publisher.status : undefined
			channel.publishers[publisher.id] = existing
		}
	},

	/**
	 * Refresh preview images for every subscribed key. Never throws.
	 * A call while a refresh is already running queues exactly one follow-up refresh (so a key
	 * subscribed meanwhile still gets its first image promptly) and resolves when that one is done.
	 */
	async pollPreviews() {
		if (this.previewsInProgress) {
			if (!this.previewsRerun) {
				this.previewsRerun = this.previewsPromise.then(() => {
					this.previewsRerun = undefined
					return this.pollPreviews()
				})
			}
			return this.previewsRerun
		}
		if (!this.previewSubscriptions || this.previewSubscriptions.size === 0) return
		if (!this.isV2) return
		// previews disabled in the configuration: subscriptions are kept, images are not fetched
		if (!(Number(this.config?.preview_interval) > 0)) return
		this.previewsInProgress = true
		this.previewsPromise = this.pollPreviewsInner().finally(() => {
			this.previewsInProgress = false
			this.previewsPromise = undefined
		})
		return this.previewsPromise
	},

	/**
	 * INTERNAL: the actual preview refresh (never throws)
	 */
	async pollPreviewsInner() {
		try {
			const keys = [...this.previewSubscriptions.entries()].filter(([, count]) => count > 0).map(([key]) => key)
			if (keys.length === 0) return
			let changed = false
			await Promise.allSettled(
				keys.map(async (key) => {
					const idx = key.indexOf(':')
					if (idx <= 0) return
					const kind = key.slice(0, idx)
					const id = key.slice(idx + 1)
					const png64 = await this.fetchPreviewImage(kind, id)
					if (png64 === null) return
					// unsubscribed while the image was in flight: do not cache it
					if (!this.previewSubscriptions.has(key)) return
					if (this.previews[key]?.png64 !== png64) changed = true
					this.previews[key] = { png64, fetchedAt: Date.now() }
				}),
			)
			if (changed) this.checkFeedbacks('channelPreview', 'inputPreview', 'outputPreview', 'channelLayoutPreview')
		} catch (error) {
			this.log('error', `Preview poll failed: ${error?.message || error}`)
		}
	},

	/**
	 * Compatibility helper (used by older action code): refresh the active layout of one channel
	 *
	 * @param {string|number} channelId
	 */
	async updateActiveChannelLayout(channelId) {
		const cid = String(channelId)
		try {
			const layouts = await this.request('GET', `/channels/${cid}/layouts`, { base: 'v1', silent: true })
			const channel = this.state.channels[cid]
			if (!channel) return
			for (const layout of Array.isArray(layouts) ? layouts : []) {
				if (channel.layouts[layout.id]) channel.layouts[layout.id].active = layout.active === true
				if (layout.active === true) channel.active_layout = { id: String(layout.id), name: layout.name }
			}
			this.checkFeedbacks('channelLayout')
			variables.updateVariables(this)
		} catch (error) {
			this.log('debug', `Could not refresh active layout of channel ${cid}: ${error?.message || error}`)
		}
	},

	/**
	 * Compatibility helper (used by older action code): refresh the status of all recorders
	 */
	async updateRecorderStatus() {
		try {
			const statuses = await this.request('GET', '/recorders/status', { silent: true })
			for (const entry of Array.isArray(statuses) ? statuses : []) {
				if (this.state.recorders[entry.id]) this.state.recorders[entry.id].status = entry.status
			}
			this.checkFeedbacks('recorderRecording', 'recorderState', 'anyRecording')
			variables.updateVariables(this)
		} catch (error) {
			this.log('debug', `Could not refresh recorder status: ${error?.message || error}`)
		}
	},
}
