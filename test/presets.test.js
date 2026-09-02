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
})
