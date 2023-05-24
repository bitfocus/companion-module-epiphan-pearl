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

		for (const layout of this.CHOICES_CHANNELS_LAYOUTS) {
			presets[`layout_${layout.label}`] = {
				type: 'button',
				category: 'Channels',
				name: layout.label,
				style: {
					text: layout.channelLabel + '\\n' + layout.layoutLabel,
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
							color: combineRgb(255, 255, 255),
							bgcolor: combineRgb(255, 0, 0),
						},
					},
				],
			}
		}

		for (const publisher of this.CHOICES_CHANNELS_PUBLISHERS) {
			presets[`publisher_${publisher.label}`] = {
				type: 'button',
				category: 'Publishers',
				label: publisher.label,
				style: {
					text: publisher.channelLabel + '\\n' + publisher.publisherLabel,
					size: 7,
					color: combineRgb(255, 255, 255),
					bgcolor: combineRgb(0, 51, 153),
				},
				steps: [
					{
						down: [
							{
								actionId: 'channelStreaming',
								options: {
									channelIdpublisherId: publisher.id,
									startStopAction: 1, // START
								},
							},
						],
						up: [],
					},
					{
						down: [
							{
								actionId: 'channelStreaming',
								options: {
									channelIdpublisherId: publisher.id,
									startStopAction: 0, // STOP
								},
							},
						],
						up: [],
					},
				],
				feedbacks: [
					{
						feedbackId: 'channelStreaming',
						options: {
							channelIdpublisherId: publisher.id,
						},
						style: {
							color: combineRgb(255, 255, 255),
							bgcolor: combineRgb(0, 255, 0),
						},
					},
				],
			}
		}

		for (const recorder of this.CHOICES_RECORDERS) {
			presets[`recorder_${recorder.label}`] = {
				type: 'button',
				category: 'Recorders',
				label: recorder.label,
				style: {
					text: recorder.label,
					size: 7,
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
									startStopAction: 1, // START
								},
							},
						],
						up: [],
					},
					{
						down: [
							{
								actionId: 'recorderRecording',
								options: {
									recorderId: recorder.id,
									startStopAction: 0, // STOP
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
							color: combineRgb(255, 255, 255),
							bgcolor: combineRgb(255, 0, 0),
						},
					},
				],
			}
		}

		return presets
	},
}
