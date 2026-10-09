/**
 * The target 3.0.0 preset set (D15
 * categories) and the style module (src/style.js) it is built from.
 */
const { describe, it, before, after, afterEach } = require('node:test')
const assert = require('node:assert/strict')

const { createInstance, splitRgb } = require('./harness')
const { startMockPearl } = require('./mock-pearl')
const { HEX, colors, restStyle, stateStyle } = require('../src/style')
const { ICONS } = require('../src/icons')
const { PRESET_CATEGORY_IDS, normalisePresetCategories } = require('../src/presets')

const PRESET_ID_RE = /^[a-zA-Z0-9_-]+$/

/** style objects the code deliberately gives a plain grey TEXT colour instead of stateStyle()'s
 * bgcolor+badgeText pair: the "fixed command does not apply" / "recorder not recording" grey-outs. */
function isGreyTextOnly(style) {
	return style && style.color === colors.grey && style.bgcolor === undefined
}

/**
 * Keys whose text carries a device-provided name or event title (stream, bookmark, configuration preset, the
 * two CMS status keys and the CPU key): no icon and centred text, so the whole key is there for the wrapped
 * lines (QA 2026-09-14). Recording keys carry a state glyph instead (QA 2026-10-09).
 */
function isNamedKey(id, preset) {
	return (
		['Streaming', 'Bookmarks', 'Configuration presets'].includes(preset.category) ||
		/^cms_events_status_/.test(id) ||
		id === 'system_cpu'
	)
}

function hexToComponents(hex) {
	const n = parseInt(hex.slice(1), 16)
	return { r: (n >> 16) & 0xff, g: (n >> 8) & 0xff, b: n & 0xff, a: 1 }
}

describe('style.js palette and helpers', () => {
	it('exposes the palette, round-tripping every hex through combineRgb/splitRgb', () => {
		assert.deepEqual(Object.keys(colors).sort(), Object.keys(HEX).sort())
		for (const [key, hex] of Object.entries(HEX)) {
			assert.deepEqual(splitRgb(colors[key]), hexToComponents(hex), `colors.${key} round-trips to ${hex}`)
		}
	})

	it('restStyle/stateStyle build the documented shapes', () => {
		assert.deepEqual(restStyle(), { bgcolor: colors.bg, color: colors.text })
		assert.deepEqual(stateStyle(colors.red), { bgcolor: colors.red, color: colors.badgeText })
		assert.deepEqual(stateStyle(colors.green), { bgcolor: colors.green, color: colors.badgeText })
	})
})

describe('icons.js', () => {
	it('has exactly the 9 category icons and the 4 recorder state glyphs, all valid PNG payloads', () => {
		assert.deepEqual(
			Object.keys(ICONS).sort(),
			[
				'bookmark',
				'event',
				'layout',
				'pause',
				'play',
				'power',
				'preset',
				'preview',
				'rec',
				'singletouch',
				'stop',
				'storage',
				'system',
			].sort(),
		)
		const PNG_MAGIC = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])
		for (const [key, b64] of Object.entries(ICONS)) {
			const buf = Buffer.from(b64, 'base64')
			assert.ok(buf.subarray(0, 8).equals(PNG_MAGIC), `${key} icon is not a PNG`)
		}
	})
})

