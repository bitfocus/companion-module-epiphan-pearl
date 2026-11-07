const { PRESET_CATEGORY_IDS } = require('./presets')

/**
 * Creates the configuration fields for web config.
 *
 * @access public
 * @since 1.0.0
 * @returns {Array} the config fields
 */
function getConfigFields(api = {}) {
	// the settings page is built when it is opened, so it can say what the module found out about this encoder
	let apiText
	if (api.version === '2.0') apiText = `REST API v2.0 in use${api.firmware ? ` (firmware ${api.firmware})` : ''}.`
	else if (api.version === 'legacy')
		apiText = `Legacy REST API in use${api.firmware ? ` (firmware ${api.firmware})` : ''}: update the encoder to firmware 4.24.1 or newer to use API v2.0.`
	else apiText = 'Not detected yet: the encoder has not answered. It is asked again with every poll.'

	return [
		{
			type: 'static-text',
			id: 'info',
			width: 12,
			label: 'Information',
			value:
				'Controls an Epiphan encoder (Pearl-2, Pearl Mini, Pearl Nano, Pearl Nexus and newer models) over its REST API. ' +
				'Firmware 4.24.1 or newer is required for the API v2.0 features (inputs, outputs, storage, single touch, events, presets, previews).',
		},
		// Encoders in the same network announce themselves as '_epiphan._tcp' (see bonjourQueries in
		// companion/manifest.json). Companion lists them here by device name and always offers "Manual",
		// which is what every connection created before this field existed uses.
		{
			type: 'bonjour-device',
			id: 'bonjourHost',
			label: 'Encoder',
			width: 12,
			// the manual address fields refer to this field in isVisibleExpression
			disableAutoExpression: true,
			tooltip:
				'Encoders in the same network as Companion are found automatically. Select "Manual" to enter the address yourself, e.g. for an encoder in another network.',
		},
		{
			type: 'textinput',
			id: 'host',
			label: 'Host',
			width: 6,
			default: '192.168.255.250',
			// no regex: the address is checked by the module (validateConfig), so IPv6 and any hostname form can be entered
			isVisibleExpression: '!$(options:bonjourHost)',
		},
		{
			type: 'number',
			id: 'host_port',
			label: 'Port',
			width: 6,
			default: 80,
			min: 1,
			max: 65535,
			asInteger: true,
			isVisibleExpression: '!$(options:bonjourHost)',
		},
		{
			type: 'textinput',
			id: 'username',
			label: 'Username',
			width: 6,
			default: 'admin',
		},
		{
			type: 'secret-text',
			id: 'password',
			label: 'Password',
			width: 6,
			default: '',
		},
		{
			type: 'checkbox',
			id: 'use_https',
			label: 'Use HTTPS',
			width: 6,
			default: false,
			// accept_self_signed refers to this field in isVisibleExpression
			disableAutoExpression: true,
			tooltip: 'If HTTPS is enabled on the encoder, enable it here too.',
		},
		{
			type: 'checkbox',
			id: 'accept_self_signed',
			label: 'Accept self-signed certificate',
			width: 6,
			default: true,
			isVisibleExpression: '$(options:use_https)',
		},
		{
			type: 'number',
			id: 'poll_interval',
			label: 'Poll interval (ms)',
			width: 6,
			default: 2000,
			min: 500,
			max: 300000,
		},
		{
			type: 'number',
			id: 'timeout',
			label: 'Request timeout (ms)',
			width: 6,
			default: 5000,
			min: 1000,
			max: 60000,
		},
		{
			type: 'number',
			id: 'preview_interval',
			label: 'Preview image refresh interval (s, 0 disables previews)',
			width: 6,
			default: 2,
			min: 0,
			max: 300,
		},
		{
			type: 'number',
			id: 'preview_width',
			label: 'Preview image width (px)',
			width: 6,
			default: 144,
			min: 72,
			max: 720,
		},
		{
			type: 'checkbox',
			id: 'poll_events',
			label: 'Poll CMS schedule',
			width: 6,
			default: true,
		},
		{
			type: 'checkbox',
			id: 'enable_metadata',
			label: 'Poll channel content metadata (title, author, ...)',
			width: 6,
			default: true,
		},
		{
			type: 'checkbox',
			id: 'verbose',
			label: 'Enable verbose logging',
			width: 6,
			default: false,
		},
		{
			type: 'static-text',
			id: 'api_info',
			width: 12,
			label: 'API version',
			value: `${apiText} The REST API version is selected automatically from the firmware of the encoder; it is also shown in the connection status and in the variable api_version.`,
		},
		{
			type: 'multidropdown',
			id: 'preset_categories',
			label: 'Preset categories to generate',
			width: 12,
			default: PRESET_CATEGORY_IDS.slice(),
			choices: PRESET_CATEGORY_IDS.map((id) => ({ id, label: id })),
			tooltip:
				'Which groups of ready-made buttons appear in the drag-and-drop preset list. Unchecking a group ' +
				'only hides its auto-generated buttons here; the underlying actions and feedbacks stay available ' +
				"if you want to build your own button by hand, and anything you've already placed on a page keeps " +
				'working. Some encoders have enough channels, layouts or inputs that a few of these groups produce a ' +
				'lot of buttons (dozens of layout or input buttons is normal); trim what you do not use.',
		},
	]
}

module.exports = { getConfigFields }
