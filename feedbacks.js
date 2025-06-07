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
					choices: this.choicesChannelLayout(),
					default: this.firstId(this.choicesChannelLayout()),
				},
			],
			callback: (feedback) => {
				if (!feedback.options.channelIdlayoutId) {
					return false
				}

				const [channelId, layoutId] = feedback.options.channelIdlayoutId.split('-')

				try {
					if (this.state.channels[channelId]?.layouts[layoutId]?.active) {
						return true
					}
				} catch (error) {
					this.log(
						'error',
						`trying to read feedback for a non-existing layout (Channel ${channelId}, Layout ${layoutId})`
					)
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
					choices: this.choicesChannelPublishers(),
					default: this.firstId(this.choicesChannelPublishers()),
				},
			],
			callback: (feedback) => {
				if (!feedback.options.channelIdpublisherId) {
					return false
				}

				const [channelId, publisherId] = feedback.options.channelIdpublisherId.split('-')
				const channel = this.state.channels[channelId]

				try {
					if (publisherId === 'all') {
						return !Object.keys(channel.publishers)
							.map((id) => channel.publishers[id].status.state)
							.some((state) => state !== 'started')
					} else {
						return channel.publishers[publisherId].status.state === 'started'
					}
				} catch (error) {
					this.log(
						'error',
						`trying to read feedback for a non-existing publisher (Channel ${channelId}, Publisher ${publisherId})`
					)
					return false
				}
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
					choices: this.choicesRecorders(),
					default: this.firstId(this.choicesRecorders()),
				},
			],
			callback: (feedback) => {
				try {
					return this.state.recorders[feedback.options.recorderId]?.status?.state === 'started'
				} catch (error) {
					this.log('error', `trying to read feedback for a non-existing recorder (${feedback.options.recorderId})`)
					return false
				}
                        },
                }

                feedbacks['recorderState'] = {
                        name: 'Recorder State',
                        type: 'boolean',
                        description: 'Change style when recorder is in the selected state',
                        defaultStyle: {
                                color: combineRgb(255, 255, 255),
                                bgcolor: combineRgb(0, 255, 0),
                        },
                        options: [
                                {
                                        type: 'dropdown',
                                        label: 'Recorder',
                                        id: 'recorderId',
                                        choices: this.choicesRecorders(),
                                        default: this.firstId(this.choicesRecorders()),
                                },
                                {
                                        type: 'dropdown',
                                        label: 'State',
                                        id: 'state',
                                        choices: [
                                                { id: 'started', label: 'Started' },
                                                { id: 'stopped', label: 'Stopped' },
                                        ],
                                        default: 'started',
                                },
                        ],
                        callback: (feedback) => {
                                const rec = this.state.recorders[feedback.options.recorderId]
                                return rec?.status?.state === feedback.options.state
                        },
                }

               feedbacks['streamingState'] = {
                       name: 'Streaming State',
                       type: 'boolean',
                       description: 'Change style when the stream has the selected state',
                       defaultStyle: {
                               color: combineRgb(255, 255, 255),
                               bgcolor: combineRgb(0, 255, 0),
                       },
                        options: [
                                {
                                        type: 'dropdown',
                                        label: 'Channel publisher',
                                        id: 'channelIdpublisherId',
                                        choices: this.choicesChannelPublishers(),
                                        default: this.firstId(this.choicesChannelPublishers()),
                                },
                                {
                                        type: 'dropdown',
                                        label: 'State',
                                        id: 'state',
                                        choices: [
                                                { id: 'started', label: 'Started' },
                                                { id: 'stopped', label: 'Stopped' },
                                        ],
                                        default: 'started',
                                },
                        ],
                       callback: (feedback) => {
                               const [channelId, publisherId] = feedback.options.channelIdpublisherId.split('-')
                               const channel = this.state.channels[channelId]
                               if (!channel) return false
                               const current = publisherId === 'all'
                                       ? !Object.keys(channel.publishers)
                                               .map((id) => channel.publishers[id].status.state)
                                               .some((state) => state !== feedback.options.state)
                                       : channel.publishers[publisherId]?.status?.state === feedback.options.state
                               return !!current
                       },
               }

               feedbacks['eventState'] = {
                       name: 'Event State',
                       type: 'boolean',
                       description: 'Change style when the event is in the selected state',
                       defaultStyle: {
                               color: combineRgb(255, 255, 255),
                               bgcolor: combineRgb(0, 255, 0),
                       },
                       options: [
                               {
                                       type: 'dropdown',
                                       label: 'Event',
                                       id: 'event',
                                       choices: this.choicesEvents(),
                                       default: this.firstId(this.choicesEvents()),
                               },
                               {
                                       type: 'dropdown',
                                       label: 'State',
                                       id: 'state',
                                       choices: [
                                               { id: 'started', label: 'Started' },
                                               { id: 'stopped', label: 'Stopped' },
                                               { id: 'paused', label: 'Paused' },
                                       ],
                                       default: 'started',
                               },
                       ],
                       callback: (fb) => {
                               const ev = this.state.events[fb.options.event]
                               return ev?.status?.state === fb.options.state
                       },
               }

                feedbacks['afuState'] = {
                        name: 'AFU State',
                        type: 'boolean',
                        description: 'Change style when the AFU is in the selected state',
                        defaultStyle: {
                                color: combineRgb(255, 255, 255),
                                bgcolor: combineRgb(0, 255, 0),
                        },
                        options: [
                                {
                                        type: 'dropdown',
                                        label: 'State',
                                        id: 'state',
                                        choices: [
                                                { id: 'running', label: 'Running' },
                                                { id: 'stopped', label: 'Stopped' },
                                        ],
                                        default: 'running',
                                },
                        ],
                        callback: (fb) => {
                                return this.state.system?.afu?.state === fb.options.state
                        },
                }

		return feedbacks
	},
}
