// D-numbers (D1–D17) refer to Epiphan's internal Companion-parity decisions.
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
const meter = require('./meter')
const { getConfigFields } = require('./config')
const upgrades = require('./upgrades')
const { emptyState, firmwareVersionNumber, clampNumber } = require('./utils')

/** Minimum firmware version (4.24.01) that supports API v2.0 */
const MIN_API_V2_VERSION = 42401
/** delay of the coalesced poll triggered after a control action */
const POLL_SOON_DELAY = 750
/** poll_interval bounds and fallback (D8); kept in sync with src/config.js and src/poller.js */
const POLL_INTERVAL_DEFAULT_MS = 2000
const POLL_INTERVAL_MIN_MS = 500
const POLL_INTERVAL_MAX_MS = 300000

const IP_RE = new RegExp(Regex.IP.slice(1, -1))
const HOSTNAME_RE = new RegExp(Regex.HOSTNAME.slice(1, -1))

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
	c.use_https = c.use_https === true
	c.accept_self_signed = c.accept_self_signed !== false
	if (c.use_https && c.host_port === '80') c.host_port = '443'
	c.poll_interval = clampNumber(c.poll_interval, POLL_INTERVAL_DEFAULT_MS, POLL_INTERVAL_MIN_MS, POLL_INTERVAL_MAX_MS)
	c.timeout = clampNumber(c.timeout, 5000, 1000, 60000)
	c.use_api_v2 = c.use_api_v2 !== false
	c.preview_interval = clampNumber(c.preview_interval, 2, 0, 300)
	c.preview_width = Math.round(clampNumber(c.preview_width, 144, 72, 720))
	c.poll_events = c.poll_events !== false
	c.verbose = c.verbose === true
	c.preset_categories = presets.normalisePresetCategories(c.preset_categories)
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

		/** device state, rebuilt on every poll */
		this.state = emptyState()
		/** cached preview images: { [key]: { png64, fetchedAt } } */
		this.previews = {}
		/** preview subscriptions maintained by the preview feedbacks: Map<key, count> */
		this.previewSubscriptions = new Map()
		/** audio meter subscriptions maintained by the 'audio' feedback: Map<inputId, count> */
		this.meterSubscriptions = new Map()
		/** keys whose last fetch failed, so a 'warn' is logged once on failure and once on recovery, not every poll */
		this.previewFailedKeys = new Set()
		/** incremented on every poll */
		this.pollCounter = 0
		/** consecutive failed polls; drives the poller's failure backoff (D8, poller.nextPollDelayMs) */
		this.pollFailureCount = 0
		/** '/api' or '/api/v2.0', decided by determineApiBase() */
		this.apiBasePath = '/api'
		/** last status passed to updateStatus (tracked by api.applyStatus) */
		this.currentStatus = undefined
		this.currentStatusMessage = undefined
		/** sorted variable ids joined, kept by variables.updateVariables */
		this.lastVariableIds = ''
		/** device clock minus host clock in ms, from the Date header of every response (api.syncClock) */
		this.clockOffsetMs = 0
		/** undici Agent carrying the TLS settings of the current configuration (api.resetDispatcher) */
		this.dispatcher = undefined

		/** incremented by every configUpdated(); a poll started under an older generation discards its result */
		this.configGeneration = 0
		/** number of updateSystem() calls so far (lets configUpdated skip a redundant definitions update) */
		this.systemUpdateCount = 0

		this.timer = undefined
		this.previewTimer = undefined
		this.pollSoonTimer = undefined
		/** 500 ms audio level poll, running only while a meter is subscribed (src/meter.js) */
		this.meterTimer = undefined
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
		this.reportRemovedLegacy()
		await this.configUpdated(config)
	}

	/**
	 * INTERNAL: warn once, at module start, about every legacy action/feedback id the upgrade script
	 * (`upgrades.convertToParityV300`) found and could not delete (D13: an upgrade script has no way to
	 * remove a placed instance, only to report it). One 'warn' line per distinct id, naming how many
	 * buttons carried it; the shared array is then emptied so a later init() in the same process does
	 * not repeat the message.
	 */
	reportRemovedLegacy() {
		const removed = upgrades.REMOVED_LEGACY
		if (!Array.isArray(removed) || removed.length === 0) return
		const counts = new Map()
		for (const entry of removed) {
			const key = `${entry.kind}:${entry.id}`
			counts.set(key, (counts.get(key) || 0) + 1)
		}
		for (const [key, count] of counts) {
			const sep = key.indexOf(':')
			const kind = key.slice(0, sep)
			const id = key.slice(sep + 1)
			this.log(
				'warn',
				`Removed legacy ${kind} '${id}' (${count} button${count === 1 ? '' : 's'}): no longer available ` +
					'after the 3.0.0 Companion-parity rewrite. Remove it from the affected button(s) or replace it ' +
					'with its listed counterpart (see CHANGELOG.md).',
			)
		}
		removed.length = 0
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
		this.clockOffsetMs = 0
		this.resetDispatcher()

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
		this.previews = {}
		this.previewFailedKeys.clear()
		this.pollCounter = 0
		this.pollErrorLogged = false
		// a new configuration may be a different device entirely; it should not inherit the old one's backoff
		this.pollFailureCount = 0

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
		// meter subscriptions survive a configuration change (Companion does not re-send subscribe for
		// them), so the level poll is simply restarted here when one is still placed
		this.startMeterTimer()
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
			this.subscribeFeedbacks('preview', 'layout_preview')
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
		// a connect() from the last configUpdated() may still be in flight (its own request timeouts
		// haven't elapsed yet); bumping the generation makes its guards see a mismatch so it returns
		// without calling initInterval()/initPreviewInterval(), instead of starting a new timer after
		// destroy() already ran
		this.configGeneration++
		this.previewSubscriptions.clear()
		this.meterSubscriptions.clear()
		this.previews = {}
		this.previewFailedKeys.clear()
		this.closeDispatcher()
		this.applyStatus(InstanceStatus.Disconnected)
		this.log('debug', `destroy ${this.id}`)
	}

	/**
	 * INTERNAL: clear all timers
	 */
	stopTimers() {
		// this.timer now chains via setTimeout (D8 backoff, see initInterval); clearTimeout and
		// clearInterval clear either kind of handle interchangeably in Node, but this names the truth
		if (this.timer) clearTimeout(this.timer)
		if (this.previewTimer) clearInterval(this.previewTimer)
		if (this.pollSoonTimer) clearTimeout(this.pollSoonTimer)
		this.timer = undefined
		this.previewTimer = undefined
		this.pollSoonTimer = undefined
		this.stopMeterTimer()
		// Stage 1 mixins (confirm.js, rotary.js): a pending confirm or a coalescing rotary tick must not
		// outlive this instance
		this.clearConfirmTimer()
		this.clearRotaryTimers()
		this.clearFailureTimers()
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
	 * INTERNAL: start the interval data poller. Chains via setTimeout rather than a fixed setInterval so
	 * the D8 failure backoff (poller.nextPollDelayMs) can widen the gap between polls; the delay is
	 * recomputed from the current failure count after every poll, not fixed at start time.
	 */
	initInterval() {
		if (this.timer) clearTimeout(this.timer)
		const runOnce = () => {
			this.pollAll()
				.catch(() => {})
				.finally(() => {
					this.timer = setTimeout(runOnce, this.nextPollDelayMs())
				})
		}
		this.timer = setTimeout(runOnce, this.nextPollDelayMs())
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

Object.assign(EpiphanPearl.prototype, api, poller, choices, actions, feedbacks, presets, meter)

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

module.exports = { EpiphanPearl, upgradeScripts, PearlApiError, normaliseConfig }
