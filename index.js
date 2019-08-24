const instanceSkel = require('../../instance_skel');
const http         = require('http');
const request      = require('request');
let debug, log;

const feedbacks = require('./feedbacks');

const TYPE_LAYOUT    = 1;
const TYPE_PUBLISHER = 2;

/**
 * Companion instance class for the Epiphan Pearl.
 *
 * @extends instanceSkel
 * @version 1.0.0
 * @since 1.0.0
 * @author Marc Hagen <hello@marchagen.nl>
 */
class EpiphanPearl extends instanceSkel {

	/**
	 * Create an instance of a EpiphanPearl module.
	 *
	 * @access public
	 * @since 1.0.0
	 * @param {EventEmitter} system - the brains of the operation
	 * @param {string} id - the instance ID
	 * @param {Object} config - saved user configuration parameters
	 */
	constructor(system, id, config) {
		super(system, id, config);

		/**
		 * Array with channel objects containing channel information like layouts
		 * recorders and encoders with the states of these properties
		 * @type {Array<Object>}
		 */
		this.CHANNEL_STATES = [];
		this.RECORDER_STATES = [];

		/*
		 * Array with channel objects containing channel information like layouts
		 * @type {Array<Object>}
		 */
		this.CHOICES_CHANNELS_LAYOUTS    = [];
		this.CHOICES_CHANNELS_PUBLISHERS = [];

		/**
		 * Array with recorders objects
		 * @type {Array<Object>}
		 */
		this.CHOICES_RECORDERS = [];

		this.CHOICES_STARTSTOP = [
			{id: 1, label: 'Start', action: 'start'},
			{id: 0, label: 'Stop', action: 'stop'}
		];

		Object.assign(this, {
			//...actions,
			...feedbacks,
			//...presets,
			//...variables
		});
	}

	/**
	 * Setup the actions.
	 *
	 * @access public
	 * @since 1.0.0
	 * @param {EventEmitter} system - the brains of the operation
	 */
	actions(system = null) {
		const startStopOption = {
			type: 'dropdown',
			id: 'startStopAction',
			label: 'Action',
			choices: this.CHOICES_STARTSTOP
		};

		this.setActions({
			'channelChangeLayout': {
				label: 'Change channel layout',
				options: [{
					type: 'dropdown',
					id: 'channelIdlayoutId',
					label: 'Change layout to:',
					choices: this.CHOICES_CHANNELS_LAYOUTS
				}]
			},
			'channelStreaming': {
				label: 'Start/stop streaming',
				options: [
					{
						type: 'dropdown',
						label: 'Channel publishers',
						id: 'channelIdpublisherId',
						choices: this.CHOICES_CHANNELS_PUBLISHERS,
						tooltip: 'If a channel has only one "publisher" or "stream" then you just select all. Else you can pick the "publisher" you want to start/stop'
					},
					startStopOption
				],
			},
			'recorderRecording': {
				label: 'Start/stop recording',
				options: [
					{
						type: 'dropdown',
						label: 'Recorder',
						id: 'recorderId',
						choices: this.CHOICES_RECORDERS
					},
					startStopOption
				],
			},
		});
	}

