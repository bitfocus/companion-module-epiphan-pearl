const { Regex } = require('@companion-module/base')

// noinspection JSUnusedGlobalSymbols
/**
 * Creates the configuration fields for web config.
 *
 * @access public
 * @since 1.0.0
 * @returns {Array} the config fields
 */
const get_config_fields = () => {
	return [
		// Pearls in the same network announce themselves via Bonjour as '_epiphan._tcp' (checked on a
		// Pearl-2 with firmware 4.24.6), see bonjourQueries in companion/manifest.json. Companion lists
		// them here with the device name of the Pearl and offers "Manual" for all other cases, e.g. a
		// Pearl in another network. The value is 'host:port', or null for "Manual".
		{
			type: 'bonjour-device',
			id: 'bonjourHost',
			label: 'Pearl',
			tooltip:
				'Pearls in the same network as Companion are found automatically. Select "Manual" to enter the address yourself, e.g. for a Pearl in another network.',
			width: 6,
			// the manual address fields below refer to this field, see isVisibleExpression
			disableAutoExpression: true,
		},
		{
			type: 'textinput',
			id: 'host',
			label: 'Target IP or hostname',
			width: 6,
			default: '192.168.255.250',
			// hostnames are allowed too, e.g. <device name>.local, the name a Pearl announces on the network
			regex: Regex.HOSTNAME,
			tooltip: 'IP address or hostname of the Pearl, e.g. 192.168.1.20 or <device name>.local',
			// only needed when no Pearl is selected in the Bonjour field
			isVisibleExpression: '!$(options:bonjourHost)',
		},
		{
			type: 'textinput',
			id: 'host_port',
			label: 'Target Port',
			width: 6,
			default: '80',
			regex: Regex.PORT,
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
			type: 'checkbox',
			id: 'verbose',
			label: 'Enable verbose logging',
			default: false,
		},
	]
}

module.exports = { get_config_fields }
