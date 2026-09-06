const variables = require('./variables')
const { splitPair, parseJsonOption, nonBlank } = require('./utils')
const { gainPatch, delayPatch, GAIN_MIN, GAIN_MAX, DELAY_MIN, DELAY_MAX } = require('./audio')

const JSON_TOOLTIP_SUFFIX = ' See the examples in doc/pearl-api-v2.0.yaml. Variables are allowed.'

const CHOICES_ENABLE_DISABLE = [
	{ id: 'true', label: 'Enable' },
	{ id: 'false', label: 'Disable' },
]
const CHOICES_ON_OFF = [
	{ id: 'true', label: 'On' },
	{ id: 'false', label: 'Off' },
]
const CHOICES_MUTE = [
	{ id: 'true', label: 'Mute' },
	{ id: 'false', label: 'Unmute' },
]
const CHOICES_START_STOP = [
	{ id: 'start', label: 'Start' },
	{ id: 'stop', label: 'Stop' },
]
const SRT_MODE_UNCHANGED = 'unchanged'
const CHOICES_SRT_MODE = [
	{ id: SRT_MODE_UNCHANGED, label: 'Unchanged (keep current mode)' },
	{ id: 'caller', label: 'Caller' },
	{ id: 'listener', label: 'Listener' },
	{ id: 'rendezvous', label: 'Rendezvous' },
]
const CHOICES_NETWORK_INPUT_TYPE = [
	{ id: 'rtsp', label: 'RTSP' },
	{ id: 'srt', label: 'SRT' },
	{ id: 'ndi', label: 'NDI' },
	{ id: 'web-graphics', label: 'Web graphics' },
	{ id: 'dante', label: 'Dante' },
]
const CHOICES_PRESET_SECTIONS = [
	{ id: 'system', label: 'System' },
	{ id: 'network', label: 'Network' },
	{ id: 'sources', label: 'Sources' },
	{ id: 'edid', label: 'EDID' },
	{ id: 'channels', label: 'Channels' },
	{ id: 'afu', label: 'AFU' },
	{ id: 'cms', label: 'CMS' },
	{ id: 'avstudio', label: 'AV Studio' },
	{ id: 'frontscreen', label: 'Front screen' },
	{ id: 'displays', label: 'Displays' },
]
const CHOICES_EVENT_ACTION = [
	{ id: 'start', label: 'Start' },
	{ id: 'stop', label: 'Stop' },
	{ id: 'pause', label: 'Pause' },
	{ id: 'resume', label: 'Resume' },
]

const enc = (v) => encodeURIComponent(String(v))
const errMsg = (e) => (e && e.message ? e.message : String(e))
const isTrue = (v) => v === true || v === 'true'
const toInt = (v, fallback) => {
	const n = Number.parseInt(v, 10)
	return Number.isFinite(n) ? n : fallback
}

/**
 * Body for `PATCH /inputs/{sid}/settings` that mutes or unmutes an input.
 *
 * The InputSettings schema in doc/pearl-api-v2.0.yaml nests the audio settings of HDMI and SDI
 * inputs under `hdmi.audio.mute` (HdmiInputSettings) and `sdi.audio.mute` (SdiInputSettings), while
 * analog, USB and network inputs use `local_audio.mute`. The input type is derived from the input id
 * (e.g. `hdmi-a`, `D2P0.sdi-b`).
 *
 * @param {string} sid input id
 * @param {boolean} mute
 * @returns {object} request body
 */
function audioMuteBody(sid, mute) {
	const id = String(sid).toLowerCase()
	if (id.includes('hdmi')) return { hdmi: { audio: { mute } } }
	if (id.includes('sdi')) return { sdi: { audio: { mute } } }
	return { local_audio: { mute } }
}

