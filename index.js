// noinspection JSFileReferences
const {
	CreateConvertToBooleanFeedbackUpgradeScript,
	InstanceBase,
	InstanceStatus,
	Regex,
} = require('@companion-module/base')
const http = require('http')

// use global fetch provided by Node 18+
if (typeof global.fetch !== 'function') {
	throw new Error('Global fetch API is not available. Please use Node 18 or newer')
}
const fetchFunc = global.fetch

const actions = require('./actions')
const feedbacks = require('./feedbacks')
const presets = require('./presets')
const { get_config_fields } = require('./config')
const variables = require('./variables')
const upgradeScripts = require('./upgrades')
// Minimum firmware version that supports API v2.0, older firmware is controlled with the v1 API
const MIN_API_V2_FIRMWARE = '4.24.1'
// Timeout in ms for all HTTP requests to the device
const REQUEST_TIMEOUT = 3000
// Interval in ms to retry the connection while the device is not reachable
const RECONNECT_INTERVAL = 10000

/**
 * Companion instance class for the Epiphan Pearl.
 *
 * @extends InstanceBase
 * @version 3.2.0
 * @since 1.0.0
 */
class EpiphanPearl extends InstanceBase {
	/**
	 * Create an instance of a EpiphanPearl module.
	 *
	 * @access public
	 * @since 1.0.0
	 * @param {EventEmitter} system - the brains of the operation
	 * @param {string} id - the instance ID
	 * @param {Object} config - saved user configuration parameters
	 */
	constructor(internal) {
		super(internal)

		/**
		 * Object holding all the state of the pearl
		 * structure is similar to the api nodes
		 */
		this.state = {
			channels: {},
			recorders: {},
		}

		// store content metadata for each channel
		this.metadata = {}

		/**
		 * base path for the pearl API
		 * will be updated during init when firmware is checked
		 */
		this.apiBasePath = '/api'

		Object.assign(this, {
			...actions,
			...feedbacks,
			...presets,
			//...variables
		})
	}

	// noinspection JSUnusedGlobalSymbols
	/**
	 * Creates the configuration fields for web config.
	 *
	 * @access public
	 * @since 1.0.0
	 * @returns {Array} the config fields
	 */
	getConfigFields() {
		return get_config_fields()
	}

	/**
	 * Clean up the instance before it is destroyed.
	 *
	 * @access public
	 * @since 1.0.0
	 */
	async destroy() {
		this.stopPolling()
		this.updateStatus(InstanceStatus.Disconnected)
		this.log('debug', 'destroy', this.id)
	}

	/**
	 * Main initialization function called once the module
	 * is OK to start doing things.
	 *
	 * @access public
	 * @since 1.0.0
	 * @param config the configuration object
	 */
	async init(config) {
		this.updateStatus(InstanceStatus.Connecting)

		// Fix: all the connection setup moved to configUpdated(), so it also runs when the user saves the
		// config later. Before, a new connection without a config from a previous version crashed here
		// (this.config was never set, determineApiBase() threw), so Companion never showed the config page.
		await this.configUpdated(config)
	}

	// noinspection JSUnusedGlobalSymbols
	/**
	 * Process an updated configuration array.
	 * (Re)starts the connection to the device with the new configuration.
	 *
	 * @access public
	 * @since 1.0.0
	 * @param {Object} config - the new configuration
	 */
	async configUpdated(config) {
		// Fix: always store the config, even an invalid one, so no method runs on an undefined config
		const savedConfig = config || {}
		// the connection works on a copy, the address of a Pearl found via Bonjour is only used, not
		// written into the manual address fields
		this.config = { ...savedConfig }

		// A Pearl selected in the Bonjour field ("Pearl") is used instead of the manual address. Companion
		// provides it as 'host:port', or null for "Manual".
		if (this.config.bonjourHost) {
			const value = String(this.config.bonjourHost)
			const separator = value.lastIndexOf(':')
			this.config.host = separator > 0 ? value.slice(0, separator).replace(/^\[|\]$/g, '') : value
			this.config.host_port = separator > 0 ? value.slice(separator + 1) : '80'
		}

		// stop polling the old device, the new configuration may point to a different one
		this.stopPolling()
		this.connectionFailed = false

		// hostnames are accepted as well as IP addresses (the hostname pattern also matches IPv4 addresses)
		if (typeof this.config.host === 'string') this.config.host = this.config.host.trim()
		if (!this.config.host || this.config.host.match(new RegExp(Regex.HOSTNAME.slice(1, -1))) === null) {
			this.updateStatus(InstanceStatus.BadConfig, 'Invalid IP address or hostname')
			this.log('error', 'invalid IP address or hostname given in configuration: ' + this.config.host)
			// register the (empty) definitions anyway, so the module is usable once configured
			this.updateSystem()
			return
		}
		const port = parseInt(this.config.host_port)
		if (!(port >= 1 && port <= 65535)) {
			this.updateStatus(InstanceStatus.BadConfig, 'Invalid port number')
			this.log('error', 'invalid portnumber given in configuration: ' + this.config.host_port)
			this.updateSystem()
			return
		}

		if (typeof this.config.pollfreq !== 'number') {
			this.config.pollfreq = 10
			// the saved config, not the working copy, so a Bonjour address is not stored as manual address
			// module-base 2.x: saveConfig() takes the secrets as second argument, this module has none
			this.saveConfig({ ...savedConfig, pollfreq: 10 }, undefined)
		}

		// Fix: forget everything learned from the previous configuration (it may have been a different
		// device) and redetect the API version, before this happened only once at startup
		this.state = { channels: {}, recorders: {} }
		this.metadata = {}
		this.updateStatus(InstanceStatus.Connecting)
		// the poller detects the API version first, and also fetches the metadata of all channels
		this.apiDetected = false
		await this.dataPoller()
		this.updateSystem()
		this.initInterval()
	}

