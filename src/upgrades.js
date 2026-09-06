const { PRESET_CATEGORY_IDS } = require('./presets')

/**
 * Default values for config fields that were added after the first release.
 * Any field that is undefined in a stored config gets its default here.
 *
 * Companion runs every upgrade script exactly once per connection and remembers how far it got, so an
 * existing script must never be extended: fields added in a later version get their own script that is
 * APPENDED to the exported array (setDefaultConfig = v2.2.0, setDefaultConfigV230 = v2.3.0,
 * setDefaultConfigV260 = v2.6.0, setDefaultConfigV300Https = v3.0.0).
 */
const CONFIG_DEFAULTS = {
	use_api_v2: true,
	verbose: false,
	use_https: false,
	accept_self_signed: true,
	timeout: 5000,
	preview_interval: 2,
	preview_width: 144,
	poll_events: true,
	poll_archive: false,
	poll_connectivity: false,
	// every category was implicitly "on" before this setting existed, so an upgraded connection keeps
	// generating exactly the presets it already had
	preset_categories: PRESET_CATEGORY_IDS.slice(),
}

/** fields handled by setDefaultConfig (v2.2.0) */
const CONFIG_DEFAULT_KEYS_V220 = ['use_api_v2', 'verbose']
/** fields handled by setDefaultConfigV230 (v2.3.0) */
const CONFIG_DEFAULT_KEYS_V230 = [
	'timeout',
	'preview_interval',
	'preview_width',
	'poll_events',
	'poll_archive',
	'poll_connectivity',
]
/** fields handled by setDefaultConfigV260 (v2.6.0) */
const CONFIG_DEFAULT_KEYS_V260 = ['preset_categories']
/** fields handled by setDefaultConfigV300Https (v3.0.0) */
const CONFIG_DEFAULT_KEYS_V300_HTTPS = ['use_https', 'accept_self_signed']

/**
 * Build an upgrade script that fills the given config keys with their CONFIG_DEFAULTS value when undefined
 *
 * @param {string[]} keys
 * @returns {(context: unknown, props: {config?: object}) => object}
 */
function fillConfigDefaults(keys) {
	return (context, props) => {
		const result = {
			updatedConfig: null,
			updatedActions: [],
			updatedFeedbacks: [],
		}

		if (!props.config) return result

		const changed = {}
		for (const key of keys) {
			if (props.config[key] === undefined) {
				changed[key] = CONFIG_DEFAULTS[key]
			}
		}

		if (Object.keys(changed).length > 0) {
			result.updatedConfig = Object.assign({}, props.config, changed)
		}

		return result
	}
}

const setDefaultConfig = fillConfigDefaults(CONFIG_DEFAULT_KEYS_V220)
const setDefaultConfigV230 = fillConfigDefaults(CONFIG_DEFAULT_KEYS_V230)
const setDefaultConfigV260 = fillConfigDefaults(CONFIG_DEFAULT_KEYS_V260)
const setDefaultConfigV300Https = fillConfigDefaults(CONFIG_DEFAULT_KEYS_V300_HTTPS)
Object.defineProperty(setDefaultConfig, 'name', { value: 'setDefaultConfig' })
Object.defineProperty(setDefaultConfigV230, 'name', { value: 'setDefaultConfigV230' })
Object.defineProperty(setDefaultConfigV260, 'name', { value: 'setDefaultConfigV260' })
Object.defineProperty(setDefaultConfigV300Https, 'name', { value: 'setDefaultConfigV300Https' })

// Rename old streaming feedback and action identifiers
function renameStreaming(context, props) {
	const result = {
		updatedConfig: null,
		updatedActions: [],
		updatedFeedbacks: [],
	}

	for (const action of props.actions) {
		if (action.actionId === 'channelStreaming') {
			action.actionId = 'controlStreaming'
			result.updatedActions.push(action)
		}
	}

	for (const feedback of props.feedbacks) {
		if (feedback.feedbackId === 'channelStreaming') {
			feedback.feedbackId = 'streamingState'
			result.updatedFeedbacks.push(feedback)
		}
	}

	return result
}

// The order is part of the contract: scripts are only ever appended, never reordered or removed.
module.exports = [
	// v2.2.0: default values for use_api_v2 / verbose
	setDefaultConfig,
	// v2.2.0: channelStreaming -> controlStreaming / streamingState
	renameStreaming,
	// v2.3.0: default values for the polling / preview options
	setDefaultConfigV230,
	// v2.6.0: default value (every category) for the new preset_categories setting
	setDefaultConfigV260,
	// v3.0.0: default values (HTTPS off, self-signed accepted) for the connection security settings
	setDefaultConfigV300Https,
]

module.exports.CONFIG_DEFAULTS = CONFIG_DEFAULTS
module.exports.CONFIG_DEFAULT_KEYS_V220 = CONFIG_DEFAULT_KEYS_V220
module.exports.CONFIG_DEFAULT_KEYS_V230 = CONFIG_DEFAULT_KEYS_V230
module.exports.CONFIG_DEFAULT_KEYS_V260 = CONFIG_DEFAULT_KEYS_V260
module.exports.CONFIG_DEFAULT_KEYS_V300_HTTPS = CONFIG_DEFAULT_KEYS_V300_HTTPS
