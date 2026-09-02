const {
	CreateConvertToBooleanFeedbackUpgradeScript,
	InstanceBase,
	InstanceStatus,
	Regex,
} = require('@companion-module/base')

const { PearlApiError, ...api } = require('./api')
const poller = require('./poller')
const choices = require('./choices')
const actions = require('./actions')
const feedbacks = require('./feedbacks')
const presets = require('./presets')
const variables = require('./variables')
const { getConfigFields } = require('./config')
const upgrades = require('./upgrades')
const { emptyState, parseKeyValueText, firmwareVersionNumber, clampNumber } = require('./utils')

/** Minimum firmware version (4.24.01) that supports API v2.0 */
const MIN_API_V2_VERSION = 42401
/** delay of the coalesced poll triggered after a control action */
const POLL_SOON_DELAY = 750

const IP_RE = new RegExp(Regex.IP.slice(1, -1))
const HOSTNAME_RE = new RegExp(Regex.HOSTNAME.slice(1, -1))
const CHANNEL_ID_RE = /^[a-zA-Z0-9_-]+$/

/**
 * Fill missing / invalid config values with sane defaults (in memory only)
 *
 * @param {object} config
 * @returns {object}
 */
function normaliseConfig(config) {
	const c = { ...(config || {}) }
	c.host = typeof c.host === 'string' ? c.host.trim() : ''
	c.host_port =
		c.host_port === undefined || c.host_port === null || c.host_port === '' ? '80' : String(c.host_port).trim()
	c.username = typeof c.username === 'string' ? c.username : 'admin'
	c.password = typeof c.password === 'string' ? c.password : ''
	c.pollfreq = clampNumber(c.pollfreq, 10, 1, 300)
	c.timeout = clampNumber(c.timeout, 5000, 1000, 60000)
	c.use_api_v2 = c.use_api_v2 !== false
	c.preview_interval = clampNumber(c.preview_interval, 2, 0, 300)
	c.preview_width = Math.round(clampNumber(c.preview_width, 144, 72, 720))
	c.poll_events = c.poll_events !== false
	c.poll_archive = c.poll_archive === true
	c.poll_connectivity = c.poll_connectivity === true
	c.verbose = c.verbose === true
	return c
}

/**
 * Validate the parts of the config we cannot default
 *
 * @param {object} config normalised config
 * @returns {string|null} problem description or null when fine
 */
function validateConfig(config) {
	if (!config.host || (!IP_RE.test(config.host) && !HOSTNAME_RE.test(config.host))) {
		return `Invalid IP address or hostname given in configuration: '${config.host}'`
	}
	const port = Number(config.host_port)
	if (!Number.isInteger(port) || port < 1 || port > 65535) {
		return `Invalid port number given in configuration: '${config.host_port}'`
	}
	return null
}

/**
 * Companion instance class for the Epiphan Pearl.
 *
 * @extends InstanceBase
 * @since 1.0.0
 */
class EpiphanPearl extends InstanceBase {
	/**
	 * @param {unknown} internal
	 */
	constructor(internal) {
		super(internal)

		/** device state, rebuilt on every poll (see doc/ARCHITECTURE.md) */
		this.state = emptyState()
		/**
		 * content metadata per channel from the legacy get_params.cgi: { [cid]: { title, author, rec_prefix } }.
		 * A failed fetch leaves a retryable marker with the extra fields `_failedAt` (ms) and `_attempts`.
		 */
		this.metadata = {}
		/** cached preview images: { [key]: { png64, fetchedAt } } */
		this.previews = {}
		/** preview subscriptions maintained by the preview feedbacks: Map<key, count> */
		this.previewSubscriptions = new Map()
		/** incremented on every poll */
		this.pollCounter = 0
		/** '/api' or '/api/v2.0', decided by determineApiBase() */
		this.apiBasePath = '/api'
		/** last status passed to updateStatus (tracked by api.applyStatus) */
		this.currentStatus = undefined
		this.currentStatusMessage = undefined
		/** sorted variable ids joined, kept by variables.updateVariables */
		this.lastVariableIds = ''

		/** incremented by every configUpdated(); a poll started under an older generation discards its result */
		this.configGeneration = 0
		/** number of updateSystem() calls so far (lets configUpdated skip a redundant definitions update) */
		this.systemUpdateCount = 0

		this.timer = undefined
		this.previewTimer = undefined
		this.pollSoonTimer = undefined
		this.pollInProgress = false
		/** promise of the poll currently running (pollAll returns it to overlapping callers) */
		this.pollPromise = undefined
		this.previewsInProgress = false
		this.previewsPromise = undefined
		this.previewsRerun = undefined
	}

	/** true when the device speaks API v2.0 */
	get isV2() {
		return this.apiBasePath === '/api/v2.0'
	}

	/**
	 * Creates the configuration fields for web config.
	 *
	 * @returns {Array} the config fields
	 */
	getConfigFields() {
		return getConfigFields()
	}

