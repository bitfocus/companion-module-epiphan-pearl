/**
 * Default values for config fields that were added after the first release.
 * Any field that is undefined in a stored config gets its default here.
 *
 * Companion runs every upgrade script exactly once per connection and remembers how far it got, so an
 * existing script must never be extended: fields added in a later version get their own script that is
 * APPENDED to the exported array (setDefaultConfig = v2.2.0, setDefaultConfigV230 = v2.3.0).
 */
const CONFIG_DEFAULTS = {
	use_api_v2: true,
	verbose: false,
	timeout: 5000,
	preview_interval: 2,
	preview_width: 144,
	poll_events: true,
	poll_archive: false,
	poll_connectivity: false,
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
Object.defineProperty(setDefaultConfig, 'name', { value: 'setDefaultConfig' })
Object.defineProperty(setDefaultConfigV230, 'name', { value: 'setDefaultConfigV230' })

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
]

module.exports.CONFIG_DEFAULTS = CONFIG_DEFAULTS
module.exports.CONFIG_DEFAULT_KEYS_V220 = CONFIG_DEFAULT_KEYS_V220
module.exports.CONFIG_DEFAULT_KEYS_V230 = CONFIG_DEFAULT_KEYS_V230
