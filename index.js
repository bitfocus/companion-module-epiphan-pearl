const instance_skel = require('../../instance_skel');
const http          = require('http');
const request       = require('request');
let debug, log;

/**
 * Companion instance class for the Epiphan Pearl.
 *
 * @extends instance_skel
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
		 * @type {Array}
		 */
		this.CHOICES_CHANNELS = {};
		this.CHOICES_CHANNELS_LAYOUTS = [];

		/**
		 * Array with recorders objects
		 * @type {Array}
		 */
		this.CHOICES_RECORDERS = {};

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
				options: [
					// {
					// 	type: 'dropdown',
					// 	id: 'id',
					// 	label: 'Channel ID',
					// 	choices: this.CHOICES_CHANNELS
					// },
					// {
					// 	type: 'dropdown',
					// 	id: 'layoutId',
					// 	label: 'Layout ID',
					// 	choices: this.CHOICES_CHANNELS_LAYOUTS
					// },
					{
						type: 'dropdown',
						id: 'channelIdlayoutId',
						label: 'Change layout to:',
						choices: this.CHOICES_CHANNELS_LAYOUTS
					},
				],
			},
			'channelStartRecording': {
				label: 'Start channel recording',
				options: [
					{
						type: 'dropdown',
						id: 'channelId',
						label: 'Channel',
						choices: this.CHOICES_CHANNELS
					},
				],
			},
			'channelStopRecording': {
				label: 'Stop channel recording',
				options: [
					{
						type: 'dropdown',
						id: 'channelId',
						label: 'Channel',
						choices: this.CHOICES_CHANNELS
					},
				],
			},
			'channelStartStreaming': {
				label: 'Start channel streaming',
				options: [
					{
						type: 'dropdown',
						id: 'channelId',
						label: 'Channel',
						choices: this.CHOICES_CHANNELS
					},
				],
			},
			'channelStopStreaming': {
				label: 'Stop channel streaming',
				options: [
					{
						type: 'dropdown',
						id: 'channelId',
						label: 'Channel',
						choices: this.CHOICES_CHANNELS
					},
				],
			},
			'recorderStartRecording': {
				label: 'Start recorder recording',
				options: [
					{
						type: 'textinput',
						id: 'id',
						label: 'Recorder ID',
						default: 0,
						regex: this.REGEX_NUMBER,
					},
				],
			},
			'recorderStopRecording': {
				label: 'Stop recorder recording',
				options: [
					{
						type: 'textinput',
						id: 'id',
						label: 'Recorder ID',
						default: 0,
						regex: this.REGEX_NUMBER,
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

		switch (action.action) {
			case 'channelChangeLayout':
				let [channelId, layoutId] = action.options.channelIdlayoutId.split('-')
				type                      = 'put';
				url                       = '/api/channels/' + channelId + '/layouts/active';
				body                      = {id: layoutId};
				break;
			case 'channelStartRecording':
				type = 'post';
				//url  = '/api/channels/' + action.options.channelId + '/control/start';
				break;
			case 'channelStopRecording':
				type = 'post';
				//url  = '/api/channels/' + action.options.channelId + '/control/stop';
				break;
			case 'recorderStartRecording':
				type = 'post';
				//url  = '/api/recorders/' + action.options.channelId + '/control/start';
				break;
			case 'recorderStopRecording':
				type = 'post';
				//url  = '/api/recorders/' + action.options.channelId + '/control/stop';
				break;
			case 'channelStartStreaming':
				type = 'post';
				//url  = '/api/recorders/' + action.options.channelId + '/control/start';
				break;
			case 'channelStopStreaming':
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

		if (feedback.type === 'program_bg') {
			if (this.states['program_bg'] ===
				parseInt(feedback.options.input)) {
				return {
					color: feedback.options.fg,
					bgcolor: feedback.options.bg,
				};
			}
		}

		if (feedback.type === 'preview_bg') {
			if (this.states['preview_bg'] ===
				parseInt(feedback.options.input)) {
				return {
					color: feedback.options.fg,
					bgcolor: feedback.options.bg,
				};
			}
		}

		if (feedback.type === 'logo_bg') {
			if (this.states['logo_bg'] === parseInt(feedback.options.input)) {
				return {
					color: feedback.options.fg,
					bgcolor: feedback.options.bg,
				};
			}
		}

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
	 * @param {Function} callback - Callback function for data
	 * @returns {boolean} False on errors
	 * @private
	 * @since 1.0.0
	 */
	_sendRequest(type, url, body, callback) {
		let self      = this;
		const apiHost = this.config.host,
					baseUrl = 'http://' + apiHost;

		if (url === null || url === '') {
			return false;
		}

		if (this.defaultRequest === undefined) {
			this.status(this.STATE_ERROR, 'Error, no request interface...');
			this.log('error', 'Error, no request interface...');
			return false;
		}

		type = type.toUpperCase();
		if (['GET', 'POST', 'PUT'].indexOf(type) === -1) {
			this.status(this.STATE_ERROR, 'Wrong request type: ' + type);
			this.log('error', 'Wrong request type: ' + type);
			return false;
		}

		if (body === undefined) {
			body = {};
		}

		if (callback === undefined) {
			callback = function (err, data) {
			}
		}

		this.debug('info', 'Starting request to: ' + url);
		this.defaultRequest({
				method: type,
				uri: baseUrl + url,
				json: body
			},
			function (error, response, body) {
				self.debug('info', JSON.stringify(error));
				self.debug('info', JSON.stringify(response));
				self.debug('info', JSON.stringify(body));

				if (error && error.code === 'ETIMEDOUT') {
					self.status(self.STATE_ERROR);
					self.log('error', 'Connection timeout while connecting to ' + apiHost);
					callback(error)
					return;
				}

				if (error && error.connect === true) {
					self.status(self.STATE_ERROR);
					self.log('error', 'Read timeout waiting for response from: ' + url);
					callback(error)
					return;
				}

				if (response &&
					(response.statusCode < 200 || response.statusCode > 299)) {
					self.status(self.STATE_ERROR);
					self.log('error', 'Non-successful response status code: ' +
						http.STATUS_CODES[response.statusCode]);
					callback(error)
					return;
				}

				callback(null, body.result);
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
					label: 'Input',
					id: 'input',
					default: 1,
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
					label: 'Input',
					id: 'input',
					default: 1,
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
					label: 'Input',
					id: 'input',
					default: 1,
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
		// Poll data from PDS every 5 secs
		this.timer = setInterval(this._dataPoller.bind(this), 5000);
	}


	/**
	 * INTERNAL: The data poller will activally make requests to update feedbacks and dropdown options.
	 * Polling data such as channels, recorders, layouts and status
	 *
	 * @private
	 * @since 1.0.0
	 */
	_dataPoller() {
		let self = this;

		// Get all channels availble
		this._sendRequest('get', '/api/channels', {}, function (err, channels) {
			for (let a in channels) {
				let channel = channels[a];

				self.CHOICES_CHANNELS[channel.id] = {
					id: channel.id,
					label: channel.name,
					layouts: {}
				}
			}
		})

		for (let a in this.CHOICES_CHANNELS) {
			let channel = this.CHOICES_CHANNELS[a];

			this._sendRequest('get', '/api/channels/' + channel.id + '/layouts', {}, function (err, layouts) {
				for (let b in layouts) {
					let layout = layouts[b];

					self.CHOICES_CHANNELS[a].layouts[layout.id] = {
						id: channel.id + '-' + layout.id,
						label: channel.label + ' - ' + layout.name
					}
				}
			});
		}

		this.CHOICES_CHANNELS_LAYOUTS = []
		for (let a in this.CHOICES_CHANNELS) {
			let channel = this.CHOICES_CHANNELS[a];
			for (let b in channel.layouts) {
				let layout = channel.layouts[b];
				this.CHOICES_CHANNELS_LAYOUTS.push(layout)
			}
		}


		// GET- /api/channels/
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
