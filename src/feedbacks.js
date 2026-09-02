const { combineRgb } = require('@companion-module/base')
const { splitPair } = require('./utils')

const WHITE = combineRgb(255, 255, 255)
const RED = combineRgb(255, 0, 0)
const GREEN = combineRgb(0, 204, 0)
const BLUE = combineRgb(0, 102, 204)
const ORANGE = combineRgb(255, 128, 0)
const PURPLE = combineRgb(102, 0, 204)

const PUBLISHER_STATES = [
	{ id: 'started', label: 'Started' },
	{ id: 'stopped', label: 'Stopped' },
	{ id: 'starting', label: 'Starting' },
	{ id: 'listening', label: 'Listening' },
	{ id: 'error', label: 'Error' },
]

const RECORDER_STATES = [
	{ id: 'started', label: 'Started' },
	{ id: 'stopped', label: 'Stopped' },
	{ id: 'paused', label: 'Paused' },
	{ id: 'starting', label: 'Starting' },
	{ id: 'error', label: 'Error' },
	{ id: 'disabled', label: 'Disabled' },
]

const STORAGE_STATES = [
	{ id: 'ready', label: 'Ready' },
	{ id: 'nodev', label: 'No device' },
	{ id: 'dev', label: 'Device present (not mounted)' },
	{ id: 'devro', label: 'Device read-only' },
	{ id: 'formatting', label: 'Formatting' },
]

const AFU_STATES = [
	{ id: 'idle', label: 'Idle' },
	{ id: 'paused', label: 'Paused' },
	{ id: 'uploading', label: 'Uploading' },
	{ id: 'error', label: 'Error' },
	{ id: 'disabled', label: 'Disabled' },
]

const EVENT_WHICH = [
	{ id: 'upcoming', label: 'An upcoming event is scheduled' },
	{ id: 'running', label: 'Ongoing event is running' },
	{ id: 'paused', label: 'Ongoing event is paused' },
	{ id: 'ongoing', label: 'An event is ongoing (running or paused)' },
]

/**
 * Build the preview cache key for a preview feedback, or null when the option is missing.
 *
 * @param {'channel'|'input'|'output'} kind
 * @param {unknown} id
 * @returns {string|null}
 */
function previewKey(kind, id) {
	if (id === undefined || id === null || id === '') return null
	return `${kind}:${id}`
}

/**
 * Preview feedbacks are enabled only when the preview interval is > 0.
 *
 * @param {object} self instance
 * @returns {boolean}
 */
function previewsEnabled(self) {
	const interval = Number(self.config?.preview_interval)
	return Number.isFinite(interval) && interval > 0
}

/**
 * Register interest in a preview image. Increments the subscription counter and
 * triggers one immediate preview poll so the first image appears without waiting.
 * The key is registered even while previews are disabled (preview_interval 0): Companion calls
 * subscribe only once per feedback, so the subscription has to survive a later config change that
 * enables previews. pollPreviews() itself is a no-op while previews are disabled.
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
 * Build an advanced preview feedback definition for a channel, input or output.
 *
 * @param {object} self instance
 * @param {'channel'|'input'|'output'} kind
 * @param {string} label
 * @param {Array<{id: string, label: string}>} choices
 * @returns {object} feedback definition
 */
function previewFeedback(self, kind, label, choices) {
	return {
		type: 'advanced',
		name: `${label} preview image`,
		description: `Show a live preview image of the selected ${kind} on the button (requires preview interval > 0 in the connection settings)`,
		options: [
			{
				type: 'dropdown',
				label,
				id: kind,
				choices,
				default: self.firstId(choices),
			},
		],
		callback: (feedback) => {
			try {
				if (!previewsEnabled(self)) return {}
				const key = previewKey(kind, feedback.options[kind])
				const png64 = key ? self.previews?.[key]?.png64 : undefined
				return typeof png64 === 'string' && png64.length > 0 ? { png64 } : {}
			} catch (err) {
				self.log('error', `preview feedback failed: ${err?.message ?? err}`)
				return {}
			}
		},
		subscribe: (feedback) => {
			subscribePreview(self, previewKey(kind, feedback.options[kind]))
		},
		unsubscribe: (feedback) => {
			unsubscribePreview(self, previewKey(kind, feedback.options[kind]))
		},
	}
}

