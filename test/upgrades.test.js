const { describe, it } = require('node:test')
const assert = require('node:assert/strict')

const { installStub } = require('./harness')
const upgrades = require('../src/upgrades')
const { PRESET_CATEGORY_IDS: presetCategoryIds } = require('../src/presets')

const props = (config, extra = {}) => ({ config, actions: [], feedbacks: [], ...extra })

describe('upgrade scripts', () => {
	it('are exported in the historical order (scripts are only ever appended)', () => {
		assert.deepEqual(
			upgrades.map((fn) => fn.name),
			['setDefaultConfig', 'renameStreaming', 'setDefaultConfigV230', 'setDefaultConfigV260'],
		)
		for (const fn of upgrades) assert.equal(typeof fn, 'function')
	})

	it('setDefaultConfig (v2.2.0) only fills use_api_v2 and verbose', () => {
		const result = upgrades[0](null, props({ host: '1.2.3.4' }))
		assert.deepEqual(result.updatedConfig, { host: '1.2.3.4', use_api_v2: true, verbose: false })
		assert.deepEqual(result.updatedActions, [])
		assert.deepEqual(result.updatedFeedbacks, [])

		assert.equal(upgrades[0](null, props({ host: 'x', use_api_v2: false, verbose: true })).updatedConfig, null)
		assert.equal(upgrades[0](null, props(null)).updatedConfig, null)
		assert.equal(upgrades[0](null, props(undefined)).updatedConfig, null)
	})

	it('setDefaultConfigV230 fills the v2.3.0 polling / preview fields when undefined', () => {
		const stored = { host: 'x', use_api_v2: true, verbose: false, preview_width: 300 }
		const result = upgrades[2](null, props(stored))
		assert.deepEqual(result.updatedConfig, {
			host: 'x',
			use_api_v2: true,
			verbose: false,
			preview_width: 300,
			timeout: 5000,
			preview_interval: 2,
			poll_events: true,
			poll_archive: false,
			poll_connectivity: false,
		})
		assert.deepEqual(stored, { host: 'x', use_api_v2: true, verbose: false, preview_width: 300 }, 'input untouched')
		assert.deepEqual(result.updatedActions, [])
		assert.deepEqual(result.updatedFeedbacks, [])

		// a config that has every field (e.g. a fresh connection) is left alone
		assert.equal(upgrades[2](null, props({ host: 'x', ...upgrades.CONFIG_DEFAULTS })).updatedConfig, null)
		assert.equal(upgrades[2](null, props(null)).updatedConfig, null)

		// the v2.2.0 fields are not touched by the v2.3.0 script
		const onlyNew = upgrades[2](null, props({ host: 'x' })).updatedConfig
		assert.equal('use_api_v2' in onlyNew, false)
		assert.equal('verbose' in onlyNew, false)
	})

	it('setDefaultConfigV260 fills preset_categories when undefined', () => {
		const result = upgrades[3](null, props({ host: 'x' }))
		assert.deepEqual(result.updatedConfig.preset_categories, presetCategoryIds)
		assert.deepEqual(result.updatedActions, [])
		assert.deepEqual(result.updatedFeedbacks, [])

		// a config that already has the field (even a subset, e.g. after the user unchecked some) is left alone
		assert.equal(upgrades[3](null, props({ host: 'x', preset_categories: ['Channels'] })).updatedConfig, null)
		assert.equal(upgrades[3](null, props({ host: 'x', preset_categories: [] })).updatedConfig, null)
		assert.equal(upgrades[3](null, props(null)).updatedConfig, null)
	})

	it('the three default scripts together cover CONFIG_DEFAULTS exactly once', () => {
		const covered = [
			...upgrades.CONFIG_DEFAULT_KEYS_V220,
			...upgrades.CONFIG_DEFAULT_KEYS_V230,
			...upgrades.CONFIG_DEFAULT_KEYS_V260,
		].sort()
		assert.deepEqual(covered, Object.keys(upgrades.CONFIG_DEFAULTS).sort())
	})

	it('CONFIG_DEFAULTS match the defaults of the config fields', () => {
		installStub()
		const { getConfigFields } = require('../src/config')
		for (const field of getConfigFields()) {
			if (field.id in upgrades.CONFIG_DEFAULTS) {
				// deepEqual: preset_categories defaults to an array, compared by value not by reference
				assert.deepEqual(field.default, upgrades.CONFIG_DEFAULTS[field.id], `default of ${field.id}`)
			}
		}
	})

	it('renameStreaming renames channelStreaming actions and feedbacks', () => {
		const actions = [
			{ id: 'a1', actionId: 'channelStreaming', options: {} },
			{ id: 'a2', actionId: 'recorderRecording', options: {} },
		]
		const feedbacks = [
			{ id: 'f1', feedbackId: 'channelStreaming', options: {} },
			{ id: 'f2', feedbackId: 'channelLayout', options: {} },
		]
		const result = upgrades[1](null, props({ host: 'x' }, { actions, feedbacks }))
		assert.equal(result.updatedConfig, null)
		assert.deepEqual(
			result.updatedActions.map((a) => [a.id, a.actionId]),
			[['a1', 'controlStreaming']],
		)
		assert.deepEqual(
			result.updatedFeedbacks.map((f) => [f.id, f.feedbackId]),
			[['f1', 'streamingState']],
		)
	})
})
