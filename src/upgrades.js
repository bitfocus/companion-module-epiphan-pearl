/**
 * Default values for config fields that were added after the first release.
 * Any field that is undefined in a stored config gets its default here.
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

module.exports = [
	// Set default values for new config options
	function setDefaultConfig(context, props) {
		const result = {
			updatedConfig: null,
			updatedActions: [],
			updatedFeedbacks: [],
		}

		if (!props.config) return result

		const changed = {}
		for (const [key, value] of Object.entries(CONFIG_DEFAULTS)) {
			if (props.config[key] === undefined) {
				changed[key] = value
			}
		}

		if (Object.keys(changed).length > 0) {
			result.updatedConfig = Object.assign({}, props.config, changed)
		}

		return result
	},

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
	},
]

module.exports.CONFIG_DEFAULTS = CONFIG_DEFAULTS