module.exports = {
	/**
	 * Build all action definitions.
	 *
	 * @returns {Object} the action definitions
	 */
	getActions() {
		const actions = {}

		/**
		 * Wrap an action callback so it never throws and always logs failures.
		 */
		const wrap = (label, fn) => async (action, context) => {
			try {
				await fn(action, context)
			} catch (e) {
				this.log('error', `${label} failed: ${errMsg(e)}`)
			}
		}

		/** Returns true when the device speaks API v2.0, otherwise logs and returns false. */
		const requireV2 = (label) => {
			if (this.isV2) return true
			this.log(
				'warn',
				`${label}: this action needs the Pearl REST API v2.0 (firmware 4.24.1 or newer with "Use API v2.0" enabled)`,
			)
			return false
		}

		const parse = async (value) => this.parseVariablesInString(String(value ?? ''))

		const parseJson = async (label, optionLabel, value) => {
			const text = await parse(value)
			try {
				return parseJsonOption(text)
			} catch (e) {
				this.log('error', `${label}: option "${optionLabel}" is not valid JSON: ${errMsg(e)}`)
				return null
			}
		}

		/** Split a "cid-lid" option and validate it against state. Returns [cid, lid] or null. */
		const parseLayout = (label, value) => {
			const pair = splitPair(value)
			if (!pair) {
				this.log(
					'error',
					`${label}: channel and layout are not known, please review your button config (${value})`,
				)
				return null
			}
			const [cid, lid] = pair
			if (!this.state.channels[cid]) {
				this.log('error', `${label}: action on non existing channel ${cid}`)
				return null
			}
			if (!this.state.channels[cid].layouts?.[lid]) {
				this.log('error', `${label}: action on non existing layout ${lid} on channel ${cid}`)
				return null
			}
			return [cid, lid]
		}

		/** Validate a channel option against state. Returns the channel id as string or null. */
		const parseChannel = (label, value) => {
			const cid = value === undefined || value === null ? '' : String(value)
			if (!cid) {
				this.log('error', `${label}: no channel selected`)
				return null
			}
			if (!this.state.channels[cid]) {
				this.log('error', `${label}: unknown channel ${cid}`)
				return null
			}
			return cid
		}

		/** Split a "cid-pid" (or "cid-all") option and validate it. Returns [cid, pid] or null. */
		const parsePublisher = (label, value, allowAll) => {
			const pair = splitPair(value)
			if (!pair) {
				this.log(
					'error',
					`${label}: channel or publisher are not valid, please review your button config (${value})`,
				)
				return null
			}
			const [cid, pid] = pair
			if (!this.state.channels[cid]) {
				this.log('error', `${label}: action on non existing channel ${cid}`)
				return null
			}
			if (pid === 'all') {
				if (!allowAll) {
					this.log('error', `${label}: "all publishers" is not supported here, pick a single publisher`)
					return null
				}
			} else if (!this.state.channels[cid].publishers?.[pid]) {
				this.log('error', `${label}: action on non existing publisher ${pid} on channel ${cid}`)
				return null
			}
			return [cid, pid]
		}

		/** Resolve the event alias/custom id option pair into an event id (or null). */
		const resolveEventId = async (label, options) => {
			let id = options.event
			if (id === 'custom') id = (await parse(options.eventId)).trim()
			if (!id) {
				this.log('error', `${label}: no event selected`)
				return null
			}
			return id
		}

		const optChannel = (label = 'Channel') => ({
			type: 'dropdown',
			label,
			id: 'channel',
			choices: this.choicesChannel(),
			default: this.firstId(this.choicesChannel()),
		})
		const optPublisherOnly = () => ({
			type: 'dropdown',
			label: 'Publisher (stream)',
			id: 'channelIdpublisherId',
			choices: this.choicesChannelPublishersOnly(),
			default: this.firstId(this.choicesChannelPublishersOnly()),
		})
		const optInput = (choices) => ({
			type: 'dropdown',
			label: 'Input',
			id: 'input',
			choices,
			default: this.firstId(choices),
		})
		const optText = (id, label, extra = {}) => ({
			type: 'textinput',
			id,
			label,
			default: '',
			useVariables: true,
			...extra,
		})
		const optJson = (id, label, tooltip) => ({
			type: 'textinput',
			id,
			label,
			default: '{}',
			useVariables: true,
			tooltip: tooltip + JSON_TOOLTIP_SUFFIX,
		})
		const optEvent = () => [
			{
				type: 'dropdown',
				id: 'event',
				label: 'Event',
				choices: [...this.choicesEventAlias(), { id: 'custom', label: 'Custom event id (enter below)' }],
				default: 'ongoing',
			},
			optText('eventId', 'Event id', {
				tooltip: 'Event identifier as reported by the schedule (variable event_upcoming_id / event_ongoing_id)',
				isVisible: (options) => options.event === 'custom',
			}),
		]

		// ------------------------------------------------------------------
		// Existing actions (ids and option ids unchanged)
		// ------------------------------------------------------------------

		actions['channelChangeLayout'] = {
			name: 'Channel: change layout',
			options: [
				{
					type: 'dropdown',
					id: 'channelIdlayoutId',
					label: 'Change layout to:',
					choices: this.choicesChannelLayout(),
					default: this.firstId(this.choicesChannelLayout()),
				},
			],
			callback: wrap('Channel: change layout', async (action) => {
				const pair = parseLayout('Channel: change layout', action.options.channelIdlayoutId)
				if (!pair) return
				const [cid, lid] = pair
				// v1 wants the id in the body, v2 wants it as a query parameter; both accept both
				await this.request('PUT', `/channels/${enc(cid)}/layouts/active`, {
					query: { id: lid },
					body: { id: Number(lid) },
				})
				this.log('debug', `Activated layout ${lid} on channel ${cid}`)
				this.schedulePollSoon()
			}),
		}

		actions['controlStreaming'] = {
			name: 'Stream: start/stop',
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
			callback: wrap('Stream: start/stop', async (action) => {
				const pair = parsePublisher('Stream: start/stop', action.options.channelIdpublisherId, true)
				if (!pair) return
				const [cid, pid] = pair

				const selected = Number(action.options.startStopAction)
				if (selected === 99) return

				let verb = selected === 1 ? 'start' : 'stop'
				if (selected === 3) {
					const channel = this.state.channels[cid]
					let isStreaming
					if (pid !== 'all') {
						isStreaming = channel.publishers[pid]?.status?.state === 'started'
					} else {
						// toggle all: if at least one publisher is not streaming, start them all
						const states = Object.values(channel.publishers || {}).map((p) => p?.status?.state)
						isStreaming = states.length > 0 && !states.some((s) => s !== 'started')
					}
					verb = isStreaming ? 'stop' : 'start'
				}

				const path =
					pid !== 'all'
						? `/channels/${enc(cid)}/publishers/${enc(pid)}/control/${verb}`
						: `/channels/${enc(cid)}/publishers/control/${verb}`
				await this.request('POST', path)
				this.schedulePollSoon()
			}),
		}

		actions['recorderRecording'] = {
			name: 'Recorder: start/stop/reset',
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
			callback: wrap('Recorder: start/stop/reset', async (action) => {
				const rid = action.options.recorderId
				if (!this.state.recorders[rid]) {
					this.log('warn', `Recorder: start/stop/reset: action on non existing recorder ${rid}`)
					return
				}

				let selected = Number(action.options.startStopAction)
				if (selected === 99) return
				if (selected === 3) {
					selected = this.state.recorders[rid]?.status?.state === 'started' ? 0 : 1
				}

				if (selected === 0) {
					await this.request('POST', `/recorders/${enc(rid)}/control/stop`)
				} else if (selected === 1) {
					await this.request('POST', `/recorders/${enc(rid)}/control/start`)
				} else if (selected === 2) {
					// reset only exists in the legacy API
					await this.request('POST', `/recorders/${enc(rid)}/control/reset`, { base: 'v1' })
				} else {
					this.log('error', `Recorder: start/stop/reset: unknown action ${action.options.startStopAction}`)
					return
				}
				this.schedulePollSoon()
			}),
		}

		actions['insertMarker'] = {
			name: 'Recorder: insert marker (bookmark)',
			description: 'Adds a bookmark to the recording of the channel. Only works while recording to MP4/MOV.',
			options: [
				optChannel(),
				{
					type: 'textinput',
					id: 'markertext',
					label: 'Marker text',
					useVariables: true,
					default: '',
					tooltip: 'You can use variables in this field like current time',
				},
			],
			callback: wrap('Recorder: insert marker', async (action) => {
				const cid = parseChannel('Recorder: insert marker', action.options.channel)
				if (!cid) return
				const text = await parse(action.options.markertext)
				// v2 wants the text as a query parameter, v1 in the body; send both
				await this.request('POST', `/channels/${enc(cid)}/bookmarks`, { query: { text }, body: { text } })
				this.log('info', `Marker successfully sent: ${text}`)
			}),
		}

		actions['getLayoutData'] = {
			name: 'Channel: get layout data',
			description: 'Reads the layout settings JSON into a custom variable',
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
			callback: wrap('Channel: get layout data', async (action) => {
				const pair = parseLayout('Channel: get layout data', action.options.channelIdlayoutId)
				if (!pair) return
				const [cid, lid] = pair
				const result = await this.request('GET', `/channels/${enc(cid)}/layouts/${enc(lid)}/settings`, {
					base: 'v1',
				})
				const layoutData = JSON.stringify(result)
				this.log(
					'debug',
					`Layout data retrieved for channel ${this.state.channels[cid].name}, layout ${this.state.channels[cid].layouts[lid].name}: ${layoutData}`,
				)
				this.setCustomVariableValue(action.options.destination, layoutData)
			}),
		}

		actions['setLayoutData'] = {
			name: 'Channel: set layout data',
			description: 'Writes a layout settings JSON (as produced by "Channel: get layout data") to the layout',
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
			callback: wrap('Channel: set layout data', async (action) => {
				const pair = parseLayout('Channel: set layout data', action.options.channelIdlayoutId)
				if (!pair) return
				const [cid, lid] = pair
				const body = await parseJson('Channel: set layout data', 'Layout Data', action.options.source)
				if (!body) return
				await this.request('PUT', `/channels/${enc(cid)}/layouts/${enc(lid)}/settings`, { base: 'v1', body })
				this.schedulePollSoon()
			}),
		}

		actions['systemReboot'] = {
			name: 'System: reboot',
			options: [],
			callback: wrap('System: reboot', async () => {
				await this.request('POST', '/system/control/reboot')
				this.log('info', 'Reboot requested')
			}),
		}

		actions['systemShutdown'] = {
			name: 'System: shutdown',
			options: [],
			callback: wrap('System: shutdown', async () => {
				await this.request('POST', '/system/control/shutdown')
				this.log('info', 'Shutdown requested')
			}),
		}

		actions['getContentMetadata'] = {
			name: 'Channel: get content metadata',
			description: 'Refreshes the channel_N_metadata_* variables (title, author, filename prefix)',
			options: [optChannel()],
			callback: wrap('Channel: get content metadata', async (action) => {
				const cid = parseChannel('Channel: get content metadata', action.options.channel)
				if (!cid) return
				if (this.config.verbose) this.log('debug', `Action get metadata for channel ${cid}`)
				await this.fetchMetadata(cid)
			}),
		}

		actions['setContentMetadata'] = {
			name: 'Channel: set content metadata',
			description: 'Sets recording title, author and filename prefix of the channel',
			options: [
				optChannel(),
				optText('title', 'Title'),
				optText('author', 'Author'),
				optText('prefix', 'Filename Prefix'),
			],
			callback: wrap('Channel: set content metadata', async (action) => {
				const cid = parseChannel('Channel: set content metadata', action.options.channel)
				if (!cid) return
				const title = await parse(action.options.title)
				const author = await parse(action.options.author)
				const rec_prefix = await parse(action.options.prefix)
				if (this.config.verbose) this.log('debug', `Action set metadata for channel ${cid}`)
				// legacy admin endpoint, answers text/plain
				await this.request('GET', `/admin/channel${enc(cid)}/set_params.cgi`, {
					base: 'raw',
					text: true,
					query: { title, author, rec_prefix },
				})
				// a fresh object: drops a failure marker (_failedAt/_attempts) left by fetchMetadata
				this.metadata[cid] = { title, author, rec_prefix }
				variables.updateVariables(this)
			}),
		}

		// ------------------------------------------------------------------
		// Recorders
		// ------------------------------------------------------------------

		actions['recorderControlAll'] = {
			name: 'Recorder: start/stop all recorders',
			options: [
				{
					type: 'dropdown',
					id: 'action',
					label: 'Action',
					choices: CHOICES_START_STOP,
					default: 'start',
				},
			],
			callback: wrap('Recorder: start/stop all', async (action) => {
				if (!requireV2('Recorder: start/stop all')) return
				const verb = action.options.action === 'stop' ? 'stop' : 'start'
				await this.request('POST', `/recorders/control/${verb}`)
				this.schedulePollSoon()
			}),
		}

		// ------------------------------------------------------------------
		// Channels / publishers
		// ------------------------------------------------------------------

		actions['setChannelName'] = {
			name: 'Channel: set name',
			options: [optChannel(), optText('name', 'New name')],
			callback: wrap('Channel: set name', async (action) => {
				if (!requireV2('Channel: set name')) return
				const cid = parseChannel('Channel: set name', action.options.channel)
				if (!cid) return
				const name = (await parse(action.options.name)).trim()
				if (!name) {
					this.log('error', 'Channel: set name: name must not be empty')
					return
				}
				await this.request('PUT', `/channels/${enc(cid)}/name`, { query: { name } })
				this.schedulePollSoon()
			}),
		}

		actions['setPublisherName'] = {
			name: 'Stream: set name',
			options: [optPublisherOnly(), optText('name', 'New name')],
			callback: wrap('Stream: set name', async (action) => {
				if (!requireV2('Stream: set name')) return
				const pair = parsePublisher('Stream: set name', action.options.channelIdpublisherId, false)
				if (!pair) return
				const [cid, pid] = pair
				const name = (await parse(action.options.name)).trim()
				if (!name) {
					this.log('error', 'Stream: set name: name must not be empty')
					return
				}
				await this.request('PUT', `/channels/${enc(cid)}/publishers/${enc(pid)}/name`, { query: { name } })
				this.schedulePollSoon()
			}),
		}

		actions['setPublisherEnabled'] = {
			name: 'Stream: enable/disable',
			description: 'Enables or disables the publisher (a disabled publisher is skipped by "start all")',
			options: [
				optPublisherOnly(),
				{
					type: 'dropdown',
					id: 'enabled',
					label: 'Enabled',
					choices: CHOICES_ENABLE_DISABLE,
					default: 'true',
				},
			],
			callback: wrap('Stream: enable/disable', async (action) => {
				if (!requireV2('Stream: enable/disable')) return
				const pair = parsePublisher('Stream: enable/disable', action.options.channelIdpublisherId, false)
				if (!pair) return
				const [cid, pid] = pair
				await this.request('PATCH', `/channels/${enc(cid)}/publishers/${enc(pid)}/settings`, {
					body: { common: { enabled: isTrue(action.options.enabled) } },
				})
				this.schedulePollSoon()
			}),
		}

		actions['setPublisherSingleTouch'] = {
			name: 'Stream: include in single touch control',
			description: 'Whether the publisher is started/stopped by the single touch (one touch) control',
			options: [
				optPublisherOnly(),
				{
					type: 'dropdown',
					id: 'single_touch',
					label: 'Single touch',
					choices: CHOICES_ENABLE_DISABLE,
					default: 'true',
				},
			],
			callback: wrap('Stream: single touch', async (action) => {
				if (!requireV2('Stream: single touch')) return
				const pair = parsePublisher('Stream: single touch', action.options.channelIdpublisherId, false)
				if (!pair) return
				const [cid, pid] = pair
				await this.request('PATCH', `/channels/${enc(cid)}/publishers/${enc(pid)}/settings`, {
					body: { common: { single_touch: isTrue(action.options.single_touch) } },
				})
				this.schedulePollSoon()
			}),
		}

		actions['setRtmpDestination'] = {
			name: 'Stream: set RTMP destination',
			description:
				'Updates URL, stream key and credentials of an RTMP publisher. Blank fields are left unchanged.',
			options: [
				optPublisherOnly(),
				optText('url', 'RTMP URL', { tooltip: 'e.g. rtmp://a.rtmp.youtube.com/live2 (blank = unchanged)' }),
				optText('stream', 'Stream name / key', { tooltip: 'blank = unchanged' }),
				optText('username', 'Username', { tooltip: 'blank = unchanged' }),
				optText('password', 'Password', { tooltip: 'blank = unchanged' }),
			],
			callback: wrap('Stream: set RTMP destination', async (action) => {
				if (!requireV2('Stream: set RTMP destination')) return
				const pair = parsePublisher('Stream: set RTMP destination', action.options.channelIdpublisherId, false)
				if (!pair) return
				const [cid, pid] = pair
				const rtmp = nonBlank({
					url: await parse(action.options.url),
					stream: await parse(action.options.stream),
					username: await parse(action.options.username),
					password: await parse(action.options.password),
				})
				if (Object.keys(rtmp).length === 0) {
					this.log('warn', 'Stream: set RTMP destination: all fields blank, nothing to change')
					return
				}
				await this.request('PATCH', `/channels/${enc(cid)}/publishers/${enc(pid)}/settings`, { body: { rtmp } })
				this.schedulePollSoon()
			}),
		}

		actions['setSrtDestination'] = {
			name: 'Stream: set SRT destination',
			description:
				'Updates mode, URL/port, stream id and latency of an SRT publisher. Mode "Unchanged" keeps the current mode; blank fields are left unchanged.',
			options: [
				optPublisherOnly(),
				{
					type: 'dropdown',
					id: 'mode',
					label: 'Mode',
					choices: CHOICES_SRT_MODE,
					default: SRT_MODE_UNCHANGED,
					tooltip:
						'Unchanged keeps the mode configured on the device and only sends the non-blank fields below',
				},
				optText('url', 'SRT URL', {
					tooltip: 'caller / rendezvous: e.g. srt://host:port (blank = unchanged)',
					isVisible: (options) => options.mode !== 'listener',
				}),
				optText('stream_id', 'Stream id', {
					tooltip: 'caller only (blank = unchanged)',
					isVisible: (options) => options.mode === 'caller' || options.mode === 'unchanged',
				}),
				optText('port', 'Listen port', {
					tooltip: 'listener only: 1024..65535 (blank = unchanged)',
					isVisible: (options) => options.mode === 'listener' || options.mode === 'unchanged',
				}),
				optText('latency', 'Latency (ms)', { tooltip: '80..8000 (blank = unchanged)' }),
			],
			callback: wrap('Stream: set SRT destination', async (action) => {
				if (!requireV2('Stream: set SRT destination')) return
				const pair = parsePublisher('Stream: set SRT destination', action.options.channelIdpublisherId, false)
				if (!pair) return
				const [cid, pid] = pair
				const mode = CHOICES_SRT_MODE.some((c) => c.id === action.options.mode)
					? action.options.mode
					: SRT_MODE_UNCHANGED
				const keepMode = mode === SRT_MODE_UNCHANGED
				const srt = {}
				if (!keepMode) srt.mode = mode

				if (keepMode || mode !== 'listener') {
					const url = (await parse(action.options.url)).trim()
					if (url) srt.url = url
				}
				if (keepMode || mode === 'caller') {
					const streamId = (await parse(action.options.stream_id)).trim()
					if (streamId) srt.stream_id = streamId
				}
				if (keepMode || mode === 'listener') {
					const portText = (await parse(action.options.port)).trim()
					if (portText) {
						const port = toInt(portText, NaN)
						if (!Number.isFinite(port) || port < 1024 || port > 65535) {
							this.log('error', `Stream: set SRT destination: invalid port "${portText}" (1024..65535)`)
							return
						}
						srt.port = port
					}
				}
				const latencyText = (await parse(action.options.latency)).trim()
				if (latencyText) {
					const latency = toInt(latencyText, NaN)
					if (!Number.isFinite(latency) || latency < 80 || latency > 8000) {
						this.log('error', `Stream: set SRT destination: invalid latency "${latencyText}" (80..8000)`)
						return
					}
					srt.latency = latency
				}
				if (Object.keys(srt).length === 0) {
					this.log(
						'warn',
						'Stream: set SRT destination: mode unchanged and all fields blank, nothing to change',
					)
					return
				}

				await this.request('PATCH', `/channels/${enc(cid)}/publishers/${enc(pid)}/settings`, { body: { srt } })
				this.schedulePollSoon()
			}),
		}

		actions['patchPublisherSettings'] = {
			name: 'Stream: patch settings (JSON)',
			description: 'Partially updates the publisher settings with an arbitrary JSON object',
			options: [
				optPublisherOnly(),
				optJson(
					'json',
					'Settings JSON',
					'Partial PublisherSettings object, e.g. {"rtmp":{"url":"rtmp://..."},"common":{"enabled":true}}.',
				),
			],
			callback: wrap('Stream: patch settings', async (action) => {
				if (!requireV2('Stream: patch settings')) return
				const pair = parsePublisher('Stream: patch settings', action.options.channelIdpublisherId, false)
				if (!pair) return
				const [cid, pid] = pair
				const body = await parseJson('Stream: patch settings', 'Settings JSON', action.options.json)
				if (!body) return
				await this.request('PATCH', `/channels/${enc(cid)}/publishers/${enc(pid)}/settings`, { body })
				this.schedulePollSoon()
			}),
		}

		actions['addPublisher'] = {
			name: 'Stream: add publisher',
			description: 'Creates a new publisher (stream) on the channel from a PublisherSettings JSON object',
			options: [
				optChannel(),
				optText('name', 'Name', { tooltip: 'Display name of the new publisher (optional)' }),
				optJson(
					'json',
					'Settings JSON',
					'PublisherSettings object; "type" is required, e.g. {"type":"rtmp","rtmp":{"url":"rtmp://...","stream":"key"},"common":{"enabled":true}}.',
				),
			],
			callback: wrap('Stream: add publisher', async (action) => {
				if (!requireV2('Stream: add publisher')) return
				const cid = parseChannel('Stream: add publisher', action.options.channel)
				if (!cid) return
				const settings = await parseJson('Stream: add publisher', 'Settings JSON', action.options.json)
				if (!settings) return
				if (!settings.type) {
					this.log(
						'error',
						'Stream: add publisher: settings JSON must contain a "type" (rtmp, srt, rtsp, hls, ndi, ...)',
					)
					return
				}
				// PublisherSettings requires common.enabled; a new publisher starts disabled unless told otherwise
				if (!settings.common || typeof settings.common !== 'object' || Array.isArray(settings.common)) {
					settings.common = { enabled: false, single_touch: false }
				}
				const name = (await parse(action.options.name)).trim()
				const body = { settings }
				if (name) body.name = name
				const result = await this.request('POST', `/channels/${enc(cid)}/publishers`, { body })
				this.log('info', `Publisher added on channel ${cid}: ${JSON.stringify(result)}`)
				this.schedulePollSoon()
			}),
		}

		// ------------------------------------------------------------------
		// Outputs
		// ------------------------------------------------------------------

		actions['setOutputSource'] = {
			name: 'Output: set source',
			description:
				'Selects what is shown on the output port: a channel, an input, the multi-viewer, device info or console',
			options: [
				{
					type: 'dropdown',
					id: 'output',
					label: 'Output',
					choices: this.choicesOutputs(),
					default: this.firstId(this.choicesOutputs()),
				},
				{
					type: 'dropdown',
					id: 'source',
					label: 'Source',
					choices: [...this.choicesOutputSources(), { id: 'custom', label: 'Custom (enter below)' }],
					default: this.firstId(this.choicesOutputSources()),
				},
				optText('customSource', 'Custom source', {
					tooltip: 'Channel id, input id, multiview, deviceinfo or console',
					isVisible: (options) => options.source === 'custom',
				}),
			],
			callback: wrap('Output: set source', async (action) => {
				if (!requireV2('Output: set source')) return
				const did = String(action.options.output ?? '')
				if (!did) {
					this.log('error', 'Output: set source: no output selected')
					return
				}
				let source = String(action.options.source ?? '')
				if (source === 'custom') source = (await parse(action.options.customSource)).trim()
				if (!source) {
					this.log('error', 'Output: set source: no source given')
					return
				}
				await this.request('PUT', `/outputs/${enc(did)}/settings`, { query: { source } })
				// optimistic update: the API has no way to read the current source back
				if (this.state.outputs?.[did]) {
					this.state.outputs[did].source = source
					variables.updateVariables(this)
					this.checkFeedbacks('outputSourceOptimistic')
				}
				this.schedulePollSoon()
			}),
		}

		// ------------------------------------------------------------------
		// Inputs
		// ------------------------------------------------------------------

		actions['inputAudioMute'] = {
			name: 'Input: audio mute',
			options: [
				optInput(this.choicesInputsWithAudio()),
				{
					type: 'dropdown',
					id: 'mute',
					label: 'Mute',
					choices: CHOICES_MUTE,
					default: 'true',
				},
			],
			callback: wrap('Input: audio mute', async (action) => {
				if (!requireV2('Input: audio mute')) return
				const sid = String(action.options.input ?? '')
				if (!sid) {
					this.log('error', 'Input: audio mute: no input selected')
					return
				}
				await this.request('PATCH', `/inputs/${enc(sid)}/settings`, {
					body: audioMuteBody(sid, isTrue(action.options.mute)),
				})
				this.schedulePollSoon()
			}),
		}

		actions['inputAudioGain'] = {
			name: 'Input: audio gain',
			description:
				'Sets the capture gain (dB or %, depending on the device). The current settings are read first: ' +
				'Both sets the stereo pair gain, or both channels when the input already has individual channel settings. ' +
				'Channel A/B switches the input to individual channel settings.',
			options: [
				optInput(this.choicesInputsWithAudio()),
				{
					type: 'number',
					id: 'gain',
					label: 'Gain',
					default: 0,
					min: GAIN_MIN,
					max: GAIN_MAX,
					step: 1,
				},
				{
					type: 'dropdown',
					id: 'channel',
					label: 'Audio channel',
					choices: [
						{ id: 'both', label: 'Both (stereo pair)' },
						{ id: 'A', label: 'Channel A only' },
						{ id: 'B', label: 'Channel B only' },
					],
					default: 'both',
				},
			],
			callback: wrap('Input: audio gain', async (action) => {
				if (!requireV2('Input: audio gain')) return
				const sid = String(action.options.input ?? '')
				if (!sid) {
					this.log('error', 'Input: audio gain: no input selected')
					return
				}
				const gain = Math.min(GAIN_MAX, Math.max(GAIN_MIN, toInt(action.options.gain, 0)))
				let body
				if (action.options.channel === 'A' || action.options.channel === 'B') {
					// Single channel: the body is built entirely from the option values, so no read is needed.
					body = {
						local_audio: {
							stereo_pair: false,
							channels: { [`channel${action.options.channel}`]: { gain } },
						},
					}
				} else {
					// Both: the existing settings decide whether this is a stereo pair or an unpaired input.
					const settings = await this.request('GET', `/inputs/${enc(sid)}/settings`)
					body = gainPatch(settings, gain)
					if (!body) {
						this.log('error', `Input: audio gain: input ${sid} has no gain setting`)
						return
					}
				}
				await this.request('PATCH', `/inputs/${enc(sid)}/settings`, { body })
				this.schedulePollSoon()
			}),
		}

		actions['inputAudioDelay'] = {
			name: 'Input: audio delay',
			description:
				'Sets the audio delay in milliseconds. The current settings are read first and the delay is written where ' +
				'the input keeps it (audio.delay, hdmi.audio.delay or sdi.audio.delay).',
			options: [
				optInput(this.choicesInputsWithAudio()),
				{
					type: 'number',
					id: 'delay',
					label: 'Delay (ms)',
					default: 0,
					min: DELAY_MIN,
					max: DELAY_MAX,
					step: 1,
				},
			],
			callback: wrap('Input: audio delay', async (action) => {
				if (!requireV2('Input: audio delay')) return
				const sid = String(action.options.input ?? '')
				if (!sid) {
					this.log('error', 'Input: audio delay: no input selected')
					return
				}
				const delay = Math.min(DELAY_MAX, Math.max(DELAY_MIN, toInt(action.options.delay, 0)))
				const settings = await this.request('GET', `/inputs/${enc(sid)}/settings`)
				const body = delayPatch(settings, delay)
				if (!body) {
					this.log('error', `Input: audio delay: input ${sid} has no audio delay setting`)
					return
				}
				await this.request('PATCH', `/inputs/${enc(sid)}/settings`, { body })
				this.schedulePollSoon()
			}),
		}

		actions['inputPhantomPower'] = {
			name: 'Input: phantom power (48V)',
			description: 'Only supported on XLR analog audio inputs (Pearl Mini, Pearl Nexus)',
			options: [
				optInput(this.choicesInputsWithAudio()),
				{
					type: 'dropdown',
					id: 'phantom_power',
					label: 'Phantom power',
					choices: CHOICES_ON_OFF,
					default: 'true',
				},
			],
			callback: wrap('Input: phantom power', async (action) => {
				if (!requireV2('Input: phantom power')) return
				const sid = String(action.options.input ?? '')
				if (!sid) {
					this.log('error', 'Input: phantom power: no input selected')
					return
				}
				await this.request('PATCH', `/inputs/${enc(sid)}/settings`, {
					body: { local_audio: { phantom_power: isTrue(action.options.phantom_power) } },
				})
				this.schedulePollSoon()
			}),
		}

		actions['patchInputSettings'] = {
			name: 'Input: patch settings (JSON)',
			description: 'Partially updates the input settings with an arbitrary JSON object',
			options: [
				optInput(this.choicesInputs()),
				optJson(
					'json',
					'Settings JSON',
					'Partial InputSettings object, e.g. {"video":{"nosignal":{"timeout":5}},"srt":{"mode":"listener","port":1025}}.',
				),
			],
			callback: wrap('Input: patch settings', async (action) => {
				if (!requireV2('Input: patch settings')) return
				const sid = String(action.options.input ?? '')
				if (!sid) {
					this.log('error', 'Input: patch settings: no input selected')
					return
				}
				const body = await parseJson('Input: patch settings', 'Settings JSON', action.options.json)
				if (!body) return
				await this.request('PATCH', `/inputs/${enc(sid)}/settings`, { body })
				this.schedulePollSoon()
			}),
		}

		actions['createNetworkInput'] = {
			name: 'Input: create network input',
			description: 'Creates a new RTSP, SRT, NDI, web graphics or Dante input',
			options: [
				{
					type: 'dropdown',
					id: 'type',
					label: 'Type',
					choices: CHOICES_NETWORK_INPUT_TYPE,
					default: 'rtsp',
				},
				optText('name', 'Name'),
				optJson(
					'json',
					'Settings JSON',
					'NetworkInputSettings object, e.g. {"rtsp":{"url":"rtsp://10.0.0.1:8554/stream","transport":"udp"}}.',
				),
			],
			callback: wrap('Input: create network input', async (action) => {
				if (!requireV2('Input: create network input')) return
				const type = action.options.type
				if (!CHOICES_NETWORK_INPUT_TYPE.some((c) => c.id === type)) {
					this.log('error', `Input: create network input: unknown type ${type}`)
					return
				}
				const settings = await parseJson('Input: create network input', 'Settings JSON', action.options.json)
				if (!settings) return
				const name = (await parse(action.options.name)).trim()
				const body = { type }
				if (name) body.name = name
				if (Object.keys(settings).length > 0) body.settings = settings
				const result = await this.request('POST', '/inputs', { body })
				this.log('info', `Network input created: ${JSON.stringify(result)}`)
				this.schedulePollSoon()
			}),
		}

		// ------------------------------------------------------------------
		// Single touch control
		// ------------------------------------------------------------------

		actions['singleTouchToggle'] = {
			name: 'Single touch: toggle',
			description: 'Starts or stops all recorders and publishers included in the single touch control',
			options: [
				{
					type: 'dropdown',
					id: 'stc',
					label: 'Single touch control',
					choices: this.choicesSingleTouch(),
					default: this.firstId(this.choicesSingleTouch()),
				},
			],
			callback: wrap('Single touch: toggle', async (action) => {
				if (!requireV2('Single touch: toggle')) return
				const stcid = String(action.options.stc ?? '')
				if (!stcid) {
					this.log('error', 'Single touch: toggle: no single touch control selected')
					return
				}
				await this.request('POST', `/system/singletouchcontrol/${enc(stcid)}/control/toggle`)
				this.schedulePollSoon()
			}),
		}

		// ------------------------------------------------------------------
		// Configuration presets
		// ------------------------------------------------------------------

		actions['applyConfigPreset'] = {
			name: 'Config preset: apply',
			description: 'Applies a configuration preset stored on the device. The device may reboot.',
			options: [
				{
					type: 'dropdown',
					id: 'preset',
					label: 'Preset',
					choices: this.choicesConfigPresets(),
					default: this.firstId(this.choicesConfigPresets()),
				},
				{
					type: 'multidropdown',
					id: 'sections',
					label: 'Sections (empty = all)',
					choices: CHOICES_PRESET_SECTIONS,
					default: [],
				},
			],
			callback: wrap('Config preset: apply', async (action) => {
				if (!requireV2('Config preset: apply')) return
				const name = String(action.options.preset ?? '')
				if (!name) {
					this.log('error', 'Config preset: apply: no preset selected')
					return
				}
				const sections = Array.isArray(action.options.sections) ? action.options.sections.filter(Boolean) : []
				const opts = sections.length > 0 ? { body: { sections } } : {}
				const result = await this.request('POST', `/system/presets/${enc(name)}/control/apply`, opts)
				if (result && result.reboot) {
					this.log('info', `Config preset "${name}" applied, the device is rebooting`)
				} else {
					this.log('info', `Config preset "${name}" applied`)
				}
				// optimistic: the API has no way to read back which preset the device currently matches
				this.state.lastConfigPreset = { name, appliedAt: Date.now() }
				variables.updateVariables(this)
				this.checkFeedbacks('configPresetApplied')
				this.schedulePollSoon()
			}),
		}

		// ------------------------------------------------------------------
		// Storage
		// ------------------------------------------------------------------

		actions['storageEject'] = {
			name: 'Storage: eject',
			description: 'Safely ejects a removable storage (SD card / USB). The main storage cannot be ejected.',
			options: [
				{
					type: 'dropdown',
					id: 'storage',
					label: 'Storage',
					choices: this.choicesStorages(),
					default: this.firstId(this.choicesStorages()),
				},
			],
			callback: wrap('Storage: eject', async (action) => {
				if (!requireV2('Storage: eject')) return
				const stid = String(action.options.storage ?? '')
				if (!stid) {
					this.log('error', 'Storage: eject: no storage selected')
					return
				}
				await this.request('POST', `/system/storages/${enc(stid)}/control/eject`)
				this.log('info', `Storage ${stid} ejected`)
				this.schedulePollSoon()
			}),
		}

		// ------------------------------------------------------------------
		// Events (CMS schedule)
		// ------------------------------------------------------------------

		actions['eventControl'] = {
			name: 'Event: start/stop/pause/resume',
			description:
				'Controls a scheduled CMS event. Aliases: upcoming = next scheduled, ongoing = running or paused.',
			options: [
				...optEvent(),
				{
					type: 'dropdown',
					id: 'action',
					label: 'Action',
					choices: CHOICES_EVENT_ACTION,
					default: 'start',
				},
			],
			callback: wrap('Event: control', async (action) => {
				if (!requireV2('Event: control')) return
				const verb = action.options.action
				if (!CHOICES_EVENT_ACTION.some((c) => c.id === verb)) {
					this.log('error', `Event: control: unknown action ${verb}`)
					return
				}
				const id = await resolveEventId('Event: control', action.options)
				if (!id) return
				await this.request('POST', `/schedule/events/${enc(id)}/control/${verb}`)
				this.schedulePollSoon()
			}),
		}

		actions['eventExtend'] = {
			name: 'Event: extend',
			description: 'Adds time to the finish of a running or paused event',
			options: [
				...optEvent(),
				{
					type: 'number',
					id: 'seconds',
					label: 'Extend by (seconds)',
					default: 300,
					min: 1,
					max: 86400,
					step: 60,
				},
			],
			callback: wrap('Event: extend', async (action) => {
				if (!requireV2('Event: extend')) return
				const id = await resolveEventId('Event: extend', action.options)
				if (!id) return
				const finish = Math.max(1, toInt(action.options.seconds, 300))
				await this.request('POST', `/schedule/events/${enc(id)}/control/extend`, { body: { finish } })
				this.schedulePollSoon()
			}),
		}

		actions['createAdhocEvent'] = {
			name: 'Event: create ad-hoc event',
			description: 'Creates an ad-hoc event for the configured CMS (Kaltura, Panopto or Opencast)',
			options: [
				optJson(
					'json',
					'Event JSON',
					'AdhocEventKaltura / AdhocEventPanopto / AdhocEventOpencast object, e.g. {"title":"Ad-hoc","duration":3600}.',
				),
			],
			callback: wrap('Event: create ad-hoc event', async (action) => {
				if (!requireV2('Event: create ad-hoc event')) return
				const body = await parseJson('Event: create ad-hoc event', 'Event JSON', action.options.json)
				if (!body) return
				const result = await this.request('POST', '/schedule/events', { body })
				this.log('info', `Ad-hoc event created: ${result && result.id ? result.id : JSON.stringify(result)}`)
				this.schedulePollSoon()
			}),
		}

		actions['adhocSessionLogout'] = {
			name: 'Event: ad-hoc session logout',
			description: 'Deletes the current ad-hoc CMS login session',
			options: [],
			callback: wrap('Event: ad-hoc session logout', async () => {
				if (!requireV2('Event: ad-hoc session logout')) return
				await this.request('DELETE', '/schedule/events/adhoc/session')
				this.log('info', 'Ad-hoc session logged out')
			}),
		}

		// ------------------------------------------------------------------
		// System
		// ------------------------------------------------------------------

		actions['refreshConnectivity'] = {
			name: 'System: refresh connectivity details',
			description: 'Reads the network connectivity test results into the connectivity_* variables',
			options: [],
			callback: wrap('System: refresh connectivity', async () => {
				if (!requireV2('System: refresh connectivity')) return
				const result = await this.request('GET', '/system/connectivity/details')
				this.state.connectivity = result && typeof result === 'object' ? result : undefined
				variables.updateVariables(this)
			}),
		}

		actions['runSpeedTest'] = {
			name: 'System: run speed test',
			description: 'Runs a network speed test on the device and stores the result in the speedtest_* variables',
			options: [
				{
					type: 'dropdown',
					id: 'mode',
					label: 'Direction',
					choices: [
						{ id: 'uplink', label: 'Uplink' },
						{ id: 'downlink', label: 'Downlink' },
					],
					default: 'uplink',
				},
				{
					type: 'dropdown',
					id: 'protocol',
					label: 'Protocol',
					choices: [
						{ id: 'tcp', label: 'TCP' },
						{ id: 'udp', label: 'UDP' },
					],
					default: 'tcp',
				},
				{
					type: 'number',
					id: 'timeout',
					label: 'Test duration (seconds)',
					default: 10,
					min: 1,
					max: 300,
					step: 1,
				},
			],
			callback: wrap('System: run speed test', async (action) => {
				if (!requireV2('System: run speed test')) return
				const mode = action.options.mode === 'downlink' ? 'downlink' : 'uplink'
				const protocol = action.options.protocol === 'udp' ? 'udp' : 'tcp'
				const timeout = Math.max(1, toInt(action.options.timeout, 10))
				const result = await this.request('GET', '/system/connectivity/tools/speedtest', {
					query: { mode, protocol, timeout },
					timeout: (timeout + 15) * 1000,
				})
				this.state.speedtest = result && typeof result === 'object' ? result : undefined
				variables.updateVariables(this)
				if (result && typeof result.bandwidth === 'number') {
					this.log('info', `Speed test ${protocol} ${mode}: ${(result.bandwidth / 1e6).toFixed(1)} Mbps`)
				}
			}),
		}

		actions['refreshPoll'] = {
			name: 'System: refresh state now',
			description: 'Polls the device immediately instead of waiting for the next interval',
			options: [],
			callback: wrap('System: refresh state', async () => {
				await this.pollAll()
			}),
		}

		return actions
	},
}
