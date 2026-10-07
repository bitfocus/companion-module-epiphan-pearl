const { InstanceStatus } = require('@companion-module/base')
const http = require('http')

// use global fetch provided by Node 18+
if (typeof global.fetch !== 'function') {
	throw new Error('Global fetch API is not available. Please use Node 18 or newer')
}
const fetchFunc = global.fetch

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

				if (
					typeof action.options.channelIdlayoutId !== 'string' ||
					!action.options.channelIdlayoutId.includes('-')
				) {
					this.setStatus(
						InstanceStatus.UnknownWarning,
						'Channel and layout are not known! Please review your button config',
					)
					// Fix: InstanceBase has no debug() method, use log()
					this.log('debug', 'channelIdlayoutId: ' + action.options.channelIdlayoutId)
					return
				}

				const [channelId, layoutId] = action.options.channelIdlayoutId.split('-')
				if (!this.state.channels[channelId]) {
					this.setStatus(
						InstanceStatus.UnknownWarning,
						'Action on non existing channel! Please review your button config',
					)
					this.log('error', 'Action on non existing channel: ' + channelId)
					return
				}
				if (!this.state.channels[channelId].layouts[layoutId]) {
					this.setStatus(
						InstanceStatus.UnknownWarning,
						'Action on non existing layout! Please review your button config',
					)
					this.log('error', 'Action on non existing layout ' + layoutId + ' on channel ' + channelId)
					return
				}

				type = 'put'
				url = '/api/channels/' + channelId + '/layouts/active'
				if (this.usesApiV2()) {
					// API v2.0 expects the layout id as query parameter instead of a JSON body
					url += '?id=' + encodeURIComponent(layoutId)
				} else {
					body = { id: Number(layoutId) }
				}
				callback = (response) => {
					if (response && response.status === 'ok') {
						// return the promise so a failing refresh is caught below
						return this.updateActiveChannelLayout(channelId)
					}
				}

				// Send request
				// Fix: sendRequest() throws on any failure, without catch this was an unhandled promise rejection
				this.sendRequest(type, url, body)
					.then(callback)
					.catch((error) => this.log('error', 'Layout could not be changed: ' + error.message))
			},
		}

		actions['controlStreaming'] = {
			name: 'Control streaming',
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
						'Channel or Publisher are not valid! Please review your button config',
					)
					// Fix: InstanceBase has no debug() method, use log()
					this.log('debug', 'Undefined channelIdpublisherId ... ' + action.options.channelIdpublisherId)
					return
				}

				const [channelId, publisherId] = action.options.channelIdpublisherId.split('-')
				if (!this.state.channels[channelId]) {
					this.setStatus(
						InstanceStatus.UnknownWarning,
						'Action on non existing channel! Please review your button config.',
					)
					this.log('error', 'Action on non existing channel: ' + channelId)
					return
				}
				if (publisherId !== 'all' && !this.state.channels[channelId].publishers[publisherId]) {
					this.setStatus(
						InstanceStatus.UnknownWarning,
						'Action on non existing publisher! Please review your button config.',
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
					// Fix: status is missing if the publisher status request failed, use optional chaining
					if (publisherId !== 'all') {
						isStreaming = channel.publishers[publisherId].status?.state === 'started'
					} else {
						// if we should toggle all, check if there is at least one not streaming and then turn it on
						isStreaming = !Object.keys(channel.publishers)
							.map((id) => channel.publishers[id].status?.state)
							.some((state) => state !== 'started')
					}
					startStopAction = isStreaming ? 'stop' : 'start'
				}

				if (publisherId !== 'all') {
					url = '/api/channels/' + channelId + '/publishers/' + publisherId + '/control/' + startStopAction
				} else {
					url = '/api/channels/' + channelId + '/publishers/control/' + startStopAction
				}

				// the publishers whose state has to reach the target of the command
				const publisherIds =
					publisherId === 'all' ? Object.keys(this.state.channels[channelId].publishers) : [publisherId]
				const command = startStopAction

				// Send request
				// Fix: catch request errors to avoid an unhandled promise rejection
				this.sendRequest(type, url, body)
					.then(() =>
						// Fix: the streaming feedback only changed with the next regular poll before
						this.followUpState(
							() => this.updatePublisherStatus(channelId),
							() =>
								publisherIds.every((id) =>
									this.constructor.stateReached(
										this.state.channels[channelId]?.publishers[id]?.status?.state,
										command,
									),
								),
						),
					)
					.catch((error) => this.log('error', 'Streaming could not be controlled: ' + error.message))
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
						'Action on non existing recorder! Please review your button config.',
					)
					this.log('warn', 'Action on non existing recorder ' + recorderId)
					return
				}

				const requestOptions = {}
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
					// API v2.0 has no reset command, so this always uses the v1 API
					requestOptions.legacy = true
				} else if (startStopAction === 99) {
					return
				} else {
					this.setStatus(
						InstanceStatus.UnknownWarning,
						'Called an unknown action! Please review your button config.',
					)
					this.log('error', 'Called an unknown action: ' + action.options.startStopAction)
					return
				}

				// Fix: a single refresh right after the command usually still returned the old state, so
				// the recording feedback only changed with the next regular poll. Now the state is asked
				// for repeatedly until the Pearl reports it. A reset has no fixed target state, there it is
				// enough that the recorder is no longer starting.
				const command = startStopAction === 0 ? 'stop' : startStopAction === 1 ? 'start' : undefined
				callback = () =>
					this.followUpState(
						() => this.updateRecorderStatus(),
						() => {
							const state = this.state.recorders[recorderId]?.status?.state
							return command ? this.constructor.stateReached(state, command) : state !== 'starting'
						},
					)
				// Send request
				// Fix: catch request errors to avoid an unhandled promise rejection
				this.sendRequest(type, url, body, requestOptions)
					.then(callback)
					.catch((error) => this.log('error', 'Recorder could not be controlled: ' + error.message))
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
				// module-base 2.x: Companion already replaced the variables in options with useVariables
				const text = action.options.markertext
				let body = {}
				if (this.usesApiV2()) {
					// API v2.0 expects the text as query parameter instead of a JSON body
					url += '?text=' + encodeURIComponent(text)
				} else {
					body = { text }
				}

				// Send request
				try {
					await this.sendRequest(type, url, body)
					this.log('info', 'marker successful sent: ' + text)
				} catch (error) {
					// the reason matters here, e.g. the Pearl refuses markers if the channel is not recording
					this.log('error', 'marker could not be set: ' + error.message)
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
			],
			// module-base 2.x: the 'custom-variable' option is deprecated, the action returns the layout data
			// as result instead and the user chooses in Companion where to store it. Existing buttons are
			// converted by an upgrade script (see upgrades.js).
			hasResult: true,
			callback: async (action) => {
				if (
					typeof action.options.channelIdlayoutId !== 'string' ||
					!action.options.channelIdlayoutId.includes('-')
				) {
					this.setStatus(
						InstanceStatus.UnknownWarning,
						'Channel and layout are not known! Please review your button config',
					)
					// Fix: InstanceBase has no debug() method, use log()
					this.log('debug', 'channelIdlayoutId: ' + action.options.channelIdlayoutId)
					return
				}

				const [channelId, layoutId] = action.options.channelIdlayoutId.split('-')
				if (!this.state.channels[channelId]) {
					this.setStatus(
						InstanceStatus.UnknownWarning,
						'Action on non existing channel! Please review your button config',
					)
					this.log('error', 'Action on non existing channel: ' + channelId)
					return
				}
				if (!this.state.channels[channelId].layouts[layoutId]) {
					this.setStatus(
						InstanceStatus.UnknownWarning,
						'Action on non existing layout! Please review your button config',
					)
					this.log('error', 'Action on non existing layout ' + layoutId + ' on channel ' + channelId)
					return
				}

				//get the data
				const url = '/api/channels/' + channelId + '/layouts/' + layoutId + '/settings'
				try {
					// API v2.0 has no layout settings, so this always uses the v1 API
					const layoutData = JSON.stringify(await this.sendRequest('GET', url, {}, { legacy: true }))
					this.log(
						'debug',
						`Layout Data retrieved for Channel ${this.state.channels[channelId].name}, Layout ${this.state.channels[channelId].layouts[layoutId].name}:\n${layoutData}`,
					)
					return layoutData
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
				if (
					typeof action.options.channelIdlayoutId !== 'string' ||
					!action.options.channelIdlayoutId.includes('-')
				) {
					this.setStatus(
						InstanceStatus.UnknownWarning,
						'Channel and layout are not known! Please review your button config',
					)
					// Fix: InstanceBase has no debug() method, use log()
					this.log('debug', 'channelIdlayoutId: ' + action.options.channelIdlayoutId)
					return
				}

				const [channelId, layoutId] = action.options.channelIdlayoutId.split('-')
				if (!this.state.channels[channelId]) {
					this.setStatus(
						InstanceStatus.UnknownWarning,
						'Action on non existing channel! Please review your button config',
					)
					this.log('error', 'Action on non existing channel: ' + channelId)
					return
				}
				if (!this.state.channels[channelId].layouts[layoutId]) {
					this.setStatus(
						InstanceStatus.UnknownWarning,
						'Action on non existing layout! Please review your button config',
					)
					this.log('error', 'Action on non existing layout ' + layoutId + ' on channel ' + channelId)
					return
				}

				//set the data
				const url = '/api/channels/' + channelId + '/layouts/' + layoutId + '/settings'
				let body = {}
				try {
					// module-base 2.x: Companion already replaced the variables in options with useVariables
					body = JSON.parse(action.options.source)
				} catch (error) {
					this.log('error', 'Option is no valid JSON')
					return
				}
				try {
					// API v2.0 has no layout settings, so this always uses the v1 API
					await this.sendRequest('PUT', url, body, { legacy: true })
				} catch (error) {
					this.log('error', 'Layout data could not be sent')
				}
			},
		}

		actions['systemReboot'] = {
			name: 'Reboot system',
			options: [],
			callback: () => {
				// Fix: catch request errors to avoid an unhandled promise rejection
				this.sendRequest('post', '/api/system/control/reboot', {}).catch((error) =>
					this.log('error', 'System reboot failed: ' + error.message),
				)
			},
		}

		actions['systemShutdown'] = {
			name: 'Shutdown system',
			options: [],
			callback: () => {
				// Fix: catch request errors to avoid an unhandled promise rejection
				this.sendRequest('post', '/api/system/control/shutdown', {}).catch((error) =>
					this.log('error', 'System shutdown failed: ' + error.message),
				)
			},
		}

		actions['getContentMetadata'] = {
			name: 'Get Content Metadata',
			options: [
				{
					type: 'dropdown',
					label: 'Channel',
					id: 'channel',
					choices: this.choicesChannel(),
					default: this.firstId(this.choicesChannel()),
				},
			],
			callback: async (action) => {
				const channel = action.options.channel
				if (this.config.verbose) {
					this.log('debug', `Action get metadata for channel ${channel}`)
				}
				await this.fetchMetadata(channel)
			},
		}

		actions['setContentMetadata'] = {
			name: 'Set Content Metadata',
			options: [
				{
					type: 'dropdown',
					label: 'Channel',
					id: 'channel',
					choices: this.choicesChannel(),
					default: this.firstId(this.choicesChannel()),
				},
				{
					id: 'title',
					type: 'textinput',
					label: 'Title',
					default: '',
					useVariables: true,
				},
				{
					id: 'author',
					type: 'textinput',
					label: 'Author',
					default: '',
					useVariables: true,
				},
				{
					id: 'prefix',
					type: 'textinput',
					label: 'Filename Prefix',
					default: '',
					useVariables: true,
				},
			],
			callback: async (action) => {
				const channel = action.options.channel
				const apiHost = this.config.host
				const apiPort = this.config.host_port
				// module-base 2.x: Companion already replaced the variables in options with useVariables
				const titleRaw = action.options.title
				const authorRaw = action.options.author
				const prefixRaw = action.options.prefix
				// same validation as when reading the metadata, the channel id becomes part of the URL path
				if (!/^[a-zA-Z0-9_-]+$/.test(String(channel))) {
					this.log('error', `Invalid channel: ${channel}`)
					return
				}
				// encodeURIComponent encodes spaces as %20, which every CGI understands, unlike the '+' of URLSearchParams
				const query = [
					['title', titleRaw],
					['author', authorRaw],
					['rec_prefix', prefixRaw],
				]
					.map(([key, value]) => `${key}=${encodeURIComponent(value ?? '')}`)
					.join('&')
				const url = `http://${apiHost}:${apiPort}/admin/channel${channel}/set_params.cgi?${query}`
				if (this.config.verbose) {
					this.log('debug', `Action set metadata for channel ${channel}`)
				}
				try {
					const response = await fetchFunc(url, {
						method: 'GET',
						// Fix: without a timeout the action never finishes if the device is unreachable
						signal: AbortSignal.timeout(3000),
						headers: {
							Authorization:
								'Basic ' +
								Buffer.from(this.config.username + ':' + this.config.password).toString('base64'),
						},
					})
					// Fix: the values were stored locally even if the Pearl rejected them
					if (!response.ok) {
						throw new Error(http.STATUS_CODES[response.status])
					}
					// read the values back, so the variables show what the Pearl actually stored
					await this.fetchMetadata(channel)
				} catch (e) {
					this.log('error', 'Failed to set metadata: ' + e.message)
				}
			},
		}

		return actions
	},
}
