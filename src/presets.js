// D-numbers (D1–D17) refer to Epiphan's internal Companion-parity decisions.
const { safeId, splitPair, STORAGE_SEVERITY } = require('./utils')
const { colors, restStyle, stateStyle } = require('./style')
const { CONFIRM_HINT } = require('./confirm')
const { FAILED_TEXT } = require('./failure')

/** confirm_pending on a preset: red, with the hint in place of the label -- per button, unlike the global confirm_hint variable */
const confirmStyle = () => ({ ...stateStyle(colors.red), text: CONFIRM_HINT })
/** action_failed on a preset: red with "Failed" in place of the label for three seconds after a rejected command */
const failedStyle = () => ({ ...stateStyle(colors.red), text: FAILED_TEXT })
/** the action_failed feedback every command preset carries, appended last so it wins over the state colours */
const failedFeedback = () => ({ feedbackId: 'action_failed', options: {}, style: failedStyle() })
const { ICONS } = require('./icons')

/** colour of each severity level of utils.storageLevel() on the Storage presets */
const STORAGE_SEVERITY_COLORS = { ok: colors.green, low: colors.amber, full: colors.red }

const CAT_RECORDING = 'Recording'
const CAT_STREAMING = 'Streaming'
const CAT_LAYOUTS = 'Layouts'
const CAT_SINGLE_TOUCH = 'Single touch'
const CAT_BOOKMARKS = 'Bookmarks'
const CAT_PREVIEWS = 'Previews'
const CAT_CONFIG_PRESETS = 'Configuration presets'
const CAT_CMS_EVENTS = 'CMS events'
const CAT_SYSTEM = 'System'
const CAT_POWER = 'Power'
const CAT_STORAGE = 'Storage'

/**
 * Every preset category that can be generated, in the order they are built (D15: one category per
 * Stream Deck Pearl action, minus Outputs and Audio, dropped from the ready-made buttons on 2026-09-11 --
 * their actions, feedbacks and variables stay for hand-built buttons). Used to build the "Preset categories to generate" connection setting
 * (src/config.js) and to validate/default its stored value (see normalisePresetCategories).
 */
const PRESET_CATEGORY_IDS = [
	CAT_RECORDING,
	CAT_STREAMING,
	CAT_LAYOUTS,
	CAT_SINGLE_TOUCH,
	CAT_BOOKMARKS,
	CAT_PREVIEWS,
	CAT_CONFIG_PRESETS,
	CAT_CMS_EVENTS,
	CAT_SYSTEM,
	CAT_POWER,
	CAT_STORAGE,
]

/**
 * Category -> the icons.js key drawn at the top of a preset in that category, unless the preset is
 * `named` (see button()). Single touch and Streaming have none: the Single touch summary (reference page,
 * 2026-09-11) stands alone, and every stream key is named.
 */
const CATEGORY_ICON = {
	[CAT_RECORDING]: 'rec',
	[CAT_LAYOUTS]: 'layout',
	[CAT_BOOKMARKS]: 'bookmark',
	[CAT_PREVIEWS]: 'preview',
	[CAT_CONFIG_PRESETS]: 'preset',
	[CAT_CMS_EVENTS]: 'event',
	[CAT_SYSTEM]: 'system',
	[CAT_POWER]: 'power',
	[CAT_STORAGE]: 'storage',
}

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
 * Text sizes, in Companion's units, standardised on Ryan's reference page (Companion 5, 2026-09-11):
 * 20 for most buttons, 16 where two variable lines must fit (the CMS status keys), 22 for the Single
 * touch summary that has the whole key to itself. Fixed rather than `auto`: auto grows a short label
 * until it breaks mid-word ("Rebo" / "ot") and shrinks a long one to illegibility. The one exception is
 * the stream keys (channel / stream / state, see there), which need `auto` so the state line survives
 * long channel names. Device-named things wrap as Companion sees fit.
 */
/**
 * Text size of every key but the Single touch summary: the Stream Deck plugin's own budget (the EC20
 * module uses the same). Measured on Companion 5.0.4's 288 px render: about nine characters per line,
 * four lines per key, two below an icon (a third touches the glyph), and a trailing empty line costs
 * nothing. It is the largest size at which every fixed word of the module ("Recorders", "scheduled",
 * "Bookmark") still fits on one line; at 16 and above Companion breaks them mid-word, and under an icon
 * anything past two six-character lines climbs into the glyph (QA 2026-09-14). `auto` is no alternative:
 * Companion picks it by height alone and char-breaks words on short texts ("Bookm/ark").
 */
const TEXT_SIZE = 14
/** the Single touch summary stands alone on its key, no icon (reference page, 2026-09-11) */
const TEXT_SIZE_SUMMARY = 22

