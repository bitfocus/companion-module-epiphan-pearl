/**
 * The target 3.0.0 preset set (doc/PARITY.md §1 "Presets" column, briefing §5 "Presets", D15
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

function hexToComponents(hex) {
	const n = parseInt(hex.slice(1), 16)
	return { r: (n >> 16) & 0xff, g: (n >> 8) & 0xff, b: n & 0xff, a: 1 }
}

describe('style.js palette and helpers', () => {
	it('exposes the §3.1 palette, round-tripping every hex through combineRgb/splitRgb', () => {
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
	it('has exactly the 13 Pearl category icons, all valid PNG payloads', () => {
		assert.deepEqual(
			Object.keys(ICONS).sort(),
			[
				'audio',
				'bookmark',
				'event',
				'layout',
				'output',
				'power',
				'preset',
				'preview',
				'recorder',
				'singletouch',
				'storage',
				'stream',
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

	it('PRESET_CATEGORY_IDS is the D15 list of 13 categories, in order (one per Stream Deck action)', () => {
		assert.deepEqual(PRESET_CATEGORY_IDS, [
			'Recording',
			'Streaming',
			'Layouts',
			'Single touch',
			'Bookmarks',
			'Previews',
			'Outputs',
			'Configuration presets',
			'CMS events',
			'System',
			'Power',
			'Audio',
			'Storage',
		])
	})

	it('generates presets (default config enables every category on the seeded mock)', () => {
		assert.ok(Object.keys(presets).length > 40, `expected >40 presets, got ${Object.keys(presets).length}`)
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
			// every $(pearl:var) referenced in the button text must be a variable that actually exists
			for (const m of String(preset.style.text).matchAll(/\$\(pearl:([^)]+)\)/g)) {
				assert.notEqual(instance.variableValues[m[1]], undefined, `${id} uses unknown variable ${m[1]}`)
			}
		}
	})

	it('every preset is restStyle() at rest, with its category icon top / text bottom', () => {
		const categoryIcon = {
			Recording: 'recorder',
			Streaming: 'stream',
			Layouts: 'layout',
			'Single touch': 'singletouch',
			Bookmarks: 'bookmark',
			Previews: 'preview',
			Outputs: 'output',
			'Configuration presets': 'preset',
			'CMS events': 'event',
			System: 'system',
			Power: 'power',
			Audio: 'audio',
			Storage: 'storage',
		}
		for (const [id, preset] of Object.entries(presets)) {
			assert.equal(preset.style.bgcolor, colors.bg, `${id}: rest bgcolor`)
			assert.equal(preset.style.color, colors.text, `${id}: rest color`)
			assert.equal(preset.style.png64, ICONS[categoryIcon[preset.category]], `${id}: category icon`)
			assert.equal(preset.style.pngalignment, 'center:top', `${id}: pngalignment`)
			assert.equal(preset.style.alignment, 'center:bottom', `${id}: alignment`)
		}
	})

	it('every preset uses the Stream Deck key layout: fixed 14 px text, top bar hidden', () => {
		for (const [id, preset] of Object.entries(presets)) {
			assert.equal(preset.style.size, 14, `${id}: text size`)
			assert.equal(preset.style.show_topbar, false, `${id}: top bar`)
		}
	})

	it('fixed labels fit one 14 px line (at most 11 characters once variables are taken out) where the words are ours', () => {
		// device-named things (layouts, publishers, single-touch controls, outputs) wrap as Companion sees fit
		const fixedCategories = new Set(['Recording', 'Bookmarks', 'CMS events', 'System', 'Power', 'Audio', 'Storage'])
		const tooLong = []
		for (const [id, preset] of Object.entries(presets)) {
			if (!fixedCategories.has(preset.category)) continue
			for (const line of String(preset.style.text).split('\n')) {
				const fixed = line.replace(/\$\(pearl:[^)]+\)/g, '').trim()
				if (fixed.length > 10) tooLong.push(`${id}: "${line}"`)
			}
		}
		assert.deepEqual(tooLong, [])
	})

	it('Audio presets are generated for the analog inputs only', () => {
		const audio = Object.values(presets).filter((p) => p.category === 'Audio')
		assert.ok(audio.length > 0, "expected Audio presets for the mock's analog inputs")
		const inputIds = new Set(
			audio.map((p) => p.steps[0].down[0]?.options.inputId ?? p.feedbacks[0]?.options.inputId),
		)
		assert.deepEqual([...inputIds].sort(), ['analog-a', 'analog-b'])
		// 7 buttons per input: meter, gain +/-, delay +/-, rotary gain, rotary delay
		assert.equal(audio.length, 14)
	})

	it(
		'every state-driven feedback style is stateStyle() (bgcolor + badge text colour), except the ' +
			'documented grey-text-only "does not apply" / "not recording" overrides',
		() => {
			for (const [id, preset] of Object.entries(presets)) {
				for (const feedback of preset.feedbacks) {
					if (!feedback.style) continue
					if (feedback.style.bgcolor !== undefined) {
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

	it('grey text-only overrides are exactly event_applies and recorder_state, both isInverted', () => {
		const found = []
		for (const [id, preset] of Object.entries(presets)) {
			for (const feedback of preset.feedbacks) {
				if (feedback.style && isGreyTextOnly(feedback.style)) {
					found.push({ id, feedbackId: feedback.feedbackId, isInverted: feedback.isInverted === true })
				}
			}
		}
		assert.ok(found.length > 0)
		for (const entry of found) {
			assert.equal(entry.isInverted, true, `${entry.id}: grey-out must be isInverted`)
			assert.ok(
				entry.feedbackId === 'event_applies' || entry.feedbackId === 'recorder_state',
				`${entry.id}: unexpected grey-out feedback ${entry.feedbackId}`,
			)
		}
	})

	it('CMS events: the three status buttons lead with an event variable; the command buttons grey out via event_applies', () => {
		const cms = Object.values(presets).filter((p) => p.category === 'CMS events')
		const status = cms.filter((p) => /^\$\(pearl:event_/.test(p.style.text))
		assert.equal(status.length, 3, 'status_ongoing, status_upcoming and toggle')
		for (const p of status) {
			assert.equal(p.style.text.split('\n').length, 2, `${p.name}: two lines, event title/command and time`)
		}
		// the command buttons (start/stop/pause/resume/extend) name the command first
		const withoutCmsPrefix = cms.filter((p) => !status.includes(p))
		assert.equal(withoutCmsPrefix.length, cms.length - 3)
		for (const p of withoutCmsPrefix) {
			assert.ok(
				p.feedbacks.some((f) => f.feedbackId === 'event_applies'),
				`${p.name}: greys out via event_applies`,
			)
		}
	})

	it('rotary presets (Audio gain/delay) carry options.rotaryActions and both rotate arrays; push = control:none', () => {
		const rotaryPresets = Object.values(presets).filter((p) => p.options?.rotaryActions === true)
		assert.ok(rotaryPresets.length > 0, 'expected at least one rotary preset (Audio gain/delay)')
		for (const preset of rotaryPresets) {
			assert.equal(preset.category, 'Audio')
			const step = preset.steps[0]
			assert.ok(Array.isArray(step.rotate_left) && step.rotate_left.length > 0)
			assert.ok(Array.isArray(step.rotate_right) && step.rotate_right.length > 0)
			assert.ok(Array.isArray(step.down) && step.down.length > 0, 'push = control:none re-read')
			assert.equal(step.down[0].options.control, 'none')
		}
	})

	it('Pearl has no hold-to-move presets (D3 motion-stop is EC20-only): every "up" step is empty', () => {
		const withUpActions = Object.values(presets).filter((p) => p.steps[0].up.length > 0)
		assert.equal(withUpActions.length, 0)
	})

	it('confirm-gated categories (Power, Configuration presets, Storage) carry confirm_pending -> stateStyle(red)', () => {
		const confirmCategories = ['Power', 'Configuration presets', 'Storage']
		const confirmPresets = Object.values(presets).filter((p) => confirmCategories.includes(p.category))
		assert.ok(confirmPresets.length > 0)
		for (const preset of confirmPresets) {
			const confirmFeedback = preset.feedbacks.find((f) => f.feedbackId === 'confirm_pending')
			assert.ok(confirmFeedback, `${preset.name}: missing confirm_pending feedback`)
			assert.deepEqual(confirmFeedback.style, stateStyle(colors.red))
			assert.match(preset.style.text, /\$\(pearl:confirm_hint\)/, `${preset.name}: confirm_hint on last line`)
			const action = preset.steps[0].down.find((a) => ['power', 'preset', 'storage'].includes(a.actionId))
			assert.equal(action.options.confirm, true, `${preset.name}: confirm option is true`)
		}
	})

	it('preview preset texts reference the sanitised name variable', () => {
		assert.equal(presets.previews_channel_1.style.text, '$(pearl:channel_1_name)')
		assert.equal(presets['previews_input_hdmi-a'].style.text, '$(pearl:input_hdmi-a_name)')

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
		assert.equal(odd.style.text, '$(pearl:channel_x_y_name)')
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

	it('audio-only inputs get no preview button; Outputs presets exist only for built-in sources', () => {
		// analog-a is audio-only (video: false) in the mock: no picture to preview
		assert.equal(instance.definitions.presets['previews_input_analog-a'], undefined)
		assert.ok(instance.definitions.presets['previews_input_hdmi-a'])
		assert.ok(instance.definitions.presets['previews_input_USBA'])
		const outputPresets = Object.values(instance.definitions.presets).filter((p) => p.category === 'Outputs')
		assert.equal(outputPresets.length, 3, 'one output x 3 built-in sources (Multiview/Device info/Console)')
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
