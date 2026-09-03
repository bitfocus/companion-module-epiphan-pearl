const { combineRgb } = require('@companion-module/base')
const { safeId } = require('./utils')

const WHITE = combineRgb(255, 255, 255)
const BLACK = combineRgb(0, 0, 0)
const RED = combineRgb(255, 0, 0)
const GREEN = combineRgb(0, 204, 0)
const DARK_GREEN = combineRgb(0, 102, 0)
const BLUE = combineRgb(0, 102, 204)
const NAVY = combineRgb(0, 51, 153)
const DARK_RED = combineRgb(153, 0, 0)
const ORANGE = combineRgb(255, 128, 0)
const YELLOW = combineRgb(255, 204, 0)
const PURPLE = combineRgb(102, 0, 204)
const GREY = combineRgb(64, 64, 64)

const CAT_CHANNELS = 'Channels'
const CAT_PUBLISHERS = 'Publishers'
const CAT_RECORDERS = 'Recorders'
const CAT_INPUTS = 'Inputs'
const CAT_PREVIEWS = 'Previews'
const CAT_SINGLE_TOUCH = 'Single touch'
const CAT_STORAGE = 'Storage'
const CAT_SYSTEM = 'System'
const CAT_EVENTS = 'Events'
const CAT_AFU = 'AFU'
const CAT_CONFIG_PRESETS = 'Config presets'

/**
 * Every preset category that can be generated, in the order they are built. Used to build the
 * "Preset categories to generate" connection setting (src/config.js) and to validate/default its
 * stored value (see normalisePresetCategories). There used to be an `Outputs` category (one button
 * per output x source) but with more than a handful of inputs it produced dozens of buttons for very
 * little practical use, so it was removed outright rather than made toggle-able; `setOutputSource` and
 * the `outputSourceOptimistic` feedback are unaffected and still available for a hand-built button.
 */
const PRESET_CATEGORY_IDS = [
	CAT_CHANNELS,
	CAT_PUBLISHERS,
	CAT_RECORDERS,
	CAT_INPUTS,
	CAT_PREVIEWS,
	CAT_SINGLE_TOUCH,
	CAT_STORAGE,
	CAT_SYSTEM,
	CAT_EVENTS,
	CAT_AFU,
	CAT_CONFIG_PRESETS,
]

/**
 * Validate a stored `preset_categories` config value against the known category list.
 * A missing/non-array value (new connection, or one that predates this setting) defaults to every
 * category; an array that is present (even empty) is respected as-is, just filtered to known ids so a
 * stale id from a removed category cannot linger.
 *
 * @param {unknown} value
 * @returns {string[]}
 */
function normalisePresetCategories(value) {
	if (!Array.isArray(value)) return PRESET_CATEGORY_IDS.slice()
	return value.filter((id) => PRESET_CATEGORY_IDS.includes(id))
}

/**
 * Build a unique, stable preset id: `${category}_${parts...}` sanitised with safeId.
 *
 * @param {string} category
 * @param  {...(string|number)} parts
 * @returns {string}
 */
function presetId(category, ...parts) {
	return [category.toLowerCase(), ...parts].map((part) => safeId(String(part))).join('_')
}

/**
 * Companion variable reference for this connection.
 *
 * @param {string} variableId
 * @returns {string}
 */
function v(variableId) {
	return `$(pearl:${variableId})`
}

/**
 * Turn `Channel - Layout` style labels into two lines for the button text.
 *
 * @param {string} label
 * @returns {string}
 */
function twoLines(label) {
	return String(label ?? '').replace(' - ', '\n')
}

/**
 * Build a standard button preset.
 *
 * @param {object} def
 * @param {string} def.category
 * @param {string} def.name
 * @param {string} def.text
 * @param {number|string} [def.size='auto']
 * @param {number} [def.color=WHITE]
 * @param {number} [def.bgcolor=BLACK]
 * @param {object} [def.styleExtra] extra style props (alignment, pngalignment, ...)
 * @param {Array<{actionId: string, options: object}>} [def.actions=[]] down actions
 * @param {Array<{feedbackId: string, options: object, style?: object, isInverted?: boolean}>} [def.feedbacks=[]]
 * @returns {object} preset definition
 */
function button({
	category,
	name,
	text,
	size = 'auto',
	color = WHITE,
	bgcolor = BLACK,
	styleExtra = {},
	actions = [],
	feedbacks = [],
}) {
	return {
		type: 'button',
		category,
		name,
		style: {
			text,
			size,
			color,
			bgcolor,
			...styleExtra,
		},
		steps: [
			{
				down: actions,
				up: [],
			},
		],
		feedbacks,
	}
}

