const { safeId, splitPair, STORAGE_SEVERITY } = require('./utils')
const { colors, restStyle, stateStyle } = require('./style')
const { ICONS } = require('./icons')

/** colour of each severity level of utils.storageLevel() on the Storage presets */
const STORAGE_SEVERITY_COLORS = { ok: colors.green, low: colors.amber, full: colors.red }

const CAT_RECORDING = 'Recording'
const CAT_STREAMING = 'Streaming'
const CAT_LAYOUTS = 'Layouts'
const CAT_SINGLE_TOUCH = 'Single touch'
const CAT_BOOKMARKS = 'Bookmarks'
const CAT_PREVIEWS = 'Previews'
const CAT_OUTPUTS = 'Outputs'
const CAT_CONFIG_PRESETS = 'Configuration presets'
const CAT_CMS_EVENTS = 'CMS events'
const CAT_SYSTEM = 'System'
const CAT_POWER = 'Power'
const CAT_AUDIO = 'Audio'
const CAT_STORAGE = 'Storage'

/**
 * Every preset category that can be generated, in the order they are built (D15: one category per
 * Stream Deck Pearl action). Used to build the "Preset categories to generate" connection setting
 * (src/config.js) and to validate/default its stored value (see normalisePresetCategories).
 */
const PRESET_CATEGORY_IDS = [
	CAT_RECORDING,
	CAT_STREAMING,
	CAT_LAYOUTS,
	CAT_SINGLE_TOUCH,
	CAT_BOOKMARKS,
	CAT_PREVIEWS,
	CAT_OUTPUTS,
	CAT_CONFIG_PRESETS,
	CAT_CMS_EVENTS,
	CAT_SYSTEM,
	CAT_POWER,
	CAT_AUDIO,
	CAT_STORAGE,
]

/** Category -> the icons.js key drawn at the top of every preset in that category (all 13 have one). */
const CATEGORY_ICON = {
	[CAT_RECORDING]: 'recorder',
	[CAT_STREAMING]: 'stream',
	[CAT_LAYOUTS]: 'layout',
	[CAT_SINGLE_TOUCH]: 'singletouch',
	[CAT_BOOKMARKS]: 'bookmark',
	[CAT_PREVIEWS]: 'preview',
	[CAT_OUTPUTS]: 'output',
	[CAT_CONFIG_PRESETS]: 'preset',
	[CAT_CMS_EVENTS]: 'event',
	[CAT_SYSTEM]: 'system',
	[CAT_POWER]: 'power',
	[CAT_AUDIO]: 'audio',
	[CAT_STORAGE]: 'storage',
}

