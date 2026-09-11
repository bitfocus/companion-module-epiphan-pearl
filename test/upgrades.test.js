const { describe, it, before } = require('node:test')
const assert = require('node:assert/strict')

const { installStub } = require('./harness')
const upgrades = require('../src/upgrades')
const { PRESET_CATEGORY_IDS: presetCategoryIds } = require('../src/presets')

const props = (config, extra = {}) => ({ config, actions: [], feedbacks: [], ...extra })

describe('upgrade scripts', () => {
	it('are exported in the historical order (scripts are only ever appended)', () => {
		assert.deepEqual(
			upgrades.map((fn) => fn.name),
			[
				'setDefaultConfig',
				'renameStreaming',
				'setDefaultConfigV230',
				'setDefaultConfigV260',
				'setDefaultConfigV300Https',
				'convertToParityV300',
			],
		)
		for (const fn of upgrades) assert.equal(typeof fn, 'function')
	})

	it("instance.js's exported upgradeScripts prepends the pre-3.0.0 upgradeToBooleanFeedbacks script", () => {
		// src/upgrades.js's six scripts (asserted above) are not the whole story: instance.js builds the
		// array Companion actually runs as [upgradeToBooleanFeedbacks, ...upgrades] — a pre-3.0.0 (v2.3.0)
		// script that converts three legacy feedbacks' fg/bg options to boolean-feedback style before any
		// of the six scripts above run. It is the unlisted first entry; this test pins its identity and
		// position so that fact stays true.
		installStub()
		const { upgradeScripts } = require('../src/instance')
		assert.equal(upgradeScripts.length, upgrades.length + 1)
		assert.equal(upgradeScripts[0].name, 'convertToBooleanFeedbacks')
		assert.deepEqual(Object.keys(upgradeScripts[0].upgradeMap), [
			'channelLayout',
			'streamingState',
			'recorderRecording',
		])
		assert.deepEqual(
			upgradeScripts.slice(1).map((fn) => fn.name),
			upgrades.map((fn) => fn.name),
		)
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

	it('setDefaultConfigV300Https fills use_https / accept_self_signed when undefined', () => {
		const result = upgrades[4](null, props({ host: 'x' }))
		assert.deepEqual(result.updatedConfig, { host: 'x', use_https: false, accept_self_signed: true })
		assert.deepEqual(result.updatedActions, [])
		assert.deepEqual(result.updatedFeedbacks, [])

		// a connection that already chose (either way) is left alone, only missing keys are filled
		assert.equal(
			upgrades[4](null, props({ host: 'x', use_https: true, accept_self_signed: false })).updatedConfig,
			null,
		)
		assert.deepEqual(upgrades[4](null, props({ host: 'x', use_https: true })).updatedConfig, {
			host: 'x',
			use_https: true,
			accept_self_signed: true,
		})
		assert.equal(upgrades[4](null, props(null)).updatedConfig, null)

		// the earlier scripts do not touch the new fields
		const older = upgrades[2](null, props({ host: 'x' })).updatedConfig
		assert.equal('use_https' in older, false)
		assert.equal('accept_self_signed' in older, false)
	})

	it('the default scripts together cover CONFIG_DEFAULTS exactly once', () => {
		const covered = [
			...upgrades.CONFIG_DEFAULT_KEYS_V220,
			...upgrades.CONFIG_DEFAULT_KEYS_V230,
			...upgrades.CONFIG_DEFAULT_KEYS_V260,
			...upgrades.CONFIG_DEFAULT_KEYS_V300_HTTPS,
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

// ------------------------------------------------------------------------------------------------
// convertToParityV300 (D13): the 3.0.0 Companion-parity control-set
// rewrite. Every legacy action/feedback id, every op/state value mapping and the config conversion.
// ------------------------------------------------------------------------------------------------

const { createInstance, DEFAULT_CONFIG, InstanceStatus } = require('./harness')
const { startMockPearl } = require('./mock-pearl')

// appended last (index 5): setDefaultConfig, renameStreaming, setDefaultConfigV230,
// setDefaultConfigV260, setDefaultConfigV300Https, convertToParityV300
const convertToParityV300 = upgrades[5]

const convertProps = (actions, feedbacks, config = null) => ({ config, actions, feedbacks })

/** build one CompanionMigrationAction fixture */
function action(actionId, options, controlId) {
	return { id: `${controlId}-inst`, controlId, actionId, options }
}

/** build one CompanionMigrationFeedback fixture */
function feedback(feedbackId, options, controlId, isInverted = false) {
	return { id: `${controlId}-inst`, controlId, feedbackId, options, isInverted }
}

describe('convertToParityV300 (D13)', () => {
	before(() => {
		// a stray entry from a require elsewhere in the same process must not pollute the counts below
		upgrades.REMOVED_LEGACY.length = 0
	})

	it('converts every legacy action id of PARITY.md table 2.1 to its new id and options', () => {
		const actions = [
			action('channelChangeLayout', { channelIdlayoutId: '1-2' }, 'a01'),
			action('controlStreaming', { channelIdpublisherId: '1-0', startStopAction: 1 }, 'a02'),
			action('recorderRecording', { recorderId: '2', startStopAction: 2 }, 'a03'),
			action('insertMarker', { channel: '3', markertext: '' }, 'a04'),
			action('getLayoutData', { channelIdlayoutId: '1-2', destination: 'x' }, 'a05'),
			action('setLayoutData', { channelIdlayoutId: '1-2', source: 'x' }, 'a06'),
			action('systemReboot', {}, 'a07'),
			action('systemShutdown', {}, 'a08'),
			action('getContentMetadata', { channel: '1' }, 'a09'),
			action('setContentMetadata', { channel: '1', title: 'x', author: 'y', prefix: 'z' }, 'a10'),
			action('recorderControlAll', { action: 'stop' }, 'a11'),
			action('setChannelName', { channel: '1', name: 'x' }, 'a12'),
			action('setPublisherName', { channelIdpublisherId: '1-0', name: 'x' }, 'a13'),
			action('setPublisherEnabled', { channelIdpublisherId: '1-0', enabled: 'true' }, 'a14'),
			action('setPublisherSingleTouch', { channelIdpublisherId: '1-0', single_touch: 'true' }, 'a15'),
			action('setRtmpDestination', { channelIdpublisherId: '1-0', url: 'rtmp://x' }, 'a16'),
			action('setSrtDestination', { channelIdpublisherId: '1-1', mode: 'caller', url: 'srt://x' }, 'a17'),
			action('patchPublisherSettings', { channelIdpublisherId: '1-0', json: '{}' }, 'a18'),
			action('addPublisher', { channel: '1', name: 'x', json: '{}' }, 'a19'),
			action('setOutputSource', { output: 'D1', source: 'custom', customSource: 'hdmi-a' }, 'a20'),
			action('inputAudioMute', { input: 'analog-a', mute: 'true' }, 'a21'),
			action('inputAudioGain', { input: 'analog-a', gain: 50, channel: 'A' }, 'a22'),
			action('inputAudioDelay', { input: 'hdmi-b', delay: 20 }, 'a23'),
			action('inputPhantomPower', { input: 'analog-a', phantom_power: 'true' }, 'a24'),
			action('patchInputSettings', { input: 'analog-a', json: '{}' }, 'a25'),
			action('createNetworkInput', { type: 'rtsp', name: 'x', json: '{}' }, 'a26'),
			action('singleTouchToggle', { stc: '0' }, 'a27'),
			action('applyConfigPreset', { preset: 'Show A', sections: ['system'] }, 'a28'),
			action('storageEject', { storage: 'external' }, 'a29'),
			action('eventControl', { event: 'ongoing', eventId: '', action: 'pause' }, 'a30'),
			action('eventControl', { event: 'custom', eventId: 'abc123', action: 'stop' }, 'a30b'),
			action('eventExtend', { event: 'ongoing', eventId: '', seconds: 600 }, 'a31'),
			action('createAdhocEvent', { json: '{}' }, 'a32'),
			action('adhocSessionLogout', {}, 'a33'),
			action('refreshConnectivity', {}, 'a34'),
			action('runSpeedTest', { mode: 'downlink', protocol: 'udp', timeout: 5 }, 'a35'),
			action('refreshPoll', {}, 'a36'),
		]

		const result = convertToParityV300(null, convertProps(actions, [], null))

		const byControl = Object.fromEntries(actions.map((a) => [a.controlId, a]))
		const expectConverted = (controlId, actionId, options) => {
			assert.equal(byControl[controlId].actionId, actionId, `${controlId} actionId`)
			assert.deepEqual(byControl[controlId].options, options, `${controlId} options`)
			assert.ok(result.updatedActions.includes(byControl[controlId]), `${controlId} in updatedActions`)
		}
		const expectRemoved = (controlId, originalActionId) => {
			assert.equal(byControl[controlId].actionId, originalActionId, `${controlId} left untouched`)
			assert.ok(!result.updatedActions.includes(byControl[controlId]), `${controlId} not in updatedActions`)
		}

		expectConverted('a01', 'layout', { channelId: '1', layoutId: '1-2', layoutIdManual: '' })
		expectConverted('a02', 'stream', { channelId: '1', publisherId: '1-0', op: 'start' })
		expectConverted('a03', 'recorder', { recorderId: '2', op: 'reset' })
		expectConverted('a04', 'bookmark', { channelId: '3', text: 'Marker', appendTime: false })
		expectRemoved('a05', 'getLayoutData')
		expectRemoved('a06', 'setLayoutData')
		expectConverted('a07', 'power', { op: 'reboot', confirm: false })
		expectConverted('a08', 'power', { op: 'shutdown', confirm: false })
		expectRemoved('a09', 'getContentMetadata')
		expectRemoved('a10', 'setContentMetadata')
		expectConverted('a11', 'recorder', { recorderId: 'all', op: 'stop' })
		expectRemoved('a12', 'setChannelName')
		expectRemoved('a13', 'setPublisherName')
		expectRemoved('a14', 'setPublisherEnabled')
		expectRemoved('a15', 'setPublisherSingleTouch')
		expectRemoved('a16', 'setRtmpDestination')
		expectRemoved('a17', 'setSrtDestination')
		expectRemoved('a18', 'patchPublisherSettings')
		expectRemoved('a19', 'addPublisher')
		expectConverted('a20', 'output', { outputId: 'D1', source: 'hdmi-a' })
		expectRemoved('a21', 'inputAudioMute')
		expectConverted('a22', 'audio', { inputId: 'analog-a', control: 'gain', direction: 'up', step: 1 })
		expectConverted('a23', 'audio', { inputId: 'hdmi-b', control: 'delay', direction: 'up', step: 1 })
		expectRemoved('a24', 'inputPhantomPower')
		expectRemoved('a25', 'patchInputSettings')
		expectRemoved('a26', 'createNetworkInput')
		expectConverted('a27', 'singletouch', { stcId: '0' })
		expectConverted('a28', 'preset', { presetName: 'Show A', sections: ['system'], confirm: false })
		expectConverted('a29', 'storage', { storageId: 'external', confirm: false })
		expectConverted('a30', 'event', { eventRef: 'ongoing', op: 'pause', extendSeconds: 300 })
		expectConverted('a30b', 'event', { eventRef: 'abc123', op: 'stop', extendSeconds: 300 })
		expectConverted('a31', 'event', { eventRef: 'ongoing', op: 'extend', extendSeconds: 600 })
		expectRemoved('a32', 'createAdhocEvent')
		expectRemoved('a33', 'adhocSessionLogout')
		expectRemoved('a34', 'refreshConnectivity')
		expectRemoved('a35', 'runSpeedTest')
		expectRemoved('a36', 'refreshPoll')

		// 15 legacy action ids convert + one extra eventControl fixture (a30b)
		// added above to also cover the event==='custom' branch, so 16 fixtures end up in updatedActions
		assert.equal(result.updatedActions.length, 16, 'exactly the 16 converted action instances were reported')
	})

	it('also handles the plain (non-custom) setOutputSource and non-numeric recorderControlAll values', () => {
		const actions = [
			action('setOutputSource', { output: 'D1', source: 'multiview' }, 'b1'),
			action('recorderControlAll', { action: 'start' }, 'b2'),
		]
		convertToParityV300(null, convertProps(actions, [], null))
		assert.deepEqual(actions[0].options, { outputId: 'D1', source: 'multiview' })
		assert.deepEqual(actions[1].options, { recorderId: 'all', op: 'start' })
	})

	it('converts every legacy feedback id of PARITY.md table 2.2 to its new id and options', () => {
		const feedbacks = [
			feedback('channelLayout', { channelIdlayoutId: '1-2' }, 'f01'),
			feedback('channelLayoutPreview', { channelIdlayoutId: '1-2' }, 'f02'),
			feedback('streamingState', { channelIdpublisherId: '1-0' }, 'f03'),
			feedback('recorderRecording', { recorderId: '2' }, 'f04'),
			feedback('publisherState', { channelIdpublisherId: '1-1', state: 'listening' }, 'f05'),
			feedback('recorderState', { recorderId: 'm1', state: 'paused' }, 'f06'),
			feedback('anyRecording', {}, 'f07'),
			feedback('anyStreaming', {}, 'f08'),
			feedback('singleTouchPressed', { stcId: '0' }, 'f09'),
			feedback('singleTouchOk', { stcId: '0' }, 'f10', false),
			feedback('storageState', { storageId: 'main', state: 'ready' }, 'f11'),
			feedback('storageFreeBelow', { storageId: 'main', percent: 15 }, 'f12'),
			feedback('afuState', { state: 'uploading' }, 'f13'),
			feedback('cpuLoadHigh', {}, 'f14'),
			feedback('cpuTempHigh', {}, 'f15'),
			feedback('eventStatus', { which: 'upcoming' }, 'f16'),
			feedback('channelPreview', { channel: '1' }, 'f17'),
			feedback('inputPreview', { input: 'hdmi-a' }, 'f18'),
			feedback('outputPreview', { output: 'D1' }, 'f19'),
			feedback('outputSourceOptimistic', { output: 'D1', source: 'multiview' }, 'f20'),
			feedback('configPresetApplied', { preset: 'Show A' }, 'f21'),
		]

		const result = convertToParityV300(null, convertProps([], feedbacks, null))

		const byControl = Object.fromEntries(feedbacks.map((f) => [f.controlId, f]))
		const expectConverted = (controlId, feedbackId, options, isInverted) => {
			assert.equal(byControl[controlId].feedbackId, feedbackId, `${controlId} feedbackId`)
			assert.deepEqual(byControl[controlId].options, options, `${controlId} options`)
			if (isInverted !== undefined)
				assert.equal(byControl[controlId].isInverted, isInverted, `${controlId} isInverted`)
			assert.ok(result.updatedFeedbacks.includes(byControl[controlId]), `${controlId} in updatedFeedbacks`)
		}
		const expectRemoved = (controlId, originalFeedbackId) => {
			assert.equal(byControl[controlId].feedbackId, originalFeedbackId, `${controlId} left untouched`)
			assert.ok(!result.updatedFeedbacks.includes(byControl[controlId]), `${controlId} not in updatedFeedbacks`)
		}

		expectConverted('f01', 'layout_active', { layoutId: '1-2' })
		expectConverted('f02', 'layout_preview', { layoutId: '1-2' })
		expectConverted('f03', 'stream_state', { publisherId: '1-0', state: 'started' })
		expectConverted('f04', 'recorder_state', { recorderId: '2', state: 'started' })
		expectConverted('f05', 'stream_state', { publisherId: '1-1', state: 'listening' })
		expectConverted('f06', 'recorder_state', { recorderId: 'm1', state: 'paused' })
		expectConverted('f07', 'recorder_state', { recorderId: 'all', state: 'started' })
		expectRemoved('f08', 'anyStreaming')
		expectConverted('f09', 'singletouch_active', { stcId: '0', state: 'on' })
		expectConverted('f10', 'singletouch_active', { stcId: '0', state: 'error' }, true)
		expectConverted('f11', 'storage_level', { storageId: 'main', level: 'ok' })
		expectConverted('f12', 'storage_level', { storageId: 'main', level: 'low' })
		expectConverted('f13', 'system', { condition: 'afu_uploading' })
		expectConverted('f14', 'system', { condition: 'cpu_high' })
		expectConverted('f15', 'system', { condition: 'cpu_hot' })
		expectConverted('f16', 'event_state', { eventRef: 'upcoming', state: 'scheduled' })
		expectConverted('f17', 'preview', { source: 'channel', sourceId: '1' })
		expectConverted('f18', 'preview', { source: 'input', sourceId: 'hdmi-a' })
		expectConverted('f19', 'preview', { source: 'output', sourceId: 'D1' })
		expectConverted('f20', 'output_set', { outputId: 'D1', source: 'multiview' })
		expectRemoved('f21', 'configPresetApplied')

		assert.equal(result.updatedFeedbacks.length, 19, 'exactly the 19 converted feedbacks were reported as updated')
	})

	it('maps every storageState / afuState / eventStatus value', () => {
		const feedbacks = [
			feedback('storageState', { storageId: 'x', state: 'nodev' }, 's1'),
			feedback('storageState', { storageId: 'x', state: 'dev' }, 's2'),
			feedback('storageState', { storageId: 'x', state: 'devro' }, 's3'),
			feedback('storageState', { storageId: 'x', state: 'formatting' }, 's4'),
			feedback('afuState', { state: 'idle' }, 'u1'),
			feedback('afuState', { state: 'paused' }, 'u2'),
			feedback('afuState', { state: 'error' }, 'u3'),
			feedback('afuState', { state: 'disabled' }, 'u4'),
			feedback('eventStatus', { which: 'running' }, 'e1'),
			feedback('eventStatus', { which: 'paused' }, 'e2'),
			feedback('eventStatus', { which: 'ongoing' }, 'e3'),
		]
		convertToParityV300(null, convertProps([], feedbacks, null))
		const byControl = Object.fromEntries(feedbacks.map((f) => [f.controlId, f]))
		assert.equal(byControl.s1.options.level, 'nomedia')
		assert.equal(byControl.s2.options.level, 'notready')
		assert.equal(byControl.s3.options.level, 'ro')
		assert.equal(byControl.s4.options.level, 'formatting')
		assert.equal(byControl.u1.options.condition, 'afu_idle')
		assert.equal(byControl.u2.options.condition, 'afu_paused')
		assert.equal(byControl.u3.options.condition, 'afu_error')
		assert.equal(byControl.u4.options.condition, 'afu_off')
		assert.deepEqual(byControl.e1.options, { eventRef: 'ongoing', state: 'running' })
		assert.deepEqual(byControl.e2.options, { eventRef: 'ongoing', state: 'paused' })
		assert.deepEqual(byControl.e3.options, { eventRef: 'ongoing', state: 'ongoing' })
	})

	it('converts pollfreq (s) to poll_interval (ms), drops the removed fields, resets preset_categories (D8, D15)', () => {
		const config = {
			host: '10.0.0.5',
			pollfreq: 10,
			poll_archive: true,
			poll_connectivity: false,
			preset_categories: ['Channels', 'Publishers', 'Recorders'],
		}
		const result = convertToParityV300(null, convertProps([], [], config))
		assert.equal(result.updatedConfig.poll_interval, 10000, 'pollfreq 10 s -> poll_interval 10000 ms')
		assert.equal('pollfreq' in result.updatedConfig, false)
		assert.equal('poll_archive' in result.updatedConfig, false)
		assert.equal('poll_connectivity' in result.updatedConfig, false)
		assert.deepEqual(result.updatedConfig.preset_categories, presetCategoryIds, 'every new D15 category is on')
		assert.equal(result.updatedConfig.host, '10.0.0.5', 'unrelated fields are kept')
		// clamped at the D8 ceiling (a pollfreq above 300 s is itself clamped to 300 s first, i.e. 300000 ms)
		assert.equal(
			convertToParityV300(null, convertProps([], [], { pollfreq: 1000 })).updatedConfig.poll_interval,
			300000,
			'clamped to the 300000 ms ceiling',
		)
		// the old pollfreq field's own floor is 1 s, so 1000 ms is the smallest poll_interval this
		// conversion can ever produce (the D8 500 ms floor only matters for a value typed directly
		// into the new field afterwards, see init.test.js's normaliseConfig checks)
		assert.equal(
			convertToParityV300(null, convertProps([], [], { pollfreq: 0.1 })).updatedConfig.poll_interval,
			1000,
			'the old field never goes below 1 s, so the converted value never goes below 1000 ms',
		)
	})

	it('does nothing when there is no config to upgrade', () => {
		assert.equal(convertToParityV300(null, convertProps([], [], null)).updatedConfig, null)
	})
})

describe('REMOVED_LEGACY reporting (D13)', () => {
	before(() => {
		upgrades.REMOVED_LEGACY.length = 0
	})

	it('records every removed action/feedback instance with its controlId', () => {
		const actions = [
			action('refreshPoll', {}, 'c1'),
			action('refreshPoll', {}, 'c2'),
			action('getLayoutData', {}, 'c3'),
		]
		const feedbacks = [feedback('anyStreaming', {}, 'c4')]
		convertToParityV300(null, convertProps(actions, feedbacks, null))
		assert.deepEqual(
			upgrades.REMOVED_LEGACY.map((r) => [r.kind, r.id, r.controlId]).sort(),
			[
				['action', 'getLayoutData', 'c3'],
				['action', 'refreshPoll', 'c1'],
				['action', 'refreshPoll', 'c2'],
				['feedback', 'anyStreaming', 'c4'],
			].sort(),
		)
	})

	it('instance.init() warns once per distinct id (with its count) and empties the array', async () => {
		const mock = await startMockPearl()
		try {
			const instance = await createInstance({ mock })
			try {
				const warnings = instance.calls.log.filter((l) => l.level === 'warn').map((l) => l.message)
				const refreshPollLine = warnings.find((m) => m.includes("'refreshPoll'"))
				const getLayoutDataLine = warnings.find((m) => m.includes("'getLayoutData'"))
				const anyStreamingLine = warnings.find((m) => m.includes("'anyStreaming'"))
				assert.ok(refreshPollLine, 'refreshPoll was reported')
				assert.match(refreshPollLine, /\(2 buttons\)/)
				assert.ok(getLayoutDataLine, 'getLayoutData was reported')
				assert.match(getLayoutDataLine, /\(1 button\)/)
				assert.ok(anyStreamingLine, 'anyStreaming was reported')
				assert.equal(upgrades.REMOVED_LEGACY.length, 0, 'the array is emptied after being reported')
			} finally {
				await instance.destroy()
			}
		} finally {
			await mock.close()
		}
	})

	it('a later init() in the same process reports nothing new', async () => {
		const mock = await startMockPearl()
		try {
			const instance = await createInstance({ mock })
			try {
				assert.equal(instance.calls.log.filter((l) => l.level === 'warn').length, 0)
			} finally {
				await instance.destroy()
			}
		} finally {
			await mock.close()
		}
	})
})

describe('config.js fields for D8/D9/D10 (poll_interval, use_api_v2, previews)', () => {
	it('offers poll_interval (ms) and no longer offers pollfreq/poll_archive/poll_connectivity', () => {
		installStub()
		const { getConfigFields } = require('../src/config')
		const fields = getConfigFields()
		const ids = fields.map((f) => f.id)
		assert.ok(ids.includes('poll_interval'))
		assert.equal(ids.includes('pollfreq'), false)
		assert.equal(ids.includes('poll_archive'), false)
		assert.equal(ids.includes('poll_connectivity'), false)
		const pollField = fields.find((f) => f.id === 'poll_interval')
		assert.equal(pollField.label, 'Poll interval (ms)')
		assert.equal(pollField.default, 2000)
		assert.equal(pollField.min, 500)
		assert.equal(pollField.max, 300000)
		// D9: use_api_v2 is last among the operational settings, right before preset_categories
		assert.equal(ids.at(-1), 'preset_categories')
		assert.equal(ids.at(-2), 'use_api_v2')
	})

	it('DEFAULT_CONFIG (test harness) carries poll_interval 300000, not the old pollfreq', () => {
		assert.equal(DEFAULT_CONFIG.poll_interval, 300000)
		assert.equal('pollfreq' in DEFAULT_CONFIG, false)
		assert.equal('poll_archive' in DEFAULT_CONFIG, false)
		assert.equal('poll_connectivity' in DEFAULT_CONFIG, false)
	})

	it('a fresh instance reaches InstanceStatus.Ok against the mock with the new config fields', async () => {
		const mock = await startMockPearl()
		const instance = await createInstance({ mock })
		try {
			assert.equal(instance.currentStatus, InstanceStatus.Ok)
			assert.equal(instance.config.poll_interval, 300000)
			assert.equal(instance.config.pollfreq, undefined)
			assert.ok(Object.keys(instance.state.channels).length > 0)
		} finally {
			await instance.destroy()
			await mock.close()
		}
	})
})
