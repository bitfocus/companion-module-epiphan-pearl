const { combineRgb } = require('@companion-module/base')

module.exports = {
	/**
	 * INTERNAL: Get the available presets.
	 *
	 * @access protected
	 * @since 2.0.0
	 * @returns {Object[]} - the available presets
	 */
	getPresets() {
		let presets = {}

		for (const layout of this.choicesChannelLayout()) {
			presets[`layout_${layout.label}`] = {
				type: 'button',
				category: 'Channels',
				name: layout.label,
				style: {
					text: layout.label.replace(' - ', '\\n'),
					size: 7,
					color: combineRgb(255, 255, 255),
					bgcolor: combineRgb(0, 0, 0),
				},
				steps: [
					{
						down: [
							{
								actionId: 'channelChangeLayout',
								options: {
									channelIdlayoutId: layout.id,
								},
							},
						],
						up: [],
					},
				],
				feedbacks: [
					{
						feedbackId: 'channelLayout',
						options: {
							channelIdlayoutId: layout.id,
						},
						style: {
							color: combineRgb(0, 0, 0),
							bgcolor: combineRgb(255, 0, 0),
						},
					},
				],
			}
		}

		for (const publisher of this.choicesChannelPublishers()) {
			presets[`publisher_${publisher.label}`] = {
				type: 'button',
				category: 'Publishers',
				label: publisher.label,
				style: {
					text: publisher.label.replace(' - ', '\\n'),
					size: 7,
					color: combineRgb(255, 255, 255),
					bgcolor: combineRgb(0, 51, 153),
				},
				steps: [
					{
						down: [
							{
                                                               actionId: 'controlStreaming',
								options: {
									channelIdpublisherId: publisher.id,
									startStopAction: 3, // toggle
								},
							},
						],
						up: [],
					},
				],
				feedbacks: [
					{
                                               feedbackId: 'streamingState',
						options: {
							channelIdpublisherId: publisher.id,
						},
						style: {
							color: combineRgb(0, 0, 0),
							bgcolor: combineRgb(0, 255, 0),
						},
					},
				],
			}
		}

		for (const recorder of this.choicesRecorders()) {
			presets[`recorder_${recorder.label}`] = {
				type: 'button',
				category: 'Recorders',
				label: recorder.label,
				style: {
					text: recorder.label + '\\n▶️/⏹',
					size: 14,
					color: combineRgb(255, 255, 255),
					bgcolor: combineRgb(0, 102, 0),
				},
				steps: [
					{
						down: [
							{
								actionId: 'recorderRecording',
								options: {
									recorderId: recorder.id,
									startStopAction: 3, // Toggle
								},
							},
						],
						up: [],
					},
				],
				feedbacks: [
					{
						feedbackId: 'recorderRecording',
						options: {
							recorderId: recorder.id,
						},
						style: {
							color: combineRgb(0, 0, 0),
							bgcolor: combineRgb(255, 0, 0),
						},
					},
				],
			}
			presets[`recorder_${recorder.label}_reset`] = {
				type: 'button',
				category: 'Recorders',
				label: recorder.label,
				style: {
					text: recorder.label + '\\n🔁',
					size: 14,
					color: combineRgb(255, 255, 255),
					bgcolor: combineRgb(0, 102, 0),
				},
				steps: [
					{
						down: [
							{
								actionId: 'recorderRecording',
								options: {
									recorderId: recorder.id,
									startStopAction: 2, // Reset
								},
							},
						],
						up: [],
					},
				],
				feedbacks: [
					{
						feedbackId: 'recorderRecording',
						options: {
							recorderId: recorder.id,
						},
						style: {
							color: combineRgb(0, 0, 0),
							bgcolor: combineRgb(255, 0, 0),
						},
					},
				],
			}
		}

		return presets
	},
}