/** Built-in output sources offered by the `output` action, labelled without the dropdown's "Built-in:" prefix; `keyLabel` is the shorter word for the button. */
const OUTPUT_BUILTIN_SOURCES = [
	{ id: 'multiview', label: 'Multiview' },
	{ id: 'deviceinfo', label: 'Device info', keyLabel: 'Dev. info' }, // 'Device info' wraps at 14 px
	{ id: 'console', label: 'Console' },
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
 * @param {...(string|number)} parts
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
 * Text size of every preset, in Companion's units (14 = the size Companion itself defaults to).
 * Fixed rather than `auto`: auto grows a short label until it breaks mid-word ("Rebo" / "ot") and
 * shrinks a long one to illegibility, and the Stream Deck plugin's subtitles are small text anyway.
 * At 14 px a 72 px button holds about ten characters per line and two lines under the icon, so
 * every fixed label below is written to fit that; a third line (the transient confirm hint, D2)
 * only ever appears together with a colour change. Device-named things (layouts, publishers) wrap
 * as Companion sees fit.
 */
const TEXT_SIZE = 14

/**
 * Build a standard button preset in the Stream Deck plugin's key layout, expressed with Companion's
 * own renderer: `restStyle()` (dark bg, light text) at rest, the category's icon at the top (each
 * src/icons.js glyph is drawn small in the top third of its 72x72 canvas; `pngalignment: 'center:top'`),
 * the text at the bottom (`alignment: 'center:bottom'`, TEXT_SIZE), and no top bar so the whole 72x72
 * key is available as on the plugin's keys — every one of the 13 categories has a matching icons.js
 * entry. `feedbacks[].style` is the only thing that changes a button's colour; nothing here overrides
 * `bgcolor`/`color` at rest.
 *
 * @param {object} def
 * @param {string} def.category
 * @param {string} def.name
 * @param {string} def.text
 * @param {Array<{actionId: string, options: object}>} [def.actions=[]] down actions (Pearl has no
 *   hold-to-move motion actions — D3 is EC20-only — so every Pearl preset's `up` step is empty)
 * @param {Array<{feedbackId: string, options: object, style?: object, isInverted?: boolean}>} [def.feedbacks=[]]
 * @param {{rotateLeft: object[], rotateRight: object[]}} [def.rotary] D4 rotary preset: adds
 *   `options.rotaryActions` and the `rotate_left`/`rotate_right` step arrays alongside `down`
 * @returns {object} preset definition
 */
function button({ category, name, text, actions = [], feedbacks = [], rotary = null }) {
	const style = { text, size: TEXT_SIZE, show_topbar: false, ...restStyle() }
	const icon = ICONS[CATEGORY_ICON[category]]
	if (icon) {
		style.png64 = icon
		style.pngalignment = 'center:top'
		style.alignment = 'center:bottom'
	}
	const step = { down: actions, up: [] }
	if (rotary) {
		step.rotate_left = rotary.rotateLeft
		step.rotate_right = rotary.rotateRight
	}
	const preset = {
		type: 'button',
		category,
		name,
		style,
		steps: [step],
		feedbacks,
	}
	if (rotary) preset.options = { rotaryActions: true }
	return preset
}

/** `event_applies` feedback entry that greys out the text of a fixed command that does not apply. */
function appliesGreyOut(eventRef, op) {
	return {
		feedbackId: 'event_applies',
		options: { eventRef, op },
		isInverted: true,
		style: { color: colors.grey },
	}
}

module.exports = {
	/**
	 * INTERNAL: Get the available presets.
	 *
	 * @access protected
	 * @returns {Object} the available presets keyed by preset id
	 */
	getPresets() {
		const presets = {}
		const enabledCategories = new Set(normalisePresetCategories(this.config?.preset_categories))

		// ids that collide after safeId() get a _2, _3, ... suffix instead of being dropped
		const add = (id, preset) => {
			// the "Preset categories to generate" connection setting; a category left unchecked there
			// simply never gets any buttons added, one gate for every category below
			if (!enabledCategories.has(preset.category)) return
			let unique = id
			for (let n = 2; presets[unique] !== undefined; n++) unique = `${id}_${n}`
			if (unique !== id) this.log('debug', `duplicate preset id ${id}, using ${unique}`)
			presets[unique] = preset
		}

		// ---------------------------------------------------------------------
		// Recording: one toggle button per recorder, plus "All recorders" (recorderId: all)
		// ---------------------------------------------------------------------

		for (const recorder of this.choicesRecordersWithAll()) {
			const isAll = recorder.id === 'all'
			const text = isAll
				? `Recorders\n${v('recorder_all_state_word')} (${v('recorders_active_count')})`
				: `${recorder.label}\n${v(`recorder_${safeId(recorder.id)}_state_word`)} ${v(`recorder_${safeId(recorder.id)}_duration_text`)}`
			add(
				presetId(CAT_RECORDING, 'toggle', recorder.id),
				button({
					category: CAT_RECORDING,
					name: `${recorder.label} toggle`,
					text,
					actions: [{ actionId: 'recorder', options: { recorderId: recorder.id, op: 'toggle' } }],
					feedbacks: [
						{
							feedbackId: 'recorder_state',
							options: { recorderId: recorder.id, state: 'started' },
							style: stateStyle(colors.red),
						},
						{
							feedbackId: 'recorder_state',
							options: { recorderId: recorder.id, state: 'error' },
							style: stateStyle(colors.red),
						},
						{
							feedbackId: 'recorder_state',
							options: { recorderId: recorder.id, state: 'paused' },
							style: stateStyle(colors.amber),
						},
						{
							feedbackId: 'recorder_state',
							options: { recorderId: recorder.id, state: 'starting' },
							style: stateStyle(colors.amber),
						},
					],
				}),
			)
		}

		// ---------------------------------------------------------------------
		// Streaming: one toggle button per publisher, plus per channel "All publishers"
		// ---------------------------------------------------------------------

		for (const publisher of this.choicesPublishers()) {
			const pair = splitPair(publisher.id)
			const isAll = pair && pair[1] === 'all'
			const stateWordVar =
				isAll && pair
					? `channel_${safeId(pair[0])}_publishers_state_word`
					: `channel_${safeId(pair?.[0] ?? '')}_publisher_${safeId(pair?.[1] ?? '')}_state_word`
			// the key shows the publisher's own name (the preset name and category carry the channel)
			const publisherName = isAll
				? 'All streams'
				: String(
						this.state?.channels?.[pair?.[0] ?? '']?.publishers?.[pair?.[1] ?? '']?.name ??
							pair?.[1] ??
							publisher.id,
					)
			add(
				presetId(CAT_STREAMING, 'toggle', publisher.id),
				button({
					category: CAT_STREAMING,
					name: `${publisher.label} toggle`,
					text: `${publisherName}\n${v(stateWordVar)}`,
					actions: [
						{
							actionId: 'stream',
							options: { channelId: pair?.[0] ?? '', publisherId: publisher.id, op: 'toggle' },
						},
					],
					feedbacks: [
						{
							feedbackId: 'stream_state',
							options: { publisherId: publisher.id, state: 'started' },
							style: stateStyle(colors.green),
						},
						{
							feedbackId: 'stream_state',
							options: { publisherId: publisher.id, state: 'starting' },
							style: stateStyle(colors.amber),
						},
						{
							feedbackId: 'stream_state',
							options: { publisherId: publisher.id, state: 'listening' },
							style: stateStyle(colors.amber),
						},
						{
							feedbackId: 'stream_state',
							options: { publisherId: publisher.id, state: 'error' },
							style: stateStyle(colors.red),
						},
					],
				}),
			)
		}

		// ---------------------------------------------------------------------
		// Layouts: one switch button per layout, title = layout name, subtitle line = channel name
		// ---------------------------------------------------------------------

		for (const channel of Object.values(this.state?.channels || {})) {
			for (const layout of Object.values(channel.layouts || {})) {
				const layoutId = `${channel.id}-${layout.id}`
				add(
					presetId(CAT_LAYOUTS, channel.id, layout.id),
					button({
						category: CAT_LAYOUTS,
						name: `${channel.name ?? channel.id} – ${layout.name ?? layout.id}`,
						text: `${layout.name ?? layout.id}\n${channel.name ?? channel.id}`,
						actions: [
							{
								actionId: 'layout',
								options: { channelId: String(channel.id), layoutId, layoutIdManual: '' },
							},
						],
						feedbacks: [
							{ feedbackId: 'layout_active', options: { layoutId }, style: stateStyle(colors.amber) },
							{ feedbackId: 'layout_preview', options: { layoutId } },
						],
					}),
				)
			}
		}

		// ---------------------------------------------------------------------
		// Single touch: toggle per control
		// ---------------------------------------------------------------------

		for (const stc of this.choicesSingleTouch()) {
			add(
				presetId(CAT_SINGLE_TOUCH, 'toggle', stc.id),
				button({
					category: CAT_SINGLE_TOUCH,
					name: `${stc.label} toggle`,
					text: `${stc.label}\n${v(`singletouch_${safeId(stc.id)}_summary`)}`,
					actions: [{ actionId: 'singletouch', options: { stcId: stc.id } }],
					feedbacks: [
						{
							feedbackId: 'singletouch_active',
							options: { stcId: stc.id, state: 'on' },
							style: stateStyle(colors.green),
						},
						{
							feedbackId: 'singletouch_active',
							options: { stcId: stc.id, state: 'error' },
							style: stateStyle(colors.red),
						},
					],
				}),
			)
		}

		// ---------------------------------------------------------------------
		// Bookmarks: one button per channel, greyed out while its recorder is not recording
		// ---------------------------------------------------------------------

		for (const channel of this.choicesChannel()) {
			add(
				presetId(CAT_BOOKMARKS, channel.id),
				button({
					category: CAT_BOOKMARKS,
					name: `Bookmark ${channel.label}`,
					text: 'Bookmark\nMarker',
					actions: [
						{ actionId: 'bookmark', options: { channelId: channel.id, text: 'Marker', appendTime: false } },
					],
					feedbacks: [
						{
							feedbackId: 'recorder_state',
							options: { recorderId: channel.id, state: 'started' },
							isInverted: true,
							style: { color: colors.grey },
						},
					],
				}),
			)
		}

		// ---------------------------------------------------------------------
		// Previews: live image per channel / video-capable input / output
		// ---------------------------------------------------------------------

		for (const channel of this.choicesChannel()) {
			add(
				presetId(CAT_PREVIEWS, 'channel', channel.id),
				button({
					category: CAT_PREVIEWS,
					name: `Preview ${channel.label}`,
					text: v(`channel_${safeId(channel.id)}_name`),
					feedbacks: [{ feedbackId: 'preview', options: { source: 'channel', sourceId: channel.id } }],
				}),
			)
		}
		// audio-only inputs have no picture to preview
		for (const input of this.choicesInputsWithVideo()) {
			add(
				presetId(CAT_PREVIEWS, 'input', input.id),
				button({
					category: CAT_PREVIEWS,
					name: `Preview ${input.label}`,
					text: v(`input_${safeId(input.id)}_name`),
					feedbacks: [{ feedbackId: 'preview', options: { source: 'input', sourceId: input.id } }],
				}),
			)
		}
		for (const output of this.choicesOutputs()) {
			add(
				presetId(CAT_PREVIEWS, 'output', output.id),
				button({
					category: CAT_PREVIEWS,
					name: `Preview ${output.label}`,
					text: v(`output_${safeId(output.id)}_name`),
					feedbacks: [{ feedbackId: 'preview', options: { source: 'output', sourceId: output.id } }],
				}),
			)
		}

		// ---------------------------------------------------------------------
		// Outputs: one button per output x built-in source
		// ---------------------------------------------------------------------

		for (const output of this.choicesOutputs()) {
			for (const source of OUTPUT_BUILTIN_SOURCES) {
				add(
					presetId(CAT_OUTPUTS, output.id, source.id),
					button({
						category: CAT_OUTPUTS,
						name: `${output.label} → ${source.label}`,
						text: `${output.label}\n${source.keyLabel ?? source.label}`,
						actions: [{ actionId: 'output', options: { outputId: output.id, source: source.id } }],
						feedbacks: [
							{
								feedbackId: 'output_set',
								options: { outputId: output.id, source: source.id },
								style: stateStyle(colors.green),
							},
						],
					}),
				)
			}
		}

		// ---------------------------------------------------------------------
		// Configuration presets stored on the device (confirm before applying, D2)
		// ---------------------------------------------------------------------

		for (const preset of this.choicesConfigPresets()) {
			add(
				presetId(CAT_CONFIG_PRESETS, 'apply', preset.id),
				button({
					category: CAT_CONFIG_PRESETS,
					name: `Apply ${preset.label}`,
					// confirm_hint (while armed) and preset_status ("Rebooting..." after a reboot-reporting
					// apply) share the last line: actions.js clears preset_status the moment a fresh confirm
					// is armed (D2), so the two never render at the same time
					text: `Apply\n${preset.id}\n${v('confirm_hint')}${v('preset_status')}`,
					actions: [{ actionId: 'preset', options: { presetName: preset.id, sections: [], confirm: true } }],
					feedbacks: [{ feedbackId: 'confirm_pending', options: {}, style: stateStyle(colors.red) }],
				}),
			)
		}

		// ---------------------------------------------------------------------
		// CMS events (schedule)
		// ---------------------------------------------------------------------

		add(
			presetId(CAT_CMS_EVENTS, 'status_ongoing'),
			button({
				category: CAT_CMS_EVENTS,
				name: 'Ongoing event status',
				text: `${v('event_ongoing_title')}\n${v('event_ongoing_time_text')}`,
				feedbacks: [
					{
						feedbackId: 'event_state',
						options: { eventRef: 'ongoing', state: 'running' },
						style: stateStyle(colors.green),
					},
					{
						feedbackId: 'event_state',
						options: { eventRef: 'ongoing', state: 'paused' },
						style: stateStyle(colors.amber),
					},
					{
						feedbackId: 'event_state',
						options: { eventRef: 'ongoing', state: 'none' },
						style: stateStyle(colors.grey),
					},
				],
			}),
		)
		add(
			presetId(CAT_CMS_EVENTS, 'status_upcoming'),
			button({
				category: CAT_CMS_EVENTS,
				name: 'Upcoming event status',
				text: `${v('event_upcoming_title')}\n${v('event_upcoming_time_text')}`,
				feedbacks: [
					{
						feedbackId: 'event_state',
						options: { eventRef: 'upcoming', state: 'scheduled' },
						style: stateStyle(colors.cms),
					},
				],
			}),
		)
		add(
			presetId(CAT_CMS_EVENTS, 'toggle'),
			button({
				category: CAT_CMS_EVENTS,
				name: 'Toggle ongoing / next event',
				text: `${v('event_ongoing_toggle_command')}\n${v('event_ongoing_title')}`,
				actions: [{ actionId: 'event', options: { eventRef: 'ongoing', op: 'toggle' } }],
				feedbacks: [
					{
						feedbackId: 'event_state',
						options: { eventRef: 'ongoing', state: 'running' },
						style: stateStyle(colors.green),
					},
					{
						feedbackId: 'event_state',
						options: { eventRef: 'ongoing', state: 'paused' },
						style: stateStyle(colors.amber),
					},
					{
						feedbackId: 'event_state',
						options: { eventRef: 'ongoing', state: 'none' },
						style: stateStyle(colors.grey),
					},
				],
			}),
		)
		add(
			presetId(CAT_CMS_EVENTS, 'start_upcoming'),
			button({
				category: CAT_CMS_EVENTS,
				name: 'Start upcoming event',
				text: `Start\n${v('event_upcoming_title')}`,
				actions: [{ actionId: 'event', options: { eventRef: 'upcoming', op: 'start' } }],
				feedbacks: [appliesGreyOut('upcoming', 'start')],
			}),
		)
		add(
			presetId(CAT_CMS_EVENTS, 'stop'),
			button({
				category: CAT_CMS_EVENTS,
				name: 'Stop ongoing event',
				text: `Stop\n${v('event_ongoing_title')}`,
				actions: [{ actionId: 'event', options: { eventRef: 'ongoing', op: 'stop' } }],
				feedbacks: [appliesGreyOut('ongoing', 'stop')],
			}),
		)
		add(
			presetId(CAT_CMS_EVENTS, 'pause'),
			button({
				category: CAT_CMS_EVENTS,
				name: 'Pause event',
				text: `Pause\n${v('event_ongoing_title')}`,
				actions: [{ actionId: 'event', options: { eventRef: 'ongoing', op: 'pause' } }],
				feedbacks: [appliesGreyOut('ongoing', 'pause')],
			}),
		)
		add(
			presetId(CAT_CMS_EVENTS, 'resume'),
			button({
				category: CAT_CMS_EVENTS,
				name: 'Resume event',
				text: `Resume\n${v('event_ongoing_title')}`,
				actions: [{ actionId: 'event', options: { eventRef: 'ongoing', op: 'resume' } }],
				feedbacks: [appliesGreyOut('ongoing', 'resume')],
			}),
		)
		add(
			presetId(CAT_CMS_EVENTS, 'extend_5min'),
			button({
				category: CAT_CMS_EVENTS,
				name: 'Extend event +5:00',
				text: 'Extend\n+5:00',
				actions: [{ actionId: 'event', options: { eventRef: 'ongoing', op: 'extend', extendSeconds: 300 } }],
				feedbacks: [appliesGreyOut('ongoing', 'extend')],
			}),
		)

		// ---------------------------------------------------------------------
		// System (display only)
		// ---------------------------------------------------------------------

		add(
			presetId(CAT_SYSTEM, 'cpu'),
			button({
				category: CAT_SYSTEM,
				name: 'CPU load / status',
				text: `${v('cpu_load')}%\n${v('system_status_text')}`,
				feedbacks: [
					{ feedbackId: 'system', options: { condition: 'cpu_high' }, style: stateStyle(colors.amber) },
					{ feedbackId: 'system', options: { condition: 'cpu_hot' }, style: stateStyle(colors.amber) },
				],
			}),
		)
		add(
			presetId(CAT_SYSTEM, 'afu'),
			button({
				category: CAT_SYSTEM,
				name: 'AFU status',
				text: `AFU\n${v('afu_text')}`,
				feedbacks: [
					{ feedbackId: 'system', options: { condition: 'afu_uploading' }, style: stateStyle(colors.green) },
					{ feedbackId: 'system', options: { condition: 'afu_paused' }, style: stateStyle(colors.amber) },
					{ feedbackId: 'system', options: { condition: 'afu_error' }, style: stateStyle(colors.red) },
				],
			}),
		)
		add(
			presetId(CAT_SYSTEM, 'info'),
			button({
				category: CAT_SYSTEM,
				name: 'Device info',
				text: `${v('product_name')}\n${v('firmware')}`,
			}),
		)

		// ---------------------------------------------------------------------
		// Power (confirm before firing, D2)
		// ---------------------------------------------------------------------

		// confirm_hint (while armed) and power_status ("Command sent") share the last line: actions.js
		// clears power_status the moment a fresh confirm is armed (D2), so the two never render together
		add(
			presetId(CAT_POWER, 'reboot'),
			button({
				category: CAT_POWER,
				name: 'Reboot',
				text: `Reboot\n${v('confirm_hint')}${v('power_status')}`,
				actions: [{ actionId: 'power', options: { op: 'reboot', confirm: true } }],
				feedbacks: [{ feedbackId: 'confirm_pending', options: {}, style: stateStyle(colors.red) }],
			}),
		)
		add(
			presetId(CAT_POWER, 'shutdown'),
			button({
				category: CAT_POWER,
				name: 'Shut down',
				text: `Shut down\n${v('confirm_hint')}${v('power_status')}`,
				actions: [{ actionId: 'power', options: { op: 'shutdown', confirm: true } }],
				feedbacks: [{ feedbackId: 'confirm_pending', options: {}, style: stateStyle(colors.red) }],
			}),
		)

		// ---------------------------------------------------------------------
		// Audio: meter, gain +/-, delay +/-, rotary gain, rotary delay -- for the analog audio inputs only
		// (the other audio-capable inputs keep their variables, feedback and action; they just get no
		// ready-made buttons)
		// ---------------------------------------------------------------------

		for (const input of this.choicesAnalogAudioInputs()) {
			const sid = safeId(input.id)
			add(
				presetId(CAT_AUDIO, 'meter', input.id),
				button({
					category: CAT_AUDIO,
					name: `${input.label} meter`,
					text: v(`input_${sid}_name`),
					feedbacks: [{ feedbackId: 'audio', options: { inputId: input.id } }],
				}),
			)
			add(
				presetId(CAT_AUDIO, 'gain', 'up', input.id),
				button({
					category: CAT_AUDIO,
					name: `${input.label} gain +`,
					text: `${v(`input_${sid}_name`)}\nGain +`,
					actions: [
						{
							actionId: 'audio',
							options: { inputId: input.id, control: 'gain', direction: 'up', step: 1 },
						},
					],
				}),
			)
			add(
				presetId(CAT_AUDIO, 'gain', 'down', input.id),
				button({
					category: CAT_AUDIO,
					name: `${input.label} gain −`,
					text: `${v(`input_${sid}_name`)}\nGain −`,
					actions: [
						{
							actionId: 'audio',
							options: { inputId: input.id, control: 'gain', direction: 'down', step: 1 },
						},
					],
				}),
			)
			add(
				presetId(CAT_AUDIO, 'delay', 'up', input.id),
				button({
					category: CAT_AUDIO,
					name: `${input.label} delay +`,
					text: `${v(`input_${sid}_name`)}\nDelay +`,
					actions: [
						{
							actionId: 'audio',
							options: { inputId: input.id, control: 'delay', direction: 'up', step: 1 },
						},
					],
				}),
			)
			add(
				presetId(CAT_AUDIO, 'delay', 'down', input.id),
				button({
					category: CAT_AUDIO,
					name: `${input.label} delay −`,
					text: `${v(`input_${sid}_name`)}\nDelay −`,
					actions: [
						{
							actionId: 'audio',
							options: { inputId: input.id, control: 'delay', direction: 'down', step: 1 },
						},
					],
				}),
			)
			add(
				presetId(CAT_AUDIO, 'rotary', 'gain', input.id),
				button({
					category: CAT_AUDIO,
					name: `${input.label} gain (rotary)`,
					text: `${v(`input_${sid}_name`)}\nGain ${v(`input_${sid}_gain`)}`,
					actions: [
						{
							actionId: 'audio',
							options: { inputId: input.id, control: 'none', direction: 'up', step: 1 },
						},
					],
					rotary: {
						rotateLeft: [
							{
								actionId: 'audio',
								options: { inputId: input.id, control: 'gain', direction: 'down', step: 1 },
							},
						],
						rotateRight: [
							{
								actionId: 'audio',
								options: { inputId: input.id, control: 'gain', direction: 'up', step: 1 },
							},
						],
					},
				}),
			)
			add(
				presetId(CAT_AUDIO, 'rotary', 'delay', input.id),
				button({
					category: CAT_AUDIO,
					name: `${input.label} delay (rotary)`,
					text: `${v(`input_${sid}_name`)}\nDelay ${v(`input_${sid}_delay`)} ms`,
					actions: [
						{
							actionId: 'audio',
							options: { inputId: input.id, control: 'none', direction: 'up', step: 1 },
						},
					],
					rotary: {
						rotateLeft: [
							{
								actionId: 'audio',
								options: { inputId: input.id, control: 'delay', direction: 'down', step: 1 },
							},
						],
						rotateRight: [
							{
								actionId: 'audio',
								options: { inputId: input.id, control: 'delay', direction: 'up', step: 1 },
							},
						],
					},
				}),
			)
		}

		// ---------------------------------------------------------------------
		// Storage: free space / status display per storage, eject on press (confirm, D2)
		// ---------------------------------------------------------------------

		for (const storage of this.choicesStorages()) {
			const sid = safeId(storage.id)
			add(
				presetId(CAT_STORAGE, storage.id),
				button({
					category: CAT_STORAGE,
					name: `${storage.label} status`,
					// confirm_hint (while armed) and the "Ejected" hint share the last line: actions.js clears
					// the hint the moment a fresh confirm is armed (D2), so the two never render at the same time
					text: `${v(`storage_${sid}_free`)}\n${v(`storage_${sid}_text`)}\n${v('confirm_hint')}${v(`storage_${sid}_hint`)}`,
					actions: [{ actionId: 'storage', options: { storageId: storage.id, confirm: true } }],
					feedbacks: [
						// the three severity levels of utils.storageLevel(), worst last so it wins
						...STORAGE_SEVERITY.map((level) => ({
							feedbackId: 'storage_level',
							options: { storageId: storage.id, level },
							style: stateStyle(STORAGE_SEVERITY_COLORS[level]),
						})),
						{
							feedbackId: 'storage_level',
							options: { storageId: storage.id, level: 'nomedia' },
							style: stateStyle(colors.grey),
						},
						{ feedbackId: 'confirm_pending', options: {}, style: stateStyle(colors.red) },
					],
				}),
			)
		}

		return presets
	},
}

module.exports.PRESET_CATEGORY_IDS = PRESET_CATEGORY_IDS
module.exports.normalisePresetCategories = normalisePresetCategories
