const instance_skel = require('../../instance_skel');
const http          = require('http');
const request       = require('request');
let debug, log;

/**
 * Companion instance class for the Epiphan Pearl.
 *
 * @extends instance_skel
 * @version 1.0.0
 * @since 1.0.0
 * @author Marc Hagen <hello@marchagen.nl>
 */
class EpiphanPearl extends instance_skel {

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
		 * @type {Array<Object>}
		 */
		this.CHOICES_CHANNELS = [];
		this.CHOICES_CHANNELS_LAYOUTS    = [];
		this.CHOICES_CHANNELS_PUBLISHERS = [];

		/**
		 * Array with recorders objects
		 * @type {Array<Object>}
		 */
		this.CHOICES_RECORDERS = [];

		this.CHOICES_STARTSTOP = [
			{id: 1, label: 'Start'},
			{id: 0, label: 'Stop'}
		];


		this.actions();
	}

	/**
	 * Setup the actions.
	 *
	 * @param {EventEmitter} system - the brains of the operation
	 * @access public
	 * @since 1.0.0
	 */
	actions(system) {
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
			'channelRecording': {
				label: 'Channel start/stop recording',
				options: [
					{
						type: 'dropdown',
						id: 'channelId',
						label: 'Channel',
						choices: this.CHOICES_CHANNELS
					},
					{
						type: 'dropdown',
						id: 'channelAction',
						label: 'Action',
						choices: this.CHOICES_STARTSTOP
					},
				],
			},
			'channelStreaming': {
				label: 'Channel start/stop streaming',
				options: [
					{
						type: 'dropdown',
						id: 'channelIdpublisherId',
						label: 'Channel publishers',
						choices: this.CHOICES_CHANNELS_PUBLISHERS,
						tooltip: 'If a channel has only one "publisher" or "stream" then you jst select all. Else you can pick the "publisher" you want to start/stop'
					},
					{
						type: 'dropdown',
						id: 'channelAction',
						label: 'Action',
						choices: this.CHOICES_STARTSTOP
					},
				],
			},
			'recorderRecording': {
				label: 'Recorder start/stop recording',
				options: [
					{
						type: 'dropdown',
						id: 'recorderId',
						label: 'Recorder',
						choices: this.CHOICES_RECORDERS
					},
					{
						type: 'dropdown',
						id: 'recorderAction',
						label: 'Action',
						choices: this.CHOICES_STARTSTOP
					},
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
		let channelId, layoutId, channelAction, publishersId;

		switch (action.action) {
			case 'channelChangeLayout':
				[channelId, layoutId] = action.options.channelIdlayoutId.split('-');
				type                  = 'put';
				url                   = '/api/channels/' + channelId + '/layouts/active';
				body                  = JSON.stringify({id: layoutId});
				break;
			case 'channelStreaming':
				[channelId, publishersId] = action.options.channelIdpublisherId.split('-');
				channelAction             = this.CHOICES_STARTSTOP.find(function (e) { return e.id === action.options.channelAction; });
				type                      = 'post';

				if (publishersId !== 'all') {
					url = '/api/channels/' + channelId + '/publishers/' + publishersId + '/control/' + channelAction;
				} else {
					url = '/api/channels/' + channelId + '/publishers/control/' + channelAction;
				}

				break;
			case 'channelRecording':
				type = 'post';
				//url  = '/api/channels/' + action.options.channelId + '/control/start';
				break;
			case 'recorderRecording':
				type = 'post';
				//url  = '/api/recorders/' + action.options.channelId + '/control/start';
				break;
			default:
				return;
		}

		// Send request
		if (url) {
			this._sendRequest(type, url, body);
		}
	}

	/**
	 * Processes a feedback state.
	 *
	 * @param {Object} feedback - the feedback type to process
	 * @param {Object} bank - the bank this feedback is associated with
	 * @returns {Object} feedback information for the bank
	 * @access public
	 * @since 1.0.0
	 */
	feedback(feedback, bank) {
		let out   = {};
		const opt = feedback.options;

		return out;
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

		this.states = {};
		this._init_feedbacks();
		this._init_request();
		this._init_interval();
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
		this._init_request();
	}

	/**
	 * INTERNAL: setup default request data for requests
	 *
	 * @private
	 * @since 1.0.0
	 */
	_init_request() {
		this.defaultRequest = request.defaults({
			auth: {
				user: this.config.username,
				pass: this.config.password,
			},
			timeout: 10000,
		});
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
	_sendRequest(type, url, body, callback = null) {
		let self      = this;
		const apiHost = this.config.host,
			  baseUrl = 'http://' + apiHost;

		if (url === null || url === '') {
			return false;
		}

		if (this.defaultRequest === undefined) {
			this.status(this.STATUS_ERROR, 'Error, no request interface...');
			this.log('error', 'Error, no request interface...');
			return false;
		}

		type = type.toUpperCase();
		if (['GET', 'POST', 'PUT'].indexOf(type) === -1) {
			this.status(this.STATUS_ERROR, 'Wrong request type: ' + type);
			this.log('error', 'Wrong request type: ' + type);
			return false;
		}

		if (body === undefined) {
			body = {};
		}

		if (callback === undefined || callback == null) {
			callback = () => {
			}
		}

		let requestUrl = baseUrl + url;
		this.debug('info', 'Starting request to: ' + type + ' ' + baseUrl + url);
		this.debug('info', body);
		this.defaultRequest({
				method: type,
				uri: requestUrl,
				json: body
			},
			function (error, response, body) {
				self.debug('info', JSON.stringify(error));
				//self.debug('info', JSON.stringify(response));
				self.debug('info', JSON.stringify(body));

				if (error && error.code === 'ETIMEDOUT') {
					self.status(self.STATUS_ERROR);
					self.log('error', 'Connection timeout while connecting to ' + requestUrl);
					callback(error);
					return;
				}

				if (error && error.code === 'ECONNREFUSED') {
					self.status(self.STATUS_ERROR);
					self.log('error', 'Connection refused for ' + requestUrl);
					callback(error);
					return;
				}

				if (error && error.connect === true) {
					self.status(self.STATUS_ERROR);
					self.log('error', 'Read timeout waiting for response from: ' + requestUrl);
					callback(error);
					return;
				}

				if (response &&
					(response.statusCode < 200 || response.statusCode > 299)) {
					self.status(self.STATUS_ERROR);
					self.log('error', 'Non-successful response status code: ' + http.STATUS_CODES[response.statusCode] + ' ' + requestUrl);
					callback(error);
					return;
				}

				if (body.status && body.status !== 'ok') {
					self.status(self.STATUS_ERROR);
					self.log('error', 'Non-successful response from pearl: ' + requestUrl + ' - ' + (body.message ? body.message : 'No error message'));
					callback(error);
					return;
				}

				let result = body;
				if (body.result) {
					result = body.result;
				}

				self.status(this.STATUS_OK);
				callback(null, result);
			});
	}

	/**
	 * INTERNAL: initialize feedbacks.
	 *
	 * @private
	 * @since 1.0.0
	 */
	_init_feedbacks() {
		const feedbacks = {};

		feedbacks['channel_layout'] = {
			label: 'Change colors on channel layout change',
			description: 'If the current layout is active, change color of the bank',
			options: [
				{
					type: 'colorpicker',
					label: 'Foreground color',
					id: 'fg',
					default: this.rgb(255, 255, 255),
				},
				{
					type: 'colorpicker',
					label: 'Background color',
					id: 'bg',
					default: this.rgb(255, 0, 0),
				},
				{
					type: 'dropdown',
					label: 'Channel',
					id: 'input',
					choices: this.CHOICES_CHANNELS,
				},
			],
		};

		feedbacks['recording'] = {
			label: 'Change colors if recording',
			description: 'If channel/recorder is recording, change colors of the bank',
			options: [
				{
					type: 'colorpicker',
					label: 'Foreground color',
					id: 'fg',
					default: this.rgb(255, 255, 255),
				},
				{
					type: 'colorpicker',
					label: 'Background color',
					id: 'bg',
					default: this.rgb(0, 255, 0),
				},
				{
					type: 'dropdown',
					label: 'Recorders',
					id: 'input',
					choices: this.CHOICES_RECORDERS,
				},
			],
		};

		feedbacks['streaming'] = {
			label: 'Change colors if streaming',
			description: 'If channel is streaming, change colors of the bank',
			options: [
				{
					type: 'colorpicker',
					label: 'Foreground color',
					id: 'fg',
					default: this.rgb(255, 255, 255),
				},
				{
					type: 'colorpicker',
					label: 'Background color',
					id: 'bg',
					default: this.rgb(0, 255, 0),
				},
				{
					type: 'dropdown',
					label: 'Channels',
					id: 'input',
					choices: this.CHOICES_CHANNELS,
				},
			],
		};

		this.setFeedbackDefinitions(feedbacks);
	}

	/**
	 * INTERNAL: initialize interval data poller.
	 * Polling data such as channels, recorders, layouts
	 *
	 * @private
	 * @since 1.0.0
	 */
	_init_interval() {
		// Run first
		this._dataPoller(this);
		// Poll data from pearl every 10 secs
		this.timer = setInterval(this._dataPoller.bind(this), 10000);
	}


	/**
	 * INTERNAL: The data poller will activally make requests to update feedbacks and dropdown options.
	 * Polling data such as channels, recorders, layouts and status
	 *
	 * @param {EventEmitter} system - the brains of the operation
	 * @private
	 * @since 1.0.0
	 */
	_dataPoller(system) {
		let self = this;

		// Get all channels available
		let temp_channel = [];
		this._sendRequest('get', '/api/channels', {}, (err, channels) => {
			if (err) {
				return;
			}
			for (let a in channels) {
				let channel = channels[a];
				temp_channel.push({
					id: channel.id,
					label: channel.name,
					layouts: [],
					publishers: [],
					encoders: []
				});
			}

			self.debug('info', 'Updating CHOICES_CHANNELS and call actions()');
			// Update the master channel selector
			self.CHOICES_CHANNELS = temp_channel.slice();
			// Update dropdowns
			self.actions(system);
		});

		// For every channel get layouts and populate/update actions()
		let temp_layout = [];
		for (let b in this.CHOICES_CHANNELS) {
			let channel = this.CHOICES_CHANNELS[b];

			this._sendRequest('get', '/api/channels/' + channel.id + '/layouts', {}, (err, layouts) => {
				if (err) {
					return;
				}
				for (let c in layouts) {
					let layout = layouts[c];
					temp_layout.push({
						id: channel.id + '-' + layout.id,
						label: channel.label + ' - ' + layout.name
					});
				}

				self.debug('info', 'Updating CHANNEL_LAYOUTS and call actions()');
				// Update the master channel selector
				self.CHOICES_CHANNELS_LAYOUTS = temp_layout.slice();
				// Update dropdowns
				self.actions(system);
			});
		}

		// For get publishers and encoders
		let temp_publishers = [];
		this._sendRequest('get', '/api/channels/status?publishers=yes&encoders=yes', {}, (err, channels) => {
			if (err) {
				return;
			}
			for (let a = 0; a < channels.length; a++) {
				let channel = this.CHOICES_CHANNELS[a];
				if (!channel) {
					return;
				}

				temp_publishers.push({
					id: 'all',
					label: channel.label + ' - All'
				});
				for (let b in channels[a].publishers) {
					let publisher = channels[a].publishers[b];
					if (!publisher) {
						return;
					}
					temp_publishers.push({
						id: channel.id + '-' + publisher.id,
						// TODO: Check the /api/channels/?publishers=yes for names?
						label: channel.label + ' - Stream ' + publisher.id
					});
				}
			}

			self.debug('info', 'Updating CHANNELS_PUBLISHERS and call actions()');
			// Update the master channel selector
			self.CHOICES_CHANNELS_PUBLISHERS = temp_publishers.slice();
			// Update dropdowns
			self.actions(system);
		});


		// GET- /api/channels
		// GET- /api/channels/?publishers=yes
		// GET- /api/channels/status?publishers=yes&encoders=yes
		// GET- /api/channels/<id>/status
		// GET- /api/channels/<id>/layouts
		// PUT- /api/channels/<id>/layouts/active - {"id":"3"}
		// GET- /api/channels/<id>/publishers
		// GET- /api/recorders
		// GET- /api/recorders/status

		//this._sendRequest();
	}
}

exports = module.exports = EpiphanPearl;
