const { combineRgb } = require('@companion-module/base')

module.exports = {
	/**
	 * INTERNAL: Get the available feedbacks.
	 *
	 * @access protected
	 * @since 1.0.0
	 * @returns {Object} - the available feedbacks
	 */
	getFeedbacks() {
		let feedbacks = {}

		feedbacks['channelLayout'] = {
			name: 'Change style on channel layout change',
			type: 'boolean',
			description: 'Change style if the specified layout is active',
			defaultStyle: {
				color: combineRgb(255, 255, 255),
				bgcolor: combineRgb(255, 0, 0),
			},
			options: [
				{
					type: 'dropdown',
					label: 'Channel',
					id: 'channelIdlayoutId',
					choices: this.CHOICES_CHANNELS_LAYOUTS,
					default: this.CHOICES_CHANNELS_LAYOUTS.length > 0 ? this.CHOICES_CHANNELS_LAYOUTS[0].id : '',
				},
			],
			callback: (feedback) => {
				if (!feedback.options.channelIdlayoutId) {
					return false
				}

				const [channelId, layoutId] = feedback.options.channelIdlayoutId.split('-')
				const layout = this._getLayoutFromChannelById(this._getChannelById(channelId), layoutId)
				if (!layout) {
					return false
				}

				if (layout.active) {
					return true
				}
				return false
			},
		}

		feedbacks['channelStreaming'] = {
			name: 'Change style if streaming',
			type: 'boolean',
			description: 'Change style if specified channel is streaming',
			defaultStyle: {
				color: combineRgb(255, 255, 255),
				bgcolor: combineRgb(0, 255, 0),
			},
			options: [
				{
					type: 'dropdown',
					label: 'Channel publisher',
					id: 'channelIdpublisherId',
					choices: this.CHOICES_CHANNELS_PUBLISHERS,
					default: this.CHOICES_CHANNELS_PUBLISHERS.length > 0 ? this.CHOICES_CHANNELS_PUBLISHERS[0].id : '',
				},
			],
			callback: (feedback) => {
				if (!feedback.options.channelIdpublisherId) {
					return false
				}

				const [channelId, publisherId] = feedback.options.channelIdpublisherId.split('-')
				const channel = this._getChannelById(channelId)
				if (!channel) {
					return false
				}

				const publisher = this._getPublisherFromChannelById(channel, publisherId)
				let isStreaming = false
				if (publisherId === 'all') {
					isStreaming = this._getActivePublishersFromChannel(channel)
				}

				if (this._isPublisherStreaming(publisher) || isStreaming) {
					return true
				}
				return false
			},
		}

		feedbacks['recorderRecording'] = {
			name: 'Change style if recording',
			type: 'boolean',
			description: 'Change style if channel/recorder is recording',
			defaultStyle: {
				color: combineRgb(255, 255, 255),
				bgcolor: combineRgb(0, 255, 0),
			},
			options: [
				{
					type: 'dropdown',
					label: 'Recorders',
					id: 'recorderId',
					choices: this.CHOICES_RECORDERS,
					default: this.CHOICES_RECORDERS.length > 0 ? this.CHOICES_RECORDERS[0].id : '',
				},
			],
			callback: (feedback) => {
				const recorder = this._getRecorderById(feedback.options.recorderId)
				if (this._isRecorderRecording(recorder)) {
					return true
				}
				return false
			},
		}

		return feedbacks
	},
}
