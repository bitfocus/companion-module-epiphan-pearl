// D-numbers (D1–D17) refer to Epiphan's internal Companion-parity decisions.
const variables = require('./variables')
const { stableJson, emptyState, normaliseInputId, clampNumber } = require('./utils')

/** every Nth poll the slow changing system information is refreshed */
const STRUCTURE_REFRESH_EVERY = 30
/**
 * Preview images are fetched this many at a time rather than all at once. The Pearl is an embedded
 * device: firing one request per placed preview button (there can easily be a dozen or more) at the
 * same instant tends to overwhelm it, so most of them time out instead of a few taking slightly longer.
 */
const MAX_CONCURRENT_PREVIEWS = 3
/** poll_interval bounds (D8); kept in sync with src/config.js's field of the same name */
const POLL_INTERVAL_DEFAULT_MS = 2000
const POLL_INTERVAL_MIN_MS = 500
const POLL_INTERVAL_MAX_MS = 300000
/** failure backoff cap (D8): a failing poll never waits longer than this before retrying */
const POLL_BACKOFF_MAX_MS = 15000

/**
 * Return the fulfilled value of a Promise.allSettled entry or `fallback`
 */
function settled(entry, fallback = undefined) {
	return entry && entry.status === 'fulfilled' ? entry.value : fallback
}

/**
 * Feedback ids to re-check per state domain when that domain changed (D7 ids).
 */
