// D-numbers (D1–D17) refer to Epiphan's internal Companion-parity decisions.
const { splitPair, eventApplies, storageLevel, STORAGE_LOW_PCT, STORAGE_FULL_PCT } = require('./utils')
const { colors, stateStyle } = require('./style')
const { CONFIRM_HINT } = require('./confirm')
const { FAILED_TEXT } = require('./failure')
const { meterOf, renderMeter, METER_DEFAULT_SIZE } = require('./meter')

const RECORDER_STATES = [
	{ id: 'started', label: 'Started' },
	{ id: 'starting', label: 'Starting' },
	{ id: 'paused', label: 'Paused' },
	{ id: 'error', label: 'Error' },
	{ id: 'stopped', label: 'Stopped' },
	{ id: 'disabled', label: 'Disabled' },
]
/** aggregate order for recorderId 'all': the first of these found among the recorders wins */
const RECORDER_AGGREGATE_ORDER = ['started', 'starting', 'paused', 'error']

const PUBLISHER_STATES = [
	{ id: 'started', label: 'Started' },
	{ id: 'starting', label: 'Starting' },
	{ id: 'listening', label: 'Listening' },
	{ id: 'error', label: 'Error' },
	{ id: 'stopped', label: 'Stopped' },
]
/** aggregate order for publisherId '<cid>-all': the first of these found among the channel's publishers wins */
const PUBLISHER_AGGREGATE_ORDER = ['started', 'starting', 'listening', 'error']

const SINGLETOUCH_STATES = [
	{ id: 'on', label: 'On (pressed)' },
	{ id: 'error', label: 'Error' },
]

const EVENT_STATES = [
	{ id: 'running', label: 'Running' },
	{ id: 'paused', label: 'Paused' },
	{ id: 'ongoing', label: 'Ongoing (running or paused)' },
	{ id: 'scheduled', label: 'Scheduled' },
	{ id: 'finished', label: 'Finished' },
	{ id: 'none', label: 'None' },
]

const EVENT_APPLIES_OPS = [
	{ id: 'start', label: 'Start' },
	{ id: 'stop', label: 'Stop' },
	{ id: 'pause', label: 'Pause' },
	{ id: 'resume', label: 'Resume' },
	{ id: 'extend', label: 'Extend' },
]

const SYSTEM_CONDITIONS = [
	{ id: 'cpu_high', label: 'CPU load high' },
	{ id: 'cpu_hot', label: 'CPU temperature high' },
	{ id: 'afu_uploading', label: 'AFU uploading' },
	{ id: 'afu_paused', label: 'AFU paused' },
	{ id: 'afu_error', label: 'AFU error' },
	{ id: 'afu_idle', label: 'AFU idle' },
	{ id: 'afu_off', label: 'AFU off (disabled or none)' },
]

const STORAGE_LEVELS = [
	{ id: 'low', label: `Low (${STORAGE_LOW_PCT}% or more used)` },
	{ id: 'full', label: `Full (${STORAGE_FULL_PCT}% or more used)` },
	{ id: 'ro', label: 'Read-only' },
	{ id: 'nomedia', label: 'No media' },
	{ id: 'notready', label: 'Not ready' },
	{ id: 'formatting', label: 'Formatting' },
	{ id: 'ok', label: 'OK' },
]

/**
 * Build the preview cache key for the preview / layout preview feedbacks, or null when the id is missing.
 *
 * @param {string} kind 'channel' | 'input' | 'output' | 'layout'
 * @param {unknown} id
 * @returns {string|null}
 */
function previewKey(kind, id) {
	if (id === undefined || id === null || id === '') return null
	return `${kind}:${id}`
}

/**
 * Preview feedbacks are enabled only when the preview interval is > 0. The audio meter is not gated
 * on it: its levels come from its own 500 ms poll (src/meter.js), not from the preview poller.
 *
 * @param {object} self instance
 * @returns {boolean}
 */
function previewsEnabled(self) {
	const interval = Number(self.config?.preview_interval)
	return Number.isFinite(interval) && interval > 0
}

/**
 * Register interest in a preview image. Increments the subscription counter and triggers one
 * immediate preview poll so the first image appears without waiting. The key is registered even
 * while previews are disabled (preview_interval 0): Companion calls subscribe only once per feedback,
 * so the subscription has to survive a later config change that enables previews.
 *
 * @param {object} self instance
 * @param {string|null} key
 */
