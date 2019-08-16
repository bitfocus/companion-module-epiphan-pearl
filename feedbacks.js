module.exports = {
	/**
	 * INTERNAL: Get the available feedbacks.
	 *
	 * @access protected
	 * @since 1.0.0
	 * @returns {Object[]} - the available feedbacks
	 */
	getFeedbacks() {
		let feedbacks = {};

		feedbacks['channel_layout'] = {
			label: 'Change colors on channel layout change',
			description: 'If the current layout is active, change color of the bank',
			options: [
				{
					type: 'colorpicker',
					label: 'Foreground color',
					id: 'fg',
					default: this.rgb(255, 255, 255),
				},
				{
					type: 'colorpicker',
					label: 'Background color',
					id: 'bg',
					default: this.rgb(255, 0, 0),
				},
				{
					type: 'dropdown',
					label: 'Channel',
					id: 'channelIdlayoutId',
					choices: this.CHOICES_CHANNELS_LAYOUTS,
				},
			],
			callback: (feedback, bank) => {
				const [channelId, layoutId] = feedback.options.channelIdlayoutId.split('-');
				const layout                = this._getLayoutFromChannelById(this._getChannelById(channelId), layoutId);
				if (!layout) {
					return {};
				}

				if (layout.active) {
					return {
						color: feedback.options.fg,
						bgcolor: feedback.options.bg
					};
				}
				return {};
			}
		};

		feedbacks['streaming'] = {
			label: 'Change colors if streaming',
			description: 'If channel is streaming, change colors of the bank',
			options: [
				{
					type: 'colorpicker',
					label: 'Foreground color',
					id: 'fg',
					default: this.rgb(255, 255, 255),
				},
				{
					type: 'colorpicker',
					label: 'Background color',
					id: 'bg',
					default: this.rgb(0, 255, 0),
				},
				{
					type: 'dropdown',
					label: 'Channel publishers',
					id: 'channelIdpublisherId',
					choices: this.CHOICES_CHANNELS_PUBLISHERS,
				},
			],
			callback: (feedback, bank) => {
				const [channelId, publisherId] = feedback.options.channelIdpublisherId.split('-');
				const channel                  = this._getChannelById(channelId);
				if (!channel) {
					return {};
				}

				const publisher = this._getPublisherFromChannelById(channel, publisherId);
				let isStreaming = false;
				if (publisherId === 'all') {
					isStreaming = this._getActivePublishersFromChannel(channel);
				}

				if (this._isPublisherStreaming(publisher) || isStreaming) {
					return {
						color: feedback.options.fg,
						bgcolor: feedback.options.bg
					};
				}
				return {};
			}
		};

		feedbacks['recording'] = {
			label: 'Change colors if recording',
			description: 'If channel/recorder is recording, change colors of the bank',
			options: [
				{
					type: 'colorpicker',
					label: 'Foreground color',
					id: 'fg',
					default: this.rgb(255, 255, 255),
				},
				{
					type: 'colorpicker',
					label: 'Background color',
					id: 'bg',
					default: this.rgb(0, 255, 0),
				},
				{
					type: 'dropdown',
					label: 'Recorders',
					id: 'recorderId',
					choices: this.CHOICES_RECORDERS,
				},
			],
			callback: (feedback, bank) => {
				const recorderId = feedback.options.recorderId;
				const recorder   = this._getRecorderById(recorderId);
				if (this._isRecorderRecording(recorder)) {
					return {
						color: feedback.options.fg,
						bgcolor: feedback.options.bg
					};
				}
				return {};
			}
		};

		return feedbacks;
	}
};
