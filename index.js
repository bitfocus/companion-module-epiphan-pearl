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
const { get_config_fields } = require('./config')

const TYPE_LAYOUT = 1
const TYPE_PUBLISHER = 2

/**
 * Companion instance class for the Epiphan Pearl.
 *
 * @extends instanceSkel
 * @version 1.0.3
 * @since 1.0.0
 * @author Marc Hagen <hello@marchagen.nl>
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
		 * Array with channel objects containing channel information like layouts
		 * recorders and encoders with the states of these properties
		 * @type {Array<Object>}
		 */
		this.CHANNEL_STATES = []
		this.RECORDER_STATES = {}

		/*
		 * Array with channel objects containing channel information like layouts
		 * @type {Array<Object>}
		 */
		this.CHOICES_CHANNELS_LAYOUTS = []
		this.CHOICES_CHANNELS_PUBLISHERS = []

		/**
		 * Array with recorders objects
		 * @type {Array<Object>}
		 */
		this.CHOICES_RECORDERS = []

		this.CHOICES_STARTSTOP = [
			{ id: 99, label: '---', action: '' },
			{ id: 1, label: 'Start', action: 'start' },
			{ id: 0, label: 'Stop', action: 'stop' },
		]

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
		this._updateSystem()
		this._initInterval()
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
				this._initInterval()
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
	_setStatus(level, message = '') {
		this.updateStatus(level, message)

		if (level === 'error') {
			this.log('error', message)
		} else if (level === 'warning') {
			this.log('warning', message)
		}
	}

	/**
	 * INTERNAL: Get action from the options for start and stop
	 *
	 * @private
	 * @since 1.0.0
	 * @param {Object} options - Option object gotten from a performed action [action()]
	 */
	_getStartStopActionFromOptions(options) {
		const startStopActionId = parseInt(options.startStopAction)
		const startStopActionObj = this.CHOICES_STARTSTOP.find((obj) => obj.id === startStopActionId)

		return typeof startStopActionObj !== 'undefined' ? startStopActionObj.action : null
	}

	/**
	 * INTERNAL: Get channel by id
	 *
	 * @private
	 * @since 1.0.0
	 * @param {String|Number} id
	 */
	_getChannelById(id) {
		if (!id) {
			return
		}
		if (typeof id !== 'number') {
			id = parseInt(id)
		}
		return this.CHANNEL_STATES.find((obj) => obj.id === id)
	}

	/**
	 * INTERNAL: Get publisher by id from channel
	 *
	 * @private
	 * @since 1.0.0
	 * @param {Number} type - 1 for layout, 2 for publisher. Use const.
	 * @param {Object|Number} channel
	 * @param {String|Number} id
	 */
	_getTypeFromChannelById(type, channel, id) {
		if (!channel || !id) {
			return
		} else if (typeof channel === 'number') {
			channel = this._getChannelById(channel)
			if (!channel) {
				return
			}
		}

		if (typeof id !== 'number') {
			id = parseInt(id)
		}

		if (type === TYPE_LAYOUT) {
			type = channel.layouts
		} else if (type === TYPE_PUBLISHER) {
			type = channel.publishers
		} else {
			return
		}

		return type.find((obj) => obj.id === id)
	}

	/**
	 * INTERNAL: Get layout by id from channel
	 *
	 * @private
	 * @since 1.0.0
	 * @param {Object|Number} channel
	 * @param {String|Number} id
	 */
	_getLayoutFromChannelById(channel, id) {
		return this._getTypeFromChannelById(TYPE_LAYOUT, channel, id)
	}

	/**
	 * INTERNAL: Get current active layout for channel
	 *
	 * @private
	 * @since 1.0.0
	 * @param {Object} channel
	 */
	_getActiveLayoutFromChannel(channel) {
		if (!channel) {
			return
		}
		return channel.layouts.find((obj) => obj.active === true)
	}

	/**
	 * INTERNAL: Update current active layout for a channel to the new active layout
	 *
	 * @private
	 * @since 1.0.0
	 * @param {String|Number} channelId
	 * @param {String|Number} newLayoutId
	 */
	_updateActiveChannelLayout(channelId, newLayoutId) {
		let channel = this._getChannelById(channelId)
		if (!channel) {
			return
		}

		let activeLayout = this._getActiveLayoutFromChannel(channel)
		let newActiveLayout = this._getLayoutFromChannelById(channel, newLayoutId)
		if (!activeLayout || !newActiveLayout) {
			return
		}

		// Be positive and switch channels in advance.
		activeLayout.active = false
		newActiveLayout.active = true
		this.checkFeedbacks('channelLayout')
	}

	/**
	 * INTERNAL: Get publisher by id from channel
	 *
	 * @private
	 * @since 1.0.0
	 * @param {Object|Number} channel
	 * @param {String|Number} id
	 */
	_getPublisherFromChannelById(channel, id) {
		return this._getTypeFromChannelById(TYPE_PUBLISHER, channel, id)
	}

	/**
	 * INTERNAL: Get active publishers for channel
	 *
	 * @private
	 * @since 1.0.0
	 * @param {Object} publisher
	 */
	_isPublisherStreaming(publisher) {
		if (!publisher) {
			return false
		}

		return publisher.status.isStreaming ? publisher.status.isStreaming : false
	}

	/**
	 * INTERNAL: Get active publishers for channel
	 *
	 * @private
	 * @since 1.0.0
	 * @param {Object} channel
	 */
	_getActivePublishersFromChannel(channel) {
		if (!channel) {
			return
		}
		return channel.publishers.find((obj) => obj.status.isStreaming === true)
	}

	/**
	 * INTERNAL: Get recorder by id
	 *
	 * @private
	 * @since 1.0.0
	 * @param {String|Number} id Can have a "m" in the id
	 */
	_getRecorderById(id) {
		// eslint-disable-next-line no-prototype-builtins
		if (id && this.RECORDER_STATES.hasOwnProperty(id.toString())) {
			return this.RECORDER_STATES[id.toString()]
		} else {
			return undefined
		}
	}

	/**
	 * INTERNAL: Is recorder recording?
	 *
	 * @private
	 * @since 1.0.0
	 * @param {Object} recorder
	 */
	_isRecorderRecording(recorder) {
		if (!recorder) {
			return false
		}
		return recorder.status.isRecording ? recorder.status.isRecording : false
	}

	/**
	 * INTERNAL: Check if the publisher id we get from the button is valid.
	 *
	 * @private
	 * @since 1.0.3
	 * @param {String|Number} channelId
	 * @param {String|Number} publisherId
	 */
	_checkValidPublisherId(channelId, publisherId) {
		const channel = this._getChannelById(channelId)
		if (!channel) {
			return
		}

		if (publisherId === 'all') {
			// We can start and stop all encoders at the same time.
			return true
		}

		return this._getTypeFromChannelById(TYPE_PUBLISHER, channel, publisherId)
	}

	/**
	 * INTERNAL: Check if the layout id we get from the button is valid.
	 *
	 * @private
	 * @since 1.0.3
	 * @param {String|Number} channelId
	 * @param {String|Number} layoutId
	 */
	_checkValidLayoutId(channelId, layoutId) {
		const channel = this._getChannelById(channelId)
		if (!channel) {
			return
		}

		return this._getTypeFromChannelById(TYPE_LAYOUT, channel, layoutId)
	}

	/**
	 * INTERNAL: Get action from the options for start and stop
	 *
	 * @private
	 * @since 1.0.0
	 */
	_updateSystem() {
		this.setActionDefinitions(this.get_actions())
		this._updateFeedbacks()
		this._updatePresets()
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
	async _sendRequest(type, url, body = {}) {
		const apiHost = this.config.host,
			apiPort = this.config.host_port,
			baseUrl = 'http://' + apiHost + ':' + apiPort

		if (url === null || url === '') {
			this._setStatus(InstanceStatus.BadConfig, 'No URL given for _sendRequest')
			this.log('error', 'No URL given for _sendRequest')
			return false
		}

		type = type.toUpperCase()
		if (['GET', 'POST', 'PUT'].indexOf(type) === -1) {
			this._setStatus(InstanceStatus.UnknownError, 'Wrong request type: ' + type)
			this.log('error', 'Wrong request type: ' + type)
			return false
		}

		// Check if body is not empty
		if (body === undefined) {
			body = {}
		}

		const requestUrl = baseUrl + url
		this.log('debug', 'Starting request to: ' + type + ' ' + baseUrl + url)
		this.log('debug', 'body: ' + JSON.stringify(body))

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
				this._setStatus(
					InstanceStatus.ConnectionFailure,
					'Request was aborted: ' + requestUrl + ' reason: ' + error.message
				)
				this.log('debug', error.message)
				return
			}

			this._setStatus(InstanceStatus.ConnectionFailure, error.message)
			this.log('debug', error.message)
			return
		}

		if (!response.ok) {
			this._setStatus(
				InstanceStatus.ConnectionFailure,
				'Non-successful response status code: ' + http.STATUS_CODES[response.status] + ' ' + requestUrl
			)
			this.log('debug', 'Non-successful response status code: ' + http.STATUS_CODES[response.status] + ' ' + requestUrl)
			return
		}

		const responseBody = await response.json()
		if (responseBody && responseBody.status && responseBody.status !== 'ok') {
			this._setStatus(
				InstanceStatus.ConnectionFailure,
				'Non-successful response from pearl: ' + requestUrl + ' - ' + (body.message ? body.message : 'No error message')
			)
			this.log(
				'debug',
				'Non-successful response from pearl: ' + requestUrl + ' - ' + (body.message ? body.message : 'No error message')
			)
			return
		}

		let result = responseBody
		if (responseBody && responseBody.result) {
			result = responseBody.result
		}

		this._setStatus(InstanceStatus.Ok)
		return result
	}

	/**
	 * INTERNAL: initialize feedbacks.
	 *
	 * @private
	 * @since 1.0.0
	 */
	_updateFeedbacks() {
		this.setFeedbackDefinitions(this.getFeedbacks())
	}

	/**
	 * INTERNAL: initialize presets.
	 *
	 * @private
	 * @since [Unreleased]
	 */
	_updatePresets() {
		this.setPresetDefinitions(this.getPresets())
	}

	/**
	 * INTERNAL: initialize interval data poller.
	 * Polling data such as channels, recorders, layouts
	 *
	 * @private
	 * @since 1.0.0
	 */
	_initInterval() {
		// Run one time first
		this._dataPoller()
		// Poll data from pearl regulary
		this.timer = setInterval(this._dataPoller.bind(this), Math.ceil(this.config.pollfreq * 1000) || 10000)
	}

	/**
	 * Part of poller
	 * INTERNAL: The data poller will actively make requests to update feedbacks and dropdown options.
	 * Polling data such as channels, recorders, layouts and status
	 *
	 * @private
	 * @since 1.0.0
	 */
	async _dataPoller() {
		// Get all channels available
		const channels = await this._sendRequest('get', '/api/channels?publishers=yes&encoders=yes', {})

		for (const a in channels) {
			const channel = channels[a]

			const channelUpdate = {
				id: parseInt(channel.id),
				label: channel.name,
			}

			let currentChannel = this._getChannelById(channelUpdate.id)
			if (currentChannel === undefined) {
				currentChannel = {
					...channelUpdate,
					...{
						layouts: [],
						publishers: [],
						encoders: [],
					},
				}
				this.CHANNEL_STATES.push(currentChannel)
			} else {
				currentChannel = { ...currentChannel, ...channelUpdate }
			}

			for (const b in channel.publishers) {
				const publisher = channel.publishers[b]
				let currentPublisher = currentChannel.publishers.find((obj) => obj.id === parseInt(publisher.id))

				const updatedPublisher = {
					id: parseInt(publisher.id),
					label: publisher.name,
				}
				if (currentPublisher === undefined) {
					currentChannel.publishers.push({
						...updatedPublisher,
						...{
							status: {
								isStreaming: false,
								duration: 0,
							},
						},
					})
				} else {
					currentPublisher = { ...currentPublisher, ...updatedPublisher }
				}
			}
		}

		this.log('debug', 'Updating CHANNEL_STATES')

		// Update layouts and publishers
		await this._updateChannelLayouts()
		await this._updateChannelPublishers()

		// Get all recorders
		this.log('debug', 'Updating RECORDER_STATES')
		let tempRecorders = []
		const recorders = await this._sendRequest('get', '/api/recorders', {})

		if (Array.isArray(recorders)) {
			this.RECORDER_STATES = {}
			for (const recorder of recorders) {
				const updatedRecorder = {
					id: recorder.id,
					label: recorder.name,
				}
				tempRecorders.push(updatedRecorder)

				this.RECORDER_STATES[recorder.id] = {
					id: recorder.id,
					label: recorder.name,
					status: {
						state: '',
						isRecording: false,
						duration: 0,
					},
				}
			}
		} else {
			this.log('error', 'Got no valid response for recorders ' + JSON.stringify(recorders))
		}

		this.log('debug', 'Updating CHOICES_RECORDERS')
		this.CHOICES_RECORDERS = tempRecorders.slice()

		// Update status
		await this._updateRecorderStatus()

		this.log('debug', 'Call _updateSystem() for update')
		this._updateSystem()
	}

	/**
	 * Part of poller
	 * INTERNAL: Update the layout data from every tracked channel
	 *
	 * @private
	 * @since 1.0.0
	 */
	async _updateChannelLayouts() {
		// For every channel get layouts and populate/update actions()
		let tempLayouts = []
		for (const a in this.CHANNEL_STATES) {
			let channel = this.CHANNEL_STATES[a]

			const layouts = await this._sendRequest('get', '/api/channels/' + channel.id + '/layouts', {})
			if (!layouts) {
				return
			}

			for (const b in layouts) {
				const layout = layouts[b]
				tempLayouts.push({
					id: channel.id + '-' + layout.id,
					label: channel.label + ' - ' + layout.name,
					channelLabel: channel.label,
					layoutLabel: layout.name,
				})

				const objIndex = channel.layouts.findIndex((obj) => obj.id === parseInt(layout.id))
				const updatedLayout = {
					id: parseInt(layout.id),
					label: layout.name,
					active: layout.active,
				}
				if (objIndex === -1) {
					channel.layouts.push(updatedLayout)
				} else {
					channel.layouts[objIndex] = updatedLayout
				}
			}

			this.log('debug', 'Updating CHOICES_CHANNELS_LAYOUTS and then call checkFeedbacks(channelLayout)')
			this.CHOICES_CHANNELS_LAYOUTS = tempLayouts.slice()
			this.checkFeedbacks('channelLayout')
		}
	}

	/**
	 * Part of poller
	 * INTERNAL: Update the publisher data from every tracked channel
	 *
	 * @private
	 * @since 1.0.0
	 */
	async _updateChannelPublishers() {
		// For get publishers and encoders
		let tempPublishers = []
		const channels = await this._sendRequest('get', '/api/channels/status?publishers=yes&encoders=yes', {})
		if (!channels) {
			return
		}

		for (const a in channels) {
			const apiChannel = channels[a]
			const currentChannel = this._getChannelById(apiChannel.id)
			if (!currentChannel) {
				continue
			}

			tempPublishers.push({
				id: currentChannel.id + '-all',
				label: currentChannel.label + ' - All encoders',
				channelLabel: currentChannel.label,
				publisherLabel: 'All encoders',
			})
			for (const b in apiChannel.publishers) {
				const publisher = apiChannel.publishers[b]
				const currentPublisher = currentChannel.publishers.find((obj) => obj.id === parseInt(publisher.id))
				if (!currentPublisher) {
					continue
				}

				tempPublishers.push({
					id: currentChannel.id + '-' + currentPublisher.id,
					label: currentChannel.label + ' - ' + currentPublisher.label,
					channelLabel: currentChannel.label,
					publisherLabel: currentPublisher.label,
				})

				const status = publisher.status
				currentPublisher.status = {
					isStreaming: status.started && status.state === 'started',
					duration: status.started && status.state === 'started' ? parseInt(status.duration) : 0,
				}
			}
		}

		this.log('debug', 'Updating CHOICES_CHANNELS_PUBLISHERS and then call checkFeedbacks(channelStreaming)')
		this.CHOICES_CHANNELS_PUBLISHERS = tempPublishers.slice()
		this.checkFeedbacks('channelStreaming')
	}

	/**
	 * Part of poller
	 * INTERNAL: Update the recorder status
	 *
	 * @private
	 * @since 1.0.0
	 */
	async _updateRecorderStatus() {
		// For get status for recorders
		const recoders = await this._sendRequest('get', '/api/recorders/status', {})
		if (!recoders) {
			return
		}

		for (const recorder of recoders) {
			const currentRecorder = this._getRecorderById(recorder.id)
			if (currentRecorder === undefined) {
				continue
			}

			const status = recorder.status
			currentRecorder.status = {
				state: status.state,
				isRecording: status.state !== 'stopped',
				duration: status.state !== 'stopped' ? parseInt(status.duration) : 0,
			}
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
