// noinspection JSFileReferences
const {
	CreateConvertToBooleanFeedbackUpgradeScript,
	InstanceBase,
	InstanceStatus,
	Regex,
	runEntrypoint,
} = require('@companion-module/base')
const http = require('http')

// use global fetch if available, otherwise fall back to node-fetch
let fetchFunc = global.fetch
if (!fetchFunc) {
       fetchFunc = (...args) => import('node-fetch').then(({ default: fetch }) => fetch(...args))
}

const actions = require('./actions')
const feedbacks = require('./feedbacks')
const presets = require('./presets')
const { get_config_fields } = require('./config')
const variables = require('./variables')
const upgradeScripts = require('./upgrades')

/**
 * Companion instance class for the Epiphan Pearl.
 *
 * @extends InstanceBase
 * @version 2.2.0
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
               await this.determineApiBase()
              await this.dataPoller()
              // fetch metadata for all channels once during init
              for (const channelId of Object.keys(this.state.channels)) {
                      await this.fetchMetadata(channelId)
              }
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

		if (this.config === undefined) {
			// get config for the first time after init
			this.config = config
		} else {
			let oldconfig = { ...this.config }

			this.config = config

                       if (oldconfig.pollfreq !== this.config.pollfreq) {
                               // polling frequency has changed, update interval
                               clearInterval(this.timer)
                               this.initInterval()
                       }
               }
       }

       /**
        * Determine which API version should be used based on firmware
        */
       async determineApiBase() {
               this.apiBasePath = '/api'
               if (!this.config.use_api_v2) {
                       return
               }
               const apiHost = this.config.host
               const apiPort = this.config.host_port
               const url = `http://${apiHost}:${apiPort}/api/v2.0/system/firmware/version`
               try {
                       const response = await fetchFunc(url, {
                               method: 'GET',
                               timeout: 3000,
                               headers: {
                                       Authorization: 'Basic ' + Buffer.from(this.config.username + ':' + this.config.password).toString('base64'),
                               },
                       })
                       if (response.ok) {
                               const data = await response.json()
                               const version = data.result || data
                               const parts = version.split('.').map((v) => parseInt(v, 10))
                               const verNum = parts[0] * 10000 + parts[1] * 100 + parts[2]
                               if (verNum >= 42401) {
                                       this.apiBasePath = '/api/v2.0'
                               }
                       }
               } catch (e) {
                       if (this.config.verbose) {
                               this.log('debug', 'API v2.0 check failed: ' + e.message)
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
               if (url.startsWith('/api/')) {
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
				timeout: 3000,
				headers: {
					Authorization: 'Basic ' + Buffer.from(this.config.username + ':' + this.config.password).toString('base64'),
				},
			}

			if (type !== 'GET') {
				options.body = JSON.stringify(body)
				options.headers['Content-Type'] = 'application/json'
			}

			response = await fetchFunc(requestUrl, options)
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
               if (this.config.verbose) {
                       this.log('debug', `Response ${JSON.stringify(responseBody)}`)
               }
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

		this.setStatus(InstanceStatus.Ok)
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
		} // start with a fresh object, during the update some properties will be unavailable, so it is best to not do live updates

		// Get all channels and recorders available (in parallel)
               let channels, recorders, recorders_status, systemStatus, firmware, identity, afu
               try {
                       const requests = [
                               this.sendRequest('get', '/api/channels?publishers=yes&encoders=yes', {}),
                               this.sendRequest('get', '/api/recorders', {}),
                               this.sendRequest('get', '/api/recorders/status', {}),
                       ]
                       if (this.apiBasePath === '/api/v2.0') {
                               requests.push(this.sendRequest('get', '/api/system/status', {}))
                               requests.push(this.sendRequest('get', '/api/system/firmware', {}))
                               requests.push(this.sendRequest('get', '/api/system/ident', {}))
                               requests.push(this.sendRequest('get', '/api/afu/status', {}))
                       }
                       [channels, recorders, recorders_status, systemStatus, firmware, identity, afu] = await Promise.all(requests)
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

               if (systemStatus) state.systemStatus = systemStatus
               if (firmware) state.firmware = firmware
               if (identity) state.identity = identity
               if (afu) state.afu = afu

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
                       feedbacksToCheck = ['channelLayout', 'streamingState', 'recorderRecording'] // recheck everything after reconfiguration, could be more fine grained but not worth for such a small amount of feedbacks
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
                               feedbacksToCheck.push('streamingState')
			}
			if (
				recorderIds.reduce((acc, curr) => `${acc},${JSON.stringify(state.recorders[curr].status.state)}`, '') !==
				recorderIds.reduce((acc, curr) => `${acc},${JSON.stringify(this.state.recorders[curr].status.state)}`, '')
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

       async fetchMetadata(channelId) {
               const apiHost = this.config.host
               const apiPort = this.config.host_port
               const url = `http://${apiHost}:${apiPort}/admin/channel${channelId}/get_params.cgi?title&author&rec_prefix`
               if (this.config.verbose) {
                       this.log('debug', `Fetching metadata for channel ${channelId}`)
               }
               try {
                       const response = await fetchFunc(url, {
                               method: 'GET',
                               headers: {
                                       Authorization: 'Basic ' + Buffer.from(this.config.username + ':' + this.config.password).toString('base64'),
                               },
                       })
                       const text = await response.text()
                       const lines = text.split('\n')
                       if (!this.metadata[channelId]) this.metadata[channelId] = {}
                       for (const line of lines) {
                               const [k, v] = line.split('=')
                               if (k) this.metadata[channelId][k.trim()] = v ? v.trim() : ''
                       }
                       variables.updateVariables(this)
               } catch (e) {
                       this.log('error', 'Failed to get metadata')
               }
       }
}

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

runEntrypoint(EpiphanPearl, [upgradeToBooleanFeedbacks, ...upgradeScripts])
