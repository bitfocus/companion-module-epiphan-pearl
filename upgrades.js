const { CreateUseActionResultStoreUpgradeScript } = require('@companion-module/base')

// Remember: once an upgrade script has been added, it must never be removed or reordered
module.exports = [
	// Set default values for new config options
	function setDefaultConfig(context, props) {
		const result = {
			updatedConfig: null,
			updatedActions: [],
			updatedFeedbacks: [],
		}

		const changed = {}

		// Fix: props.config is null when there is no config to upgrade
		if (!props.config) {
			return result
		}

		if (props.config.use_api_v2 === undefined) {
			changed.use_api_v2 = true
		}

		if (props.config.verbose === undefined) {
			changed.verbose = false
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

	// module-base 2.x: 'Get layout data' returns its result instead of writing into the custom variable
	// selected in the 'destination' option. This converts existing actions to the new result flow.
	CreateUseActionResultStoreUpgradeScript({
		getLayoutData: 'destination',
	}),

	// The option 'Use API v2.0' was removed, API v2.0 is now always used when the firmware supports it
	function removeUseApiV2(context, props) {
		const result = {
			updatedConfig: null,
			updatedActions: [],
			updatedFeedbacks: [],
		}

		if (props.config && 'use_api_v2' in props.config) {
			const { use_api_v2: _removed, ...config } = props.config
			result.updatedConfig = config
		}

		return result
	},
]
