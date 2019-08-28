module.exports = {

	/**
	 * INTERNAL: Get the available presets.
	 *
	 * @access protected
	 * @since [Unreleased]
	 * @returns {Object[]} - the available presets
	 */
	getPresets() {
		let presets = [];

		for (const a in this.CHOICES_CHANNELS_LAYOUTS) {
			const layout = this.CHOICES_CHANNELS_LAYOUTS[a];

			let pst = {
				category: 'Channels',
				label: layout.label,
				bank: {
					style: 'text',
					text: layout.channelLabel + '\\n' + layout.layoutLabel,
					size: 7,
					color: this.rgb(255, 255, 255),
					bgcolor: this.rgb(0, 0, 0)
				},
				actions: [
					{
						action: 'channelChangeLayout',
						options: {
							channelIdlayoutId: layout.id
						}
					}
				],
				feedbacks: [
					{
						type: 'channelLayout',
						options: {
							fg: this.rgb(255, 255, 255),
							bg: this.rgb(255, 0, 0),
							channelIdlayoutId: layout.id
						}
					}
				]
			};

			presets.push(pst);
		}

		for (const b in this.CHOICES_CHANNELS_PUBLISHERS) {
			const publisher = this.CHOICES_CHANNELS_PUBLISHERS[b];

			let pst = {
				category: 'Publishers',
				label: publisher.label,
				bank: {
					style: 'text',
					text: publisher.channelLabel + '\\n' + publisher.publisherLabel,
					size: 7,
					color: this.rgb(255, 255, 255),
					bgcolor: this.rgb(0, 51, 153),
					latch: true
				},
				actions: [
					{
						action: 'channelStreaming',
						options: {
							channelIdpublisherId: publisher.id,
							startStopAction: 1 // START
						}
					}
				],
				release_actions: [
					{
						action: 'channelStreaming',
						options: {
							channelIdpublisherId: publisher.id,
							startStopAction: 0 // STOP
						}
					}
				],
				feedbacks: [
					{
						type: 'channelStreaming',
						options: {
							fg: this.rgb(255, 255, 255),
							bg: this.rgb(0, 255, 0),
							channelIdpublisherId: publisher.id
						}
					}
				]
			};

			presets.push(pst);
		}

		for (const c in this.CHOICES_RECORDERS) {
			const recoder = this.CHOICES_RECORDERS[c];

			let pst = {
				category: 'Recorders',
				label: recoder.label,
				bank: {
					style: 'text',
					text: recoder.label,
					size: 7,
					color: this.rgb(255, 255, 255),
					bgcolor: this.rgb(0, 102, 0),
					latch: true
				},
				actions: [
					{
						action: 'recorderRecording',
						options: {
							recorderId: recoder.id,
							startStopAction: 1 // START
						}
					}
				],
				release_actions: [
					{
						action: 'recorderRecording',
						options: {
							recorderId: recoder.id,
							startStopAction: 0 // STOP
						}
					}
				],
				feedbacks: [
					{
						type: 'recorderRecording',
						options: {
							fg: this.rgb(255, 255, 255),
							bg: this.rgb(255, 0, 0),
							recorderId: recoder.id
						}
					}
				]
			};

			presets.push(pst);
		}

		return presets;
	}
};