function subscribePreview(self, key) {
	try {
		if (!key) return
		if (!(self.previewSubscriptions instanceof Map)) self.previewSubscriptions = new Map()
		self.previewSubscriptions.set(key, (self.previewSubscriptions.get(key) || 0) + 1)
		const result = self.pollPreviews?.()
		if (result && typeof result.catch === 'function') {
			result.catch((err) => self.log('debug', `preview poll failed: ${err?.message ?? err}`))
		}
	} catch (err) {
		self.log('error', `preview subscribe failed for ${key}: ${err?.message ?? err}`)
	}
}

/**
 * Drop interest in a preview image. Deletes the counter and the cached image at zero.
 *
 * @param {object} self instance
 * @param {string|null} key
 */
function unsubscribePreview(self, key) {
	try {
		if (!key || !(self.previewSubscriptions instanceof Map)) return
		const count = (self.previewSubscriptions.get(key) || 0) - 1
		if (count > 0) {
			self.previewSubscriptions.set(key, count)
		} else {
			self.previewSubscriptions.delete(key)
			if (self.previews && typeof self.previews === 'object') delete self.previews[key]
		}
	} catch (err) {
		self.log('error', `preview unsubscribe failed for ${key}: ${err?.message ?? err}`)
	}
}

/**
 * Register interest in an input's level meter and start the 500 ms level poll if it is not running
 * yet. One tick serves every subscribed input (one /sources/status request lists them all), so the
 * ref count only decides whether the poll runs at all, never how many requests it makes.
 *
 * @param {object} self instance
 * @param {string} key input id
 */
function subscribeMeter(self, key) {
	try {
		if (!key) return
		if (!(self.meterSubscriptions instanceof Map)) self.meterSubscriptions = new Map()
		self.meterSubscriptions.set(key, (self.meterSubscriptions.get(key) || 0) + 1)
		self.startMeterTimer?.()
	} catch (err) {
		self.log('error', `audio meter subscribe failed for ${key}: ${err?.message ?? err}`)
	}
}

/**
 * Drop interest in an input's level meter. The last unsubscribe stops the level poll and clears the
 * levels, so the level variables read '' again instead of freezing at their last value.
 *
 * @param {object} self instance
 * @param {string} key input id
 */
function unsubscribeMeter(self, key) {
	try {
		if (!key || !(self.meterSubscriptions instanceof Map)) return
		const count = (self.meterSubscriptions.get(key) || 0) - 1
		if (count > 0) self.meterSubscriptions.set(key, count)
		else self.meterSubscriptions.delete(key)
		if (self.meterSubscriptions.size === 0) {
			self.stopMeterTimer?.()
			self.applyMeterSnapshot?.([])
		}
	} catch (err) {
		self.log('error', `audio meter unsubscribe failed for ${key}: ${err?.message ?? err}`)
	}
}

/**
 * Aggregate status of a list of {status:{state}} entities: the first status of `order` found among
 * them, or `fallback` when none matches (including an empty list).
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

/**
 * Resolve an event alias or a specific event id against the polled event snapshot, the same way the
 * `event` action resolves it live against the device (utils.eventApplies mirrors the device's own rule
 * for which fixed commands apply once resolved).
 *
 * @param {object} state instance state
 * @param {string} ref alias (upcoming/ongoing/running/paused/completed) or a specific event id
 * @returns {object|null} the event, or null when nothing matches
 */
function resolveEventRef(state, ref) {
	const events = state?.events || {}
	const list = Array.isArray(events.list) ? events.list : []
	switch (ref) {
		case 'upcoming':
			return events.upcoming ?? null
		case 'ongoing':
			return events.ongoing ?? null
		case 'running':
			return events.ongoing?.status === 'running' ? events.ongoing : null
		case 'paused':
			return events.ongoing?.status === 'paused' ? events.ongoing : null
		case 'completed': {
			const finished = list.filter((e) => e && e.status === 'finished')
			if (finished.length === 0) return null
			return finished.reduce((a, b) => ((Number(b.finish) || 0) > (Number(a.finish) || 0) ? b : a))
		}
		default: {
			const found = list.find((e) => e && String(e.id) === String(ref))
			if (found) return found
			if (events.upcoming && String(events.upcoming.id) === String(ref)) return events.upcoming
			if (events.ongoing && String(events.ongoing.id) === String(ref)) return events.ongoing
			return null
		}
	}
}