	/**
	 * Main initialization function called once the module is OK to start doing things.
	 *
	 * @param {object} config the configuration object
	 */
	async init(config) {
		this.applyStatus(InstanceStatus.Connecting)
		await this.configUpdated(config)
	}

	/**
	 * Process an updated configuration.
	 * The config is always stored first; problems set the BadConfig status.
	 *
	 * @param {object} config - the new configuration
	 */
	async configUpdated(config) {
		this.stopTimers()
		// a poll that is still running belongs to the old configuration; the generation guard in
		// pollAllInner makes it discard its result, so there is no need to wait for it here
		this.configGeneration++
		this.config = normaliseConfig(config)

		const problem = validateConfig(this.config)
		if (problem) {
			this.log('error', problem)
			this.applyStatus(InstanceStatus.BadConfig, problem)
			// definitions must exist even while the config is unusable
			this.updateSystem()
			return
		}

		this.applyStatus(InstanceStatus.Connecting)
		this.state = emptyState()
		this.metadata = {}
		this.previews = {}
		this.pollCounter = 0
		this.pollErrorLogged = false

		// publish definitions for the (still empty) state right away; the first poll refreshes them
		this.updateSystem()

		// Companion allows init()/configUpdated() only a few seconds before it restarts the module,
		// and an unreachable device costs two request timeouts, so the first contact runs in the background.
		this.startupPromise = this.connect(this.configGeneration)
	}

	/**
	 * INTERNAL: first contact with the device for one configuration generation.
	 * Determines the API base, runs the first poll, re-subscribes previews and starts the timers.
	 * Never throws. Stops silently when the configuration changed underneath it.
	 *
	 * @param {number} generation - value of this.configGeneration this connection belongs to
	 */
	async connect(generation) {
		try {
			await this.determineApiBase()
			if (generation !== this.configGeneration) return
			// a poll from the previous configuration may still be running; pollAll() would join it and its
			// result is discarded by the generation guard, so let it finish before polling for real
			if (this.pollPromise) await this.pollPromise.catch(() => {})
			if (generation !== this.configGeneration) return
			await this.pollAll()
		} catch (error) {
			this.log('error', `Initialisation failed: ${error?.message || error}`)
		}
		if (generation !== this.configGeneration) return
		this.resubscribePreviews()
		this.initInterval()
		this.initPreviewInterval()
	}

	/**
	 * INTERNAL: ask Companion to re-send subscribe() for every placed preview feedback.
	 * Companion only calls subscribe once when a feedback is first sent, so after a config change the
	 * subscriptions are rebuilt from scratch. When the host does not deliver any (e.g. a stub that has
	 * no feedback instances) the previous subscriptions are kept.
	 */
	resubscribePreviews() {
		if (typeof this.subscribeFeedbacks !== 'function') return
		const previous = this.previewSubscriptions
		this.previewSubscriptions = new Map()
		try {
			this.subscribeFeedbacks('channelPreview', 'inputPreview', 'outputPreview')
		} catch (error) {
			this.log('debug', `re-subscribing preview feedbacks failed: ${error?.message || error}`)
		}
		if (this.previewSubscriptions.size === 0 && previous instanceof Map && previous.size > 0) {
			this.previewSubscriptions = previous
			this.pollPreviews().catch(() => {})
		}
	}

	/**
	 * Clean up the instance before it is destroyed.
	 */
	async destroy() {
		this.stopTimers()
		this.previewSubscriptions.clear()
		this.previews = {}
		this.applyStatus(InstanceStatus.Disconnected)
		this.log('debug', `destroy ${this.id}`)
	}

	/**
	 * INTERNAL: clear all timers
	 */
	stopTimers() {
		if (this.timer) clearInterval(this.timer)
		if (this.previewTimer) clearInterval(this.previewTimer)
		if (this.pollSoonTimer) clearTimeout(this.pollSoonTimer)
		this.timer = undefined
		this.previewTimer = undefined
		this.pollSoonTimer = undefined
	}

	/**
	 * Determine which API version should be used based on the firmware version.
	 * Requests /api/v2.0/system/firmware/version; anything >= 4.24.1 uses /api/v2.0.
	 */
	async determineApiBase() {
		this.apiBasePath = '/api'
		if (!this.config.use_api_v2) {
			this.log('info', 'API v2.0 disabled in configuration, using legacy API')
			return
		}
		try {
			const version = await this.request('GET', '/api/v2.0/system/firmware/version', {
				base: 'raw',
				optional: true,
				silent: true,
			})
			const verNum = firmwareVersionNumber(typeof version === 'string' ? version : version?.version)
			if (verNum !== null && verNum >= MIN_API_V2_VERSION) {
				this.apiBasePath = '/api/v2.0'
				this.log('info', `Firmware ${version}: using API v2.0`)
			} else if (version === null) {
				this.log('info', 'API v2.0 not available on this device, using legacy API')
			} else {
				this.log('info', `Firmware ${version} is older than 4.24.1, using legacy API`)
			}
		} catch (error) {
			this.log('warn', `API v2.0 check failed (${error?.message || error}), using legacy API`)
		}
	}

