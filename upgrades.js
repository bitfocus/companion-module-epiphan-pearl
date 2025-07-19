module.exports = [
        // Set default values for new config options
	function setDefaultConfig(context, props) {
	       const result = {
	               updatedConfig: null,
	               updatedActions: [],
	               updatedFeedbacks: [],
	       }

	       const changed = {}

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
]