	/**
	 * Executes the provided action.
	 *
	 * @access public
	 * @since 1.0.0
	 * @param {Object} action - the action to be executed
	 */
	action(action) {
		let type = 'get', url, body, callback;

		switch (action.action) {
			case 'channelChangeLayout': {
				const [channelId, layoutId] = action.options.channelIdlayoutId.split('-');

				type     = 'put';
				url      = '/api/channels/' + channelId + '/layouts/active';
				body     = {id: layoutId};
				callback = (err, response) => {
					if (response.status === 'ok') {
						this._updateActiveChannelLayout(channelId, layoutId);
					}
				};
				break;
			}
			case 'channelStreaming': {
				const [channelId, publishersId] = action.options.channelIdpublisherId.split('-');
				const startStopAction           = this._getStartStopActionFromOptions(action.options);

				type = 'post';
				if (publishersId !== 'all') {
					url = '/api/channels/' + channelId + '/publishers/' + publishersId + '/control/' + startStopAction;
				} else {
					url = '/api/channels/' + channelId + '/publishers/control/' + startStopAction;
				}
				break;
			}
			case 'recorderRecording': {
				const startStopAction = this._getStartStopActionFromOptions(action.options);
				const recorderId      = action.options.recorderId;

				type     = 'post';
				url      = '/api/recorders/' + recorderId + '/control/' + startStopAction;
				callback = (err, response) => {
					if (response.status === 'ok') {
						this._updateRecorderStatus(recorderId);
					}
				};
				break;
			}
			default:
				return;
		}

		// Send request
		if (url) {
			this._sendRequest(type, url, body, callback);
		}
	}

	/**
	 * Creates the configuration fields for web config.
	 *
	 * @access public
	 * @since 1.0.0
	 * @returns {Array} the config fields
	 */
	config_fields() {
		return [
			{
				type: 'textinput',
				id: 'host',
				label: 'Target IP',
				width: 6,
				default: '127.0.0.1',
				regex: this.REGEX_IP,
			},
			{
				type: 'textinput',
				id: 'username',
				label: 'Username',
				width: 6,
				default: 'admin',
			},
			{
				type: 'textinput',
				id: 'password',
				label: 'Password',
				width: 6,
				default: 'changeme',
			},
		];
	}

	/**
	 * Clean up the instance before it is destroyed.
	 *
	 * @access public
	 * @since 1.0.0
	 */
	destroy() {
		this.debug('destroy', this.id);
	}

	/**
	 * Main initialization function called once the module
	 * is OK to start doing things.
	 *
	 * @access public
	 * @since 1.0.0
	 */
	init() {
		debug = this.debug;
		log   = this.log;

		this.status(this.STATUS_UNKNOWN);

		this._initRequest();
		this._initInterval();
	}

	/**
	 * Process an updated configuration array.
	 *
	 * @access public
	 * @since 1.0.0
	 * @param {Object} config - the new configuration
	 */
	updateConfig(config) {
		this.config = config;
		this._initRequest();
	}

	/**
	 * INTERNAL: setup default request data for requests
	 *
	 * @private
	 * @since 1.0.0
	 */
	_initRequest() {
		this.defaultRequest = request.defaults({
			auth: {
				user: this.config.username,
				pass: this.config.password,
			},
			timeout: 10000,
		});
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
		this.status(level, message);
	}