	/**
	 * INTERNAL: compatibility status handler (used by older action code)
	 *
	 * @param {InstanceStatus} level
	 * @param {string} [message]
	 */
	setStatus(level, message = '') {
		this.applyStatus(level, message)
		if (level === 'error') {
			this.log('error', message)
		} else if (level === 'warn') {
			this.log('warn', message)
		}
	}

	/**
	 * INTERNAL: (re)set action, feedback and preset definitions. Never throws.
	 */
	updateSystem() {
		this.systemUpdateCount = (this.systemUpdateCount || 0) + 1
		const steps = [
			['actions', () => this.setActionDefinitions(this.getActions())],
			['feedbacks', () => this.setFeedbackDefinitions(this.getFeedbacks())],
			['presets', () => this.setPresetDefinitions(this.getPresets())],
		]
		for (const [what, run] of steps) {
			try {
				run()
			} catch (error) {
				this.log('error', `Failed to build ${what}: ${error?.message || error}`)
			}
		}
	}

	/**
	 * Run one poll shortly after a control action so feedbacks update without waiting for the interval.
	 * Multiple calls within the delay are coalesced into one poll.
	 */
	schedulePollSoon() {
		if (this.pollSoonTimer) return
		this.pollSoonTimer = setTimeout(() => {
			this.pollSoonTimer = undefined
			this.pollAll().catch(() => {})
		}, POLL_SOON_DELAY)
	}

	/**
	 * Fetch the content metadata (title, author, rec_prefix) of a channel via the legacy admin interface
	 *
	 * @param {string|number} channelId
	 */
	async fetchMetadata(channelId) {
		const cid = String(channelId)
		if (!CHANNEL_ID_RE.test(cid)) {
			this.log('error', `Invalid channelId: ${cid}`)
			return
		}
		if (this.config.verbose) {
			this.log('debug', `Fetching metadata for channel ${cid}`)
		}
		try {
			const text = await this.request('GET', `/admin/channel${cid}/get_params.cgi?title&author&rec_prefix`, {
				base: 'raw',
				text: true,
				silent: true,
			})
			const parsed = parseKeyValueText(text)
			this.metadata[cid] = {
				title: parsed.title ?? '',
				author: parsed.author ?? '',
				rec_prefix: parsed.rec_prefix ?? '',
			}
			if (this.config.verbose) {
				this.log('debug', `Parsed metadata ${JSON.stringify(this.metadata[cid])}`)
			}
			variables.updateVariables(this)
		} catch (error) {
			// leave a retryable marker so the poller backs off instead of hammering the device every poll
			const previous = this.metadata[cid] || {}
			const attempts = (Number(previous._attempts) || 0) + 1
			this.metadata[cid] = {
				title: previous.title ?? '',
				author: previous.author ?? '',
				rec_prefix: previous.rec_prefix ?? '',
				_failedAt: Date.now(),
				_attempts: attempts,
			}
			this.log(
				attempts === 1 ? 'error' : 'debug',
				`Failed to get metadata for channel ${cid} (attempt ${attempts}): ${error?.message || error}`,
			)
		}
	}

	/**
	 * INTERNAL: start the interval data poller
	 */
	initInterval() {
		if (this.timer) clearInterval(this.timer)
		const ms = Math.ceil((Number(this.config?.pollfreq) || 10) * 1000)
		this.timer = setInterval(() => {
			this.pollAll().catch(() => {})
		}, ms)
	}

	/**
	 * INTERNAL: start the preview image poller (only when preview_interval > 0)
	 */
	initPreviewInterval() {
		if (this.previewTimer) clearInterval(this.previewTimer)
		this.previewTimer = undefined
		const seconds = Number(this.config?.preview_interval) || 0
		if (seconds <= 0) return
		this.previewTimer = setInterval(
			() => {
				this.pollPreviews().catch(() => {})
			},
			Math.ceil(seconds * 1000),
		)
	}
}

Object.assign(EpiphanPearl.prototype, api, poller, choices, actions, feedbacks, presets)

const upgradeToBooleanFeedbacks = CreateConvertToBooleanFeedbackUpgradeScript({
	channelLayout: {
		fg: 'color',
		bg: 'bgcolor',
	},
	streamingState: {
		fg: 'color',
		bg: 'bgcolor',
	},
	recorderRecording: {
		fg: 'color',
		bg: 'bgcolor',
	},
})

const upgradeScripts = [upgradeToBooleanFeedbacks, ...upgrades]

module.exports = { EpiphanPearl, upgradeScripts, PearlApiError, MIN_API_V2_VERSION }
