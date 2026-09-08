const variables = require('./variables')
const confirm = require('./confirm')
const rotary = require('./rotary')
const failure = require('./failure')

/** pause before retrying an input settings call the Pearl refused with 405 (busy applying the previous one) */
const SETTINGS_RETRY_MS = 300
const {
	splitPair,
	clampNumber,
	recorderToggleOp,
	publisherToggleOp,
	eventToggleOp,
	eventApplies,
	bookmarkText,
} = require('./utils')
const { readGain, gainPatch, readDelay, delayPatch } = require('./audio')

const CHOICES_RECORDER_OPS = [
	{ id: 'toggle', label: 'Toggle' },
	{ id: 'start', label: 'Start' },
	{ id: 'stop', label: 'Stop' },
	{ id: 'pause', label: 'Pause' },
	{ id: 'resume', label: 'Resume' },
	{ id: 'reset', label: 'Reset' },
]
const CHOICES_STREAM_OPS = [
	{ id: 'toggle', label: 'Toggle' },
	{ id: 'start', label: 'Start' },
	{ id: 'stop', label: 'Stop' },
]
const CHOICES_EVENT_OPS = [
	{ id: 'status', label: 'Status only (no action)' },
	{ id: 'toggle', label: 'Toggle (start / pause / resume)' },
	{ id: 'start', label: 'Start' },
	{ id: 'stop', label: 'Stop' },
	{ id: 'pause', label: 'Pause' },
	{ id: 'resume', label: 'Resume' },
	{ id: 'extend', label: 'Extend' },
]
const CHOICES_POWER_OPS = [
	{ id: 'reboot', label: 'Reboot' },
	{ id: 'shutdown', label: 'Shut down' },
]
const CHOICES_AUDIO_CONTROL = [
	{ id: 'none', label: 'Nothing' },
	{ id: 'gain', label: 'Gain' },
	{ id: 'delay', label: 'Delay' },
]
const CHOICES_AUDIO_DIRECTION = [
	{ id: 'up', label: 'Up' },
	{ id: 'down', label: 'Down' },
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

const RECORDER_OP_IDS = CHOICES_RECORDER_OPS.map((c) => c.id)
const STREAM_OP_IDS = CHOICES_STREAM_OPS.map((c) => c.id)
const EVENT_OP_IDS = CHOICES_EVENT_OPS.map((c) => c.id)
const POWER_OP_IDS = CHOICES_POWER_OPS.map((c) => c.id)
const SECTION_IDS = CHOICES_PRESET_SECTIONS.map((c) => c.id)

/** how long `preset_status` says the device is rebooting after a preset that reports a reboot */
const PRESET_REBOOT_MS = 60000
/** how long `power_status` says the reboot / shutdown command was sent */
const POWER_STATUS_MS = 30000
/** how long a storage keeps its `Ejected` hint */
const STORAGE_HINT_MS = 4000

/** gain / delay steps accepted by the audio action */
const STEP_MIN = 1
const STEP_MAX = 100
/** seconds the event action may add to an event's finish time */
const EXTEND_MIN = 30
const EXTEND_MAX = 21600
const EXTEND_DEFAULT = 300

const enc = (v) => encodeURIComponent(String(v))
const errMsg = (e) => (e && e.message ? e.message : String(e))

module.exports = {
	...confirm,
	...rotary,
	...failure,

	/**
	 * Build all action definitions.
	 *
	 * @returns {Object} the action definitions
	 */
	getActions() {
		const actions = {}

		/** Record the message of a failed action and log it. */
		const fail = (label, message) => {
			if (this.state) this.state.lastError = message
			this.log('error', `${label}: ${message}`)
		}

		/**
		 * Wrap an action callback so it never throws and always logs and records failures -- and flashes
		 * the failure on the button it came from (src/failure.js, the `action_failed` feedback), so a
		 * rejected command is visible on the key and not only in the log.
		 */
		const wrap = (label, fn) => async (action, context) => {
			try {
				await fn(action, context)
			} catch (error) {
				const message = errMsg(error)
				if (this.state) this.state.lastError = message
				this.log('error', `${label} failed: ${message}`)
				this.flagActionFailure(action?.controlId)
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

		/** Re-publish the variable values; a failure here must not mark the action as failed. */
		const refreshVariables = () => {
			try {
				variables.updateVariables(this)
			} catch (error) {
				this.log('debug', `Updating variables failed: ${errMsg(error)}`)
			}
		}

		/** Validate a channel option against state. Returns the channel id as string or null. */
		const parseChannel = (label, value) => {
			const cid = value === undefined || value === null ? '' : String(value)
			if (!cid) {
				fail(label, 'no channel selected')
				return null
			}
			if (!this.state.channels[cid]) {
				fail(label, `unknown channel ${cid}`)
				return null
			}
			return cid
		}

		const optConfirm = () => ({
			type: 'checkbox',
			id: 'confirm',
			label: 'Confirm with a second press',
			default: true,
			tooltip:
				'The first press only arms the button and sets $(pearl:confirm_hint); press the same button again within 3 seconds to send the command. Untick to send it immediately.',
		})

		// ------------------------------------------------------------------
		// Recorder
		// ------------------------------------------------------------------

		actions['recorder'] = {
			name: 'Recorder',
			description:
				'Start, stop, pause or toggle a Pearl recorder. Toggle starts a stopped recorder and stops a running or paused one; "All recorders" controls every recorder on the device.',
			options: [
				{
					type: 'dropdown',
					id: 'recorderId',
					label: 'Recorder',
					choices: this.choicesRecordersWithAll(),
					default: 'all',
				},
				{
					type: 'dropdown',
					id: 'op',
					label: 'Action',
					choices: CHOICES_RECORDER_OPS,
					default: 'toggle',
				},
			],
			callback: wrap('Recorder', async (action) => {
				const label = 'Recorder'
				const rid = String(action.options.recorderId ?? 'all')
				if (rid !== 'all' && !this.state.recorders?.[rid]) {
					fail(label, `unknown recorder ${rid}`)
					return
				}
				const requested = String(action.options.op ?? 'toggle')
				if (!RECORDER_OP_IDS.includes(requested)) {
					fail(label, `unknown action ${requested}`)
					return
				}
				if ((rid === 'all' || requested === 'pause' || requested === 'resume') && !requireV2(label)) return

				const op = requested === 'toggle' ? recorderToggleOp(this.state.recorders, rid) : requested
				const path =
					rid === 'all' ? `/recorders/control/${enc(op)}` : `/recorders/${enc(rid)}/control/${enc(op)}`

				if (op === 'reset' && this.isV2) {
					// reset only exists in the legacy API on older firmware
					try {
						await this.request('POST', path, { silent: true })
					} catch (error) {
						if (error?.status !== 404) throw error
						await this.request('POST', path, { base: 'v1' })
					}
				} else {
					await this.request('POST', path)
				}
				this.log('debug', `Recorder ${rid}: ${op}`)
				this.schedulePollSoon()
			}),
		}

		// ------------------------------------------------------------------
		// Stream
		// ------------------------------------------------------------------

		actions['stream'] = {
			name: 'Stream',
			description:
				'Start, stop or toggle a channel\'s stream (publisher). "All publishers" starts or stops every stream configured on the channel.',
			options: [
				{
					type: 'dropdown',
					id: 'channelId',
					label: 'Channel',
					choices: this.choicesChannel(),
					default: this.firstId(this.choicesChannel()),
				},
				{
					type: 'dropdown',
					id: 'publisherId',
					label: 'Publisher',
					choices: this.choicesPublishers(),
					default: this.firstId(this.choicesPublishers()),
				},
				{
					type: 'dropdown',
					id: 'op',
					label: 'Action',
					choices: CHOICES_STREAM_OPS,
					default: 'toggle',
				},
			],
			callback: wrap('Stream', async (action) => {
				const label = 'Stream'
				// the composite carries its own channel; channelId is only used when it cannot be parsed
				const pair = splitPair(String(action.options.publisherId ?? ''))
				const cid = pair ? pair[0] : parseChannel(label, action.options.channelId)
				if (!cid) return
				const pid = pair ? pair[1] : 'all'
				if (!this.state.channels[cid]) {
					fail(label, `unknown channel ${cid}`)
					return
				}
				if (pid !== 'all' && !this.state.channels[cid].publishers?.[pid]) {
					fail(label, `unknown publisher ${pid} on channel ${cid}`)
					return
				}
				const requested = String(action.options.op ?? 'toggle')
				if (!STREAM_OP_IDS.includes(requested)) {
					fail(label, `unknown action ${requested}`)
					return
				}

				const op =
					requested === 'toggle' ? publisherToggleOp(this.state.channels[cid].publishers, pid) : requested
				const path =
					pid === 'all'
						? `/channels/${enc(cid)}/publishers/control/${enc(op)}`
						: `/channels/${enc(cid)}/publishers/${enc(pid)}/control/${enc(op)}`
				await this.request('POST', path)
				this.log('debug', `Stream ${cid}-${pid}: ${op}`)
				this.schedulePollSoon()
			}),
		}

		// ------------------------------------------------------------------
		// Layout
		// ------------------------------------------------------------------

		actions['layout'] = {
			name: 'Layout',
			description: 'Switch a channel to a layout. The key lights up while that layout is active.',
			options: [
				{
					type: 'dropdown',
					id: 'channelId',
					label: 'Channel',
					choices: this.choicesChannel(),
					default: this.firstId(this.choicesChannel()),
				},
				{
					type: 'dropdown',
					id: 'layoutId',
					label: 'Layout',
					choices: this.choicesLayouts(),
					default: this.firstId(this.choicesLayouts()),
				},
				{
					type: 'textinput',
					id: 'layoutIdManual',
					label: 'Layout ID',
					default: '',
					useVariables: true,
					tooltip:
						'Fallback for firmware that does not list layouts: type the layout ID shown in the Pearl Admin UI (Channel → Layouts). Used only while "Layout" is empty.',
				},
			],
			callback: wrap('Layout', async (action) => {
				const label = 'Layout'
				const pair = splitPair(String(action.options.layoutId ?? ''))
				let cid
				let lid
				if (pair) {
					cid = pair[0]
					lid = pair[1]
					if (!this.state.channels[cid]) {
						fail(label, `unknown channel ${cid}`)
						return
					}
					if (!this.state.channels[cid].layouts?.[lid]) {
						fail(label, `unknown layout ${lid} on channel ${cid}`)
						return
					}
				} else {
					cid = parseChannel(label, action.options.channelId)
					if (!cid) return
					lid = (await parse(action.options.layoutIdManual)).trim()
					if (!lid) {
						fail(label, 'no layout selected and no layout ID given')
						return
					}
				}
				const numeric = Number(lid)
				// v1 wants the id in the body, v2 wants it as a query parameter; both accept both
				await this.request('PUT', `/channels/${enc(cid)}/layouts/active`, {
					query: { id: lid },
					body: { id: Number.isFinite(numeric) ? numeric : lid },
				})
				this.log('debug', `Layout ${lid} activated on channel ${cid}`)
				this.schedulePollSoon()
			}),
		}

		// ------------------------------------------------------------------
		// Single touch
		// ------------------------------------------------------------------

		actions['singletouch'] = {
			name: 'Single Touch',
			description:
				'Trigger a Pearl single-touch control (start/stop recording and streaming together). Most devices have only control 0.',
			options: [
				{
					type: 'dropdown',
					id: 'stcId',
					label: 'Single touch control',
					choices: this.choicesSingleTouch(),
					default: this.preferredId(this.choicesSingleTouch(), '0'),
				},
			],
			callback: wrap('Single Touch', async (action) => {
				const label = 'Single Touch'
				if (!requireV2(label)) return
				const stcId = String(action.options.stcId ?? '')
				if (!stcId) {
					fail(label, 'no single touch control selected')
					return
				}
				if (!this.state.singleTouch?.[stcId]) {
					fail(label, `unknown single touch control ${stcId}`)
					return
				}
				await this.request('POST', `/system/singletouchcontrol/${enc(stcId)}/control/toggle`)
				this.schedulePollSoon()
			}),
		}

		// ------------------------------------------------------------------
		// Bookmark
		// ------------------------------------------------------------------

		actions['bookmark'] = {
			name: 'Bookmark',
			description:
				"Add a bookmark (marker) to a channel's recording. Bookmarks are only stored while the channel is recording.",
			options: [
				{
					type: 'dropdown',
					id: 'channelId',
					label: 'Channel',
					choices: this.choicesChannel(),
					default: this.firstId(this.choicesChannel()),
				},
				{
					type: 'textinput',
					id: 'text',
					label: 'Text',
					default: 'Marker',
					useVariables: true,
					tooltip: 'Shown in the recording’s bookmark list. Keep it short.',
				},
				{
					type: 'checkbox',
					id: 'appendTime',
					label: 'Append the current time (HH:MM:SS)',
					default: false,
				},
			],
			callback: wrap('Bookmark', async (action) => {
				const label = 'Bookmark'
				const cid = parseChannel(label, action.options.channelId)
				if (!cid) return
				const text = bookmarkText(await parse(action.options.text), action.options.appendTime === true)
				// v2 wants the text as a query parameter, v1 in the body; send both
				await this.request('POST', `/channels/${enc(cid)}/bookmarks`, { query: { text }, body: { text } })
				this.log('info', `Bookmark added to channel ${cid}: ${text}`)
				this.schedulePollSoon()
			}),
		}

		// ------------------------------------------------------------------
		// Output source
		// ------------------------------------------------------------------

		actions['output'] = {
			name: 'Output Source',
			description: 'Switch the source shown on a Pearl HDMI/SDI output.',
			options: [
				{
					type: 'dropdown',
					id: 'outputId',
					label: 'Output',
					choices: this.choicesOutputs(),
					default: this.firstId(this.choicesOutputs()),
				},
				{
					type: 'dropdown',
					id: 'source',
					label: 'Source',
					choices: this.choicesOutputSources(),
					default: this.firstId(this.choicesOutputSources()),
				},
			],
			callback: wrap('Output Source', async (action) => {
				const label = 'Output Source'
				if (!requireV2(label)) return
				const did = String(action.options.outputId ?? '')
				if (!did) {
					fail(label, 'no output selected')
					return
				}
				if (!this.state.outputs?.[did]) {
					fail(label, `unknown output ${did}`)
					return
				}
				const source = String(action.options.source ?? '').trim()
				if (!source) {
					fail(label, 'no source selected')
					return
				}
				await this.request('PUT', `/outputs/${enc(did)}/settings`, { query: { source } })
				// optimistic: the API has no way to read the current source back
				this.state.outputs[did].source = source
				this.state.outputs[did].setAt = Date.now()
				refreshVariables()
				this.checkFeedbacks('output_set')
				this.schedulePollSoon()
			}),
		}

		// ------------------------------------------------------------------
		// Configuration preset
		// ------------------------------------------------------------------

		actions['preset'] = {
			name: 'Apply Preset',
			description:
				'Apply a Pearl configuration preset. This can interrupt recordings and streams and the device may reboot.',
			options: [
				{
					type: 'dropdown',
					id: 'presetName',
					label: 'Preset',
					choices: this.choicesConfigPresets(),
					default: this.firstId(this.choicesConfigPresets()),
				},
				{
					type: 'multidropdown',
					id: 'sections',
					label: 'Sections',
					choices: CHOICES_PRESET_SECTIONS,
					default: [],
					tooltip: 'Leave empty to apply the whole preset.',
				},
				optConfirm(),
			],
			callback: wrap('Apply Preset', async (action) => {
				const label = 'Apply Preset'
				if (!requireV2(label)) return
				const name = String(action.options.presetName ?? '')
				if (!name) {
					fail(label, 'no preset selected')
					return
				}
				if (action.options.confirm !== false && !this.confirmGate(action, label)) {
					// a fresh confirm arm supersedes any status text left over from a previous apply, so
					// confirm_hint and preset_status never render at the same time on the button (D2)
					if (this.state.presetStatus) {
						this.state.presetStatus = undefined
						refreshVariables()
					}
					return
				}

				const sections = (Array.isArray(action.options.sections) ? action.options.sections : [])
					.map((s) => String(s))
					.filter((s) => SECTION_IDS.includes(s))
				const opts = sections.length > 0 ? { body: { sections } } : {}
				const result = await this.request('POST', `/system/presets/${enc(name)}/control/apply`, opts)
				// optimistic: the API has no way to read back which preset the device currently matches
				this.state.lastConfigPreset = { name, appliedAt: Date.now() }
				if (result && result.reboot) {
					this.state.presetStatus = { text: 'Rebooting…', until: Date.now() + PRESET_REBOOT_MS }
					this.log('info', `Configuration preset "${name}" applied, the device is rebooting`)
				} else {
					this.state.presetStatus = undefined
					this.log('info', `Configuration preset "${name}" applied`)
				}
				refreshVariables()
				this.schedulePollSoon()
			}),
		}

		// ------------------------------------------------------------------
		// CMS event
		// ------------------------------------------------------------------

		actions['event'] = {
			name: 'Event',
			description:
				'Start, pause, resume, stop or extend a scheduled CMS event. Toggle adapts to the event state; a fixed action that does not apply to the event is not sent.',
			options: [
				{
					type: 'dropdown',
					id: 'eventRef',
					label: 'Event',
					choices: this.choicesEventRefs(),
					default: 'ongoing',
					allowCustom: true,
					tooltip:
						'"Ongoing" always targets the event that is currently running or paused, "Upcoming" the next scheduled one. Picking a specific event ties the button to it.',
				},
				{
					type: 'dropdown',
					id: 'op',
					label: 'Action',
					choices: CHOICES_EVENT_OPS,
					default: 'toggle',
				},
				{
					type: 'number',
					id: 'extendSeconds',
					label: 'Extend by',
					default: EXTEND_DEFAULT,
					min: EXTEND_MIN,
					max: EXTEND_MAX,
					step: 30,
					tooltip: 'Seconds added to the finish time of the event.',
					isVisible: (options) => options.op === 'extend',
				},
			],
			callback: wrap('Event', async (action) => {
				const label = 'Event'
				if (!requireV2(label)) return
				const op = String(action.options.op ?? 'toggle')
				if (!EVENT_OP_IDS.includes(op)) {
					fail(label, `unknown action ${op}`)
					return
				}
				if (op === 'status') {
					this.schedulePollSoon()
					return
				}
				const ref = (await parse(action.options.eventRef)).trim() || 'ongoing'

				// resolve live: an alias may point at a different event than the last poll saw
				const event = await this.request('GET', `/schedule/events/${enc(ref)}`, {
					optional: true,
					silent: true,
				})
				if (!event || typeof event !== 'object' || event.id === undefined) {
					this.log('warn', `${label}: no event matches "${ref}"`)
					return
				}
				const status = event.status
				const title = event.title || event.id

				let command
				if (op === 'toggle') {
					command = eventToggleOp(status)
					if (!command) {
						this.log('warn', `${label}: "${title}" is ${status ?? 'unknown'} and cannot be toggled`)
						return
					}
				} else {
					if (!eventApplies(op, status)) {
						this.log('warn', `${label}: cannot ${op}, "${title}" is ${status ?? 'unknown'}`)
						return
					}
					command = op
				}

				// prefer the concrete id over the alias, which could resolve elsewhere by now
				const id = String(event.id)
				if (command === 'extend') {
					const finish = Math.round(
						clampNumber(action.options.extendSeconds, EXTEND_DEFAULT, EXTEND_MIN, EXTEND_MAX),
					)
					await this.request('POST', `/schedule/events/${enc(id)}/control/extend`, { body: { finish } })
					this.log('info', `Event "${title}" extended by ${finish} s`)
				} else {
					await this.request('POST', `/schedule/events/${enc(id)}/control/${enc(command)}`)
					this.log('info', `Event "${title}": ${command}`)
				}
				this.schedulePollSoon()
			}),
		}

		// ------------------------------------------------------------------
		// Power
		// ------------------------------------------------------------------

		actions['power'] = {
			name: 'Reboot / Shutdown',
			description:
				'Reboot or shut down the Pearl. Shut down powers the Pearl off completely; it must be switched back on at the device.',
			options: [
				{
					type: 'dropdown',
					id: 'op',
					label: 'Action',
					choices: CHOICES_POWER_OPS,
					default: 'reboot',
				},
				optConfirm(),
			],
			callback: wrap('Reboot / Shutdown', async (action) => {
				const label = 'Reboot / Shutdown'
				const op = String(action.options.op ?? 'reboot')
				if (!POWER_OP_IDS.includes(op)) {
					fail(label, `unknown action ${op}`)
					return
				}
				if (action.options.confirm !== false && !this.confirmGate(action, label)) {
					// a fresh confirm arm supersedes any status text left over from a previous command, so
					// confirm_hint and power_status never render at the same time on the button (D2)
					if (this.state.powerStatus) {
						this.state.powerStatus = undefined
						refreshVariables()
					}
					return
				}

				await this.request('POST', `/system/control/${enc(op)}`)
				this.state.powerStatus = { text: 'Command sent', until: Date.now() + POWER_STATUS_MS }
				this.log('info', op === 'shutdown' ? 'Shutdown requested' : 'Reboot requested')
				refreshVariables()
				this.schedulePollSoon()
			}),
		}

		// ------------------------------------------------------------------
		// Audio
		// ------------------------------------------------------------------

		actions['audio'] = {
			name: 'Audio',
			description:
				'Nudge the capture gain (dB) or the audio delay (ms) of an audio input. "Nothing" only re-reads the input. Rotary ticks arriving within 150 ms are combined into one step.',
			options: [
				{
					type: 'dropdown',
					id: 'inputId',
					label: 'Input',
					choices: this.choicesInputsWithAudio(),
					default: this.firstId(this.choicesInputsWithAudio()),
				},
				{
					type: 'dropdown',
					id: 'control',
					label: 'Press adjusts',
					choices: CHOICES_AUDIO_CONTROL,
					default: 'none',
				},
				{
					type: 'dropdown',
					id: 'direction',
					label: 'Direction',
					choices: CHOICES_AUDIO_DIRECTION,
					default: 'up',
					isVisible: (options) => options.control !== 'none',
				},
				{
					type: 'number',
					id: 'step',
					label: 'Step',
					default: 1,
					min: STEP_MIN,
					max: STEP_MAX,
					step: 1,
					tooltip: 'Gain steps are in dB (0–100), delay steps in milliseconds (−300..300).',
					isVisible: (options) => options.control !== 'none',
				},
			],
			callback: wrap('Audio', async (action) => {
				const label = 'Audio'
				if (!requireV2(label)) return
				const sid = String(action.options.inputId ?? '')
				if (!sid) {
					fail(label, 'no input selected')
					return
				}
				if (!this.state.inputs?.[sid]) {
					fail(label, `unknown input ${sid}`)
					return
				}
				const control = String(action.options.control ?? 'none')
				if (control === 'none') {
					// push / "Nothing": re-read the input instead of changing anything — the levels
					// right away (one legacy /sources/status), the rest with the next poll
					this.pollMeterLevels().catch((error) =>
						this.log('debug', `Audio level re-read failed: ${error?.message || error}`),
					)
					this.schedulePollSoon()
					return
				}
				if (control !== 'gain' && control !== 'delay') {
					fail(label, `unknown control ${control}`)
					return
				}
				const step = Math.round(clampNumber(action.options.step, 1, STEP_MIN, STEP_MAX))
				const delta = action.options.direction === 'down' ? -step : step
				const key = `${action.controlId ?? ''} ${action.actionId ?? 'audio'} ${sid} ${control}`
				this.coalesce(
					key,
					delta,
					(total) => this.nudgeInputAudio(label, sid, control, total, action.controlId),
					this.rotaryWindowMs,
				)
			}),
		}

		// ------------------------------------------------------------------
		// Storage
		// ------------------------------------------------------------------

		actions['storage'] = {
			name: 'Storage',
			description:
				'Eject removable media (SD card / USB) from a Pearl storage device. The main storage cannot be ejected.',
			options: [
				{
					type: 'dropdown',
					id: 'storageId',
					label: 'Storage',
					choices: this.choicesStorages(),
					default: this.preferredId(this.choicesStorages(), 'main'),
				},
				optConfirm(),
			],
			callback: wrap('Storage', async (action) => {
				const label = 'Storage'
				if (!requireV2(label)) return
				const stid = String(action.options.storageId ?? '')
				if (!stid) {
					fail(label, 'no storage selected')
					return
				}
				const storage = this.state.storages?.[stid]
				if (!storage) {
					fail(label, `unknown storage ${stid}`)
					return
				}
				if (storage.status?.state === 'nodev') {
					this.log('info', `Storage ${stid}: Nothing to eject`)
					return
				}
				if (action.options.confirm !== false && !this.confirmGate(action, label)) {
					// a fresh confirm arm supersedes any hint text left over from a previous eject, so
					// confirm_hint and storage_<id>_hint never render at the same time on the button (D2)
					if (storage.hint) {
						storage.hint = undefined
						refreshVariables()
					}
					return
				}

				await this.request('POST', `/system/storages/${enc(stid)}/control/eject`)
				storage.hint = { text: 'Ejected', until: Date.now() + STORAGE_HINT_MS }
				this.log('info', `Storage ${stid} ejected`)
				refreshVariables()
				this.schedulePollSoon()
			}),
		}

		return actions
	},

	/**
	 * INTERNAL: read an input's settings and write back gain or delay moved by `delta`.
	 * Called from the coalesced rotary flush, so it handles its own failures.
	 *
	 * @param {string} label action name used in log lines
	 * @param {string} sid input id
	 * @param {'gain'|'delay'} control
	 * @param {number} delta signed step
	 * @param {string} [controlId] button the nudge came from, flashed on failure (src/failure.js)
	 */
	async nudgeInputAudio(label, sid, control, delta, controlId) {
		// one nudge at a time per input: a real Pearl-2 answers 405 "Source settings are not supported" to a
		// settings GET/PATCH that lands while it is still applying the previous PATCH (QA 2026-09-08, rapid
		// presses), so flushes queue behind each other and a 405 is retried once (settingsCall)
		if (!(this.audioNudgeQueue instanceof Map)) this.audioNudgeQueue = new Map()
		const previous = this.audioNudgeQueue.get(sid) ?? Promise.resolve()
		const run = previous.then(() => this.nudgeInputAudioNow(label, sid, control, delta, controlId))
		this.audioNudgeQueue.set(
			sid,
			run.catch(() => undefined),
		)
		return run
	},

	/** GET or PATCH an input's settings, retrying once after a short pause when the Pearl answers 405. */
	async settingsCall(method, sid, opts) {
		try {
			// silent: a 405 is retried below and any other failure is logged by the caller
			return await this.request(method, `/inputs/${enc(sid)}/settings`, { ...opts, silent: true })
		} catch (error) {
			if (error?.status !== 405) throw error
			const pause = Number(this.settingsRetryMs) > 0 ? Number(this.settingsRetryMs) : SETTINGS_RETRY_MS
			this.log('debug', `${method} settings of ${sid}: 405, retrying in ${pause} ms`)
			await new Promise((resolve) => setTimeout(resolve, pause))
			return await this.request(method, `/inputs/${enc(sid)}/settings`, opts)
		}
	},

	/** INTERNAL: one queued nudge, see nudgeInputAudio(). */
	async nudgeInputAudioNow(label, sid, control, delta, controlId) {
		try {
			const settings = await this.settingsCall('GET', sid)
			let body
			if (control === 'gain') {
				const current = readGain(settings)
				if (current === undefined) {
					this.log('warn', `${label}: input ${sid} has no gain setting`)
					return
				}
				body = gainPatch(settings, current + delta)
			} else {
				const current = readDelay(settings)
				if (current === undefined) {
					this.log('warn', `${label}: input ${sid} has no audio delay setting`)
					return
				}
				body = delayPatch(settings, current.value + delta)
			}
			if (!body) {
				this.log('warn', `${label}: input ${sid} has no ${control} setting`)
				return
			}
			await this.settingsCall('PATCH', sid, { body })
			this.log('debug', `Audio ${sid}: ${control} ${delta > 0 ? '+' : ''}${delta}`)
			this.schedulePollSoon()
		} catch (error) {
			const message = errMsg(error)
			if (this.state) this.state.lastError = message
			this.log('error', `${label} failed: ${message}`)
			this.flagActionFailure(controlId)
		}
	},
}
