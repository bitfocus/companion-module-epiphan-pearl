module.exports = {
	/**
	 * INTERNAL: Get the available feedbacks.
	 *
	 * @returns {Object[]} the available feedbacks
	 * @access protected
	 * @since 1.0.0
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
				// TODO: move to function
				let [channelId, layoutId] = feedback.options.channelIdlayoutId.split('-');
				const channel = this.CHANNEL_STATES.find(obj => obj.id === parseInt(channelId));
				if (!channel) return;

				const layout = channel.layouts.find(obj => obj.id === parseInt(layoutId));
				if (!layout) return;

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
		};

		return feedbacks;
	}
};