/**
 * Build a standard button preset in the Stream Deck plugin's key layout, expressed with Companion's
 * own renderer: `restStyle()` (dark bg, light text) at rest, TEXT_SIZE text, no top bar so the whole
 * 72x72 key is available as on the plugin's keys, and one of two layouts. Companion draws the icon and
 * the text as two layers that know nothing of each other (module base 1.12 has no text box), so the
 * layout decides whether they can collide:
 *
 * - a key with the category icon (each src/icons.js glyph is drawn small in the top third of its 72x72
 *   canvas; `pngalignment: 'center:top'`) puts at most two template lines at the bottom
 *   (`alignment: 'center:bottom'`), so the text stays below the glyph -- a third only when it is a
 *   transient hint that is empty at rest (the Storage keys);
 * - a `named` key -- its text carries a device-provided name or event title, which wraps however short
 *   the template is -- carries no icon and centres the text, so the whole key is there for the wrapped
 *   lines and a long name never hides the state line. On Previews and Layouts the live picture replaces
 *   the icon.
 *
 * `feedbacks[].style` is what changes a button's colour; the only rest-state override here is `color`
 * (the red Stop of the CMS group).
 *
 * @param {object} def
 * @param {string} def.category
 * @param {string} def.name
 * @param {string} def.text
 * @param {boolean} [def.named=false] the text carries a device-provided name or title: no icon, centred
 * @param {string} [def.icon] icons.js key drawn instead of the category's icon (the Recording state glyphs)
 * @param {number} [def.size=TEXT_SIZE] text size (TEXT_SIZE_SUMMARY on the Single touch summary)
 * @param {number} [def.color] text colour at rest, when not the palette text colour
 * @param {Array<{actionId: string, options: object}>} [def.actions=[]] down actions (Pearl has no
 *   hold-to-move motion actions — D3 is EC20-only — so every Pearl preset's `up` step is empty)
 * @param {Array<{feedbackId: string, options: object, style?: object, isInverted?: boolean}>} [def.feedbacks=[]]
 * @param {{rotateLeft: object[], rotateRight: object[]}} [def.rotary] D4 rotary preset: adds
 *   `options.rotaryActions` and the `rotate_left`/`rotate_right` step arrays alongside `down`
 * @returns {object} preset definition
 */