module.exports = {
	/**
	 * INTERNAL: Get the available presets.
	 *
	 * @access protected
	 * @since 2.0.0
	 * @returns {Object} - the available presets keyed by preset id
	 */
	getPresets() {
		const presets = {}
		const enabledCategories = new Set(normalisePresetCategories(this.config?.preset_categories))

		// ids that collide after safeId() (e.g. config presets "Show A" and "Show_A") get a _2, _3, ... suffix
		const add = (id, preset) => {
			// the "Preset categories to generate" connection setting; a category left unchecked there
			// simply never gets any buttons added, one gate for every category below
			if (!enabledCategories.has(preset.category)) return
			let unique = id
			for (let n = 2; presets[unique] !== undefined; n++) unique = `${id}_${n}`
			if (unique !== id) this.log('debug', `duplicate preset id ${id}, using ${unique}`)
			presets[unique] = preset
		}

		// shared by every button that can carry a live preview image (layout buttons, Previews category)
		const previewStyle = { alignment: 'center:bottom', pngalignment: 'center:center' }

		// ---------------------------------------------------------------------
		// Channels: one button per layout (existing), each showing a live preview of that specific
		// layout's own composition via the undocumented per-layout preview endpoint (see channelLayoutPreview
		// in Feedbacks) plus the existing red highlight while it is the active one.
		// ---------------------------------------------------------------------

		for (const layout of this.choicesChannelLayout()) {
			add(
				presetId(CAT_CHANNELS, 'layout', layout.id),
				button({
					category: CAT_CHANNELS,
					name: layout.label,
					text: twoLines(layout.label),
					size: 7,
					styleExtra: previewStyle,
					actions: [{ actionId: 'channelChangeLayout', options: { channelIdlayoutId: layout.id } }],
					feedbacks: [
						{
							feedbackId: 'channelLayout',
							options: { channelIdlayoutId: layout.id },
							style: { color: BLACK, bgcolor: RED },
						},
						{ feedbackId: 'channelLayoutPreview', options: { channelIdlayoutId: layout.id } },
					],
				}),
			)
		}

		// ---------------------------------------------------------------------
		// Publishers: toggle per publisher and per channel "all" (existing)
		// ---------------------------------------------------------------------

		for (const publisher of this.choicesChannelPublishers()) {
			add(
				presetId(CAT_PUBLISHERS, 'toggle', publisher.id),
				button({
					category: CAT_PUBLISHERS,
					name: publisher.label,
					text: twoLines(publisher.label),
					size: 7,
					bgcolor: NAVY,
					actions: [
						{
							actionId: 'controlStreaming',
							options: { channelIdpublisherId: publisher.id, startStopAction: 3 }, // toggle
						},
					],
					feedbacks: [
						{
							feedbackId: 'streamingState',
							options: { channelIdpublisherId: publisher.id },
							style: { color: BLACK, bgcolor: GREEN },
						},
					],
				}),
			)
		}

		// ---------------------------------------------------------------------
		// Recorders: toggle + reset per recorder (existing), all start/stop (new)
		// ---------------------------------------------------------------------

		for (const recorder of this.choicesRecorders()) {
			add(
				presetId(CAT_RECORDERS, 'toggle', recorder.id),
				button({
					category: CAT_RECORDERS,
					name: `${recorder.label} start/stop`,
					text: `${recorder.label}\n▶️/⏹`,
					size: 14,
					bgcolor: DARK_GREEN,
					actions: [
						{
							actionId: 'recorderRecording',
							options: { recorderId: recorder.id, startStopAction: 3 }, // toggle
						},
					],
					feedbacks: [
						{
							feedbackId: 'recorderRecording',
							options: { recorderId: recorder.id },
							style: { color: BLACK, bgcolor: RED },
						},
					],
				}),
			)
			add(
				presetId(CAT_RECORDERS, 'reset', recorder.id),
				button({
					category: CAT_RECORDERS,
					name: `${recorder.label} reset`,
					text: `${recorder.label}\n🔁`,
					size: 14,
					bgcolor: DARK_GREEN,
					actions: [
						{
							actionId: 'recorderRecording',
							options: { recorderId: recorder.id, startStopAction: 2 }, // reset
						},
					],
					feedbacks: [
						{
							feedbackId: 'recorderRecording',
							options: { recorderId: recorder.id },
							style: { color: BLACK, bgcolor: RED },
						},
					],
				}),
			)
		}

		add(
			presetId(CAT_RECORDERS, 'all', 'start'),
			button({
				category: CAT_RECORDERS,
				name: 'All recorders start',
				text: `All REC\nStart\n${v('recorders_active_count')} active`,
				bgcolor: DARK_GREEN,
				actions: [{ actionId: 'recorderControlAll', options: { action: 'start' } }],
				feedbacks: [{ feedbackId: 'anyRecording', options: {}, style: { color: WHITE, bgcolor: RED } }],
			}),
		)
		add(
			presetId(CAT_RECORDERS, 'all', 'stop'),
			button({
				category: CAT_RECORDERS,
				name: 'All recorders stop',
				text: `All REC\nStop\n${v('recorders_active_count')} active`,
				bgcolor: GREY,
				actions: [{ actionId: 'recorderControlAll', options: { action: 'stop' } }],
				feedbacks: [{ feedbackId: 'anyRecording', options: {}, style: { color: WHITE, bgcolor: RED } }],
			}),
		)

		// ---------------------------------------------------------------------
		// Inputs: mute / unmute per audio input
		// ---------------------------------------------------------------------

		for (const input of this.choicesInputsWithAudio()) {
			add(
				presetId(CAT_INPUTS, input.id, 'mute'),
				button({
					category: CAT_INPUTS,
					name: `${input.label} mute`,
					text: `${input.label}\n🔇 Mute`,
					size: 7,
					bgcolor: DARK_RED,
					actions: [{ actionId: 'inputAudioMute', options: { input: input.id, mute: 'true' } }],
				}),
			)
			add(
				presetId(CAT_INPUTS, input.id, 'unmute'),
				button({
					category: CAT_INPUTS,
					name: `${input.label} unmute`,
					text: `${input.label}\n🔊 Unmute`,
					size: 7,
					bgcolor: DARK_GREEN,
					actions: [{ actionId: 'inputAudioMute', options: { input: input.id, mute: 'false' } }],
				}),
			)
		}

		// ---------------------------------------------------------------------
		// Previews: live image per channel / input / output
		// ---------------------------------------------------------------------

		for (const channel of this.choicesChannel()) {
			add(
				presetId(CAT_PREVIEWS, 'channel', channel.id),
				button({
					category: CAT_PREVIEWS,
					name: `Preview ${channel.label}`,
					text: v(`channel_${safeId(String(channel.id))}_name`),
					size: 7,
					styleExtra: previewStyle,
					feedbacks: [{ feedbackId: 'channelPreview', options: { channel: channel.id } }],
				}),
			)
		}
		// audio-only inputs have no picture to preview (no VU meter feedback exists yet either)
		for (const input of this.choicesInputsWithVideo()) {
			add(
				presetId(CAT_PREVIEWS, 'input', input.id),
				button({
					category: CAT_PREVIEWS,
					name: `Preview ${input.label}`,
					text: v(`input_${safeId(String(input.id))}_name`),
					size: 7,
					styleExtra: previewStyle,
					feedbacks: [{ feedbackId: 'inputPreview', options: { input: input.id } }],
				}),
			)
		}
		for (const output of this.choicesOutputs()) {
			add(
				presetId(CAT_PREVIEWS, 'output', output.id),
				button({
					category: CAT_PREVIEWS,
					name: `Preview ${output.label}`,
					text: v(`output_${safeId(String(output.id))}_name`),
					size: 7,
					styleExtra: previewStyle,
					feedbacks: [{ feedbackId: 'outputPreview', options: { output: output.id } }],
				}),
			)
		}

		// ---------------------------------------------------------------------
		// Single touch control: toggle per control
		// ---------------------------------------------------------------------

		for (const stc of this.choicesSingleTouch()) {
			const sid = safeId(String(stc.id))
			add(
				presetId(CAT_SINGLE_TOUCH, 'toggle', stc.id),
				button({
					category: CAT_SINGLE_TOUCH,
					name: `${stc.label} toggle`,
					text: `${stc.label}\nREC ${v(`stc_${sid}_recorders_active`)}/${v(`stc_${sid}_recorders_total`)}\nSTREAM ${v(`stc_${sid}_publishers_active`)}/${v(`stc_${sid}_publishers_total`)}`,
					size: 7,
					bgcolor: GREY,
					actions: [{ actionId: 'singleTouchToggle', options: { stc: stc.id } }],
					feedbacks: [
						{
							feedbackId: 'singleTouchPressed',
							options: { stcId: stc.id },
							style: { color: WHITE, bgcolor: GREEN },
						},
						{
							feedbackId: 'singleTouchOk',
							options: { stcId: stc.id },
							isInverted: true,
							style: { color: RED },
						},
					],
				}),
			)
		}

		// ---------------------------------------------------------------------
		// Storage: status display per storage
		// ---------------------------------------------------------------------

		for (const storage of this.choicesStorages()) {
			const sid = safeId(String(storage.id))
			add(
				presetId(CAT_STORAGE, 'status', storage.id),
				button({
					category: CAT_STORAGE,
					name: `${storage.label} status`,
					text: `${storage.label}\n${v(`storage_${sid}_free_gb`)} GB free\n${v(`storage_${sid}_state`)}`,
					size: 7,
					bgcolor: NAVY,
					feedbacks: [
						{
							feedbackId: 'storageFreeBelow',
							options: { storageId: storage.id, percent: 10 },
							style: { color: WHITE, bgcolor: RED },
						},
						{
							feedbackId: 'storageState',
							options: { storageId: storage.id, state: 'nodev' },
							style: { color: WHITE, bgcolor: GREY },
						},
					],
				}),
			)
		}

		// ---------------------------------------------------------------------
		// System
		// ---------------------------------------------------------------------

		add(
			presetId(CAT_SYSTEM, 'cpu_load'),
			button({
				category: CAT_SYSTEM,
				name: 'CPU load',
				text: `CPU load\n${v('system_status_cpuload')}%`,
				bgcolor: GREY,
				feedbacks: [{ feedbackId: 'cpuLoadHigh', options: {}, style: { color: WHITE, bgcolor: RED } }],
			}),
		)
		add(
			presetId(CAT_SYSTEM, 'cpu_temp'),
			button({
				category: CAT_SYSTEM,
				name: 'CPU temperature',
				text: `CPU temp\n${v('system_status_cputemp')}°C`,
				bgcolor: GREY,
				feedbacks: [{ feedbackId: 'cpuTempHigh', options: {}, style: { color: WHITE, bgcolor: ORANGE } }],
			}),
		)
		add(
			presetId(CAT_SYSTEM, 'uptime'),
			button({
				category: CAT_SYSTEM,
				name: 'Uptime',
				text: `Uptime\n${v('system_status_uptime_hms')}`,
				bgcolor: GREY,
			}),
		)
		add(
			presetId(CAT_SYSTEM, 'reboot'),
			button({
				category: CAT_SYSTEM,
				name: 'Reboot',
				text: 'Reboot\nPearl',
				size: 14,
				bgcolor: DARK_RED,
				actions: [{ actionId: 'systemReboot', options: {} }],
			}),
		)
		add(
			presetId(CAT_SYSTEM, 'refresh'),
			button({
				category: CAT_SYSTEM,
				name: 'Refresh',
				text: 'Refresh\nstatus',
				size: 14,
				bgcolor: GREY,
				actions: [{ actionId: 'refreshPoll', options: {} }],
			}),
		)

		// ---------------------------------------------------------------------
		// Events (CMS schedule)
		// ---------------------------------------------------------------------

		add(
			presetId(CAT_EVENTS, 'start_upcoming'),
			button({
				category: CAT_EVENTS,
				name: 'Start upcoming event',
				text: `Start next\n${v('event_upcoming_title')}`,
				size: 7,
				bgcolor: GREY,
				actions: [{ actionId: 'eventControl', options: { event: 'upcoming', eventId: '', action: 'start' } }],
				feedbacks: [
					{
						feedbackId: 'eventStatus',
						options: { which: 'upcoming' },
						style: { color: WHITE, bgcolor: DARK_GREEN },
					},
				],
			}),
		)
		add(
			presetId(CAT_EVENTS, 'stop_ongoing'),
			button({
				category: CAT_EVENTS,
				name: 'Stop ongoing event',
				text: `Stop event\n${v('event_ongoing_title')}`,
				size: 7,
				bgcolor: GREY,
				actions: [{ actionId: 'eventControl', options: { event: 'ongoing', eventId: '', action: 'stop' } }],
				feedbacks: [
					{
						feedbackId: 'eventStatus',
						options: { which: 'ongoing' },
						style: { color: WHITE, bgcolor: DARK_RED },
					},
				],
			}),
		)
		add(
			presetId(CAT_EVENTS, 'pause'),
			button({
				category: CAT_EVENTS,
				name: 'Pause event',
				text: 'Pause\nevent',
				size: 14,
				bgcolor: GREY,
				actions: [{ actionId: 'eventControl', options: { event: 'running', eventId: '', action: 'pause' } }],
				feedbacks: [
					{
						feedbackId: 'eventStatus',
						options: { which: 'running' },
						style: { color: BLACK, bgcolor: YELLOW },
					},
				],
			}),
		)
		add(
			presetId(CAT_EVENTS, 'resume'),
			button({
				category: CAT_EVENTS,
				name: 'Resume event',
				text: 'Resume\nevent',
				size: 14,
				bgcolor: GREY,
				actions: [{ actionId: 'eventControl', options: { event: 'paused', eventId: '', action: 'resume' } }],
				feedbacks: [
					{
						feedbackId: 'eventStatus',
						options: { which: 'paused' },
						style: { color: WHITE, bgcolor: DARK_GREEN },
					},
				],
			}),
		)
		add(
			presetId(CAT_EVENTS, 'extend_5min'),
			button({
				category: CAT_EVENTS,
				name: 'Extend event +5 min',
				text: 'Extend\n+5 min',
				size: 14,
				bgcolor: GREY,
				actions: [{ actionId: 'eventExtend', options: { event: 'ongoing', eventId: '', seconds: 300 } }],
				feedbacks: [
					{
						feedbackId: 'eventStatus',
						options: { which: 'ongoing' },
						style: { color: WHITE, bgcolor: BLUE },
					},
				],
			}),
		)
		add(
			presetId(CAT_EVENTS, 'status_ongoing'),
			button({
				category: CAT_EVENTS,
				name: 'Ongoing event status',
				text: `${v('event_ongoing_title')}\n${v('event_ongoing_status')}\n${v('event_ongoing_remaining_hms')}`,
				size: 7,
				bgcolor: GREY,
				feedbacks: [
					{
						feedbackId: 'eventStatus',
						options: { which: 'running' },
						style: { color: WHITE, bgcolor: DARK_GREEN },
					},
					{
						feedbackId: 'eventStatus',
						options: { which: 'paused' },
						style: { color: BLACK, bgcolor: YELLOW },
					},
				],
			}),
		)
		add(
			presetId(CAT_EVENTS, 'status_upcoming'),
			button({
				category: CAT_EVENTS,
				name: 'Upcoming event status',
				text: `Next: ${v('event_upcoming_title')}\n${v('event_upcoming_start_time')}\nin ${v('event_upcoming_starts_in_hms')}`,
				size: 7,
				bgcolor: GREY,
				feedbacks: [
					{
						feedbackId: 'eventStatus',
						options: { which: 'upcoming' },
						style: { color: WHITE, bgcolor: PURPLE },
					},
				],
			}),
		)

		// ---------------------------------------------------------------------
		// AFU (automatic file upload) status display
		// ---------------------------------------------------------------------

		add(
			presetId(CAT_AFU, 'status'),
			button({
				category: CAT_AFU,
				name: 'AFU status',
				text: `AFU\n${v('afu_state')}\n${v('afu_queue_files')} queued`,
				size: 7,
				bgcolor: GREY,
				feedbacks: [
					{
						feedbackId: 'afuState',
						options: { state: 'uploading' },
						style: { color: WHITE, bgcolor: BLUE },
					},
					{
						feedbackId: 'afuState',
						options: { state: 'error' },
						style: { color: WHITE, bgcolor: RED },
					},
				],
			}),
		)

		// ---------------------------------------------------------------------
		// Configuration presets stored on the device
		// ---------------------------------------------------------------------

		for (const preset of this.choicesConfigPresets()) {
			add(
				presetId(CAT_CONFIG_PRESETS, 'apply', preset.id),
				button({
					category: CAT_CONFIG_PRESETS,
					name: `Apply preset ${preset.label}`,
					text: `Apply preset\n${preset.label}`,
					size: 7,
					bgcolor: PURPLE,
					actions: [{ actionId: 'applyConfigPreset', options: { preset: preset.id, sections: [] } }],
					feedbacks: [
						{
							feedbackId: 'configPresetApplied',
							options: { preset: preset.id },
							style: { color: WHITE, bgcolor: BLUE },
						},
					],
				}),
			)
		}

		return presets
	},
}

module.exports.PRESET_CATEGORY_IDS = PRESET_CATEGORY_IDS
module.exports.normalisePresetCategories = normalisePresetCategories