module.exports = {
	/**
	 * INTERNAL: Get the available feedbacks.
	 *
	 * @access protected
	 * @returns {Object} the available feedbacks
	 */
	getFeedbacks() {
		const feedbacks = {}

		// ------------------------------------------------------------------
		// Recorder / stream
		// ------------------------------------------------------------------

		feedbacks['recorder_state'] = {
			type: 'boolean',
			name: 'Recorder state',
			description:
				'True while the selected recorder (or, for "All recorders", the aggregate of every recorder) is in the selected state.',
			defaultStyle: stateStyle(colors.red),
			options: [
				{
					type: 'dropdown',
					id: 'recorderId',
					label: 'Recorder',
					choices: this.choicesRecordersWithAll(),
					default: 'all',
				},
				{
					type: 'dropdown',
					id: 'state',
					label: 'State',
					choices: RECORDER_STATES,
					default: 'started',
				},
			],
			callback: (feedback) => {
				try {
					const rid = String(feedback.options.recorderId ?? 'all')
					const state = feedback.options.state
					const recorders = this.state.recorders || {}
					if (rid === 'all') {
						const agg = aggregateState(Object.values(recorders), RECORDER_AGGREGATE_ORDER, 'stopped')
						return agg === state
					}
					return recorders[rid]?.status?.state === state
				} catch (error) {
					this.log('error', `recorder_state feedback failed: ${error?.message ?? error}`)
					return false
				}
			},
		}

		feedbacks['stream_state'] = {
			type: 'boolean',
			name: 'Stream state',
			description:
				'True while the selected publisher (or, for "All publishers", the aggregate of the channel\'s publishers) is in the selected state.',
			defaultStyle: stateStyle(colors.green),
			options: [
				{
					type: 'dropdown',
					id: 'publisherId',
					label: 'Publisher',
					choices: this.choicesPublishers(),
					default: this.firstId(this.choicesPublishers()),
				},
				{
					type: 'dropdown',
					id: 'state',
					label: 'State',
					choices: PUBLISHER_STATES,
					default: 'started',
				},
			],
			callback: (feedback) => {
				try {
					const pair = splitPair(String(feedback.options.publisherId ?? ''))
					if (!pair) return false
					const [cid, pid] = pair
					const publishers = this.state.channels?.[cid]?.publishers
					if (!publishers) return false
					const state = feedback.options.state
					if (pid === 'all') {
						const agg = aggregateState(Object.values(publishers), PUBLISHER_AGGREGATE_ORDER, 'stopped')
						return agg === state
					}
					return publishers[pid]?.status?.state === state
				} catch (error) {
					this.log('error', `stream_state feedback failed: ${error?.message ?? error}`)
					return false
				}
			},
		}

		// ------------------------------------------------------------------
		// Layout
		// ------------------------------------------------------------------

		feedbacks['layout_active'] = {
			type: 'boolean',
			name: 'Layout active',
			description: 'True while the selected layout is the active layout of its channel.',
			defaultStyle: stateStyle(colors.amber),
			options: [
				{
					type: 'dropdown',
					id: 'layoutId',
					label: 'Layout',
					choices: this.choicesLayouts(),
					default: this.firstId(this.choicesLayouts()),
				},
			],
			callback: (feedback) => {
				try {
					const pair = splitPair(String(feedback.options.layoutId ?? ''))
					if (!pair) return false
					const [cid, lid] = pair
					return this.state.channels?.[cid]?.layouts?.[lid]?.active === true
				} catch (error) {
					this.log('error', `layout_active feedback failed: ${error?.message ?? error}`)
					return false
				}
			},
		}

		feedbacks['layout_preview'] = {
			type: 'advanced',
			name: 'Layout preview',
			description:
				'Show a live preview image of this specific layout on its switch button, whether or not it is ' +
				"currently active. Uses an undocumented endpoint (not in Epiphan's published REST API v2.0 " +
				'specification, confirmed working by Epiphan) that renders a given layout directly. Requires ' +
				'preview interval > 0 in the connection settings.',
			options: [
				{
					type: 'dropdown',
					id: 'layoutId',
					label: 'Layout',
					choices: this.choicesLayouts(),
					default: this.firstId(this.choicesLayouts()),
				},
			],
			callback: (feedback) => {
				try {
					if (!previewsEnabled(this)) return {}
					const pair = splitPair(String(feedback.options.layoutId ?? ''))
					if (!pair) return {}
					const png64 = this.previews?.[previewKey('layout', feedback.options.layoutId)]?.png64
					return typeof png64 === 'string' && png64.length > 0 ? { png64 } : {}
				} catch (error) {
					this.log('error', `layout_preview feedback failed: ${error?.message ?? error}`)
					return {}
				}
			},
			subscribe: (feedback) => {
				const pair = splitPair(String(feedback.options.layoutId ?? ''))
				if (pair) subscribePreview(this, previewKey('layout', feedback.options.layoutId))
			},
			unsubscribe: (feedback) => {
				const pair = splitPair(String(feedback.options.layoutId ?? ''))
				if (pair) unsubscribePreview(this, previewKey('layout', feedback.options.layoutId))
			},
		}

		// ------------------------------------------------------------------
		// Single touch
		// ------------------------------------------------------------------

		feedbacks['singletouch_active'] = {
			type: 'boolean',
			name: 'Single touch state',
			description: '"On" is true while pressed; "Error" is true while the control reports a failed start.',
			defaultStyle: stateStyle(colors.green),
			options: [
				{
					type: 'dropdown',
					id: 'stcId',
					label: 'Single touch control',
					choices: this.choicesSingleTouch(),
					default: this.preferredId(this.choicesSingleTouch(), '0'),
				},
				{
					type: 'dropdown',
					id: 'state',
					label: 'State',
					choices: SINGLETOUCH_STATES,
					default: 'on',
				},
			],
			callback: (feedback) => {
				try {
					const stc = this.state.singleTouch?.[feedback.options.stcId]
					if (feedback.options.state === 'error') return stc?.state?.status === false
					return stc?.state?.pressed === true
				} catch (error) {
					this.log('error', `singletouch_active feedback failed: ${error?.message ?? error}`)
					return false
				}
			},
		}

		// ------------------------------------------------------------------
		// Preview (channel / input / output)
		// ------------------------------------------------------------------

		feedbacks['preview'] = {
			type: 'advanced',
			name: 'Preview',
			description:
				'Show a live preview image of a channel, video input or output on the button (requires preview ' +
				'interval > 0 in the connection settings). "Source" lists channels, inputs and outputs together; ' +
				'pick the one matching "Source type".',
			options: [
				{
					type: 'dropdown',
					id: 'source',
					label: 'Source type',
					choices: [
						{ id: 'channel', label: 'Channel' },
						{ id: 'input', label: 'Input' },
						{ id: 'output', label: 'Output' },
					],
					default: 'channel',
				},
				{
					type: 'dropdown',
					id: 'sourceId',
					label: 'Source',
					choices: this.choicesPreviewSources(),
					default: this.firstId(this.choicesPreviewSources()),
				},
			],
			callback: (feedback) => {
				try {
					if (!previewsEnabled(this)) return {}
					const key = previewKey(String(feedback.options.source ?? 'channel'), feedback.options.sourceId)
					const png64 = key ? this.previews?.[key]?.png64 : undefined
					return typeof png64 === 'string' && png64.length > 0 ? { png64 } : {}
				} catch (error) {
					this.log('error', `preview feedback failed: ${error?.message ?? error}`)
					return {}
				}
			},
			subscribe: (feedback) => {
				subscribePreview(
					this,
					previewKey(String(feedback.options.source ?? 'channel'), feedback.options.sourceId),
				)
			},
			unsubscribe: (feedback) => {
				unsubscribePreview(
					this,
					previewKey(String(feedback.options.source ?? 'channel'), feedback.options.sourceId),
				)
			},
		}

		// ------------------------------------------------------------------
		// Output
		// ------------------------------------------------------------------

		feedbacks['output_set'] = {
			type: 'boolean',
			name: 'Output source recently set',
			description:
				'True while this connection set the selected source on the selected output within the last 5 seconds. ' +
				'The API has no way to read the output source back, so this only reflects what this connection itself ' +
				'last sent, not a value confirmed by the device.',
			defaultStyle: stateStyle(colors.green),
			options: [
				{
					type: 'dropdown',
					id: 'outputId',
					label: 'Output',
					choices: this.choicesOutputs(),
					default: this.firstId(this.choicesOutputs()),
				},
				{
					type: 'dropdown',
					id: 'source',
					label: 'Source',
					choices: this.choicesOutputSources(),
					default: this.firstId(this.choicesOutputSources()),
				},
			],
			callback: (feedback) => {
				try {
					const did = String(feedback.options.outputId ?? '')
					const source = String(feedback.options.source ?? '')
					if (!did || !source) return false
					const output = this.state.outputs?.[did]
					if (!output || output.source !== source) return false
					const setAt = Number(output.setAt)
					return Number.isFinite(setAt) && Date.now() - setAt < 5000
				} catch (error) {
					this.log('error', `output_set feedback failed: ${error?.message ?? error}`)
					return false
				}
			},
		}

		// ------------------------------------------------------------------
		// Event (CMS schedule)
		// ------------------------------------------------------------------

		feedbacks['event_state'] = {
			type: 'boolean',
			name: 'Event state',
			description: 'True while the resolved event (alias or specific id) is in the selected state.',
			defaultStyle: stateStyle(colors.green),
			options: [
				{
					type: 'dropdown',
					id: 'eventRef',
					label: 'Event',
					choices: this.choicesEventRefs(),
					default: 'ongoing',
					allowCustom: true,
				},
				{
					type: 'dropdown',
					id: 'state',
					label: 'State',
					choices: EVENT_STATES,
					default: 'running',
				},
			],
			callback: (feedback) => {
				try {
					const ref = String(feedback.options.eventRef ?? 'ongoing')
					const wanted = feedback.options.state
					const event = resolveEventRef(this.state, ref)
					if (wanted === 'none') return event === null
					if (wanted === 'ongoing') return event?.status === 'running' || event?.status === 'paused'
					return event?.status === wanted
				} catch (error) {
					this.log('error', `event_state feedback failed: ${error?.message ?? error}`)
					return false
				}
			},
		}

		feedbacks['event_applies'] = {
			type: 'boolean',
			name: 'Event command applies',
			description:
				"True while the selected command would be sent for the resolved event's current status (the same " +
				'rule the "Event" action itself uses to decide whether a fixed command applies).',
			defaultStyle: stateStyle(colors.cms),
			options: [
				{
					type: 'dropdown',
					id: 'eventRef',
					label: 'Event',
					choices: this.choicesEventRefs(),
					default: 'ongoing',
					allowCustom: true,
				},
				{
					type: 'dropdown',
					id: 'op',
					label: 'Action',
					choices: EVENT_APPLIES_OPS,
					default: 'start',
				},
			],
			callback: (feedback) => {
				try {
					const ref = String(feedback.options.eventRef ?? 'ongoing')
					const op = String(feedback.options.op ?? 'start')
					const event = resolveEventRef(this.state, ref)
					return eventApplies(op, event?.status)
				} catch (error) {
					this.log('error', `event_applies feedback failed: ${error?.message ?? error}`)
					return false
				}
			},
		}

		// ------------------------------------------------------------------
		// System / AFU
		// ------------------------------------------------------------------

		feedbacks['system'] = {
			type: 'boolean',
			name: 'System condition',
			description: 'True while the selected system or AFU condition holds.',
			defaultStyle: stateStyle(colors.amber),
			options: [
				{
					type: 'dropdown',
					id: 'condition',
					label: 'Condition',
					choices: SYSTEM_CONDITIONS,
					default: 'cpu_high',
				},
			],
			callback: (feedback) => {
				try {
					const condition = String(feedback.options.condition ?? '')
					if (condition === 'cpu_high') return this.state.systemStatus?.cpuload_high === true
					if (condition === 'cpu_hot') {
						const temp = Number(this.state.systemStatus?.cputemp)
						const threshold = Number(this.state.systemStatus?.cputemp_threshold)
						return Number.isFinite(temp) && Number.isFinite(threshold) && temp >= threshold
					}
					const afu = Array.isArray(this.state.afu) ? this.state.afu : []
					const key = condition.replace(/^afu_/, '')
					if (key === 'off') return afu.length === 0 || afu.some((e) => e?.status?.state === 'disabled')
					return afu.some((e) => e?.status?.state === key)
				} catch (error) {
					this.log('error', `system feedback failed: ${error?.message ?? error}`)
					return false
				}
			},
		}

		// ------------------------------------------------------------------
		// Storage
		// ------------------------------------------------------------------

		feedbacks['storage_level'] = {
			type: 'boolean',
			name: 'Storage level',
			description: 'True while the selected storage is in the selected condition.',
			defaultStyle: stateStyle(colors.amber),
			options: [
				{
					type: 'dropdown',
					id: 'storageId',
					label: 'Storage',
					choices: this.choicesStorages(),
					default: this.preferredId(this.choicesStorages(), 'main'),
				},
				{
					type: 'dropdown',
					id: 'level',
					label: 'Level',
					choices: STORAGE_LEVELS,
					default: 'low',
				},
			],
			callback: (feedback) => {
				try {
					const status = this.state.storages?.[feedback.options.storageId]?.status
					const state = status?.state
					// severity (how full) and mount state are separate axes: only a mounted storage has one
					const { level } = storageLevel(status)
					switch (feedback.options.level) {
						case 'low':
							return state === 'ready' && level === 'low'
						case 'full':
							return state === 'ready' && level === 'full'
						case 'ro':
							return state === 'devro'
						case 'nomedia':
							return state === 'nodev'
						case 'notready':
							return state === 'dev'
						case 'formatting':
							return state === 'formatting'
						case 'ok':
							return state === 'ready' && level === 'ok'
						default:
							return false
					}
				} catch (error) {
					this.log('error', `storage_level feedback failed: ${error?.message ?? error}`)
					return false
				}
			},
		}

		// ------------------------------------------------------------------
		// Audio (advanced: draws the level meter as an image)
		// ------------------------------------------------------------------

		feedbacks['audio'] = {
			type: 'advanced',
			name: 'Audio meter',
			description:
				'Stereo level meter for an audio input: two bars with peak ticks on the right edge of the ' +
				'button, green to 62%, amber to 82%, red above, over -60..0 dBFS. Placing it starts a 500 ms ' +
				'level poll; the button keeps its own text.',
			options: [
				{
					type: 'dropdown',
					id: 'inputId',
					label: 'Input',
					choices: this.choicesInputsWithAudio(),
					default: this.firstId(this.choicesInputsWithAudio()),
				},
			],
			callback: (feedback) => {
				try {
					const levels = meterOf(this.state.inputs?.[String(feedback.options.inputId ?? '')])
					// no levels yet (nothing subscribed, no signal, or a device without the endpoint):
					// return nothing at all so the button keeps its text and its own style
					if (!levels) return {}
					const width = Math.round(Number(feedback.image?.width) || METER_DEFAULT_SIZE)
					const height = Math.round(Number(feedback.image?.height) || METER_DEFAULT_SIZE)
					return {
						imageBuffer: renderMeter(width, height, levels),
						imageBufferEncoding: { pixelFormat: 'RGBA' },
						imageBufferPosition: { x: 0, y: 0, width, height },
					}
				} catch (error) {
					this.log('error', `audio feedback failed: ${error?.message ?? error}`)
					return {}
				}
			},
			subscribe: (feedback) => subscribeMeter(this, String(feedback.options.inputId ?? '')),
			unsubscribe: (feedback) => unsubscribeMeter(this, String(feedback.options.inputId ?? '')),
		}

		// ------------------------------------------------------------------
		// Confirm (D2)
		// ------------------------------------------------------------------

		feedbacks['action_failed'] = {
			type: 'boolean',
			name: 'Action failed (recent)',
			description:
				'True for three seconds on the button whose last device command failed (rejected, timed out or ' +
				'unreachable), so the key itself shows the failure; the message is in the last_error variable.',
			defaultStyle: { ...stateStyle(colors.red), text: FAILED_TEXT },
			options: [],
			callback: (feedback) => {
				try {
					return this.isActionFailed(feedback.controlId)
				} catch (error) {
					this.log('error', `action_failed feedback failed: ${error?.message ?? error}`)
					return false
				}
			},
		}

		feedbacks['confirm_pending'] = {
			type: 'boolean',
			name: 'Confirm pending',
			description:
				'True while a confirm-gated action on this button is armed, waiting for a second press. Puts the ' +
				'hint on the key in place of the label.',
			defaultStyle: { ...stateStyle(colors.red), text: CONFIRM_HINT },
			options: [],
			callback: (feedback) => {
				try {
					return this.isConfirmPending(feedback.controlId)
				} catch (error) {
					this.log('error', `confirm_pending feedback failed: ${error?.message ?? error}`)
					return false
				}
			},
		}

		return feedbacks
	},
}
