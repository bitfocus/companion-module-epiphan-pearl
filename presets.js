const { combineRgb } = require('@companion-module/base')

module.exports = {
	/**
	 * INTERNAL: Get the available presets.
	 *
	 * @access protected
	 * @since 2.0.0
	 * @returns {{structure: Object[], presets: Object}} - the preset sections and the available presets
	 */
	getPresets() {
		let presets = {}

		// Fix: preset keys are built from the ids instead of the labels, labels are not unique
		// (e.g. two recorders with the same name) and overwrote each other
		for (const layout of this.choicesChannelLayout()) {
			presets[`layout_${layout.id}`] = {
				type: 'simple',
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
			presets[`publisher_${publisher.id}`] = {
				type: 'simple',
				// Fix: presets need 'name', 'label' is an old property
				name: publisher.label,
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
			presets[`recorder_${recorder.id}`] = {
				type: 'simple',
				// Fix: presets need 'name', 'label' is an old property
				name: recorder.label,
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
			presets[`recorder_${recorder.id}_reset`] = {
				type: 'simple',
				// Fix: presets need 'name', 'label' is an old property
				name: recorder.label + ' Reset',
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

		// module-base 2.x: the 'category' property was replaced by a separate structure of sections
		const idsWithPrefix = (prefix) => Object.keys(presets).filter((id) => id.startsWith(prefix))
		const structure = [
			{ id: 'channels', name: 'Channels', definitions: idsWithPrefix('layout_') },
			{ id: 'publishers', name: 'Publishers', definitions: idsWithPrefix('publisher_') },
			{ id: 'recorders', name: 'Recorders', definitions: idsWithPrefix('recorder_') },
		]

		return { structure, presets }
	},
}