	/**
	 * Whether requests go to the API v2.0
	 *
	 * @returns {boolean}
	 */
	usesApiV2() {
		return this.apiBasePath === '/api/v2.0'
	}

	/**
	 * Compare two firmware versions like '4.24.1'
	 *
	 * @param {string} a
	 * @param {string} b
	 * @returns {number} negative if a is older than b, 0 if equal, positive if a is newer
	 */
	static compareFirmware(a, b) {
		const pa = String(a)
			.split('.')
			.map((v) => parseInt(v, 10) || 0)
		const pb = String(b)
			.split('.')
			.map((v) => parseInt(v, 10) || 0)
		for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
			const diff = (pa[i] ?? 0) - (pb[i] ?? 0)
			if (diff !== 0) return diff
		}
		return 0
	}

	/**
	 * Set the connection status to OK, or to a warning if the firmware of the Pearl is outdated
	 *
	 * @private
	 */
	setOkStatus() {
		if (this.firmwareWarning) {
			this.updateStatus(InstanceStatus.UnknownWarning, this.firmwareWarning)
		} else {
			this.updateStatus(InstanceStatus.Ok)
		}
	}

	/**
	 * Determine which API version should be used based on firmware.
	 * API v2.0 is always used when the firmware supports it (the former config option was removed).
	 * On older firmware the module falls back to the v1 API and recommends a firmware update.
	 */
	async determineApiBase() {
		this.apiBasePath = '/api'
		this.firmwareWarning = undefined
		this.apiDetected = false
		const apiHost = this.config.host
		const apiPort = this.config.host_port
		const url = `http://${apiHost}:${apiPort}/api/v2.0/system/firmware/version`
		try {
			const response = await fetchFunc(url, {
				method: 'GET',
				// Fix: fetch() ignores a 'timeout' option, an AbortSignal is needed for a real timeout
				signal: AbortSignal.timeout(REQUEST_TIMEOUT),
				headers: {
					Authorization:
						'Basic ' + Buffer.from(this.config.username + ':' + this.config.password).toString('base64'),
				},
			})
			if (response.ok) {
				const data = await response.json()
				const version = String(data.result || data)
				this.apiDetected = true
				if (EpiphanPearl.compareFirmware(version, MIN_API_V2_FIRMWARE) >= 0) {
					this.apiBasePath = '/api/v2.0'
				} else {
					this.firmwareWarning = `Pearl firmware ${version} is older than ${MIN_API_V2_FIRMWARE}. Please update the Pearl to the latest firmware to use all features of this module.`
				}
			} else if (response.status === 404) {
				// firmware without API v2.0, the exact version can't be read with the v1 API
				this.apiDetected = true
				this.firmwareWarning = `Pearl firmware is older than ${MIN_API_V2_FIRMWARE}. Please update the Pearl to the latest firmware to use all features of this module.`
			} else {
				this.log('warn', `Could not determine the firmware version: ${http.STATUS_CODES[response.status]}`)
			}
		} catch (e) {
			// device not reachable, the detection is repeated with the next poll
			if (this.config.verbose) {
				this.log('debug', 'Firmware version check failed: ' + e.message)
			}
		}
		if (this.firmwareWarning) {
			this.log('warn', this.firmwareWarning)
		}
	}

	/**
	 * INTERNAL: handler of status changes
	 *
	 * @private
	 * @since 1.0.0
	 * @param {Number} level
	 * @param {?String} message
	 */
	setStatus(level, message = '') {
		this.updateStatus(level, message)

		if (level === 'error') {
			this.log('error', message)
		} else if (level === 'warn') {
			this.log('warn', message)
		}
	}

	/**
	 * INTERNAL: Update current active layout for a channel to the new active layout
	 *
	 * @private
	 * @since 1.0.0
	 * @param {String|Number} channelId
	 */
	async updateActiveChannelLayout(channelId) {
		channelId = channelId.toString()
		if (this.usesApiV2()) {
			// API v2.0 has no layout list, but reports the active layout of a channel
			const channels = await this.sendRequest('get', '/api/channels?ids=' + channelId + '&active_layout=yes', {})
			const channel = channels.find((c) => c.id === channelId)
			if (this.state.channels[channelId] && channel?.active_layout) {
				this.applyActiveLayout(this.state.channels[channelId], channel.active_layout)
			}
		} else {
			const layouts = await this.sendRequest('get', '/api/channels/' + channelId + '/layouts', {})
			layouts.forEach((layout) => {
				// Fix: skip layouts which are not known yet (e.g. created on the device since the last poll)
				const knownLayout = this.state.channels[channelId]?.layouts[layout.id]
				if (knownLayout) knownLayout.active = layout.active
			})
		}
		this.checkFeedbacks('channelLayout')
		// Fix: the variable of the active layout only changed with the next regular poll
		variables.updateVariables(this)
	}

	/**
	 * INTERNAL: Mark the active layout reported by API v2.0 in the layouts of a channel
	 * If the layout list could not be fetched (it is only available in the v1 API), at least the
	 * active layout is added, so the feedback and variable for it still work.
	 *
	 * @private
	 * @param {Object} channelState - the channel in this.state
	 * @param {{id: string, name: string}} activeLayout - the active_layout object from API v2.0
	 */
	applyActiveLayout(channelState, activeLayout) {
		if (!channelState.layouts[activeLayout.id]) {
			channelState.layouts[activeLayout.id] = { id: activeLayout.id, name: activeLayout.name }
		}
		for (const layout of Object.values(channelState.layouts)) {
			layout.active = layout.id == activeLayout.id
		}
	}

	/**
	 * INTERNAL: Update all the companion bits when configuration changes
	 *
	 * @private
	 * @since 1.0.0
	 */
	updateSystem() {
		this.setActionDefinitions(this.get_actions())
		this.updateFeedbacks()
		this.updatePresets()
	}

	/**
	 * INTERNAL: Setup and send request
	 *
	 * @private
	 * @since 1.0.0
	 * @param {String} type - post, get, put
	 * @param {String} url - Full URL to send request to
	 * @param {?Object} body - Optional body to send
	 * @param {Object} [options]
	 * @param {boolean} [options.legacy=false] - always use the v1 API, for endpoints which don't exist in API v2.0
	 */
	async sendRequest(type, url, body = {}, { legacy = false } = {}) {
		const apiHost = this.config.host,
			apiPort = this.config.host_port,
			baseUrl = 'http://' + apiHost + ':' + apiPort

		if (url === null || url === '') {
			this.setStatus(InstanceStatus.BadConfig, 'No URL given for sendRequest')
			this.log('error', 'No URL given for sendRequest')
			return false
		}

		type = type.toUpperCase()
		if (['GET', 'POST', 'PUT'].indexOf(type) === -1) {
			this.setStatus(InstanceStatus.UnknownError, 'Wrong request type: ' + type)
			this.log('error', 'Wrong request type: ' + type)
			return false
		}

		// Check if body is not empty
		if (body === undefined) {
			body = {}
		}

		let apiUrl = url
		if (url.startsWith('/api/') && !legacy) {
			apiUrl = this.apiBasePath + url.slice(4)
		}
		const requestUrl = baseUrl + apiUrl
		if (this.config.verbose) {
			this.log('debug', `Request ${type} ${requestUrl}`)
		}
		//this.log('debug', 'Starting request to: ' + type + ' ' + baseUrl + url + ' body: ' + JSON.stringify(body))

		let response
		try {
			let options = {
				method: type,
				// Fix: fetch() ignores a 'timeout' option, an AbortSignal is needed for a real timeout
				signal: AbortSignal.timeout(REQUEST_TIMEOUT),
				headers: {
					Authorization:
						'Basic ' + Buffer.from(this.config.username + ':' + this.config.password).toString('base64'),
				},
			}

			// Fix: only send a JSON body if there is something to send. As soon as a request has a JSON
			// body, the Pearl ignores the query parameters (checked on a Pearl-2 with 4.24.6), so API v2.0
			// commands with query parameters (layout change, marker) failed with an empty body '{}'.
			if (type !== 'GET' && body && Object.keys(body).length > 0) {
				options.body = JSON.stringify(body)
				options.headers['Content-Type'] = 'application/json'
			}

			response = await fetchFunc(requestUrl, options)
		} catch (error) {
			// The connection status is only changed for real connection problems: network errors and
			// timeouts here, a wrong password below. Error answers of the Pearl to a single request
			// (e.g. "channel is not recording" for a marker) don't mean the connection is broken.
			// AbortSignal.timeout() rejects with a TimeoutError
			if (error.name === 'AbortError' || error.name === 'TimeoutError') {
				this.setStatus(
					InstanceStatus.ConnectionFailure,
					'Request was aborted: ' + requestUrl + ' reason: ' + error.message,
				)
				this.log('debug', error.message)
				throw new Error(error)
			}

			this.setStatus(InstanceStatus.ConnectionFailure, error.message)
			this.log('debug', error.message)
			throw new Error(error)
		}

		if (response.status === 401) {
			this.setStatus(InstanceStatus.AuthenticationFailure, 'Wrong username or password')
			this.log('debug', 'Authentication failed: ' + requestUrl)
			const error = new Error('Wrong username or password')
			error.authenticationFailed = true
			throw error
		}

		if (!response.ok) {
			this.log(
				'debug',
				'Non-successful response status code: ' + http.STATUS_CODES[response.status] + ' ' + requestUrl,
			)
			// the Pearl explains most errors in the JSON body, e.g. why a marker can't be set
			const errorBody = await response.json().catch(() => undefined)
			throw new Error(
				'Non-successful response status code: ' +
					http.STATUS_CODES[response.status] +
					(errorBody?.message ? ' - ' + errorBody.message : ''),
			)
		}

		const responseBody = await response.json()
		if (this.config.verbose) {
			this.log('debug', `Response ${JSON.stringify(responseBody)}`)
		}
		if (responseBody && responseBody.status && responseBody.status !== 'ok') {
			// Fix: the error message is in the response from the Pearl, not in the request body we sent
			const errorMessage =
				'Non-successful response from pearl: ' +
				requestUrl +
				' - ' +
				(responseBody.message ? responseBody.message : 'No error message')
			this.log('debug', errorMessage)
			throw new Error(errorMessage)
		}

		let result = responseBody
		if (responseBody && responseBody.result) {
			result = responseBody.result
		}

		// keeps the firmware update recommendation visible instead of overwriting it with OK
		this.setOkStatus()
		return result
	}

	/**
	 * INTERNAL: initialize feedbacks.
	 *
	 * @private
	 * @since 1.0.0
	 */
	updateFeedbacks() {
		this.setFeedbackDefinitions(this.getFeedbacks())
	}

	/**
	 * INTERNAL: initialize presets.
	 *
	 * @private
	 * @since [Unreleased]
	 */
	updatePresets() {
		// module-base 2.x: presets are passed together with their section structure
		const { structure, presets } = this.getPresets()
		this.setPresetDefinitions(structure, presets)
	}

	/**
	 * INTERNAL: initialize the data poller.
	 * Polling data such as channels, recorders, layouts
	 *
	 * @private
	 * @since 1.0.0
	 */
	initInterval() {
		this.stopPolling()
		this.scheduleNextPoll()
	}

	/**
	 * INTERNAL: stop the data poller, also a poll which is currently running won't schedule the next one
	 *
	 * @private
	 */
	stopPolling() {
		clearTimeout(this.timer)
		this.timer = undefined
		this.pollGeneration = (this.pollGeneration ?? 0) + 1
	}

	/**
	 * INTERNAL: schedule the next poll.
	 * Polls normally run with the configured polling frequency. While the connection to the Pearl is
	 * failing, the connection is retried every 10 seconds instead.
	 *
	 * @private
	 */
	scheduleNextPoll() {
		const generation = this.pollGeneration
		const delay = this.connectionFailed
			? RECONNECT_INTERVAL
			: Math.ceil(this.config.pollfreq * 1000) || RECONNECT_INTERVAL
		this.timer = setTimeout(async () => {
			await this.dataPoller()
			// don't continue if the poller was stopped or restarted in the meantime
			if (generation === this.pollGeneration) {
				this.scheduleNextPoll()
			}
		}, delay)
	}

	/**
	 * INTERNAL: Run the data poller, but never twice at the same time.
	 * Fix: slow answers from the device led to overlapping polls which overwrote each other's state.
	 * Errors are caught here, because an exception inside the timer callback would be an unhandled
	 * promise rejection.
	 *
	 * @private
	 */
	async dataPoller() {
		if (this.pollRunning) {
			return
		}
		this.pollRunning = true
		try {
			await this.pollData()
		} catch (error) {
			this.log('error', 'Polling failed: ' + error.message)
		} finally {
			this.pollRunning = false
		}
	}

	/**
	 * Part of poller
	 * INTERNAL: The data poller will actively make requests to update feedbacks and dropdown options.
	 * Polling data such as channels, recorders, layouts and status
	 *
	 * @private
	 * @since 1.0.0
	 */
	async pollData() {
		// Fix: if the Pearl was not reachable when the module started, the API version was never
		// detected and the module stayed on the v1 API, so the detection is repeated until it succeeds
		if (!this.apiDetected) {
			await this.determineApiBase()
		}

		const state = {
			channels: {},
			recorders: {},
		} // start with a fresh object, during the update some properties will be unavailable, so it is best to not do live updates

		// Get all channels and recorders available (in parallel)
		let channels, recorders, recorders_status, systemStatus, firmware, identity, afu, encoderStatus, storages
		// Fix: the optional v2.0 endpoints are requested separately with allSettled. Before, they were part
		// of the Promise.all below, so one failing optional endpoint (e.g. afu/status without Automatic
		// File Upload configured) made the whole poll fail and no feedback was updated anymore.
		const v2 = this.usesApiV2()
		const optionalRequests = Promise.allSettled([
			v2 ? this.sendRequest('get', '/api/system/status', {}) : undefined,
			v2 ? this.sendRequest('get', '/api/system/firmware', {}) : undefined,
			v2 ? this.sendRequest('get', '/api/system/ident', {}) : undefined,
			v2 ? this.sendRequest('get', '/api/afu/status', {}) : undefined,
			// The current encoder values (bitrate, fps) are only reported by the channel status of the v1
			// API, also on firmware with API v2.0 (checked on a Pearl-2 with 4.24.6). API v2.0 only reports
			// the encoder settings, where the bitrate is 0 when it is set to automatic.
			this.sendRequest('get', '/api/channels/status?encoders=yes', {}, { legacy: true }),
			v2 ? this.fetchStorages() : undefined,
		])
		// wait for all requests before deciding, otherwise a late successful answer could set the status
		// back to OK after the poll already failed
		const mainResults = await Promise.allSettled([
			// API v2.0 reports the active layout of each channel with the channel list
			this.sendRequest(
				'get',
				'/api/channels?publishers=yes&encoders=yes' + (this.usesApiV2() ? '&active_layout=yes' : ''),
				{},
			),
			this.sendRequest('get', '/api/recorders', {}),
			this.sendRequest('get', '/api/recorders/status', {}),
		])
		const optionalResults = await optionalRequests
		const failed = mainResults.find((res) => res.status === 'rejected')
		if (failed) {
			const error = failed.reason
			// a wrong password already set its own status, everything else means no usable connection
			if (!error.authenticationFailed) {
				this.setStatus(InstanceStatus.ConnectionFailure, 'No valid answer from device: ' + error.message)
			}
			// log only when the connection gets lost, not on every retry
			if (!this.connectionFailed) {
				this.log(
					'error',
					`No valid answer from device (${error.message}), retrying every ${RECONNECT_INTERVAL / 1000} seconds`,
				)
			}
			this.connectionFailed = true
			return
		}
		;[channels, recorders, recorders_status] = mainResults.map((res) => res.value)
		if (this.connectionFailed) {
			this.log('info', 'Connection to the Pearl restored')
			this.connectionFailed = false
		}
		;[systemStatus, firmware, identity, afu, encoderStatus, storages] = optionalResults.map((res) =>
			res.status === 'fulfilled' ? res.value : undefined,
		)

		channels.forEach((channel) => {
			state.channels[channel.id] = { ...channel }
			state.channels[channel.id].layouts = {}
			state.channels[channel.id].publishers = {}
		})

		// v1 API: add the channel status (signal, total bitrate) and the encoder status (resolution,
		// bitrate) to each channel
		if (Array.isArray(encoderStatus)) {
			for (const channelStatus of encoderStatus) {
				const channelState = state.channels[channelStatus.id]
				if (!channelState) continue
				if (channelStatus.status && !Array.isArray(channelStatus.status))
					channelState.status = channelStatus.status
				if (!Array.isArray(channelStatus.encoders)) continue
				const encoders = Array.isArray(channelState.encoders) ? [...channelState.encoders] : []
				for (const encoder of channelStatus.encoders) {
					const index = encoders.findIndex((e) => e.id === encoder.id)
					if (index >= 0) encoders[index] = { ...encoders[index], status: encoder.status }
					else encoders.push({ ...encoder })
				}
				channelState.encoders = encoders
			}
		}

		recorders.forEach((recorder) => {
			state.recorders[recorder.id] = { ...recorder }
		})

		recorders_status.forEach((recorder) => {
			if (state.recorders[recorder.id] === undefined) state.recorders[recorder.id] = {} // just for the event a recorder has been created between call to recorders and recorders/status
			state.recorders[recorder.id].status = recorder.status
		})

		if (systemStatus) state.systemStatus = systemStatus
		if (firmware) state.firmware = firmware
		if (identity) state.identity = identity
		if (afu) state.afu = afu
		if (storages) state.storages = storages

		// Get all layouts and publishers for all channels and all recorder states (in parallel)
		await Promise.allSettled([
			...channels.map(async (channel) => {
				// API v2.0 has no endpoint to list the layouts of a channel, so this always uses the v1 API
				const layouts = await this.sendRequest(
					'get',
					'/api/channels/' + channel.id + '/layouts',
					{},
					{ legacy: true },
				)
				layouts.forEach((layout) => {
					state.channels[channel.id].layouts[layout.id] = { ...layout }
				})
			}),
			...channels.map(async (channel) => {
				const publishers = await this.sendRequest('get', '/api/channels/' + channel.id + '/publishers/type', {})
				publishers.forEach((publisher) => {
					if (state.channels[channel.id].publishers[publisher.id] === undefined)
						state.channels[channel.id].publishers[publisher.id] = {}
					state.channels[channel.id].publishers[publisher.id].id = publisher.id
					state.channels[channel.id].publishers[publisher.id].type = publisher.type
					state.channels[channel.id].publishers[publisher.id].name = publisher.name
				})
			}),
			...channels.map(async (channel) => {
				const publishersstatus = await this.sendRequest(
					'get',
					'/api/channels/' + channel.id + '/publishers/status',
					{},
				)
				publishersstatus.forEach((publisher) => {
					if (state.channels[channel.id].publishers[publisher.id] === undefined)
						state.channels[channel.id].publishers[publisher.id] = {}
					state.channels[channel.id].publishers[publisher.id].status = publisher.status
				})
			}),
		])

		// In API v2.0 the active layout comes with the channel list and is more reliable than the
		// v1 layout list, which may not be available on newer firmware
		for (const channel of channels) {
			if (channel.active_layout) {
				this.applyActiveLayout(state.channels[channel.id], channel.active_layout)
			}
		}

		// now that we have an updated state object, let's see where we have to react

		const channelIds = Object.keys(state.channels)
		const recorderIds = Object.keys(state.recorders)

		let updateNeeded = false // this is to mark if choices or presets needs to be updated

		if (JSON.stringify(channelIds) !== JSON.stringify(Object.keys(this.state.channels))) {
			updateNeeded = true
		} else if (JSON.stringify(recorderIds) !== JSON.stringify(Object.keys(this.state.recorders))) {
			updateNeeded = true
		} else if (
			channelIds.reduce((acc, curr) => `${acc},${state.channels[curr].name}`, '') !==
			channelIds.reduce((acc, curr) => `${acc},${this.state.channels[curr].name}`, '')
		) {
			updateNeeded = true
		} else if (
			recorderIds.reduce((acc, curr) => `${acc},${state.recorders[curr].name}`, '') !==
			recorderIds.reduce((acc, curr) => `${acc},${this.state.recorders[curr].name}`, '')
		) {
			updateNeeded = true
		} else if (
			channelIds.reduce(
				(acc, curr) =>
					`${acc},${Object.keys(state.channels[curr].publishers).map(
						(id) => state.channels[curr].publishers[id].name,
					)}`,
				'',
			) !==
			channelIds.reduce(
				(acc, curr) =>
					`${acc},${Object.keys(this.state.channels[curr].publishers).map(
						(id) => this.state.channels[curr].publishers[id].name,
					)}`,
				'',
			)
		) {
			updateNeeded = true
		} else if (
			channelIds.reduce(
				(acc, curr) =>
					`${acc},${Object.keys(state.channels[curr].layouts).map(
						(id) => state.channels[curr].layouts[id].name,
					)}`,
				'',
			) !==
			channelIds.reduce(
				(acc, curr) =>
					`${acc},${Object.keys(this.state.channels[curr].layouts).map(
						(id) => this.state.channels[curr].layouts[id].name,
					)}`,
				'',
			)
		) {
			updateNeeded = true
		}

		let feedbacksToCheck = [] // this feedbacks need to be updated
		if (updateNeeded) {
			//console.log('update is needed: new', JSON.stringify(state), '\n old', JSON.stringify(this.state))
			feedbacksToCheck = ['channelLayout', 'streamingState', 'recorderRecording'] // recheck everything after reconfiguration, could be more fine grained but not worth for such a small amount of feedbacks
		} else {
			if (
				channelIds.reduce(
					(acc, curr) =>
						`${acc},${Object.keys(state.channels[curr].layouts).map(
							(id) => state.channels[curr].layouts[id].active,
						)}`,
					'',
				) !==
				channelIds.reduce(
					(acc, curr) =>
						`${acc},${Object.keys(this.state.channels[curr].layouts).map(
							(id) => this.state.channels[curr].layouts[id].active,
						)}`,
					'',
				)
			) {
				feedbacksToCheck.push('channelLayout')
			}
			if (
				channelIds.reduce(
					(acc, curr) =>
						`${acc},${Object.keys(state.channels[curr].layouts).map(
							(id) => state.channels[curr].layouts[id].active,
						)}`,
					'',
				) !==
				channelIds.reduce(
					(acc, curr) =>
						`${acc},${Object.keys(this.state.channels[curr].layouts).map(
							(id) => this.state.channels[curr].layouts[id].active,
						)}`,
					'',
				)
			) {
				feedbacksToCheck.push('channelLayout')
			}
			if (
				channelIds.reduce(
					(acc, curr) =>
						`${acc},${Object.keys(state.channels[curr].publishers).map((id) =>
							JSON.stringify(state.channels[curr].publishers[id].status),
						)}`,
					'',
				) !==
				channelIds.reduce(
					(acc, curr) =>
						`${acc},${Object.keys(this.state.channels[curr].publishers).map((id) =>
							JSON.stringify(this.state.channels[curr].publishers[id].status),
						)}`,
					'',
				)
			) {
				feedbacksToCheck.push('streamingState')
			}
			// Fix: a recorder can be listed in /recorders without an entry in /recorders/status,
			// so status may be undefined
			if (
				recorderIds.reduce(
					(acc, curr) => `${acc},${JSON.stringify(state.recorders[curr].status?.state)}`,
					'',
				) !==
				recorderIds.reduce(
					(acc, curr) => `${acc},${JSON.stringify(this.state.recorders[curr].status?.state)}`,
					'',
				)
			) {
				feedbacksToCheck.push('recorderRecording')
			}
		}

		// now finally swap the state object
		this.state = { ...state }

		// Update variables
		variables.updateVariables(this)

		// ensure metadata is available for all channels
		for (const cid of Object.keys(this.state.channels)) {
			if (!this.metadata[cid]) {
				await this.fetchMetadata(cid)
			}
		}

		//console.log('feedbacks to check', feedbacksToCheck)
		if (feedbacksToCheck.length > 0) this.checkFeedbacks(...feedbacksToCheck)
		if (updateNeeded) {
			this.updateSystem()
			this.log('info', 'Pearl configuration has changed, Choices and Presets updated.')
		}
	}

	/**
	 * Return the id of the first item of dropdown choices array
	 *
	 * @param arr {{id: string|number, label: string}[]} the dropdown array
	 * @returns {string|number}
	 */
	firstId(arr) {
		if (Array.isArray(arr) && arr.length > 0 && (typeof arr[0].id === 'string' || typeof arr[0].id === 'number')) {
			return arr[0].id
		} else {
			return ''
		}
	}

	/**
	 * Return dropdown choices for recorders
	 */
	choicesRecorders() {
		return Object.keys(this.state.recorders).map((id) => {
			// Fix: recorders only listed in /recorders/status have no name, avoid 'undefined' labels
			return { id, label: this.state.recorders[id].name ?? `Recorder ${id}` }
		})
	}

	/**
	 * Return dropdown choices for channels
	 */
	choicesChannel() {
		return Object.keys(this.state.channels).map((id) => {
			return { id, label: this.state.channels[id].name }
		})
	}

	/**
	 * Return dropdown choices for channel-layout combination
	 */
	choicesChannelLayout() {
		const choices = []
		for (const channel of Object.keys(this.state.channels)) {
			for (const layout of Object.keys(this.state.channels[channel].layouts)) {
				choices.push({
					id: `${channel}-${layout}`,
					label: `${this.state.channels[channel].name} - ${this.state.channels[channel].layouts[layout].name}`,
				})
			}
		}
		return choices
	}

	/**
	 * Return dropdown choices for channel-publishers combination
	 */
	choicesChannelPublishers() {
		const choices = []
		for (const channel of Object.keys(this.state.channels)) {
			if (Object.keys(this.state.channels[channel].publishers).length > 0) {
				choices.push({
					id: `${channel}-all`,
					label: `${this.state.channels[channel].name} - All Streams`,
				})
				for (const publisher of Object.keys(this.state.channels[channel].publishers)) {
					choices.push({
						id: `${channel}-${publisher}`,
						label: `${this.state.channels[channel].name} - ${this.state.channels[channel].publishers[publisher].name}`,
					})
				}
			}
		}

		return choices
	}

	/**
	 * Part of poller
	 * INTERNAL: Update the recorder status
	 *
	 * @private
	 * @since 1.0.0
	 */
	async updateRecorderStatus() {
		const recoders = await this.sendRequest('get', '/api/recorders/status', {})
		if (!recoders) {
			return
		}

		for (const recorder of recoders) {
			// Fix: /recorders/status can contain ids which are not in the recorder list (see doc/requests),
			// updating them crashed. Unknown recorders are picked up by the next regular poll.
			if (this.state.recorders[recorder.id]) {
				this.state.recorders[recorder.id].status = recorder.status
			}
		}

		this.log('debug', 'Updating RECORDER_STATES and then call checkFeedbacks(recorderRecording)')
		this.checkFeedbacks('recorderRecording')
		variables.updateVariables(this)
	}

	/**
	 * INTERNAL: Get the status of all storages (API v2.0), e.g. { main: { state, total, free }, ... }
	 * Storages without a device (e.g. no USB stick) only report their state.
	 *
	 * @private
	 * @returns {Promise<Object>}
	 */
	async fetchStorages() {
		const list = await this.sendRequest('get', '/api/system/storages', {})
		if (!Array.isArray(list)) return undefined
		const results = await Promise.allSettled(
			list.map((storage) => this.sendRequest('get', '/api/system/storages/' + storage.id + '/status', {})),
		)
		const storages = {}
		list.forEach((storage, index) => {
			if (results[index].status === 'fulfilled') storages[storage.id] = results[index].value
		})
		return storages
	}

	/**
	 * INTERNAL: Update the status of the publishers (streams) of a channel
	 *
	 * @private
	 * @param {string} channelId
	 */
	async updatePublisherStatus(channelId) {
		const publishers = await this.sendRequest('get', '/api/channels/' + channelId + '/publishers/status', {})
		const channel = this.state.channels[channelId]
		if (!Array.isArray(publishers) || !channel) return
		for (const publisher of publishers) {
			if (channel.publishers[publisher.id]) {
				channel.publishers[publisher.id].status = publisher.status
			}
		}
		this.checkFeedbacks('streamingState')
		variables.updateVariables(this)
	}

	/**
	 * INTERNAL: After a start or stop command, ask for the new state until the Pearl reports it.
	 * The Pearl executes start and stop in the background and reports 'starting' in between, so a
	 * single request right after the command usually still returns the old state. Without this the
	 * feedback only changed with the next regular poll, up to the polling frequency later.
	 *
	 * @private
	 * @param {function(): Promise<void>} update - requests the current state
	 * @param {function(): boolean} isSettled - whether the expected state has been reached
	 */
	async followUpState(update, isSettled) {
		const generation = this.pollGeneration
		// short steps first, most commands take one or two seconds; about 10 seconds in total, after
		// that the regular poll takes over
		for (const delay of [300, 500, 500, 500, 500, 1000, 1000, 2000, 2000, 2000]) {
			await new Promise((resolve) => setTimeout(resolve, delay))
			// stop when the connection was destroyed or restarted in the meantime
			if (generation !== this.pollGeneration) return
			try {
				await update()
			} catch (error) {
				this.log('debug', 'State follow-up failed: ' + error.message)
			}
			if (isSettled()) return
		}
	}

	/**
	 * Whether a state reported by the Pearl matches the expected state of a start or stop command.
	 * 'error' and 'disabled' are final too, waiting for them to change makes no sense.
	 *
	 * @param {string|undefined} state
	 * @param {'start'|'stop'} command
	 * @returns {boolean}
	 */
	static stateReached(state, command) {
		if (state === 'error' || state === 'disabled') return true
		// publishers of listener type (e.g. SRT listener) report 'listening' once they are started
		return command === 'start' ? state === 'started' || state === 'listening' : state === 'stopped'
	}

	async fetchMetadata(channelId) {
		// Validate channelId to ensure it is alphanumeric
		const channelIdRegex = /^[a-zA-Z0-9_-]+$/
		if (!channelIdRegex.test(channelId)) {
			this.log('error', `Invalid channelId: ${channelId}`)
			return
		}
		const apiHost = this.config.host
		const apiPort = this.config.host_port
		const url = `http://${apiHost}:${apiPort}/admin/channel${channelId}/get_params.cgi?title&author&rec_prefix`
		if (this.config.verbose) {
			this.log('debug', `Fetching metadata for channel ${channelId}`)
		}
		try {
			const response = await fetchFunc(url, {
				method: 'GET',
				// Fix: without a timeout an unreachable device blocks init and the poller
				signal: AbortSignal.timeout(REQUEST_TIMEOUT),
				headers: {
					Authorization:
						'Basic ' + Buffer.from(this.config.username + ':' + this.config.password).toString('base64'),
				},
			})
			// Fix: an error page (e.g. wrong password) was parsed as metadata before
			if (!response.ok) {
				throw new Error(http.STATUS_CODES[response.status])
			}
			const text = await response.text()
			if (this.config.verbose) {
				this.log('debug', `Response ${text.trim()}`)
			}
			const lines = text.split('\n')
			const metadata = {}
			for (const line of lines) {
				// Fix: split at the first '=' only, values may contain '=' themselves
				const separator = line.indexOf('=')
				if (separator < 1) continue
				metadata[line.slice(0, separator).trim()] = line.slice(separator + 1).trim()
			}
			this.metadata[channelId] = metadata
			this.metadataFailed?.delete(channelId)
			if (this.config.verbose) {
				this.log('debug', `Parsed Metadata ${JSON.stringify(this.metadata[channelId])}`)
			}
			variables.updateVariables(this)
		} catch (e) {
			// the poller retries this regularly, so a failure is logged only once per channel
			this.metadataFailed = this.metadataFailed ?? new Set()
			if (!this.metadataFailed.has(channelId)) {
				this.metadataFailed.add(channelId)
				this.log('error', `Failed to get metadata of channel ${channelId}: ${e.message}`)
			}
		}
	}
}

// This script runs before the rename in upgrades.js, so it must use the feedback ids as they were
// before 2.2.0. Fix: 'streamingState' reverted to the original id 'channelStreaming', otherwise old
// advanced streaming feedbacks are never converted to boolean feedbacks.
const upgradeToBooleanFeedbacks = CreateConvertToBooleanFeedbackUpgradeScript({
	channelLayout: {
		fg: 'color',
		bg: 'bgcolor',
	},
	channelStreaming: {
		fg: 'color',
		bg: 'bgcolor',
	},
	recorderRecording: {
		fg: 'color',
		bg: 'bgcolor',
	},
})

// module-base 2.x: runEntrypoint() was removed, the module class and the upgrade scripts are exported instead
module.exports = EpiphanPearl
module.exports.UpgradeScripts = [upgradeToBooleanFeedbacks, ...upgradeScripts]