function button({
	category,
	name,
	text,
	named = false,
	icon: iconKey,
	size,
	color,
	actions = [],
	feedbacks = [],
	rotary = null,
}) {
	const icon = named ? undefined : ICONS[iconKey ?? CATEGORY_ICON[category]]
	const style = {
		text,
		size: size ?? TEXT_SIZE,
		show_topbar: false,
		alignment: icon ? 'center:bottom' : 'center:center',
		...restStyle(),
	}
	if (color !== undefined) style.color = color
	if (icon) {
		style.png64 = icon
		style.pngalignment = 'center:top'
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
		// a command preset also carries the failure flash, last so it wins over the state colours
		feedbacks: actions.length > 0 || rotary ? [...feedbacks, failedFeedback()] : feedbacks,
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
		// Companion resolves $(label:variable) by the connection's label, which the user may change and which
		// Companion suffixes for a second device (label_2). The base library hands the module its current label
		// at start-up and again through configUpdated() on a rename, and both paths rebuild the presets, so the
		// references are built from it here rather than from a fixed word.
		const v = (variableId) => `$(${this.label}:${variableId})`
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
		// Recording: per recorder (and "All recorders") a Start / Stop key and a Pause / Resume key. Both carry
		// a state glyph at the top (a 64 px box, so a wrapped recorder name plus the state line still fit under
		// it) that follows the recorder: Start / Stop shows a record dot at rest and a red stop square while
		// recording; Pause / Resume a green pause bar while recording and a blinking amber play triangle while
		// paused (QA 2026-10-09).
		// ---------------------------------------------------------------------

		for (const recorder of this.choicesRecordersWithAll()) {
			const rid = recorder.id
			const isAll = rid === 'all'
			const name = isAll ? 'Recorders' : recorder.label
			const state = (s) => ({ feedbackId: 'recorder_state', options: { recorderId: rid, state: s } })
			const stateText = isAll
				? `${v('recorder_all_state_word')} (${v('recorders_active_count')})`
				: `${v(`recorder_${safeId(rid)}_state_word`)} ${v(`recorder_${safeId(rid)}_duration_text`)}`
			add(
				presetId(CAT_RECORDING, 'toggle', rid),
				button({
					category: CAT_RECORDING,
					name: `${recorder.label} start / stop`,
					text: `${name}\n${stateText}`,
					icon: 'rec',
					actions: [{ actionId: 'recorder', options: { recorderId: rid, op: 'toggle' } }],
					feedbacks: [
						{ ...state('starting'), style: { ...stateStyle(colors.amber), png64: ICONS.rec } },
						{ ...state('paused'), style: { ...stateStyle(colors.amber), png64: ICONS.pause } },
						{ ...state('started'), style: { ...stateStyle(colors.red), png64: ICONS.stop } },
						{ ...state('error'), style: { ...stateStyle(colors.red), png64: ICONS.stop } },
					],
				}),
			)
			add(
				presetId(CAT_RECORDING, 'pause', rid),
				button({
					category: CAT_RECORDING,
					name: `${recorder.label} pause / resume`,
					text: `${name}\nPause`,
					icon: 'play',
					actions: [{ actionId: 'recorder', options: { recorderId: rid, op: 'pause_resume' } }],
					feedbacks: [
						// nothing to pause or resume while stopped: grey text, like a CMS command that does not apply
						{ ...state('stopped'), style: { color: colors.grey } },
						{ ...state('disabled'), style: { color: colors.grey } },
						{ ...state('starting'), style: { ...stateStyle(colors.green), png64: ICONS.pause } },
						{ ...state('started'), style: { ...stateStyle(colors.green), png64: ICONS.pause } },
						{
							...state('paused'),
							style: { ...stateStyle(colors.amber), png64: ICONS.play, text: `${name}\nResume` },
						},
						// the blink: every 500 ms while paused the amber drops back to the rest colours (src/blink.js)
						{
							feedbackId: 'recorder_blink',
							options: { recorderId: rid },
							style: { ...restStyle(), png64: ICONS.play, text: `${name}\nResume` },
						},
					],
				}),
			)
		}

		// ---------------------------------------------------------------------
		// Streaming: one toggle button per publisher, plus a "Streams" key per channel (all of its publishers)
		// ---------------------------------------------------------------------

		for (const publisher of this.choicesPublishers()) {
			const pair = splitPair(publisher.id)
			const isAll = pair && pair[1] === 'all'
			const stateWordVar =
				isAll && pair
					? `channel_${safeId(pair[0])}_publishers_state_word`
					: `channel_${safeId(pair?.[0] ?? '')}_publisher_${safeId(pair?.[1] ?? '')}_state_word`
			// channel name, then the stream's own name (or "Streams" on the all-publishers key), then the state
			// (reference page, 2026-09-11); names are variables so a rename follows. A named key: no icon, so the
			// whole key is there for the wrapped lines. Four lines fit a key: a two-line channel name, the stream
			// line and the state -- "All Streams" was one character too long for a line and pushed the state off
			// the key (QA 2026-09-14)
			const cid = safeId(pair?.[0] ?? '')
			const streamLine = isAll ? 'Streams' : v(`channel_${cid}_publisher_${safeId(pair?.[1] ?? '')}_name`)
			add(
				presetId(CAT_STREAMING, 'toggle', publisher.id),
				button({
					category: CAT_STREAMING,
					name: `${publisher.label} toggle`,
					text: `${v(`channel_${cid}_name`)}\n${streamLine}\n${v(stateWordVar)}`,
					named: true,
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
		// Layouts: one switch button per layout, layout name over channel name (reference page, 2026-09-11):
		// two short lines at the bottom of the live picture instead of one wrapped by Companion (QA 2026-09-14)
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
								options: { channelId: String(channel.id), layoutId },
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
		// Single touch: toggle per control; the summary alone at the large size, no icon (reference page)
		// ---------------------------------------------------------------------

		for (const stc of this.choicesSingleTouch()) {
			add(
				presetId(CAT_SINGLE_TOUCH, 'toggle', stc.id),
				button({
					category: CAT_SINGLE_TOUCH,
					name: `${stc.label} toggle`,
					text: v(`singletouch_${safeId(stc.id)}_summary`),
					size: TEXT_SIZE_SUMMARY,
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
					text: `${v(`channel_${safeId(channel.id)}_name`)}\nBookmark`,
					named: true,
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
		// Configuration presets stored on the device (confirm before applying, D2)
		// ---------------------------------------------------------------------

		for (const preset of this.choicesConfigPresets()) {
			add(
				presetId(CAT_CONFIG_PRESETS, 'apply', preset.id),
				button({
					category: CAT_CONFIG_PRESETS,
					name: `Apply ${preset.label}`,
					// the preset's name over preset_status ("Rebooting..." after a reboot-reporting apply). A named key:
					// device preset names run to four lines, so no star (the picker name says apply) and centred text
					// (QA 2026-09-14). The confirm hint is the confirm_pending feedback's own text, so it shows on the
					// armed button only
					text: `${preset.id}\n${v('preset_status')}`,
					named: true,
					actions: [{ actionId: 'preset', options: { presetName: preset.id, sections: [], confirm: true } }],
					feedbacks: [{ feedbackId: 'confirm_pending', options: {}, style: confirmStyle() }],
				}),
			)
		}

		// ---------------------------------------------------------------------
		// CMS events (schedule): the two status keys show live variables and are named (an event title needs the
		// whole key); the command keys read as the verb alone. The ongoing event only pauses / resumes, stops or
		// extends, the upcoming event only starts (QA 2026-10-09).
		// ---------------------------------------------------------------------

		add(
			presetId(CAT_CMS_EVENTS, 'status_ongoing'),
			button({
				category: CAT_CMS_EVENTS,
				name: 'Ongoing event status',
				text: `${v('event_ongoing_title')}\n${v('event_ongoing_time_text')}`,
				named: true,
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
				named: true,
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
				name: 'Pause / resume ongoing event',
				text: 'Pause /\nResume',
				actions: [
					{
						actionId: 'event',
						options: { eventRef: 'ongoing', op: 'toggle', op_event: 'start', extendSeconds: 300 },
					},
				],
				feedbacks: [
					{
						feedbackId: 'event_state',
						options: { eventRef: 'ongoing', state: 'running' },
						style: { ...stateStyle(colors.green), text: 'Pause' },
					},
					{
						feedbackId: 'event_state',
						options: { eventRef: 'ongoing', state: 'paused' },
						style: { ...stateStyle(colors.amber), text: 'Resume' },
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
				text: 'Start',
				actions: [
					{
						actionId: 'event',
						options: { eventRef: 'upcoming', op: 'toggle', op_event: 'start', extendSeconds: 300 },
					},
				],
				feedbacks: [appliesGreyOut('upcoming', 'start')],
			}),
		)
		add(
			presetId(CAT_CMS_EVENTS, 'stop'),
			button({
				category: CAT_CMS_EVENTS,
				name: 'Stop ongoing event',
				text: 'Stop',
				color: colors.red, // the one red label of the set: the destructive command (reference page)
				actions: [
					{
						actionId: 'event',
						options: { eventRef: 'ongoing', op: 'stop', op_event: 'start', extendSeconds: 300 },
					},
				],
				feedbacks: [appliesGreyOut('ongoing', 'stop')],
			}),
		)
		add(
			presetId(CAT_CMS_EVENTS, 'extend_5min'),
			button({
				category: CAT_CMS_EVENTS,
				name: 'Extend event +5:00',
				text: 'Extend\n+5:00',
				actions: [
					{
						actionId: 'event',
						options: { eventRef: 'ongoing', op: 'extend', op_event: 'start', extendSeconds: 300 },
					},
				],
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
				// the status text (temperature · uptime) always wraps, and three lines run into the gear (QA 2026-09-14)
				named: true,
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

		// power_status ("Command sent") on the last line; the confirm hint is the confirm_pending feedback's
		// own text (D2), so it shows on the armed button only, not on both power buttons
		add(
			presetId(CAT_POWER, 'reboot'),
			button({
				category: CAT_POWER,
				name: 'Reboot',
				text: `Reboot\n${v('power_status')}`,
				actions: [{ actionId: 'power', options: { op: 'reboot', confirm: true } }],
				feedbacks: [{ feedbackId: 'confirm_pending', options: {}, style: confirmStyle() }],
			}),
		)
		add(
			presetId(CAT_POWER, 'shutdown'),
			button({
				category: CAT_POWER,
				name: 'Shut down',
				text: `Shut down\n${v('power_status')}`,
				actions: [{ actionId: 'power', options: { op: 'shutdown', confirm: true } }],
				feedbacks: [{ feedbackId: 'confirm_pending', options: {}, style: confirmStyle() }],
			}),
		)

		// ---------------------------------------------------------------------
		// Storage: free space / status display per storage. Display only: ejecting is left to the device's own
		// UI (QA 2026-10-09).
		// ---------------------------------------------------------------------

		for (const storage of this.choicesStorages()) {
			// the device's internal maintenance partition is not operator storage (reference page, 2026-09-11)
			if (/maintenance/i.test(storage.id) || /maintenance/i.test(storage.label)) continue
			const sid = safeId(storage.id)
			add(
				presetId(CAT_STORAGE, storage.id),
				button({
					category: CAT_STORAGE,
					name: `${storage.label} status`,
					text: `${v(`storage_${sid}_free`)}\n${v(`storage_${sid}_text`)}`,
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
					],
				}),
			)
		}

		return presets
	},
}

module.exports.PRESET_CATEGORY_IDS = PRESET_CATEGORY_IDS
module.exports.normalisePresetCategories = normalisePresetCategories
