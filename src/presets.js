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
 * Category -> the icons.js key drawn at the top of every preset in that category. Single touch and
 * Streaming have none: the Single touch summary (reference page, 2026-09-11) and the stream keys' three
 * lines (channel / stream / state; a channel name alone can wrap) need the whole key -- with an icon in
 * the way Companion drops the last line, and on a stream key that is the state word.
 */
const CATEGORY_ICON = {
	[CAT_RECORDING]: 'recorder',
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
 * Companion variable reference for this connection.
 *
 * @param {string} variableId
 * @returns {string}
 */
function v(variableId) {
	return `$(pearl:${variableId})`
}

/**
 * Text sizes, in Companion's units, standardised on Ryan's reference page (Companion 5, 2026-09-11):
 * 20 for most buttons, 16 where two variable lines must fit (the CMS status keys), 22 for the Single
 * touch summary that has the whole key to itself. Fixed rather than `auto`: auto grows a short label
 * until it breaks mid-word ("Rebo" / "ot") and shrinks a long one to illegibility. The one exception is
 * the stream keys (channel / stream / state, see there), which need `auto` so the state line survives
 * long channel names. Device-named things wrap as Companion sees fit.
 */
const TEXT_SIZE = 20
const TEXT_SIZE_STATUS = 16
const TEXT_SIZE_SUMMARY = 22

/**
 * Build a standard button preset in the Stream Deck plugin's key layout, expressed with Companion's
 * own renderer: `restStyle()` (dark bg, light text) at rest, the category's icon at the top (each
 * src/icons.js glyph is drawn small in the top third of its 72x72 canvas; `pngalignment: 'center:top'`),
 * the text at the bottom (`alignment: 'center:bottom'`, `size`), and no top bar so the whole 72x72 key
 * is available as on the plugin's keys — every category except Single touch has a matching icons.js
 * entry. `feedbacks[].style` is what changes a button's colour; the only rest-state override here is
 * `color` (the red Stop of the CMS group).
 *
 * @param {object} def
 * @param {string} def.category
 * @param {string} def.name
 * @param {string} def.text
 * @param {number} [def.size=TEXT_SIZE] text size (TEXT_SIZE_STATUS / TEXT_SIZE_SUMMARY for the exceptions)
 * @param {number} [def.color] text colour at rest, when not the palette text colour
 * @param {Array<{actionId: string, options: object}>} [def.actions=[]] down actions (Pearl has no
 *   hold-to-move motion actions — D3 is EC20-only — so every Pearl preset's `up` step is empty)
 * @param {Array<{feedbackId: string, options: object, style?: object, isInverted?: boolean}>} [def.feedbacks=[]]
 * @param {{rotateLeft: object[], rotateRight: object[]}} [def.rotary] D4 rotary preset: adds
 *   `options.rotaryActions` and the `rotate_left`/`rotate_right` step arrays alongside `down`
 * @returns {object} preset definition
 */
function button({ category, name, text, size = TEXT_SIZE, color, actions = [], feedbacks = [], rotary = null }) {
	const style = { text, size, show_topbar: false, alignment: 'center:bottom', ...restStyle() }
	if (color !== undefined) style.color = color
	const icon = ICONS[CATEGORY_ICON[category]]
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
		// Streaming: one toggle button per publisher, plus per channel "All Streams"
		// ---------------------------------------------------------------------

		for (const publisher of this.choicesPublishers()) {
			const pair = splitPair(publisher.id)
			const isAll = pair && pair[1] === 'all'
			const stateWordVar =
				isAll && pair
					? `channel_${safeId(pair[0])}_publishers_state_word`
					: `channel_${safeId(pair?.[0] ?? '')}_publisher_${safeId(pair?.[1] ?? '')}_state_word`
			// channel name, then the stream's own name (or "All Streams"), then the state (reference page,
			// 2026-09-11); names are variables so a rename follows. Companion sizes this text itself: a channel
			// name alone can wrap, and at any fixed size four lines overflow the key and Companion drops the last
			// one -- the state word, the line that matters -- so this is the one preset that uses `auto`, with
			// no icon so the text has the whole key
			const cid = safeId(pair?.[0] ?? '')
			const streamLine = isAll ? 'All Streams' : v(`channel_${cid}_publisher_${safeId(pair?.[1] ?? '')}_name`)
			add(
				presetId(CAT_STREAMING, 'toggle', publisher.id),
				button({
					category: CAT_STREAMING,
					name: `${publisher.label} toggle`,
					text: `${v(`channel_${cid}_name`)}\n${streamLine}\n${v(stateWordVar)}`,
					size: 'auto',
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
		// Layouts: one switch button per layout, "<layout name> <channel name>" (reference page, 2026-09-11)
		// ---------------------------------------------------------------------

		for (const channel of Object.values(this.state?.channels || {})) {
			for (const layout of Object.values(channel.layouts || {})) {
				const layoutId = `${channel.id}-${layout.id}`
				add(
					presetId(CAT_LAYOUTS, channel.id, layout.id),
					button({
						category: CAT_LAYOUTS,
						name: `${channel.name ?? channel.id} – ${layout.name ?? layout.id}`,
						text: `${layout.name ?? layout.id} ${channel.name ?? channel.id}`,
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
					// preset_status ("Rebooting..." after a reboot-reporting apply) on the last line; the confirm
					// hint is the confirm_pending feedback's own text, so it shows on the armed button only
					text: `Apply\n${preset.id}\n${v('preset_status')}`,
					actions: [{ actionId: 'preset', options: { presetName: preset.id, sections: [], confirm: true } }],
					feedbacks: [{ feedbackId: 'confirm_pending', options: {}, style: confirmStyle() }],
				}),
			)
		}

		// ---------------------------------------------------------------------
		// CMS events (schedule): the two status keys and the toggle show live variables, the fixed commands
		// read as the verb alone (reference page, 2026-09-11)
		// ---------------------------------------------------------------------

		add(
			presetId(CAT_CMS_EVENTS, 'status_ongoing'),
			button({
				category: CAT_CMS_EVENTS,
				name: 'Ongoing event status',
				text: `${v('event_ongoing_title')}\n${v('event_ongoing_time_text')}`,
				size: TEXT_SIZE_STATUS,
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
				size: TEXT_SIZE_STATUS,
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
				text: v('event_ongoing_toggle_command'),
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
				text: 'Start',
				actions: [{ actionId: 'event', options: { eventRef: 'upcoming', op: 'start' } }],
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
				actions: [{ actionId: 'event', options: { eventRef: 'ongoing', op: 'stop' } }],
				feedbacks: [appliesGreyOut('ongoing', 'stop')],
			}),
		)
		add(
			presetId(CAT_CMS_EVENTS, 'pause'),
			button({
				category: CAT_CMS_EVENTS,
				name: 'Pause event',
				text: 'Pause',
				actions: [{ actionId: 'event', options: { eventRef: 'ongoing', op: 'pause' } }],
				feedbacks: [appliesGreyOut('ongoing', 'pause')],
			}),
		)
		add(
			presetId(CAT_CMS_EVENTS, 'resume'),
			button({
				category: CAT_CMS_EVENTS,
				name: 'Resume event',
				text: 'Resume',
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
		// Storage: free space / status display per storage, eject on press (confirm, D2)
		// ---------------------------------------------------------------------

		for (const storage of this.choicesStorages()) {
			// the Pearl's internal maintenance partition is not operator storage (reference page, 2026-09-11)
			if (/maintenance/i.test(storage.id) || /maintenance/i.test(storage.label)) continue
			const sid = safeId(storage.id)
			add(
				presetId(CAT_STORAGE, storage.id),
				button({
					category: CAT_STORAGE,
					name: `${storage.label} status`,
					// the "Ejected" hint on the last line; the confirm hint is the confirm_pending feedback's own
					// text (D2), so it shows on the armed button only
					text: `${v(`storage_${sid}_free`)}\n${v(`storage_${sid}_text`)}\n${v(`storage_${sid}_hint`)}`,
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
						{ feedbackId: 'confirm_pending', options: {}, style: confirmStyle() },
					],
				}),
			)
		}

		return presets
	},
}

module.exports.PRESET_CATEGORY_IDS = PRESET_CATEGORY_IDS
module.exports.normalisePresetCategories = normalisePresetCategories
