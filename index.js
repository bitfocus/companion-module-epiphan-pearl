// noinspection JSFileReferences
const {
	CreateConvertToBooleanFeedbackUpgradeScript,
	InstanceBase,
	InstanceStatus,
	Regex,
	runEntrypoint,
} = require('@companion-module/base')
const http = require('http')

const actions = require('./actions')
const feedbacks = require('./feedbacks')
const presets = require('./presets')
const variables = require('./variables')
const { get_config_fields } = require('./config')

/**
 * Companion instance class for the Epiphan Pearl.
 *
 * @extends InstanceBase
 * @version 2.1.0
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
                       events: {},
               }

               /**
                * Enable verbose logging when true
                */
               this.verbose = false

               /**
                * Enable metadata http features when true
                */
               this.metadataEnabled = false

               Object.assign(this, {
                       ...actions,
                       ...feedbacks,
                       ...presets,
                       ...variables
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
		clearInterval(this.timer)
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

		await this.configUpdated(config)
		this.updateSystem()
		this.initInterval()
	}

	// noinspection JSUnusedGlobalSymbols
	/**
	 * Process an updated configuration array.
	 *
	 * @access public
	 * @since 1.0.0
	 * @param {Object} config - the new configuration
	 */
	async configUpdated(config) {
		if (!config.host || config.host.match(new RegExp(Regex.IP.slice(1, -1))) === null) {
			this.log('error', 'invalid IP given in configuration: ' + config.host)
			return
		}
		if (!config.host_port || parseInt(config.host_port) < 1 || parseInt(config.host_port) > 65536) {
			this.log('error', 'invalid portnumber given in configuration: ' + config.host_port)
			return
		}

               if (typeof config.pollfreq !== 'number') {
                       config.pollfreq = 10
                       this.saveConfig(config)
               }

               if (config.verbose === undefined) {
                       config.verbose = false
                       this.saveConfig(config)
               }

               if (config.enable_metadata === undefined) {
                       config.enable_metadata = false
                       this.saveConfig(config)
               }
               if (config.meta_username === undefined) {
                       config.meta_username = ''
                       this.saveConfig(config)
               }
               if (config.meta_password === undefined) {
                       config.meta_password = ''
                       this.saveConfig(config)
               }

               if (this.config === undefined) {
                       // get config for the first time after init
                       this.config = config
                       this.verbose = !!config.verbose
                       this.metadataEnabled = !!config.enable_metadata
               } else {
                       let oldconfig = { ...this.config }

                       this.config = config
                       this.verbose = !!config.verbose
                       this.metadataEnabled = !!config.enable_metadata

			if (oldconfig.pollfreq !== this.config.pollfreq) {
				// polling frequency has changed, update interval
				clearInterval(this.timer)
				this.initInterval()
			}
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
		const layouts = await this.sendRequest('get', '/api/channels/' + channelId + '/layouts', {})
		layouts.forEach((layout) => {
			this.state.channels[channelId].layouts[layout.id].active = layout.active
		})
		this.checkFeedbacks('channelLayout')
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
                this.updateVariables()
        }

	/**
	 * INTERNAL: Setup and send request
	 *
	 * @private
	 * @since 1.0.0
	 * @param {String} type - post, get, put
	 * @param {String} url - Full URL to send request to
	 * @param {?Object} body - Optional body to send
	 */
       async sendRequest(type, url, body = {}) {
               const apiHost = this.config.host,
                       apiPort = this.config.host_port,
                       baseUrl = 'http://' + apiHost + ':' + apiPort

               if (url && url.startsWith('/api/')) {
                       url = '/api/v2.0' + url.substring(4)
               }

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

               const requestUrl = baseUrl + url

               if (this.verbose) {
                       this.log(
                               'debug',
                               `Request: ${type} ${requestUrl}${type !== 'GET' ? ' body: ' + JSON.stringify(body) : ''}`
                       )
               }

		let response
		try {
			let options = {
				method: type,
				timeout: 3000,
				headers: {
					Authorization: 'Basic ' + Buffer.from(this.config.username + ':' + this.config.password).toString('base64'),
				},
			}

			if (type !== 'GET') {
				options.body = JSON.stringify(body)
				options.headers['Content-Type'] = 'application/json'
			}

			response = await fetch(requestUrl, options)
		} catch (error) {
			if (error.name === 'AbortError') {
				this.setStatus(
					InstanceStatus.ConnectionFailure,
					'Request was aborted: ' + requestUrl + ' reason: ' + error.message
				)
				this.log('debug', error.message)
				throw new Error(error)
			}

			this.setStatus(InstanceStatus.ConnectionFailure, error.message)
			this.log('debug', error.message)
			throw new Error(error)
		}

		if (!response.ok) {
			this.setStatus(
				InstanceStatus.ConnectionFailure,
				'Non-successful response status code: ' + http.STATUS_CODES[response.status] + ' ' + requestUrl
			)
			this.log('debug', 'Non-successful response status code: ' + http.STATUS_CODES[response.status] + ' ' + requestUrl)
			throw new Error('Non-successful response status code: ' + http.STATUS_CODES[response.status])
		}

               const responseBody = await response.json()
               if (responseBody && responseBody.status && responseBody.status !== 'ok') {
			this.setStatus(
				InstanceStatus.ConnectionFailure,
				'Non-successful response from pearl: ' + requestUrl + ' - ' + (body.message ? body.message : 'No error message')
			)
			this.log(
				'debug',
				'Non-successful response from pearl: ' + requestUrl + ' - ' + (body.message ? body.message : 'No error message')
			)
			throw new Error(
				'Non-successful response from pearl: ' + requestUrl + ' - ' + (body.message ? body.message : 'No error message')
			)
		}

               let result = responseBody
               if (responseBody && responseBody.result) {
                       result = responseBody.result
               }

               if (this.verbose) {
                       this.log('debug', `Response: ${JSON.stringify(result)}`)
               }

               this.setStatus(InstanceStatus.Ok)
               return result
       }

       /**
        * INTERNAL: Send legacy GET request for metadata operations.
        *
        * @private
        * @param {String} url - Full URL starting with '/'
        * @returns {String} response body as text
        */
       async sendLegacyGetRequest(url) {
               if (!this.metadataEnabled) {
                       this.log('debug', 'Metadata functions disabled')
                       throw new Error('Metadata disabled')
               }

               const apiHost = this.config.host,
                       apiPort = this.config.host_port,
                       baseUrl = 'http://' + apiHost + ':' + apiPort

               const requestUrl = baseUrl + url

               if (this.verbose) {
                       this.log('debug', `Legacy Request: GET ${requestUrl}`)
               }

               let options = {
                       method: 'GET',
                       timeout: 3000,
                       headers: {},
               }

               const user = this.config.meta_username || this.config.username
               const pass = this.config.meta_password || this.config.password
               if (user || pass) {
                       options.headers['Authorization'] =
                               'Basic ' + Buffer.from(user + ':' + pass).toString('base64')
               }

               let response
               try {
                       response = await fetch(requestUrl, options)
               } catch (error) {
                       this.setStatus(InstanceStatus.ConnectionFailure, error.message)
                       this.log('debug', error.message)
                       throw new Error(error)
               }

               if (!response.ok) {
                       this.setStatus(
                               InstanceStatus.ConnectionFailure,
                               'Non-successful response status code: ' + http.STATUS_CODES[response.status]
                       )
                       this.log('debug', 'Non-successful response status code:' + http.STATUS_CODES[response.status])
                       throw new Error('Non-successful response status code: ' + http.STATUS_CODES[response.status])
               }

               const text = await response.text()

               if (this.verbose) {
                       this.log('debug', `Legacy Response: ${text}`)
               }

               this.setStatus(InstanceStatus.Ok)
               return text
       }

       /**
        * INTERNAL: Parse legacy metadata response.
        *
        * @private
        * @param {String} text - raw response
        * @returns {Object} key value pairs
        */
       parseMetadataResponse(text) {
               const result = {}
               text.split(/\r?\n/).forEach((line) => {
                       const idx = line.indexOf('=')
                       if (idx > -1) {
                               const key = line.substring(0, idx).trim()
                               const val = decodeURIComponent(line.substring(idx + 1).trim())
                               result[key] = val
                       }
               })
               return result
       }

       async queryChannelMetadata(channelId) {
               if (!this.metadataEnabled) return
               try {
                       const text = await this.sendLegacyGetRequest(
                               `/admin/channel${channelId}/get_params.cgi?rec_prefix&title&author&copyright&comment&description`
                       )
                       const data = this.parseMetadataResponse(text)
                       if (this.state.channels[channelId]) {
                               this.state.channels[channelId].metadata = data
                       }
               } catch (err) {
                       this.log('error', 'Metadata could not be retrieved')
               }
       }

       async queryAllMetadata() {
               await Promise.allSettled(Object.keys(this.state.channels).map((id) => this.queryChannelMetadata(id)))
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
		this.setPresetDefinitions(this.getPresets())
	}

	/**
	 * INTERNAL: initialize interval data poller.
	 * Polling data such as channels, recorders, layouts
	 *
	 * @private
	 * @since 1.0.0
	 */
	initInterval() {
		// Run one time first
		this.dataPoller()
		// Poll data from pearl regulary
		this.timer = setInterval(this.dataPoller.bind(this), Math.ceil(this.config.pollfreq * 1000) || 10000)
	}

	/**
	 * Part of poller
	 * INTERNAL: The data poller will actively make requests to update feedbacks and dropdown options.
	 * Polling data such as channels, recorders, layouts and status
	 *
	 * @private
	 * @since 1.0.0
	 */
	async dataPoller() {
               const state = {
                       channels: {},
                       recorders: {},
                       events: {},
               } // start with a fresh object, during the update some properties will be unavailable, so it is best to not do live updates

		// Get all channels and recorders available (in parallel)
               let channels, recorders, recorders_status, events, events_status, system_status, afu_status, firmware_info, product_info, identity_info
               try {
                       ;[
                               channels,
                               recorders,
                               recorders_status,
                               events,
                               events_status,
                               system_status,
                               afu_status,
                               firmware_info,
                               product_info,
                               identity_info,
                       ] = await Promise.all([
                               this.sendRequest('get', '/api/channels?publishers=yes&encoders=yes', {}),
                               this.sendRequest('get', '/api/recorders', {}),
                               this.sendRequest('get', '/api/recorders/status', {}),
                               this.sendRequest('get', '/api/events', {}).catch(() => []),
                               this.sendRequest('get', '/api/events/status', {}).catch(() => []),
                               this.sendRequest('get', '/api/system/status', {}).catch(() => null),
                               this.sendRequest('get', '/api/afu/status', {}).catch(() => null),
                               this.sendRequest('get', '/api/system/firmware', {}).catch(() => null),
                               this.sendRequest('get', '/api/system/product', {}).catch(() => null),
                               this.sendRequest('get', '/api/system/identity', {}).catch(() => null),
                       ])
               } catch (error) {
                       this.log('error', 'No valid answer from device')
                       return
               }

		channels.forEach((channel) => {
			state.channels[channel.id] = { ...channel }
			state.channels[channel.id].layouts = {}
			state.channels[channel.id].publishers = {}
		})

               recorders.forEach((recorder) => {
                       state.recorders[recorder.id] = { ...recorder }
               })

               recorders_status.forEach((recorder) => {
                       if (state.recorders[recorder.id] === undefined) state.recorders[recorder.id] = {} // just for the event a recorder has been created between call to recorders and recorders/status
                       state.recorders[recorder.id].status = recorder.status
               })

               if (Array.isArray(events)) {
                       events.forEach((ev) => {
                               state.events[ev.id] = { ...ev }
                       })
               }

               if (Array.isArray(events_status)) {
                       events_status.forEach((ev) => {
                               if (state.events[ev.id] === undefined) state.events[ev.id] = {}
                               state.events[ev.id].status = ev.status
                       })
               }

              state.system = {
                      status: system_status || {},
                      afu: afu_status?.status || afu_status || {},
                      firmware:
                              firmware_info?.version ||
                              firmware_info?.result?.version ||
                              '',
                      product:
                              product_info?.product?.name ||
                              product_info?.product ||
                              product_info?.name ||
                              product_info?.result?.product?.name ||
                              product_info?.result?.product ||
                              product_info?.result?.name ||
                              '',
                      identity:
                              identity_info?.identity ||
                              identity_info?.result?.identity ||
                              identity_info?.result ||
                              identity_info ||
                              {},
              }

		// Get all layouts and publishers for all channels and all recorder states (in parallel)
		await Promise.allSettled([
			...channels.map(async (channel) => {
				const layouts = await this.sendRequest('get', '/api/channels/' + channel.id + '/layouts', {})
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
				const publishersstatus = await this.sendRequest('get', '/api/channels/' + channel.id + '/publishers/status', {})
				publishersstatus.forEach((publisher) => {
					if (state.channels[channel.id].publishers[publisher.id] === undefined)
						state.channels[channel.id].publishers[publisher.id] = {}
					state.channels[channel.id].publishers[publisher.id].status = publisher.status
				})
			}),
		])

		// now that we have an updated state object, let's see where we have to react

               const channelIds = Object.keys(state.channels)
               const recorderIds = Object.keys(state.recorders)
               const eventIds = Object.keys(state.events)

		let updateNeeded = false // this is to mark if choices or presets needs to be updated

		if (JSON.stringify(channelIds) !== JSON.stringify(Object.keys(this.state.channels))) {
			updateNeeded = true
               } else if (JSON.stringify(recorderIds) !== JSON.stringify(Object.keys(this.state.recorders))) {
                       updateNeeded = true
               } else if (JSON.stringify(eventIds) !== JSON.stringify(Object.keys(this.state.events))) {
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
                       eventIds.reduce((acc, curr) => `${acc},${state.events[curr].name}`, '') !==
                       eventIds.reduce((acc, curr) => `${acc},${this.state.events[curr].name}`, '')
               ) {
                       updateNeeded = true
               } else if (
                       channelIds.reduce(
                               (acc, curr) =>
                                       `${acc},${Object.keys(state.channels[curr].publishers).map(
                                               (id) => state.channels[curr].publishers[id].name
					)}`,
				''
			) !==
			channelIds.reduce(
				(acc, curr) =>
					`${acc},${Object.keys(this.state.channels[curr].publishers).map(
						(id) => this.state.channels[curr].publishers[id].name
					)}`,
				''
			)
		) {
			updateNeeded = true
		} else if (
			channelIds.reduce(
				(acc, curr) =>
					`${acc},${Object.keys(state.channels[curr].layouts).map((id) => state.channels[curr].layouts[id].name)}`,
				''
			) !==
			channelIds.reduce(
				(acc, curr) =>
					`${acc},${Object.keys(this.state.channels[curr].layouts).map(
						(id) => this.state.channels[curr].layouts[id].name
					)}`,
				''
			)
		) {
			updateNeeded = true
		}

               let feedbacksToCheck = [] // this feedbacks need to be updated
               if (updateNeeded) {
                       //console.log('update is needed: new', JSON.stringify(state), '\n old', JSON.stringify(this.state))
                       feedbacksToCheck = ['channelLayout', 'channelStreaming', 'recorderRecording', 'eventState'] // recheck everything after reconfiguration, could be more fine grained but not worth for such a small amount of feedbacks
		} else {
			if (
				channelIds.reduce(
					(acc, curr) =>
						`${acc},${Object.keys(state.channels[curr].layouts).map((id) => state.channels[curr].layouts[id].active)}`,
					''
				) !==
				channelIds.reduce(
					(acc, curr) =>
						`${acc},${Object.keys(this.state.channels[curr].layouts).map(
							(id) => this.state.channels[curr].layouts[id].active
						)}`,
					''
				)
			) {
				feedbacksToCheck.push('channelLayout')
			}
			if (
				channelIds.reduce(
					(acc, curr) =>
						`${acc},${Object.keys(state.channels[curr].layouts).map((id) => state.channels[curr].layouts[id].active)}`,
					''
				) !==
				channelIds.reduce(
					(acc, curr) =>
						`${acc},${Object.keys(this.state.channels[curr].layouts).map(
							(id) => this.state.channels[curr].layouts[id].active
						)}`,
					''
				)
			) {
				feedbacksToCheck.push('channelLayout')
			}
			if (
				channelIds.reduce(
					(acc, curr) =>
						`${acc},${Object.keys(state.channels[curr].publishers).map((id) =>
							JSON.stringify(state.channels[curr].publishers[id].status)
						)}`,
					''
				) !==
				channelIds.reduce(
					(acc, curr) =>
						`${acc},${Object.keys(this.state.channels[curr].publishers).map((id) =>
							JSON.stringify(this.state.channels[curr].publishers[id].status)
						)}`,
					''
				)
			) {
				feedbacksToCheck.push('channelStreaming')
			}
                       if (
                               recorderIds.reduce((acc, curr) => `${acc},${JSON.stringify(state.recorders[curr].status.state)}`, '') !==
                               recorderIds.reduce((acc, curr) => `${acc},${JSON.stringify(this.state.recorders[curr].status.state)}`, '')
                       ) {
                               feedbacksToCheck.push('recorderRecording')
                       }
                       if (
                               eventIds.reduce((acc, curr) => `${acc},${JSON.stringify(state.events[curr].status)}`, '') !==
                               eventIds.reduce((acc, curr) => `${acc},${JSON.stringify(this.state.events[curr].status)}`, '')
                       ) {
                               feedbacksToCheck.push('eventState')
                       }
               }

		// now finally swap the state object
               this.state = { ...state }
               //console.log('feedbacks to check', feedbacksToCheck)
               if (feedbacksToCheck.length > 0) this.checkFeedbacks(...feedbacksToCheck)
               if (updateNeeded) {
                       this.updateSystem()
                       this.log('info', 'Pearl configuration has changed, Choices and Presets updated.')
               }
               if (this.metadataEnabled) {
                       await this.queryAllMetadata()
               }
               this.updateVariables()
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
			return { id, label: this.state.recorders[id].name }
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
        * Return dropdown choices for events
        */
       choicesEvents() {
               return Object.keys(this.state.events).map((id) => {
                       return { id, label: this.state.events[id].name || id }
               })
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
			this.state.recorders[recorder.id].status = recorder.status
		}

		this.log('debug', 'Updating RECORDER_STATES and then call checkFeedbacks(recorderRecording)')
		this.checkFeedbacks('recorderRecording')
	}
}

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

runEntrypoint(EpiphanPearl, [upgradeToBooleanFeedbacks])
