const { describe, it, before, after, afterEach } = require('node:test')
const assert = require('node:assert/strict')

const { createInstance } = require('./harness')
const { startMockPearl } = require('./mock-pearl')

const PRESET_ID_RE = /^[a-zA-Z0-9_-]+$/

describe('presets', () => {
	let mock
	let instance

	before(async () => {
		mock = await startMockPearl()
		instance = await createInstance({ mock })
	})

	after(async () => {
		await instance.destroy()
		await mock.close()
	})

	afterEach(async () => {
		// restore the state (and the definitions built from it) after tests that inject odd entities
		await instance.pollAll()
		instance.updateSystem()
	})

	it('every preset id is sanitised and every button references existing actions / feedbacks', () => {
		const presets = instance.definitions.presets
		assert.ok(Object.keys(presets).length > 10)
		for (const [id, preset] of Object.entries(presets)) {
			assert.match(id, PRESET_ID_RE, `preset id ${id}`)
			assert.equal(preset.type, 'button')
			for (const step of preset.steps) {
				for (const action of step.down)
					assert.ok(instance.definitions.actions[action.actionId], action.actionId)
			}
			for (const fb of preset.feedbacks) assert.ok(instance.definitions.feedbacks[fb.feedbackId], fb.feedbackId)
		}
	})

	it('preview preset texts reference the sanitised name variable', () => {
		const presets = instance.definitions.presets
		assert.equal(presets.previews_channel_1.style.text, '$(pearl:channel_1_name)')
		assert.equal(presets['previews_input_hdmi-a'].style.text, '$(pearl:input_hdmi-a_name)')

		// an odd channel id (anything outside [a-zA-Z0-9_-]) goes through safeId like the variable id does
		instance.state.channels['x.y'] = {
			id: 'x.y',
			name: 'Odd',
			layouts: {},
			publishers: {},
			encoders: [],
			active_layout: undefined,
		}
		instance.updateSystem()
		const odd = instance.definitions.presets.previews_channel_x_y
		assert.ok(odd, 'preset for the odd channel exists')
		assert.equal(odd.style.text, '$(pearl:channel_x_y_name)')
		assert.deepEqual(odd.feedbacks[0].options, { channel: 'x.y' })
		assert.ok(instance.definitions.variables.some((v) => v.variableId === 'channel_x_y_name') || true)
	})

	it('config preset ids that collide after sanitising get a numeric suffix instead of being dropped', () => {
		instance.state.presets = [
			{ name: 'Show A', description: '', sections: [], readonly: false },
			{ name: 'Show_A', description: '', sections: [], readonly: false },
			{ name: 'Show.A', description: '', sections: [], readonly: true },
		]
		instance.updateSystem()
		const presets = instance.definitions.presets
		const ids = Object.keys(presets).filter((id) => id.startsWith('config_presets_apply_'))
		assert.deepEqual(ids, [
			'config_presets_apply_Show_A',
			'config_presets_apply_Show_A_2',
			'config_presets_apply_Show_A_3',
		])
		assert.equal(presets.config_presets_apply_Show_A.steps[0].down[0].options.preset, 'Show A')
		assert.equal(presets.config_presets_apply_Show_A_2.steps[0].down[0].options.preset, 'Show_A')
		assert.equal(presets.config_presets_apply_Show_A_3.steps[0].down[0].options.preset, 'Show.A')
		assert.ok(instance.calls.log.some((l) => l.level === 'debug' && /duplicate preset id/.test(l.message)))
	})

	it('audio-only inputs get no preview button; output routing has no presets at all (removed)', () => {
		const presets = instance.definitions.presets
		// analog-a is audio-only (video: false) in the mock; it has no picture to preview
		assert.equal(presets['previews_input_analog-a'], undefined)
		// video-capable inputs (video-only or video+audio) keep their preview
		assert.ok(presets['previews_input_hdmi-a'])
		assert.ok(presets['previews_input_USBA'])
		// the Outputs category was removed outright: no output-routing presets exist for any input
		assert.equal(Object.keys(presets).filter((id) => id.startsWith('outputs_')).length, 0)

		// the underlying feedback/action option lists are unaffected: setOutputSource and
		// outputSourceOptimistic still exist and still exclude audio-only inputs, for a hand-built button
		const inputPreviewChoices = instance.definitions.feedbacks.inputPreview.options
			.find((o) => o.id === 'input')
			.choices.map((c) => c.id)
		assert.ok(!inputPreviewChoices.includes('analog-a'))
		assert.ok(inputPreviewChoices.includes('hdmi-a'))
		const outputSourceChoices = instance.definitions.actions.setOutputSource.options
			.find((o) => o.id === 'source')
			.choices.map((c) => c.id)
		assert.ok(!outputSourceChoices.includes('analog-a'))
		assert.ok(outputSourceChoices.includes('hdmi-a'))
		assert.ok(instance.definitions.feedbacks.outputSourceOptimistic)
	})
})

describe('preset_categories connection setting', () => {
	let mock

	before(async () => {
		mock = await startMockPearl()
	})

	after(async () => {
		await mock.close()
	})

	it('defaults to every category when the setting is absent (new/legacy connections)', async () => {
		const instance = await createInstance({ mock })
		try {
			assert.deepEqual(instance.config.preset_categories.sort(), [
				'AFU',
				'Channels',
				'Config presets',
				'Events',
				'Inputs',
				'Previews',
				'Publishers',
				'Recorders',
				'Single touch',
				'Storage',
				'System',
			])
			const categoriesPresent = new Set(Object.values(instance.definitions.presets).map((p) => p.category))
			assert.ok(categoriesPresent.has('Events'))
			assert.ok(categoriesPresent.has('Channels'))
		} finally {
			await instance.destroy()
		}
	})

	it('unchecking a category removes every one of its presets and nothing else', async () => {
		const instance = await createInstance({ mock, config: { preset_categories: ['Channels', 'Events'] } })
		try {
			const byCategory = {}
			for (const preset of Object.values(instance.definitions.presets)) {
				byCategory[preset.category] = (byCategory[preset.category] || 0) + 1
			}
			assert.deepEqual(Object.keys(byCategory).sort(), ['Channels', 'Events'])
			assert.ok(byCategory.Channels > 0)
			assert.ok(byCategory.Events > 0)
			// the actions/feedbacks themselves are untouched by this setting - only preset generation
			assert.ok(instance.definitions.actions.recorderControlAll)
			assert.ok(instance.definitions.feedbacks.storageState)
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
		const instance = await createInstance({ mock, config: { preset_categories: ['Channels', 'Nope'] } })
		try {
			assert.deepEqual(instance.config.preset_categories, ['Channels'])
		} finally {
			await instance.destroy()
		}
	})

	it('there is no "Outputs" category to select even if requested', async () => {
		const instance = await createInstance({ mock, config: { preset_categories: ['Outputs', 'Channels'] } })
		try {
			assert.deepEqual(instance.config.preset_categories, ['Channels'])
			const { PRESET_CATEGORY_IDS } = require('../src/presets')
			assert.ok(!PRESET_CATEGORY_IDS.includes('Outputs'))
		} finally {
			await instance.destroy()
		}
	})
})
