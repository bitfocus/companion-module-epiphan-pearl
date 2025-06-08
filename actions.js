const { InstanceStatus } = require('@companion-module/base')

module.exports = {
	/**
	 * Setup the actions.
	 *
	 * @access public
	 * @since 2.0.0
	 * @returns {Object} the action definitions
	 */
	get_actions() {
		const actions = {}
		actions['channelChangeLayout'] = {
			name: 'Change channel layout',
			options: [
				{
					type: 'dropdown',
					id: 'channelIdlayoutId',
					label: 'Change layout to:',
					choices: this.choicesChannelLayout(),
					default: this.firstId(this.choicesChannelLayout()),
				},
			],
			callback: (action) => {
				let type = 'get',
					url,
					body,
					callback

				if (typeof action.options.channelIdlayoutId !== 'string' || !action.options.channelIdlayoutId.includes('-')) {
					this.setStatus(
						InstanceStatus.UnknownWarning,
						'Channel and layout are not known! Please review your button config'
					)
					this.debug('channelIdlayoutId: ' + action.options.channelIdlayoutId)
					return
				}

				const [channelId, layoutId] = action.options.channelIdlayoutId.split('-')
				if (!this.state.channels[channelId]) {
					this.setStatus(
						InstanceStatus.UnknownWarning,
						'Action on non existing channel! Please review your button config'
					)
					this.log('error', 'Action on non existing channel: ' + channelId)
					return
				}
				if (!this.state.channels[channelId].layouts[layoutId]) {
					this.setStatus(
						InstanceStatus.UnknownWarning,
						'Action on non existing layout! Please review your button config'
					)
					this.log('error', 'Action on non existing layout ' + layoutId + ' on channel ' + channelId)
					return
				}

				type = 'put'
				url = '/api/channels/' + channelId + '/layouts/active'
				body = { id: Number(layoutId) }
				callback = (response) => {
					if (response && response.status === 'ok') {
						this.updateActiveChannelLayout(channelId, layoutId)
					}
				}

				// Send request
				this.sendRequest(type, url, body).then(callback)
			},
		}

                actions['channelStreaming'] = {
                        name: 'Control Streaming (Publisher)',
			options: [
				{
					type: 'dropdown',
					label: 'Channel publishers',
					id: 'channelIdpublisherId',
					choices: this.choicesChannelPublishers(),
					default: this.firstId(this.choicesChannelPublishers()),
					tooltip:
						'If a channel has only one "publisher" or "stream" then you just select all. Else you can pick the "publisher" you want to start/stop',
				},
				{
					type: 'dropdown',
					id: 'startStopAction',
					label: 'Action',
					choices: [
						{ id: 99, label: '---' },
						{ id: 1, label: 'Start' },
						{ id: 0, label: 'Stop' },
						{ id: 3, label: 'Toggle Start/Stop' },
					],
					default: 1,
				},
			],
			callback: (action) => {
				let type = 'post',
					url,
					body

				if (
					typeof action.options.channelIdpublisherId !== 'string' ||
					!action.options.channelIdpublisherId.includes('-')
				) {
					this.setStatus(
						InstanceStatus.UnknownWarning,
						'Channel or Publisher are not valid! Please review your button config'
					)
					this.debug('Undefined channelIdpublisherId ... ' + action.options.channelIdpublisherId)
					return
				}

				const [channelId, publisherId] = action.options.channelIdpublisherId.split('-')
				if (!this.state.channels[channelId]) {
					this.setStatus(
						InstanceStatus.UnknownWarning,
						'Action on non existing channel! Please review your button config.'
					)
					this.log('error', 'Action on non existing channel: ' + channelId)
					return
				}
				if (publisherId !== 'all' && !this.state.channels[channelId].publishers[publisherId]) {
					this.setStatus(
						InstanceStatus.UnknownWarning,
						'Action on non existing publisher! Please review your button config.'
					)
					this.log('error', 'Action on non existing publisher ' + publisherId + ' on channel ' + channelId)
					return
				}

				if (action.options.startStopAction === 99) return

				let startStopAction = action.options.startStopAction === 1 ? 'start' : 'stop'

				if (action.options.startStopAction === 3) {
					// toggle
					let isStreaming
					const channel = this.state.channels[channelId]
					if (publisherId !== 'all') {
						isStreaming = channel.publishers[publisherId].status.state === 'started'
					} else {
						// if we should toggle all, check if there is at least one not streaming and then turn it on
						isStreaming = !Object.keys(channel.publishers)
							.map((id) => channel.publishers[id].status.state)
							.some((state) => state !== 'started')
					}
					startStopAction = isStreaming ? 'stop' : 'start'
				}

				if (publisherId !== 'all') {
					url = '/api/channels/' + channelId + '/publishers/' + publisherId + '/control/' + startStopAction
				} else {
					url = '/api/channels/' + channelId + '/publishers/control/' + startStopAction
				}

				// Send request
				this.sendRequest(type, url, body)
			},
		}

		actions['recorderRecording'] = {
			name: 'Control recording',
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
					id: 'startStopAction',
					label: 'Action',
					choices: [
						{ id: 99, label: '---' },
						{ id: 1, label: 'Start' },
						{ id: 0, label: 'Stop' },
						{ id: 2, label: 'Reset' },
						{ id: 3, label: 'Toggle Start/Stop' },
					],
					default: 1,
				},
			],
			callback: (action) => {
				let type = 'post',
					url,
					body,
					callback

				const recorderId = action.options.recorderId
				if (!this.state.recorders[recorderId]) {
					this.setStatus(
						InstanceStatus.UnknownWarning,
						'Action on non existing recorder! Please review your button config.'
					)
					this.log('warn', 'Action on non existing recorder ' + recorderId)
					return
				}

				let startStopAction = action.options.startStopAction
				if (startStopAction === 3) {
					// Toggle
					if (this.state.recorders[recorderId]?.status?.state === 'started') {
						startStopAction = 0
					} else {
						startStopAction = 1
					}
				}

				if (startStopAction === 0) {
					url = `/api/recorders/${recorderId}/control/stop`
				} else if (startStopAction === 1) {
					url = `/api/recorders/${recorderId}/control/start`
				} else if (startStopAction === 2) {
					url = `/api/recorders/${recorderId}/control/reset`
				} else if (startStopAction === 99) {
					return
				} else {
					this.setStatus(InstanceStatus.UnknownWarning, 'Called an unknown action! Please review your button config.')
					this.log('error', 'Called an unknown action: ' + action.options.startStopAction)
					return
				}

				callback = async (response) => {
					if (response && response.status === 'ok') {
						this.updateRecorderStatus(recorderId)
					}
				}
				// Send request
				this.sendRequest(type, url, body).then(callback)
			},
		}
		actions['insertMarker'] = {
			name: 'Insert Marker',
			options: [
				{
					type: 'dropdown',
					label: 'Channel',
					id: 'channel',
					choices: this.choicesChannel(),
					default: this.firstId(this.choicesChannel()),
				},
				{
					type: 'textinput',
					id: 'markertext',
					label: 'Marker text',
					useVariables: true,
					default: '',
					tooltip: 'You can use variables in this field like current time',
				},
			],
			callback: async (action) => {
				let type = 'post'
				let url = `/api/channels/${action.options.channel}/bookmarks`
				let body = { text: await this.parseVariablesInString(action.options.markertext) }

				// Send request
				try {
					await this.sendRequest(type, url, body)
					this.log('info', 'marker successful sent: ' + body.text)
				} catch (error) {
					this.log('error', 'marker could not be set')
				}
			},
		}
		actions['getLayoutData'] = {
			name: 'Get layout data',
			options: [
				{
					type: 'dropdown',
					id: 'channelIdlayoutId',
					label: 'Layout to get',
					choices: this.choicesChannelLayout(),
					default: this.firstId(this.choicesChannelLayout()),
				},
				{
					id: 'destination',
					type: 'custom-variable',
					label: 'Destination Variable',
				},
			],
			callback: async (action) => {
				if (typeof action.options.channelIdlayoutId !== 'string' || !action.options.channelIdlayoutId.includes('-')) {
					this.setStatus(
						InstanceStatus.UnknownWarning,
						'Channel and layout are not known! Please review your button config'
					)
					this.debug('channelIdlayoutId: ' + action.options.channelIdlayoutId)
					return
				}

				const [channelId, layoutId] = action.options.channelIdlayoutId.split('-')
				if (!this.state.channels[channelId]) {
					this.setStatus(
						InstanceStatus.UnknownWarning,
						'Action on non existing channel! Please review your button config'
					)
					this.log('error', 'Action on non existing channel: ' + channelId)
					return
				}
				if (!this.state.channels[channelId].layouts[layoutId]) {
					this.setStatus(
						InstanceStatus.UnknownWarning,
						'Action on non existing layout! Please review your button config'
					)
					this.log('error', 'Action on non existing layout ' + layoutId + ' on channel ' + channelId)
					return
				}

				//get the data
				const url = '/api/channels/' + channelId + '/layouts/' + layoutId + '/settings'
				try {
					const layoutData = JSON.stringify(await this.sendRequest('GET', url, {}))
					this.log(
						'debug',
						`Layout Data retrieved for Channel ${this.state.channels[channelId].name}, Layout ${this.state.channels[channelId].layouts[layoutId].name}:\n${layoutData}`
					)
					this.setCustomVariableValue(action.options.destination, layoutData)
				} catch (error) {
					this.log('error', 'Layout data could not be retrieved or stored')
				}
			},
		}
		actions['setLayoutData'] = {
			name: 'Set layout data',
			options: [
				{
					type: 'dropdown',
					id: 'channelIdlayoutId',
					label: 'Layout to set',
					choices: this.choicesChannelLayout(),
					default: this.firstId(this.choicesChannelLayout()),
				},
				{
					id: 'source',
					type: 'textinput',
					label: 'Layout Data',
					useVariables: true,
					default: '{}',
					tooltip:
						'this text needs to hold a JSON-string describing a Pearl layout, you can retrieve a valid string with the according get action, variables are allowed in this option',
				},
			],
			callback: async (action) => {
				if (typeof action.options.channelIdlayoutId !== 'string' || !action.options.channelIdlayoutId.includes('-')) {
					this.setStatus(
						InstanceStatus.UnknownWarning,
						'Channel and layout are not known! Please review your button config'
					)
					this.debug('channelIdlayoutId: ' + action.options.channelIdlayoutId)
					return
				}

				const [channelId, layoutId] = action.options.channelIdlayoutId.split('-')
				if (!this.state.channels[channelId]) {
					this.setStatus(
						InstanceStatus.UnknownWarning,
						'Action on non existing channel! Please review your button config'
					)
					this.log('error', 'Action on non existing channel: ' + channelId)
					return
				}
				if (!this.state.channels[channelId].layouts[layoutId]) {
					this.setStatus(
						InstanceStatus.UnknownWarning,
						'Action on non existing layout! Please review your button config'
					)
					this.log('error', 'Action on non existing layout ' + layoutId + ' on channel ' + channelId)
					return
				}

				//set the data
				const url = '/api/channels/' + channelId + '/layouts/' + layoutId + '/settings'
				let body = {}
				try {
					body = JSON.parse(await this.parseVariablesInString(action.options.source))
				} catch (error) {
					this.log('error', 'Option is no valid JSON')
					return
				}
                               try {
                                       await this.sendRequest('PUT', url, body)
                               } catch (error) {
                                       this.log('error', 'Layout data could not be sent')
                               }
                       },
               }

               actions['getChannelMetadata'] = {
                        name: 'Get channel metadata',
                        options: [
                                {
                                        type: 'dropdown',
                                        id: 'channel',
                                        label: 'Channel',
                                        choices: this.choicesChannel(),
                                        default: this.firstId(this.choicesChannel()),
                                },
                                {
                                        id: 'destination',
                                        type: 'custom-variable',
                                        label: 'Destination Variable',
                                },
                        ],
                        callback: async (action) => {
                                const channelId = action.options.channel
                                if (!this.state.channels[channelId]) return
                                try {
                                        const text = await this.sendLegacyGetRequest(
                                                `/admin/channel${channelId}/get_params.cgi?rec_prefix&title&author&copyright&comment&description`
                                        )
                                        const data = this.parseMetadataResponse(text)
                                        this.state.channels[channelId].metadata = data
                                        this.setCustomVariableValue(action.options.destination, JSON.stringify(data))
                                        this.updateVariables()
                                } catch (error) {
                                        this.log('error', 'Metadata could not be retrieved')
                                }
                        },
                }

               actions['setChannelMetadata'] = {
                        name: 'Set channel metadata',
                        options: [
                                {
                                        type: 'dropdown',
                                        id: 'channel',
                                        label: 'Channel',
                                        choices: this.choicesChannel(),
                                        default: this.firstId(this.choicesChannel()),
                                },
                                { id: 'title', type: 'textinput', label: 'Title', useVariables: true, default: '' },
                                { id: 'author', type: 'textinput', label: 'Author', useVariables: true, default: '' },
                                { id: 'copyright', type: 'textinput', label: 'Copyright', useVariables: true, default: '' },
                                { id: 'comment', type: 'textinput', label: 'Comment', useVariables: true, default: '' },
                                { id: 'rec_prefix', type: 'textinput', label: 'Filename Prefix', useVariables: true, default: '' },
                        ],
                        callback: async (action) => {
                                const channelId = action.options.channel
                                if (!this.state.channels[channelId]) return
                                const params = new URLSearchParams()
                                const keys = ['title', 'author', 'copyright', 'comment', 'rec_prefix']
                                for (const k of keys) {
                                        const val = await this.parseVariablesInString(action.options[k])
                                        if (val) params.append(k, val)
                                }
                                if ([...params.keys()].length === 0) return
                                try {
                                        await this.sendLegacyGetRequest(
                                                `/admin/channel${channelId}/set_params.cgi?` + params.toString()
                                        )
                                } catch (error) {
                                        this.log('error', 'Metadata could not be set')
                                }
                        },
                }






                actions['rebootSystem'] = {
                        name: 'Reboot System',
                        options: [],
                        callback: () => {
                                this.sendRequest('post', '/api/system/reboot', {})
                        },
                }

                actions['shutdownSystem'] = {
                        name: 'Shutdown System',
                        options: [],
                        callback: () => {
                                this.sendRequest('post', '/api/system/shutdown', {})
                        },
                }

                return actions
        },
}
