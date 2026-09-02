const { Regex } = require('@companion-module/base')

/**
 * Regex (as Companion regex string '/.../') accepting either an IPv4 address or a hostname
 */
const stripSlashes = (re) => re.replace(/^\/\^?/, '').replace(/\$?\/$/, '')
const REGEX_IP_OR_HOSTNAME = `/^(?:${stripSlashes(Regex.IP)}|${stripSlashes(Regex.HOSTNAME)})$/`

/**
 * Creates the configuration fields for web config.
 *
 * @access public
 * @since 1.0.0
 * @returns {Array} the config fields
 */
function getConfigFields() {
	return [
		{
			type: 'static-text',
			id: 'info',
			width: 12,
			label: 'Information',
			value:
				'Controls an Epiphan Pearl (Pearl-2, Pearl Mini, Pearl Nano) over its REST API. ' +
				'Firmware 4.24.1 or newer is required for the API v2.0 features (inputs, outputs, storage, single touch, events, presets, previews).',
		},
		{
			type: 'textinput',
			id: 'host',
			label: 'Target IP or hostname',
			width: 6,
			default: '192.168.255.250',
			regex: REGEX_IP_OR_HOSTNAME,
		},
		{
			type: 'textinput',
			id: 'host_port',
			label: 'Target Port',
			width: 6,
			default: '80',
			regex: Regex.PORT,
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
			default: '',
		},
		{
			type: 'number',
			id: 'pollfreq',
			label: 'Feedback polling frequency in seconds',
			width: 6,
			default: 10,
			min: 1,
			max: 300,
		},
		{
			type: 'number',
			id: 'timeout',
			label: 'Request timeout in milliseconds',
			width: 6,
			default: 5000,
			min: 1000,
			max: 60000,
		},
		{
			type: 'checkbox',
			id: 'use_api_v2',
			label: 'Use API v2.0 (if available)',
			width: 6,
			default: true,
		},
		{
			type: 'number',
			id: 'preview_interval',
			label: 'Preview image refresh interval in seconds (0 disables preview feedbacks)',
			width: 6,
			default: 2,
			min: 0,
			max: 300,
		},
		{
			type: 'number',
			id: 'preview_width',
			label: 'Preview image width in pixels',
			width: 6,
			default: 144,
			min: 72,
			max: 720,
		},
		{
			type: 'checkbox',
			id: 'poll_events',
			label: 'Poll CMS schedule (upcoming / ongoing events)',
			width: 6,
			default: true,
		},
		{
			type: 'checkbox',
			id: 'poll_archive',
			label: 'Poll last archive file per recorder',
			width: 6,
			default: false,
		},
		{
			type: 'checkbox',
			id: 'poll_connectivity',
			label: 'Poll network connectivity details (every 6th poll)',
			width: 6,
			default: false,
		},
		{
			type: 'checkbox',
			id: 'verbose',
			label: 'Enable verbose logging',
			width: 6,
			default: false,
		},
	]
}

module.exports = { getConfigFields, get_config_fields: getConfigFields, REGEX_IP_OR_HOSTNAME }
