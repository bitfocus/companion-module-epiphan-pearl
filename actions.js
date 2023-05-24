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
		const startStopOption = {
			type: 'dropdown',
			id: 'startStopAction',
			label: 'Action',
			choices: this.CHOICES_STARTSTOP,
			default: this.CHOICES_STARTSTOP[0].id,
		}

		// Companion has difficulties with the first 'default' selected value.
		let channels = [{ id: '0-0', label: '---' }]
		Array.prototype.push.apply(channels, this.CHOICES_CHANNELS_LAYOUTS)

		let publishers = [{ id: '0-0', label: '---' }]
		Array.prototype.push.apply(publishers, this.CHOICES_CHANNELS_PUBLISHERS)

		let recorders = [{ id: '0', label: '---' }]
		Array.prototype.push.apply(recorders, this.CHOICES_RECORDERS)

		const actions = {}
		actions['channelChangeLayout'] = {
			name: 'Change channel layout',
			options: [
				{
					type: 'dropdown',
					id: 'channelIdlayoutId',
					label: 'Change layout to:',
					choices: channels,
					default: channels[0].id,
				},
			],
			callback: (action) => {
				let type = 'get',
					url,
					body,
					callback

				if (!action.options.channelIdlayoutId || !action.options.channelIdlayoutId.includes('-')) {
					this._setStatus(
						InstanceStatus.UnknownWarning,
						'Channel and layout are not known! Please review your button config'
					)
					this.debug('channelIdlayoutId: ' + action.options.channelIdlayoutId)
					return
				}

				const [channelId, layoutId] = action.options.channelIdlayoutId.split('-')
				if (!this._getChannelById(channelId)) {
					this._setStatus(
						InstanceStatus.UnknownWarning,
						'Action on non existing channel! Please review your button config'
					)
					this.log('error', 'Action on non existing channel: ' + channelId)
					return
				}
				if (!this._checkValidLayoutId(channelId, layoutId)) {
					this._setStatus(
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
						this._updateActiveChannelLayout(channelId, layoutId)
					}
				}

				// Send request
				this._sendRequest(type, url, body).then(callback)
			},
		}

		actions['channelStreaming'] = {
			name: 'Start/stop streaming',
			options: [
				{
					type: 'dropdown',
					label: 'Channel publishers',
					id: 'channelIdpublisherId',
					choices: publishers,
					default: publishers[0].id,
					tooltip:
						'If a channel has only one "publisher" or "stream" then you just select all. Else you can pick the "publisher" you want to start/stop',
				},
				startStopOption,
			],
			callback: (action) => {
				let type = 'get',
					url,
					body,
					callback

				if (!action.options.channelIdpublisherId || !action.options.channelIdpublisherId.includes('-')) {
					this._setStatus(
						InstanceStatus.UnknownWarning,
						'Channel and Publisher are not known! Please review your button config'
					)
					this.debug('Undefined channelIdpublisherId ... ' + action.options.channelIdpublisherId)
					return
				}

				const [channelId, publishersId] = action.options.channelIdpublisherId.split('-')
				if (!this._getChannelById(channelId)) {
					this._setStatus(
						InstanceStatus.UnknownWarning,
						'Action on non existing channel! Please review your button config.'
					)
					this.log('error', 'Action on non existing channel: ' + channelId)
					return
				}
				if (publishersId !== 'all' && !this._checkValidPublisherId(channelId, publishersId)) {
					this._setStatus(
						InstanceStatus.UnknownWarning,
						'Action on non existing publisher! Please review your button config.'
					)
					this.log('error', 'Action on non existing publisher ' + publishersId + ' on channel ' + channelId)
					return
				}

				const startStopAction = this._getStartStopActionFromOptions(action.options)
				if (startStopAction === null) {
					this._setStatus(InstanceStatus.UnknownWarning, 'Called an unknown action! Please review your button config.')
					this.log('error', 'Called an unknown action: ' + action.options.startStopAction)
					return
				}

				type = 'post'
				if (publishersId !== 'all') {
					url = '/api/channels/' + channelId + '/publishers/' + publishersId + '/control/' + startStopAction
				} else {
					url = '/api/channels/' + channelId + '/publishers/control/' + startStopAction
				}

				// Send request
				this._sendRequest(type, url, body).then(callback)
			},
		}

		actions['recorderRecording'] = {
			name: 'Control recording',
			options: [
				{
					type: 'dropdown',
					label: 'Recorder',
					id: 'recorderId',
					choices: this.CHOICES_RECORDERS,
					default: this.CHOICES_RECORDERS.length > 0 ? this.CHOICES_RECORDERS[0].id : '',
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
				if (!this._getRecorderById(recorderId)) {
					this._setStatus(
						InstanceStatus.UnknownWarning,
						'Action on non existing recorder! Please review your button config.'
					)
					this.log('error', 'Action on non existing recorder ' + recorderId)
					return
				}

				const startStopAction = action.options.startStopAction
				if (startStopAction === 0) {
					url = `/api/recorders/${recorderId}/control/stop`
				} else if (startStopAction === 1) {
					url = `/api/recorders/${recorderId}/control/start`
				} else if (startStopAction === 2) {
					url = `/api/recorders/${recorderId}/control/reset`
				} else if (startStopAction === 99) {
					return
				} else {
					this._setStatus(InstanceStatus.UnknownWarning, 'Called an unknown action! Please review your button config.')
					this.log('error', 'Called an unknown action: ' + action.options.startStopAction)
					return
				}

				callback = async (response) => {
					if (response && response.status === 'ok') {
						await this._updateRecorderStatus(recorderId)
					}
				}
				// Send request
				this._sendRequest(type, url, body).then(callback)
			},
		}
		return actions
	},
}