	/**
	 * INTERNAL: Get action from the options for start and stop
	 *
	 * @private
	 * @since 1.0.0
	 * @param {Object} options - Option object gotten from a performed action [action()]
	 */
	_getStartStopActionFromOptions(options) {
		return this.CHOICES_STARTSTOP.find((e) => {
			return e.id === parseInt(options.startStopAction);
		}).action;
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
			return;
		}
		if (typeof id !== 'number') {
			id = parseInt(id);
		}
		return this.CHANNEL_STATES.find(obj => obj.id === id)
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
			return;
		} else if (typeof channel === 'number') {
			let channel = this._getChannelById(channel);
			if (!channel) {
				return;
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
			return;
		}

		return type.find(obj => obj.id === id)
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
		return this._getTypeFromChannelById(TYPE_LAYOUT, channel, id);
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
			return;
		}
		return channel.layouts.find(obj => obj.active === true)
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
		let channel = this._getChannelById(channelId);
		if (!channel) {
			return;
		}

		let activeLayout    = this._getActiveLayoutFromChannel(channel);
		let newActiveLayout = this._getLayoutFromChannelById(channel, newLayoutId);
		if (!activeLayout || !newActiveLayout) {
			return
		}

		// Be positive and switch channels in advance.
		activeLayout.active    = false;
		newActiveLayout.active = true;
		this.checkFeedbacks('channel_layout');
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
		return this._getTypeFromChannelById(TYPE_PUBLISHER, channel, id);
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
			return false;
		}

		return publisher.status.isStreaming ? publisher.status.isStreaming : false;
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
			return;
		}
		return channel.publishers.find(obj => obj.status.isStreaming === true)
	}

	/**
	 * INTERNAL: Get channel by id
	 *
	 * @private
	 * @since 1.0.0
	 * @param {String|Number} id
	 */
	_getRecorderById(id) {
		if (!id) {
			return;
		}
		if (typeof id !== 'number') {
			id = parseInt(id)
		}
		return this.RECORDER_STATES.find(obj => obj.id === id);
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
			return false;
		}
		return recorder.status.isRecording ? recorder.status.isRecording : false;
	}

	/**
	 * INTERNAL: Get action from the options for start and stop
	 *
	 * @private
	 * @since 1.0.0
	 */
	_updateSystem() {
		this.actions();
		this._updateFeedbacks();
	}

	/**
	 * INTERNAL: Setup and send request
	 *
	 * @private
	 * @since 1.0.0
	 * @param {String} type - post, get, put
	 * @param {String} url - Full URL to send request to
	 * @param {?Object} body - Optional body to send
	 * @param {?Function} callback - Optional callback function for data
	 */
	_sendRequest(type, url, body = {}, callback = () => {
	}) {
		const self    = this;
		const apiHost = this.config.host,
				baseUrl = 'http://' + apiHost;

		if (url === null || url === '') {
			this._setStatus(this.STATUS_ERROR, 'No URL given for _sendRequest');
			this.log('error', 'No URL given for _sendRequest');
			return false;
		}

		if (this.defaultRequest === undefined) {
			this._setStatus(this.STATUS_ERROR, 'Error, no request interface...');
			this.log('error', 'Error, no request interface...');
			return false;
		}

		type = type.toUpperCase();
		if (['GET', 'POST', 'PUT'].indexOf(type) === -1) {
			this._setStatus(this.STATUS_ERROR, 'Wrong request type: ' + type);
			this.log('error', 'Wrong request type: ' + type);
			return false;
		}

		// Check if body is not empty
		if (body === undefined) {
			body = {};
		}

		// Check if we have a valid callback
		if (callback === undefined || callback == null || typeof callback !== 'function') {
			callback = () => {
			};
		}

		const requestUrl = baseUrl + url;
		this.debug('Starting request to: ' + type + ' ' + baseUrl + url);
		this.debug(body);
		this.defaultRequest({
				method: type,
				uri: requestUrl,
				json: body
			},
			(error, response, body) => {
				self.debug(JSON.stringify(error));
				//self.debug(JSON.stringify(response));
				self.debug(JSON.stringify(body));

				if (error && error.code === 'ETIMEDOUT') {
					self._setStatus(self.STATUS_ERROR, 'Connection timeout while connecting to ' + requestUrl);
					self.log('error', 'Connection timeout while connecting to ' + requestUrl);
					callback(error);
					return;
				}

				if (error && error.code === 'ECONNREFUSED') {
					self._setStatus(self.STATUS_ERROR, 'Connection refused for ' + requestUrl);
					self.log('error', 'Connection refused for ' + requestUrl);
					callback(error);
					return;
				}

				if (error && error.connect === true) {
					self._setStatus(self.STATUS_ERROR, 'Read timeout waiting for response from: ' + requestUrl);
					self.log('error', 'Read timeout waiting for response from: ' + requestUrl);
					callback(error);
					return;
				}

				if (response &&
					(response.statusCode < 200 || response.statusCode > 299)) {
					self._setStatus(self.STATUS_ERROR, 'Non-successful response status code: ' + http.STATUS_CODES[response.statusCode] + ' ' + requestUrl);
					self.log('error', 'Non-successful response status code: ' + http.STATUS_CODES[response.statusCode] + ' ' + requestUrl);
					callback(error);
					return;
				}

				if (body && body.status && body.status !== 'ok') {
					self._setStatus(self.STATUS_ERROR, 'Non-successful response from pearl: ' + requestUrl + ' - ' + (body.message ? body.message : 'No error message'));
					self.log('error', 'Non-successful response from pearl: ' + requestUrl + ' - ' + (body.message ? body.message : 'No error message'));
					callback(error);
					return;
				}

				let result = body;
				if (body && body.result) {
					result = body.result;
				}

				self._setStatus(self.STATUS_OK);
				callback(null, result);
			});
	}

	/**
	 * INTERNAL: initialize feedbacks.
	 *
	 * @private
	 * @since 1.0.0
	 */
	_updateFeedbacks() {
		this.setFeedbackDefinitions(this.getFeedbacks());
	}

	/**
	 * INTERNAL: initialize interval data poller.
	 * Polling data such as channels, recorders, layouts
	 *
	 * @private
	 * @since 1.0.0
	 */
	_initInterval() {
		// Run 2 times first
		this._dataPoller();
		// Poll data from pearl every 10 secs
		this.timer = setInterval(this._dataPoller.bind(this), 10000);
	}


	/**
	 * Part of poller
	 * INTERNAL: The data poller will activally make requests to update feedbacks and dropdown options.
	 * Polling data such as channels, recorders, layouts and status
	 *
	 * @private
	 * @since 1.0.0
	 */
	_dataPoller() {
		const self = this;

		// Get all channels available
		this._sendRequest('get', '/api/channels?publishers=yes&encoders=yes', {}, (err, channels) => {
			if (err) {
				return;
			}
			for (const a in channels) {
				const channel = channels[a];

				const channelUpdate = {
					id: parseInt(channel.id),
					label: channel.name
				};

				let currentChannel = self._getChannelById(channelUpdate.id);
				if (currentChannel === undefined) {
					currentChannel = {
						...channelUpdate,
						...{
							layouts: [],
							publishers: [],
							encoders: []
						}
					};
					self.CHANNEL_STATES.push(currentChannel);
				} else {
					currentChannel = {...currentChannel, ...channelUpdate};
				}

				for (const b in channel.publishers) {
					const publisher      = channel.publishers[b];
					let currentPublisher = currentChannel.publishers.find(obj => obj.id === parseInt(publisher.id));

					const updatedPublisher = {
						id: parseInt(publisher.id),
						label: publisher.name,
					};
					if (currentPublisher === undefined) {
						currentChannel.publishers.push({
							...updatedPublisher,
							...{
								status: {
									isStreaming: false,
									duration: 0
								}
							}
						});
					} else {
						currentPublisher = {...currentPublisher, ...updatedPublisher};
					}
				}
			}

			self.debug('Updating CHANNEL_STATES and call _updateSystem()');
			self._updateSystem(system);

			// Update layouts and publishers
			self._updateChannelLayouts();
			self._updateChannelPublishers();
		});

		// Get all recorders
		let tempRecorders = [];
		this._sendRequest('get', '/api/recorders', {}, (err, recoders) => {
			if (err) {
				return;
			}

			for (const a in recoders) {
				const recoder         = recoders[a];
				const updatedRecorder = {
					id: parseInt(recoder.id),
					label: recoder.name
				};
				tempRecorders.push(updatedRecorder);

				let currentRecoder = self._getRecorderById(updatedRecorder.id);
				if (currentRecoder === undefined) {
					self.RECORDER_STATES.push({
						...updatedRecorder,
						...{
							status: {
								isRecording: false,
								duration: 0
							}
						}
					});
				} else {
					currentRecoder = {...currentRecoder, ...updatedRecorder};
				}
			}

			self.debug('Updating RECORDER_STATES and then call _updateSystem()');
			self.CHOICES_RECORDERS = tempRecorders.slice();
			self._updateSystem();

			// Update status
			self._updateRecorderStatus();
		});
	}

	/**
	 * Part of poller
	 * INTERNAL: Update the layout data from every tracked channel
	 *
	 * @private
	 * @since 1.0.0
	 */
	_updateChannelLayouts() {
		const self = this;

		// For every channel get layouts and populate/update actions()
		let tempLayouts = [];
		for (const a in this.CHANNEL_STATES) {
			let channel = self.CHANNEL_STATES[a];

			this._sendRequest('get', '/api/channels/' + channel.id + '/layouts', {}, (err, layouts) => {
				if (err) {
					return;
				}
				for (const b in layouts) {
					const layout = layouts[b];
					tempLayouts.push({
						id: channel.id + '-' + layout.id,
						label: channel.label + ' - ' + layout.name
					});

					const objIndex      = channel.layouts.findIndex(obj => obj.id === parseInt(layout.id));
					const updatedLayout = {
						id: parseInt(layout.id),
						label: layout.name,
						active: layout.active
					};
					if (objIndex === -1) {
						channel.layouts.push(updatedLayout);
					} else {
						channel.layouts[objIndex] = updatedLayout;
					}
				}

				self.debug('Updating CHOICES_CHANNELS_LAYOUTS and then call _updateSystem()');
				self.CHOICES_CHANNELS_LAYOUTS = tempLayouts.slice();
				self.checkFeedbacks('channel_layout');
				self._updateSystem();
			});
		}
	}

	/**
	 * Part of poller
	 * INTERNAL: Update the publisher data from every tracked channel
	 *
	 * @private
	 * @since 1.0.0
	 */
	_updateChannelPublishers() {
		const self = this;

		// For get publishers and encoders
		let tempPublishers = [];
		this._sendRequest('get', '/api/channels/status?publishers=yes&encoders=yes', {}, (err, channels) => {
			if (err) {
				return;
			}
			for (const a in channels) {
				const apiChannel     = channels[a];
				const currentChannel = self._getChannelById(apiChannel.id);
				if (!currentChannel) {
					continue
				}

				tempPublishers.push({
					id: currentChannel.id + '-all',
					label: currentChannel.label + ' - All'
				});
				for (const b in apiChannel.publishers) {
					const publisher        = apiChannel.publishers[b];
					const currentPublisher = currentChannel.publishers.find(obj => obj.id === parseInt(publisher.id));
					if (!currentPublisher) {
						continue;
					}

					tempPublishers.push({
						id: currentChannel.id + '-' + currentPublisher.id,
						label: currentChannel.label + ' - ' + currentPublisher.label
					});

					const status            = publisher.status;
					currentPublisher.status = {
						isStreaming: status.started && status.state === 'started',
						duration: status.started && status.state === 'started' ? parseInt(status.duration) : 0,
					}
				}
			}

			self.debug('Updating CHOICES_CHANNELS_PUBLISHERS and then call _updateSystem()');
			self.CHOICES_CHANNELS_PUBLISHERS = tempPublishers.slice();
			self.checkFeedbacks('streaming');
			self._updateSystem();
		});
	}

	/**
	 * Part of poller
	 * INTERNAL: Update the recorder status
	 *
	 * @private
	 * @since 1.0.0
	 */
	_updateRecorderStatus() {
		const self = this;

		// For get status for recorders
		this._sendRequest('get', '/api/recorders/status', {}, (err, recoders) => {
			if (err) {
				return;
			}

			for (const a in recoders) {
				const recoder        = recoders[a];
				const currentRecoder = self._getRecorderById(recoder.id);
				if (currentRecoder === undefined) {
					continue;
				}

				const status          = recoder.status;
				currentRecoder.status = {
					isRecording: status.state !== 'stopped',
					duration: status.state !== 'stopped' ? parseInt(status.duration) : 0,
				}
			}

			self.debug('Updating RECORDER_STATES and then call _updateSystem()');
			self.checkFeedbacks('recording');
			self._updateSystem();
		});
	}
}

exports = module.exports = EpiphanPearl;