const DOMAIN_FEEDBACKS = {
	layouts: ['layout_active'],
	publishers: ['stream_state'],
	recorders: ['recorder_state'],
	storages: ['storage_level'],
	singleTouch: ['singletouch_active'],
	afu: ['system'],
	systemStatus: ['system'],
	events: ['event_state', 'event_applies'],
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
	 * Base interval between polls, in milliseconds (D8): `config.poll_interval`, clamped 500..300000,
	 * default 2000. `normaliseConfig()` always fills this field (the upgrade script converts the stored
	 * pre-3.0.0 seconds-based field before a config ever reaches here), so no fallback is needed.
	 *
	 * @returns {number}
	 */
	pollIntervalMs() {
		return clampNumber(
			this.config?.poll_interval,
			POLL_INTERVAL_DEFAULT_MS,
			POLL_INTERVAL_MIN_MS,
			POLL_INTERVAL_MAX_MS,
		)
	},

	/**
	 * Delay before the next poll should run (D8): the base interval while polls are succeeding, doubling
	 * per consecutive failed poll and capped at 15 s. `pollAllInner` resets the failure count to 0 on the
	 * first successful poll and increments it when the core request fails. `instance.js`'s `initInterval()`
	 * chains via `setTimeout` and recomputes this value after every poll, so the backoff actually widens the gap between real polls.
	 *
	 * @returns {number} milliseconds
	 */
	nextPollDelayMs() {
		const base = this.pollIntervalMs()
		const failures = Math.max(0, Number(this.pollFailureCount) || 0)
		if (failures === 0) return base
		return Math.min(POLL_BACKOFF_MAX_MS, base * Math.pow(2, failures))
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
		const isV2 = this.isV2
		const prev = this.state || emptyState()
		const state = emptyState()
		const req = (method, path, opts = {}) => this.request(method, path, { silent: true, ...opts })

		// ---- 1. core (both API versions)
		const coreResults = await Promise.allSettled([
			isV2
				? req('GET', '/channels', {
						query: { publishers: true, 'publishers-status': true, active_layout: true },
					})
				: req('GET', '/channels', { query: { publishers: 'yes' } }),
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
			// D8: back off the next poll instead of retrying at the full (possibly very short) interval
			this.pollFailureCount = (this.pollFailureCount || 0) + 1
			return
		}
		if (this.pollErrorLogged) {
			this.log('info', 'Connection to device restored')
			this.pollErrorLogged = false
		}
		// D8: reset on the first successful poll
		this.pollFailureCount = 0

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
				req('GET', '/inputs').then(async (inputs) => {
					const list = Array.isArray(inputs) ? inputs : []
					for (const input of list) {
						if (!input || input.id === undefined) continue
						state.inputs[input.id] = {
							id: String(input.id),
							name: input.name ?? String(input.id),
							type: input.type,
							audio: input.audio === true,
							video: input.video === true,
							real_device_name: input.real_device_name,
							// levels come from the 500 ms meter poll (src/meter.js), not from this one:
							// carried over so a state swap does not blank a subscribed meter for a tick
							levels: prev.inputs?.[input.id]?.levels,
							audioState: prev.inputs?.[input.id]?.audioState,
							settings: undefined,
						}
					}
					// gain/delay settings cache for the audio action's variables (input_<id>_gain / _delay);
					// only audio-capable inputs have anything to read here
					await Promise.allSettled(
						list
							.filter((input) => input && input.id !== undefined && input.audio === true)
							.map((input) =>
								req('GET', `/inputs/${encodeURIComponent(input.id)}/settings`, { optional: true }).then(
									(settings) => {
										if (settings && typeof settings === 'object')
											state.inputs[input.id].settings = settings
									},
								),
							),
					)
				}),
			)
			round2.push(
				req('GET', '/outputs').then((outputs) => {
					for (const output of Array.isArray(outputs) ? outputs : []) {
						if (!output || output.id === undefined) continue
						state.outputs[output.id] = {
							id: String(output.id),
							name: output.name ?? String(output.id),
							// optimistic: no read endpoint for the current source, so carried over from the last poll
							source: prev.outputs?.[output.id]?.source,
							setAt: prev.outputs?.[output.id]?.setAt,
						}
					}
				}),
			)
			round2.push(
				req('GET', '/system/storages').then(async (storages) => {
					const list = Array.isArray(storages) ? storages : []
					for (const storage of list) {
						if (!storage || storage.id === undefined) continue
						// hint ({text, until}) is optimistic, set by the storage action; carried over like output source
						state.storages[storage.id] = {
							id: String(storage.id),
							status: undefined,
							hint: prev.storages?.[storage.id]?.hint,
						}
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
				// feeds choicesEventRefs() and the event_state / event_applies feedbacks for a specific event id (D5)
				round2.push(
					req('GET', '/schedule/events', { query: { limit: 10 }, optional: true }).then((list) => {
						state.events.list = Array.isArray(list) ? list : []
					}),
				)
			}
			// poll_events off (or not reached yet this round): events stay at emptyState()'s null/[] defaults,
			// same as upcoming/ongoing above

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
		} else {
			// v1: nothing beyond channels/layouts/publishers/recorders is available
			state.firmware = prev.firmware
			state.identity = prev.identity
		}
		// optimistic / action-set fields carried over across polls (no read endpoint, or expiry is
		// judged from `until` at variable-render time rather than here)
		state.lastConfigPreset = prev.lastConfigPreset
		state.presetStatus = prev.presetStatus
		state.powerStatus = prev.powerStatus
		state.lastError = prev.lastError

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
		const feedbacksToCheck = new Set()
		if (!structureChanged) {
			const before = domainSlices(prev)
			const after = domainSlices(state)
			for (const [domain, ids] of Object.entries(DOMAIN_FEEDBACKS)) {
				if (stableJson(before[domain]) !== stableJson(after[domain]))
					for (const id of ids) feedbacksToCheck.add(id)
			}
		}

		this.state = state

		if (structureChanged) {
			this.updateSystem()
			this.checkFeedbacks()
			if (!firstPoll) this.log('info', 'Pearl configuration has changed, choices and presets updated.')
		} else {
			// output_set expires after a fixed 5 s window rather than on a state change, so it has no
			// entry in DOMAIN_FEEDBACKS; instead it is rechecked every poll while any output was set
			// recently enough that the window could still be closing (a generous margin of one poll
			// interval past the 5 s mark covers the fall-off even at a slow poll_interval), and left
			// alone otherwise so an idle connection that never touched an output checks nothing extra
			const outputSetFalling = Object.values(state.outputs || {}).some((output) => {
				const setAt = Number(output?.setAt)
				return Number.isFinite(setAt) && Date.now() - setAt < 5000 + this.pollIntervalMs()
			})
			if (outputSetFalling) feedbacksToCheck.add('output_set')
			// checkFeedbacks() with no ids at all means "recheck everything" in Companion, so it must
			// only ever be called here with at least one id, never bare (that meaning is reserved for
			// the structureChanged branch above)
			if (feedbacksToCheck.size > 0) this.checkFeedbacks(...feedbacksToCheck)
		}

		// ---- 7. variables
		try {
			variables.updateVariables(this)
		} catch (error) {
			this.log('error', `Updating variables failed: ${error?.message || error}`)
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
	 * INTERNAL: attach the audio state and levels of the legacy /sources/status list to state.inputs.
	 * Its ids carry a D2P<serial>. prefix that the /inputs ids lack, so both sides are compared
	 * through normaliseInputId(); entries without a matching input are ignored.
	 * Called by the 500 ms meter poll (src/meter.js applyMeterSnapshot) — the interval poll does not
	 * request levels at all.
	 */
	applyInputLevels(state, sourcesStatus) {
		const byNormalisedId = new Map()
		for (const input of Object.values(state.inputs || {})) byNormalisedId.set(normaliseInputId(input.id), input)
		const finite = (v) => typeof v === 'number' && Number.isFinite(v)
		for (const entry of Array.isArray(sourcesStatus) ? sourcesStatus : []) {
			if (!entry || entry.id === undefined) continue
			const input = state.inputs[entry.id] ?? byNormalisedId.get(normaliseInputId(entry.id))
			if (!input) continue
			const audio = entry.status?.audio
			if (!audio || typeof audio !== 'object') continue
			input.audioState = typeof audio.state === 'string' ? audio.state : undefined
			const levels = audio.levels
			if (levels && typeof levels === 'object' && Array.isArray(levels.rms)) {
				input.levels = {
					rms: levels.rms.filter(finite),
					peak: Array.isArray(levels.peak) ? levels.peak.filter(finite) : [],
				}
			}
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
	 * Channel/input/output previews are skipped on the legacy API (v2.0 only); layout previews are
	 * attempted regardless, since they use the legacy base.
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
	 * INTERNAL: the actual preview refresh (never throws). Fetches at most MAX_CONCURRENT_PREVIEWS
	 * images at a time so a page full of preview buttons does not fire dozens of simultaneous
	 * requests at the device.
	 */
	async pollPreviewsInner() {
		try {
			const keys = [...this.previewSubscriptions.entries()].filter(([, count]) => count > 0).map(([key]) => key)
			if (keys.length === 0) return
			let changed = false
			for (let i = 0; i < keys.length; i += MAX_CONCURRENT_PREVIEWS) {
				const batch = keys.slice(i, i + MAX_CONCURRENT_PREVIEWS)
				await Promise.allSettled(
					batch.map(async (key) => {
						const idx = key.indexOf(':')
						if (idx <= 0) return
						const kind = key.slice(0, idx)
						const id = key.slice(idx + 1)
						// channel/input/output previews are v2.0-only; layout previews use the legacy base
						// (see fetchPreviewImage) and are attempted regardless of the detected API version
						if (kind !== 'layout' && !this.isV2) return
						const png64 = await this.fetchPreviewImage(kind, id)
						if (png64 === null) {
							// log once per key on failure (not every poll) so a persistently broken preview is
							// visible without turning on verbose logging; a single missed poll stays quiet
							if (!this.previewFailedKeys.has(key)) {
								this.previewFailedKeys.add(key)
								this.log(
									'warn',
									`Preview image for ${kind} ${id} could not be fetched (no signal, or the request failed/timed out). ` +
										'Enable verbose logging to see the underlying request. This is logged once until it recovers.',
								)
							}
							return
						}
						if (this.previewFailedKeys.delete(key)) {
							this.log('info', `Preview image for ${kind} ${id} is available again`)
						}
						// unsubscribed while the image was in flight: do not cache it
						if (!this.previewSubscriptions.has(key)) return
						if (this.previews[key]?.png64 !== png64) changed = true
						this.previews[key] = { png64, fetchedAt: Date.now() }
					}),
				)
			}
			if (changed) this.checkFeedbacks('preview', 'layout_preview')
		} catch (error) {
			this.log('error', `Preview poll failed: ${error?.message || error}`)
		}
	},
}