module.exports = {
	/**
	 * INTERNAL: Get the available feedbacks.
	 *
	 * @access protected
	 * @since 1.0.0
	 * @returns {Object} - the available feedbacks
	 */
	getFeedbacks() {
		const feedbacks = {}

		// ---------------------------------------------------------------------
		// Existing feedbacks (ids and option ids unchanged)
		// ---------------------------------------------------------------------

		feedbacks['channelLayout'] = {
			name: 'Change style on channel layout change',
			type: 'boolean',
			description: 'Change style if the specified layout is active',
			defaultStyle: {
				color: WHITE,
				bgcolor: RED,
			},
			options: [
				{
					type: 'dropdown',
					label: 'Channel',
					id: 'channelIdlayoutId',
					choices: this.choicesChannelLayout(),
					default: this.firstId(this.choicesChannelLayout()),
				},
			],
			callback: (feedback) => {
				const pair = splitPair(feedback.options.channelIdlayoutId)
				if (!pair) return false
				const [channelId, layoutId] = pair

				try {
					return this.state.channels?.[channelId]?.layouts?.[layoutId]?.active === true
				} catch (error) {
					this.log(
						'error',
						`trying to read feedback for a non-existing layout (Channel ${channelId}, Layout ${layoutId}): ${error?.message ?? error}`,
					)
					return false
				}
			},
		}

		feedbacks['streamingState'] = {
			name: 'Change style if streaming',
			type: 'boolean',
			description: 'Change style if specified channel is streaming',
			defaultStyle: {
				color: WHITE,
				bgcolor: GREEN,
			},
			options: [
				{
					type: 'dropdown',
					label: 'Channel publisher',
					id: 'channelIdpublisherId',
					choices: this.choicesChannelPublishers(),
					default: this.firstId(this.choicesChannelPublishers()),
				},
			],
			callback: (feedback) => {
				const pair = splitPair(feedback.options.channelIdpublisherId)
				if (!pair) return false
				const [channelId, publisherId] = pair

				try {
					const publishers = this.state.channels?.[channelId]?.publishers
					if (!publishers) return false
					if (publisherId === 'all') {
						const states = Object.values(publishers).map((pub) => pub?.status?.state)
						return states.length > 0 && !states.some((state) => state !== 'started')
					}
					return publishers[publisherId]?.status?.state === 'started'
				} catch (error) {
					this.log(
						'error',
						`trying to read feedback for a non-existing publisher (Channel ${channelId}, Publisher ${publisherId}): ${error?.message ?? error}`,
					)
					return false
				}
			},
		}

		feedbacks['recorderRecording'] = {
			name: 'Change style if recording',
			type: 'boolean',
			description: 'Change style if channel/recorder is recording',
			defaultStyle: {
				color: WHITE,
				bgcolor: GREEN,
			},
			options: [
				{
					type: 'dropdown',
					label: 'Recorders',
					id: 'recorderId',
					choices: this.choicesRecorders(),
					default: this.firstId(this.choicesRecorders()),
				},
			],
			callback: (feedback) => {
				try {
					return this.state.recorders?.[feedback.options.recorderId]?.status?.state === 'started'
				} catch (error) {
					this.log(
						'error',
						`trying to read feedback for a non-existing recorder (${feedback.options.recorderId}): ${error?.message ?? error}`,
					)
					return false
				}
			},
		}

		// ---------------------------------------------------------------------
		// Publishers / recorders
		// ---------------------------------------------------------------------

		feedbacks['publisherState'] = {
			name: 'Publisher state',
			type: 'boolean',
			description: 'Change style if the selected publisher (stream) is in the selected state',
			defaultStyle: {
				color: WHITE,
				bgcolor: GREEN,
			},
			options: [
				{
					type: 'dropdown',
					label: 'Publisher',
					id: 'channelIdpublisherId',
					choices: this.choicesChannelPublishersOnly(),
					default: this.firstId(this.choicesChannelPublishersOnly()),
				},
				{
					type: 'dropdown',
					label: 'State',
					id: 'state',
					choices: PUBLISHER_STATES,
					default: 'started',
				},
			],
			callback: (feedback) => {
				try {
					const pair = splitPair(feedback.options.channelIdpublisherId)
					if (!pair) return false
					const [channelId, publisherId] = pair
					const state = this.state.channels?.[channelId]?.publishers?.[publisherId]?.status?.state
					return state !== undefined && state === feedback.options.state
				} catch (error) {
					this.log('error', `publisherState feedback failed: ${error?.message ?? error}`)
					return false
				}
			},
		}

		feedbacks['recorderState'] = {
			name: 'Recorder state',
			type: 'boolean',
			description: 'Change style if the selected recorder is in the selected state',
			defaultStyle: {
				color: WHITE,
				bgcolor: RED,
			},
			options: [
				{
					type: 'dropdown',
					label: 'Recorder',
					id: 'recorderId',
					choices: this.choicesRecorders(),
					default: this.firstId(this.choicesRecorders()),
				},
				{
					type: 'dropdown',
					label: 'State',
					id: 'state',
					choices: RECORDER_STATES,
					default: 'started',
				},
			],
			callback: (feedback) => {
				try {
					const state = this.state.recorders?.[feedback.options.recorderId]?.status?.state
					return state !== undefined && state === feedback.options.state
				} catch (error) {
					this.log('error', `recorderState feedback failed: ${error?.message ?? error}`)
					return false
				}
			},
		}

		feedbacks['anyRecording'] = {
			name: 'Any recorder recording',
			type: 'boolean',
			description: 'Change style if at least one recorder is recording',
			defaultStyle: {
				color: WHITE,
				bgcolor: RED,
			},
			options: [],
			callback: () => {
				try {
					return Object.values(this.state.recorders ?? {}).some((rec) => rec?.status?.state === 'started')
				} catch (error) {
					this.log('error', `anyRecording feedback failed: ${error?.message ?? error}`)
					return false
				}
			},
		}

		feedbacks['anyStreaming'] = {
			name: 'Any publisher streaming',
			type: 'boolean',
			description: 'Change style if at least one publisher (stream) on any channel is started',
			defaultStyle: {
				color: WHITE,
				bgcolor: GREEN,
			},
			options: [],
			callback: () => {
				try {
					return Object.values(this.state.channels ?? {}).some((channel) =>
						Object.values(channel?.publishers ?? {}).some((pub) => pub?.status?.state === 'started'),
					)
				} catch (error) {
					this.log('error', `anyStreaming feedback failed: ${error?.message ?? error}`)
					return false
				}
			},
		}

		// ---------------------------------------------------------------------
		// Single touch control
		// ---------------------------------------------------------------------

		feedbacks['singleTouchPressed'] = {
			name: 'Single touch control active',
			type: 'boolean',
			description: 'Change style if the selected single touch control is currently activated (pressed)',
			defaultStyle: {
				color: WHITE,
				bgcolor: GREEN,
			},
			options: [
				{
					type: 'dropdown',
					label: 'Single touch control',
					id: 'stcId',
					choices: this.choicesSingleTouch(),
					default: this.firstId(this.choicesSingleTouch()),
				},
			],
			callback: (feedback) => {
				try {
					return this.state.singleTouch?.[feedback.options.stcId]?.state?.pressed === true
				} catch (error) {
					this.log('error', `singleTouchPressed feedback failed: ${error?.message ?? error}`)
					return false
				}
			},
		}

		feedbacks['singleTouchOk'] = {
			name: 'Single touch control OK',
			type: 'boolean',
			description:
				'Change style if all recorders and publishers of the selected single touch control started successfully',
			defaultStyle: {
				color: WHITE,
				bgcolor: GREEN,
			},
			options: [
				{
					type: 'dropdown',
					label: 'Single touch control',
					id: 'stcId',
					choices: this.choicesSingleTouch(),
					default: this.firstId(this.choicesSingleTouch()),
				},
			],
			callback: (feedback) => {
				try {
					return this.state.singleTouch?.[feedback.options.stcId]?.state?.status === true
				} catch (error) {
					this.log('error', `singleTouchOk feedback failed: ${error?.message ?? error}`)
					return false
				}
			},
		}

		// ---------------------------------------------------------------------
		// Storage
		// ---------------------------------------------------------------------

		feedbacks['storageState'] = {
			name: 'Storage state',
			type: 'boolean',
			description: 'Change style if the selected storage is in the selected state',
			defaultStyle: {
				color: WHITE,
				bgcolor: BLUE,
			},
			options: [
				{
					type: 'dropdown',
					label: 'Storage',
					id: 'storageId',
					choices: this.choicesStorages(),
					default: this.firstId(this.choicesStorages()),
				},
				{
					type: 'dropdown',
					label: 'State',
					id: 'state',
					choices: STORAGE_STATES,
					default: 'ready',
				},
			],
			callback: (feedback) => {
				try {
					const state = this.state.storages?.[feedback.options.storageId]?.status?.state
					return state !== undefined && state === feedback.options.state
				} catch (error) {
					this.log('error', `storageState feedback failed: ${error?.message ?? error}`)
					return false
				}
			},
		}

		feedbacks['storageFreeBelow'] = {
			name: 'Storage free space below',
			type: 'boolean',
			description: 'Change style if the free space of the selected storage is below the given percentage',
			defaultStyle: {
				color: WHITE,
				bgcolor: RED,
			},
			options: [
				{
					type: 'dropdown',
					label: 'Storage',
					id: 'storageId',
					choices: this.choicesStorages(),
					default: this.firstId(this.choicesStorages()),
				},
				{
					type: 'number',
					label: 'Free space below (%)',
					id: 'percent',
					default: 10,
					min: 0,
					max: 100,
					step: 1,
				},
			],
			callback: (feedback) => {
				try {
					const status = this.state.storages?.[feedback.options.storageId]?.status
					const total = Number(status?.total)
					const free = Number(status?.free)
					const percent = Number(feedback.options.percent)
					if (!Number.isFinite(total) || total <= 0 || !Number.isFinite(free) || !Number.isFinite(percent)) {
						return false
					}
					return (free / total) * 100 < percent
				} catch (error) {
					this.log('error', `storageFreeBelow feedback failed: ${error?.message ?? error}`)
					return false
				}
			},
		}

		// ---------------------------------------------------------------------
		// AFU / system
		// ---------------------------------------------------------------------

		feedbacks['afuState'] = {
			name: 'Automatic file upload state',
			type: 'boolean',
			description: 'Change style if any automatic file upload (AFU) destination is in the selected state',
			defaultStyle: {
				color: WHITE,
				bgcolor: BLUE,
			},
			options: [
				{
					type: 'dropdown',
					label: 'State',
					id: 'state',
					choices: AFU_STATES,
					default: 'uploading',
				},
			],
			callback: (feedback) => {
				try {
					const afu = this.state.afu
					if (!Array.isArray(afu) || afu.length === 0) return false
					return afu.some((entry) => entry?.status?.state === feedback.options.state)
				} catch (error) {
					this.log('error', `afuState feedback failed: ${error?.message ?? error}`)
					return false
				}
			},
		}

		feedbacks['cpuLoadHigh'] = {
			name: 'CPU load high',
			type: 'boolean',
			description: 'Change style if the device reports a high CPU load',
			defaultStyle: {
				color: WHITE,
				bgcolor: RED,
			},
			options: [],
			callback: () => {
				try {
					return this.state.systemStatus?.cpuload_high === true
				} catch (error) {
					this.log('error', `cpuLoadHigh feedback failed: ${error?.message ?? error}`)
					return false
				}
			},
		}

		feedbacks['cpuTempHigh'] = {
			name: 'CPU temperature high',
			type: 'boolean',
			description: 'Change style if the CPU temperature is at or above the device threshold',
			defaultStyle: {
				color: WHITE,
				bgcolor: ORANGE,
			},
			options: [],
			callback: () => {
				try {
					const temp = Number(this.state.systemStatus?.cputemp)
					const threshold = Number(this.state.systemStatus?.cputemp_threshold)
					if (!Number.isFinite(temp) || !Number.isFinite(threshold)) return false
					return temp >= threshold
				} catch (error) {
					this.log('error', `cpuTempHigh feedback failed: ${error?.message ?? error}`)
					return false
				}
			},
		}

		// ---------------------------------------------------------------------
		// Events (CMS schedule)
		// ---------------------------------------------------------------------

		feedbacks['eventStatus'] = {
			name: 'Event status',
			type: 'boolean',
			description: 'Change style depending on the scheduled (CMS) event status',
			defaultStyle: {
				color: WHITE,
				bgcolor: PURPLE,
			},
			options: [
				{
					type: 'dropdown',
					label: 'Condition',
					id: 'which',
					choices: EVENT_WHICH,
					default: 'running',
				},
			],
			callback: (feedback) => {
				try {
					const events = this.state.events ?? {}
					switch (feedback.options.which) {
						case 'upcoming':
							return events.upcoming !== null && events.upcoming !== undefined
						case 'ongoing':
							return events.ongoing !== null && events.ongoing !== undefined
						case 'running':
							return events.ongoing?.status === 'running'
						case 'paused':
							return events.ongoing?.status === 'paused'
						default:
							return false
					}
				} catch (error) {
					this.log('error', `eventStatus feedback failed: ${error?.message ?? error}`)
					return false
				}
			},
		}

		// ---------------------------------------------------------------------
		// Preview images (advanced)
		// ---------------------------------------------------------------------

		feedbacks['channelPreview'] = previewFeedback(this, 'channel', 'Channel', this.choicesChannel())
		feedbacks['inputPreview'] = previewFeedback(this, 'input', 'Input', this.choicesInputs())
		feedbacks['outputPreview'] = previewFeedback(this, 'output', 'Output', this.choicesOutputs())

		return feedbacks
	},
}