describe('presets', () => {
	let mock
	let instance
	let presets
	let actionIds
	let feedbackIds

	before(async () => {
		mock = await startMockPearl()
		instance = await createInstance({ mock })
		presets = instance.definitions.presets
		actionIds = new Set(Object.keys(instance.definitions.actions))
		feedbackIds = new Set(Object.keys(instance.definitions.feedbacks))
	})

	after(async () => {
		await instance.destroy()
		await mock.close()
	})

	afterEach(async () => {
		// restore the state (and the definitions built from it) after tests that inject odd entities
		await instance.pollAll()
		instance.updateSystem()
		presets = instance.definitions.presets
	})

	it('PRESET_CATEGORY_IDS is the D15 list minus Outputs and Audio: 11 categories, in order', () => {
		assert.deepEqual(PRESET_CATEGORY_IDS, [
			'Recording',
			'Streaming',
			'Layouts',
			'Single touch',
			'Bookmarks',
			'Previews',
			'Configuration presets',
			'CMS events',
			'System',
			'Power',
			'Storage',
		])
	})

	it('generates presets (default config enables every category on the seeded mock)', () => {
		assert.ok(Object.keys(presets).length > 30, `expected >30 presets, got ${Object.keys(presets).length}`)
	})

	it('every preset id is sanitised, uses type/name (not label), and category is a D15 id', () => {
		for (const [id, preset] of Object.entries(presets)) {
			assert.match(id, PRESET_ID_RE, `preset id ${id}`)
			assert.equal(preset.type, 'button')
			assert.ok(preset.name && !('label' in preset), `preset ${id} uses name`)
			assert.ok(PRESET_CATEGORY_IDS.includes(preset.category), `preset ${id} has an unknown category`)
		}
	})

	it('every category in PRESET_CATEGORY_IDS has at least one preset, nothing outside it exists', () => {
		const used = new Set(Object.values(presets).map((p) => p.category))
		for (const category of PRESET_CATEGORY_IDS) {
			assert.ok(used.has(category), `no preset generated for category "${category}"`)
		}
		for (const category of used) {
			assert.ok(PRESET_CATEGORY_IDS.includes(category), `preset with unknown category "${category}"`)
		}
	})

	it('every preset references only defined actions and feedbacks, with valid option ids', () => {
		const optionIds = (def) => new Set(def.options.map((o) => o.id))
		for (const [id, preset] of Object.entries(presets)) {
			for (const step of preset.steps) {
				for (const list of [step.down, step.up, step.rotate_left, step.rotate_right]) {
					if (!Array.isArray(list)) continue
					for (const action of list) {
						const def = instance.definitions.actions[action.actionId]
						assert.ok(def, `${id}: unknown action ${action.actionId}`)
						assert.ok(actionIds.has(action.actionId))
						for (const key of Object.keys(action.options)) {
							assert.ok(optionIds(def).has(key), `${id}: action ${action.actionId} has no option ${key}`)
						}
					}
				}
			}
			for (const feedback of preset.feedbacks) {
				const def = instance.definitions.feedbacks[feedback.feedbackId]
				assert.ok(def, `${id}: unknown feedback ${feedback.feedbackId}`)
				assert.ok(feedbackIds.has(feedback.feedbackId))
				for (const key of Object.keys(feedback.options)) {
					assert.ok(optionIds(def).has(key), `${id}: feedback ${feedback.feedbackId} has no option ${key}`)
				}
			}
			// every $(encoder:var) referenced in the button text must be a variable that actually exists
			for (const m of String(preset.style.text).matchAll(/\$\(encoder:([^)]+)\)/g)) {
				assert.notEqual(instance.variableValues[m[1]], undefined, `${id} uses unknown variable ${m[1]}`)
			}
		}
	})

	it('every preset is restStyle() at rest, with its category icon top / text bottom (Single touch, Streaming: no icon)', () => {
		const categoryIcon = {
			Recording: 'rec',
			Layouts: 'layout',
			Bookmarks: 'bookmark',
			Previews: 'preview',
			'Configuration presets': 'preset',
			'CMS events': 'event',
			System: 'system',
			Power: 'power',
			Storage: 'storage',
		}
		for (const [id, preset] of Object.entries(presets)) {
			assert.equal(preset.style.bgcolor, colors.bg, `${id}: rest bgcolor`)
			assert.equal(preset.style.color, id === 'cms_events_stop' ? colors.red : colors.text, `${id}: rest color`)
			// the Recording Pause / Resume keys rest on the play glyph, the Start / Stop keys on the record dot
			const icon = isNamedKey(id, preset)
				? undefined
				: /^recording_pause_/.test(id)
					? ICONS.play
					: ICONS[categoryIcon[preset.category]]
			assert.equal(preset.style.png64, icon, `${id}: category icon`)
			assert.equal(preset.style.pngalignment, icon ? 'center:top' : undefined, `${id}: pngalignment`)
			assert.equal(
				preset.style.alignment,
				icon ? 'center:bottom' : 'center:center',
				`${id}: text below the icon, centred without one`,
			)
		}
	})

	it('variable references carry the connection label, whatever it is, and follow a rename', async () => {
		const refsOf = (inst) => {
			const texts = Object.values(inst.definitions.presets).map((p) => p.style.text)
			const tooltip = inst.definitions.actions.preset.options.find((o) => o.id === 'confirm').tooltip
			return [...texts, tooltip].join('\n').match(/\$\([^)]*\)/g) ?? []
		}
		const other = await createInstance({ mock, label: 'studio_a' })
		try {
			let refs = refsOf(other)
			assert.ok(refs.length > 20, 'presets and the confirm tooltip reference variables')
			for (const ref of refs)
				assert.match(ref, /^\$\(studio_a:/, `${ref}: the connection label, not a fixed word`)
			// Companion renames a connection by setting the new label and calling configUpdated()
			other.label = 'studio_b'
			await other.configUpdated({ ...other.config })
			await other.startupPromise
			refs = refsOf(other)
			assert.ok(refs.length > 20)
			for (const ref of refs) assert.match(ref, /^\$\(studio_b:/, `${ref}: rebuilt with the new label`)
		} finally {
			await other.destroy()
		}
	})

	it('text size 14 everywhere but the Single touch summary (22), at most two lines under an icon; top bar hidden', () => {
		for (const [id, preset] of Object.entries(presets)) {
			assert.equal(preset.style.show_topbar, false, `${id}: top bar`)
			const expected = preset.category === 'Single touch' ? 22 : 14
			assert.equal(preset.style.size, expected, `${id}: text size`)
			if (preset.style.png64) {
				// Companion 5.0.4 at 288 px: two lines fit below a category glyph; the Recording keys' state glyphs are
				// drawn in a 64 px box, which leaves room for a wrapped recorder name plus the state line (three lines)
				const max = preset.category === 'Recording' ? 3 : 2
				assert.ok(preset.style.text.split('\n').length <= max, `${id}: at most ${max} lines below the icon`)
			}
		}
	})

	it('reference-page texts: channel + stream name on stream keys, channel name on bookmarks, verbs on CMS commands, summary alone on Single touch', () => {
		assert.equal(
			presets['streaming_toggle_1-0'].style.text,
			'$(encoder:channel_1_name)\n$(encoder:channel_1_publisher_0_name)\n$(encoder:channel_1_publisher_0_state_word)',
		)
		assert.equal(
			presets['streaming_toggle_1-all'].style.text,
			'$(encoder:channel_1_name)\nStreams\n$(encoder:channel_1_publishers_state_word)',
		)
		assert.equal(presets.bookmarks_1.style.text, '$(encoder:channel_1_name)\nBookmark')
		assert.equal(presets.cms_events_toggle.style.text, 'Pause /\nResume')
		assert.equal(presets.cms_events_stop.style.text, 'Stop')
		assert.equal(presets.cms_events_stop.style.color, colors.red, 'Stop is the one red label')
		for (const [id, verb] of [['cms_events_start_upcoming', 'Start']]) {
			assert.equal(presets[id].style.text, verb, `${id}: verb only`)
		}
		assert.equal(presets.single_touch_toggle_0.style.text, '$(encoder:singletouch_0_summary)')
		assert.equal(presets.single_touch_toggle_0.style.png64, undefined, 'Single touch has no icon')
		assert.equal(presets['streaming_toggle_1-0'].style.png64, undefined, 'stream keys have no icon')
		const channel = instance.state.channels['1']
		const layout = Object.values(channel.layouts)[0]
		assert.equal(presets[`layouts_1_${layout.id}`].style.text, `${layout.name}\n${channel.name}`)
		const configPreset = Object.values(presets).find((p) => p.category === 'Configuration presets')
		assert.match(
			configPreset.style.text,
			/^[^\n]+\n\$\(encoder:preset_status\)$/,
			'configuration preset: name over status, no Apply line (the star icon says apply)',
		)
	})

	it('no Outputs or Audio presets, and no button for the maintenance storage', () => {
		const categories = new Set(Object.values(presets).map((p) => p.category))
		assert.ok(
			!categories.has('Outputs') && !categories.has('Audio'),
			'Outputs and Audio dropped from the preset groups',
		)
		assert.ok(presets.storage_main, 'main storage keeps its button')
		assert.ok(presets.storage_external, 'removable storage keeps its button')
		assert.equal(presets.storage_maintenance, undefined, 'the maintenance partition gets none')
	})

	it(
		'every state-driven feedback style is stateStyle() (bgcolor + badge text colour), except the ' +
			'documented grey-text-only "does not apply" / "not recording" overrides',
		() => {
			for (const [id, preset] of Object.entries(presets)) {
				for (const feedback of preset.feedbacks) {
					if (!feedback.style) continue
					if (feedback.style.bgcolor === colors.bg) {
						// the "off" half of the Pause / Resume blink: back to the rest colours
						assert.equal(
							feedback.feedbackId,
							'recorder_blink',
							`${id}/${feedback.feedbackId}: rest colours`,
						)
						assert.equal(
							feedback.style.color,
							colors.text,
							`${id}/${feedback.feedbackId}: rest text colour`,
						)
					} else if (feedback.style.bgcolor !== undefined) {
						assert.equal(feedback.style.color, colors.badgeText, `${id}/${feedback.feedbackId}: badge text`)
					} else {
						assert.ok(
							isGreyTextOnly(feedback.style),
							`${id}/${feedback.feedbackId}: unexpected style shape`,
						)
					}
				}
			}
		},
	)

	it('grey text-only overrides are exactly event_applies and recorder_state (inverted, or the stopped / disabled states)', () => {
		const found = []
		for (const [id, preset] of Object.entries(presets)) {
			for (const feedback of preset.feedbacks) {
				if (feedback.style && isGreyTextOnly(feedback.style)) {
					found.push({
						id,
						feedbackId: feedback.feedbackId,
						state: feedback.options?.state,
						isInverted: feedback.isInverted === true,
					})
				}
			}
		}
		assert.ok(found.length > 0)
		for (const entry of found) {
			// a Pause / Resume key greys out while the recorder is stopped or disabled: a plain state, not inverted
			const plainGreyState =
				entry.feedbackId === 'recorder_state' && ['stopped', 'disabled'].includes(entry.state)
			if (!plainGreyState) assert.equal(entry.isInverted, true, `${entry.id}: grey-out must be isInverted`)
			assert.ok(
				entry.feedbackId === 'event_applies' || entry.feedbackId === 'recorder_state',
				`${entry.id}: unexpected grey-out feedback ${entry.feedbackId}`,
			)
		}
	})

	it('CMS events: the two status keys lead with an event variable; Pause / Resume colours by state; Start, Stop and Extend grey out via event_applies', () => {
		const cms = Object.values(presets).filter((p) => p.category === 'CMS events')
		const status = cms.filter((p) => /^\$\(encoder:event_/.test(p.style.text))
		assert.equal(status.length, 2, 'status_ongoing and status_upcoming')
		for (const p of status) assert.equal(p.style.text.split('\n').length, 2, `${p.name}: title and time`)
		assert.deepEqual(
			cms.map((p) => p.name).sort(),
			[
				'Extend event +5:00',
				'Ongoing event status',
				'Pause / resume ongoing event',
				'Start upcoming event',
				'Stop ongoing event',
				'Upcoming event status',
			],
			'no solo pause or resume keys',
		)
		const toggle = presets.cms_events_toggle
		assert.equal(toggle.steps[0].down[0].options.op, 'toggle')
		assert.ok(toggle.feedbacks.some((f) => f.feedbackId === 'event_state' && f.style.text === 'Pause'))
		assert.ok(toggle.feedbacks.some((f) => f.feedbackId === 'event_state' && f.style.text === 'Resume'))
		for (const p of cms.filter((x) => !status.includes(x) && x !== toggle)) {
			assert.ok(
				p.feedbacks.some((f) => f.feedbackId === 'event_applies'),
				`${p.name}: greys out via event_applies`,
			)
		}
		assert.equal(presets.cms_events_start_upcoming.steps[0].down[0].options.eventRef, 'upcoming')
	})

	it('Pearl ships no rotary presets (the Audio group, the only one with dials, is not generated)', () => {
		assert.equal(Object.values(presets).filter((p) => p.options?.rotaryActions === true).length, 0)
	})

	it('Pearl has no hold-to-move presets (D3 motion-stop is EC20-only): every "up" step is empty', () => {
		const withUpActions = Object.values(presets).filter((p) => p.steps[0].up.length > 0)
		assert.equal(withUpActions.length, 0)
	})

	it('confirm-gated categories (Power, Configuration presets) carry confirm_pending -> stateStyle(red); Storage is display only', () => {
		for (const p of Object.values(presets).filter((x) => x.category === 'Storage')) {
			assert.equal(p.steps[0].down.length, 0, `${p.name}: no action (ejecting is left to the device UI)`)
			assert.ok(!p.feedbacks.some((f) => f.feedbackId === 'confirm_pending'), `${p.name}: nothing to confirm`)
		}
		const confirmCategories = ['Power', 'Configuration presets']
		const confirmPresets = Object.values(presets).filter((p) => confirmCategories.includes(p.category))
		assert.ok(confirmPresets.length > 0)
		for (const preset of confirmPresets) {
			const confirmFeedback = preset.feedbacks.find((f) => f.feedbackId === 'confirm_pending')
			assert.ok(confirmFeedback, `${preset.name}: missing confirm_pending feedback`)
			assert.deepEqual(confirmFeedback.style, { ...stateStyle(colors.red), text: 'Press again' })
			assert.ok(
				!preset.style.text.includes('confirm_hint'),
				`${preset.name}: the hint is the feedback's text, not a global variable`,
			)
			const action = preset.steps[0].down.find((a) => ['power', 'preset'].includes(a.actionId))
			assert.equal(action.options.confirm, true, `${preset.name}: confirm option is true`)
		}
	})

	it('preview preset texts reference the sanitised name variable', () => {
		assert.equal(presets.previews_channel_1.style.text, '$(encoder:channel_1_name)')
		assert.equal(presets['previews_input_hdmi-a'].style.text, '$(encoder:input_hdmi-a_name)')

		// an odd channel id (anything outside [a-zA-Z0-9_-]) goes through safeId like the variable id does
		instance.state.channels['x.y'] = {
			id: 'x.y',
			name: 'Odd',
			layouts: {},
			publishers: {},
			active_layout: undefined,
		}
		instance.updateSystem()
		const odd = instance.definitions.presets.previews_channel_x_y
		assert.ok(odd, 'preset for the odd channel exists')
		assert.equal(odd.style.text, '$(encoder:channel_x_y_name)')
		assert.deepEqual(odd.feedbacks[0].options, { source: 'channel', sourceId: 'x.y' })
	})

	it('config preset ids that collide after sanitising get a numeric suffix instead of being dropped', () => {
		instance.state.presets = [
			{ name: 'Show A', description: '', sections: [], readonly: false },
			{ name: 'Show_A', description: '', sections: [], readonly: false },
			{ name: 'Show.A', description: '', sections: [], readonly: true },
		]
		instance.updateSystem()
		const ids = Object.keys(instance.definitions.presets).filter((id) =>
			id.startsWith('configuration_presets_apply_'),
		)
		assert.deepEqual(ids, [
			'configuration_presets_apply_Show_A',
			'configuration_presets_apply_Show_A_2',
			'configuration_presets_apply_Show_A_3',
		])
		const p = instance.definitions.presets
		assert.equal(p.configuration_presets_apply_Show_A.steps[0].down[0].options.presetName, 'Show A')
		assert.equal(p.configuration_presets_apply_Show_A_2.steps[0].down[0].options.presetName, 'Show_A')
		assert.equal(p.configuration_presets_apply_Show_A_3.steps[0].down[0].options.presetName, 'Show.A')
		assert.ok(instance.calls.log.some((l) => l.level === 'debug' && /duplicate preset id/.test(l.message)))
	})

	it('audio-only inputs get no preview button', () => {
		// analog-a is audio-only (video: false) in the mock: no picture to preview
		assert.equal(instance.definitions.presets['previews_input_analog-a'], undefined)
		assert.ok(instance.definitions.presets['previews_input_hdmi-a'])
		assert.ok(instance.definitions.presets['previews_input_USBA'])
	})
})

describe('preset_categories connection setting (D15 gating)', () => {
	let mock

	before(async () => {
		mock = await startMockPearl()
	})

	after(async () => {
		await mock.close()
	})

	it('defaults to every D15 category when the setting is absent', async () => {
		const instance = await createInstance({ mock })
		try {
			assert.deepEqual(instance.config.preset_categories.sort(), [...PRESET_CATEGORY_IDS].sort())
			const categoriesPresent = new Set(Object.values(instance.definitions.presets).map((p) => p.category))
			for (const category of PRESET_CATEGORY_IDS) assert.ok(categoriesPresent.has(category))
		} finally {
			await instance.destroy()
		}
	})

	it('unchecking a category removes every one of its presets and nothing else', async () => {
		const instance = await createInstance({ mock, config: { preset_categories: ['Recording', 'Power'] } })
		try {
			const byCategory = {}
			for (const preset of Object.values(instance.definitions.presets)) {
				byCategory[preset.category] = (byCategory[preset.category] || 0) + 1
			}
			assert.deepEqual(Object.keys(byCategory).sort(), ['Power', 'Recording'])
			assert.ok(byCategory.Recording > 0)
			assert.ok(byCategory.Power > 0)
			// the underlying actions/feedbacks are untouched - only preset generation is gated
			assert.ok(instance.definitions.actions.recorder)
			assert.ok(instance.definitions.feedbacks.storage_level)
		} finally {
			await instance.destroy()
		}
	})

	it('an empty selection is respected as "generate no presets", not treated as unset', async () => {
		const instance = await createInstance({ mock, config: { preset_categories: [] } })
		try {
			assert.deepEqual(instance.config.preset_categories, [])
			assert.deepEqual(instance.definitions.presets, {})
		} finally {
			await instance.destroy()
		}
	})

	it('a stale/unknown category id is dropped rather than crashing', async () => {
		const instance = await createInstance({ mock, config: { preset_categories: ['Recording', 'Nope'] } })
		try {
			assert.deepEqual(instance.config.preset_categories, ['Recording'])
		} finally {
			await instance.destroy()
		}
	})

	it('normalisePresetCategories: absent/non-array defaults to all, a legacy id is filtered out', () => {
		assert.deepEqual(normalisePresetCategories(undefined), PRESET_CATEGORY_IDS)
		assert.deepEqual(normalisePresetCategories(null), PRESET_CATEGORY_IDS)
		assert.deepEqual(normalisePresetCategories(['Recording', 'Channels', 'Publishers']), ['Recording'])
		assert.deepEqual(normalisePresetCategories([]), [])
	})
})
