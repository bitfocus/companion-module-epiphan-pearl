const instanceSkel = require('../../instance_skel');
const http         = require('http');
const request      = require('request');
let debug, log;

const feedbacks = require('./feedbacks');

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
	 * @param {EventEmitter} system - the brains of the operation
	 * @param {string} id - the instance ID
	 * @param {Object} config - saved user configuration parameters
	 * @access public
	 * @since 1.0.0
	 */
	constructor(system, id, config) {
		super(system, id, config);

		/**
		 * Array with channel objects containing channel information like layouts
		 * recorders and encoders with the states of these properties
		 * @type {Array<Object>}
		 */
		this.CHANNEL_STATES = [];

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
	 * @param {EventEmitter} system - the brains of the operation
	 * @access public
	 * @since 1.0.0
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
						tooltip: 'If a channel has only one "publisher" or "stream" then you jst select all. Else you can pick the "publisher" you want to start/stop'
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
	 * @param {Object} action - the action to be executed
	 * @access public
	 * @since 1.0.0
	 */
	action(action) {
		let type = 'get', url, body = {};

		switch (action.action) {
			case 'channelChangeLayout': {
				let [channelId, layoutId] = action.options.channelIdlayoutId.split('-');

				type = 'put';
				url  = '/api/channels/' + channelId + '/layouts/active';
				body = {id: layoutId};
				break;
			}
			case 'channelStreaming': {
				let [channelId, publishersId] = action.options.channelIdpublisherId.split('-');
				let startStopAction           = this._getStartStopActionFromOptions(action.options);

				type = 'post';
				if (publishersId !== 'all') {
					url = '/api/channels/' + channelId + '/publishers/' + publishersId + '/control/' + startStopAction;
				} else {
					url = '/api/channels/' + channelId + '/publishers/control/' + startStopAction;
				}
				break;
			}
			case 'recorderRecording': {
				let startStopAction = this._getStartStopActionFromOptions(action.options);

				type = 'post';
				url  = '/api/recorders/' + action.options.recorderId + '/control/' + startStopAction;
				break;
			}
			default:
				return;
		}

		// Send request
		if (url) {
			this._sendRequest(type, url, body);
		}
	}

	/**
	 * Creates the configuration fields for web config.
	 *
	 * @returns {Array} the config fields
	 * @access public
	 * @since 1.0.0
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
	 * @param {Object} config - the new configuration
	 * @access public
	 * @since 1.0.0
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
	 */
	_setStatus(level, message = '') {
		this.status(level, message);
	}

	/**
	 * INTERNAL: Get action from the options for start and stop
	 *
	 * @private
	 * @since 1.0.0
	 */
	_getStartStopActionFromOptions(options) {
		return this.CHOICES_STARTSTOP.find((e) => {
			return e.id === parseInt(options.startStopAction);
		}).action;
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
	 * @param {String} type - post, get, put
	 * @param {String} url - Full URL to send request to
	 * @param {Object} body - Optional body to send
	 * @param {?Function} callback - Callback function for data
	 * @returns {boolean} False on errors
	 * @private
	 * @since 1.0.0
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

		let requestUrl = baseUrl + url;
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

				if (body.status && body.status !== 'ok') {
					self._setStatus(self.STATUS_ERROR, 'Non-successful response from pearl: ' + requestUrl + ' - ' + (body.message ? body.message : 'No error message'));
					self.log('error', 'Non-successful response from pearl: ' + requestUrl + ' - ' + (body.message ? body.message : 'No error message'));
					callback(error);
					return;
				}

				let result = body;
				if (body.result) {
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
	 * INTERNAL: The data poller will activally make requests to update feedbacks and dropdown options.
	 * Polling data such as channels, recorders, layouts and status
	 *
	 * @private
	 * @since 1.0.0
	 */
	_dataPoller() {
		const self = this;

		// Get all channels available
		this._sendRequest('get', '/api/channels', {}, (err, channels) => {
			if (err) {
				return;
			}
			for (let a in channels) {
				let channel = channels[a];

				let channelUpdate = {
					id: parseInt(channel.id),
					label: channel.name
				};

				let currentChannel = self.CHANNEL_STATES.find(obj => obj.id === parseInt(channelUpdate.id));
				if (currentChannel === undefined) {
					self.CHANNEL_STATES.push({
						...channelUpdate,
						...{
							layouts: [],
							publishers: [],
							encoders: []
						}
					});
				} else {
					currentChannel = {...currentChannel, ...channelUpdate};
				}
			}

			self.debug('Updating CHANNEL_STATES and call _updateSystem()');
			self._updateSystem(system);

			// Update layouts and publishers
			self._updateChannelLayouts();
			self._updateChannelPublishers();
		});

		// Get all recorders
		let tempRecoders = [];
		this._sendRequest('get', '/api/recorders', {}, (err, recoders) => {
			if (err) {
				return;
			}
			for (let a in recoders) {
				let recoder = recoders[a];
				tempRecoders.push({
					id: recoder.id,
					label: recoder.name
				});
			}

			self.debug('Updating CHOICES_RECORDERS and then call _updateSystem()');
			// Update the master channel selector
			self.CHOICES_RECORDERS = tempRecoders.slice();
			// Update dropdowns
			self._updateSystem(system);
		});
	}

	/**
	 * INTERNAL: Update the layout data from every tracked channel
	 *
	 * @private
	 * @since 1.0.0
	 */
	_updateChannelLayouts() {
		const self = this;

		// For every channel get layouts and populate/update actions()
		let tempLayouts = [];
		for (let b in this.CHANNEL_STATES) {
			let channel = self.CHANNEL_STATES[b];

			this._sendRequest('get', '/api/channels/' + channel.id + '/layouts', {}, (err, layouts) => {
				if (err) {
					return;
				}
				for (let c in layouts) {
					const layout = layouts[c];
					tempLayouts.push({
						id: channel.id + '-' + layout.id,
						label: channel.label + ' - ' + layout.name
					});

					const objIndex = channel.layouts.findIndex(obj => obj.id === parseInt(layout.id));
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

				self.debug('Updating CHOICES_CHANNELS_LAYOUTS');
				// Update the master channel selector
				self.CHOICES_CHANNELS_LAYOUTS = tempLayouts.slice();
				self.checkFeedbacks('channel_layout');
				self._updateSystem(system);
			});
		}
	}

	/**
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
			for (let a in channels) {
				const channel = this.CHANNEL_STATES[a];
				if (!channel) {
					continue;
				}

				tempPublishers.push({
					id: channel.id + '-all',
					label: channel.label + ' - All'
				});
				for (let b in channels[a].publishers) {
					const publisher = channels[a].publishers[b];
					if (!publisher) {
						continue;
					}
					tempPublishers.push({
						id: channel.id + '-' + publisher.id,
						// TODO: Check the /api/channels/?publishers=yes for names?
						label: channel.label + ' - Stream ' + publisher.id
					});
				}
			}

			self.debug('Updating CHOICES_CHANNELS_PUBLISHERS');
			// Update the master channel selector
			self.CHOICES_CHANNELS_PUBLISHERS = tempPublishers.slice();
			// this.checkFeedbacks('recording');
			self._updateSystem(system);
		});
	}
}

exports = module.exports = EpiphanPearl;
