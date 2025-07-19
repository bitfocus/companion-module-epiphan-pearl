module.exports = [
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
