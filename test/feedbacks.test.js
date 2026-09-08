/**
 * The target 3.0.0 feedback set (doc/PARITY.md §1): every id, true/false cases, the "all"/"cid-all"
 * aggregates, the storage_level thresholds, the event_state/event_applies resolution and the advanced
 * preview/layout_preview/audio feedbacks.
 */
const { describe, it, before, after } = require('node:test')
const assert = require('node:assert/strict')

const { createInstance, runFeedback, subscribeFeedback, unsubscribeFeedback } = require('./harness')
const { startMockPearl, PNG_1X1 } = require('./mock-pearl')
const { colors } = require('../src/style')

const FEEDBACK_IDS = [
	'action_failed',
	'recorder_state',
	'stream_state',
	'layout_active',
	'layout_preview',
	'singletouch_active',
	'preview',
	'output_set',
	'event_state',
	'event_applies',
	'system',
	'storage_level',
	'audio',
	'confirm_pending',
]

describe('feedbacks', () => {
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

	it('defines exactly the target feedback set', () => {
		assert.deepEqual(Object.keys(instance.definitions.feedbacks).sort(), [...FEEDBACK_IDS].sort())
	})

	it('every feedback runs with its default options without throwing, boolean/advanced typed correctly', async () => {
		for (const id of FEEDBACK_IDS) {
			const def = instance.definitions.feedbacks[id]
			const options = {}
			for (const opt of def.options) options[opt.id] = opt.default
			const result = await runFeedback(instance, id, options)
			if (def.type === 'boolean') {
				assert.equal(typeof result, 'boolean', `${id} should return a boolean`)
			} else {
				assert.equal(typeof result, 'object', `${id} should return an object`)
			}
		}
	})

	it('no feedback callback ever throws, even with garbage or empty options', async () => {
		for (const [id, def] of Object.entries(instance.definitions.feedbacks)) {
			assert.doesNotThrow(() => def.callback({ feedbackId: id, options: {} }, {}), `feedback ${id}`)
			assert.doesNotThrow(
				() =>
					def.callback(
						{ feedbackId: id, options: { layoutId: 5, recorderId: null, publisherId: {}, storageId: [] } },
						{},
					),
				`feedback ${id} with garbage options`,
			)
		}
	})

	// ------------------------------------------------------------------
	// recorder_state (red on started/error, amber on starting/paused, grey otherwise; "all" aggregates)
	// ------------------------------------------------------------------

	describe('recorder_state', () => {
		it('matches a specific recorder in each direction', async () => {
			assert.equal(await runFeedback(instance, 'recorder_state', { recorderId: '1', state: 'started' }), true)
			assert.equal(await runFeedback(instance, 'recorder_state', { recorderId: '1', state: 'stopped' }), false)
			assert.equal(await runFeedback(instance, 'recorder_state', { recorderId: '2', state: 'stopped' }), true)
			assert.equal(await runFeedback(instance, 'recorder_state', { recorderId: '2', state: 'started' }), false)
			assert.equal(await runFeedback(instance, 'recorder_state', { recorderId: 'nope', state: 'started' }), false)
		})

		it('"all" aggregates: first of started > starting > paused > error found, else stopped', async () => {
			instance.state.recorders['1'].status = { state: 'started' }
			instance.state.recorders['2'].status = { state: 'stopped' }
			instance.state.recorders['m1'].status = { state: 'stopped' }
			assert.equal(await runFeedback(instance, 'recorder_state', { recorderId: 'all', state: 'started' }), true)

			instance.state.recorders['1'].status = { state: 'stopped' }
			instance.state.recorders['2'].status = { state: 'paused' }
			assert.equal(await runFeedback(instance, 'recorder_state', { recorderId: 'all', state: 'paused' }), true)
			assert.equal(await runFeedback(instance, 'recorder_state', { recorderId: 'all', state: 'started' }), false)

			instance.state.recorders['2'].status = { state: 'stopped' }
			assert.equal(await runFeedback(instance, 'recorder_state', { recorderId: 'all', state: 'stopped' }), true)
		})

		it('defaultStyle is stateStyle(red): bgcolor red, color badge text', () => {
			const style = instance.definitions.feedbacks.recorder_state.defaultStyle
			assert.equal(style.bgcolor, colors.red)
			assert.equal(style.color, colors.badgeText)
		})
	})

	// ------------------------------------------------------------------
	// stream_state (green on started, amber on starting/listening, red on error; "cid-all" aggregates)
	// ------------------------------------------------------------------

	describe('stream_state', () => {
		it('matches a specific publisher in each direction', async () => {
			instance.state.channels['1'].publishers['1'].status = { state: 'started' }
			instance.state.channels['1'].publishers['0'].status = { state: 'stopped' }
			assert.equal(await runFeedback(instance, 'stream_state', { publisherId: '1-1', state: 'started' }), true)
			assert.equal(await runFeedback(instance, 'stream_state', { publisherId: '1-0', state: 'started' }), false)
			assert.equal(await runFeedback(instance, 'stream_state', { publisherId: '1-9', state: 'started' }), false)
			assert.equal(
				await runFeedback(instance, 'stream_state', { publisherId: 'garbage', state: 'started' }),
				false,
			)
		})

		it('"cid-all" aggregates: first of started > starting > listening > error, else stopped', async () => {
			instance.state.channels['1'].publishers['0'].status = { state: 'stopped' }
			instance.state.channels['1'].publishers['1'].status = { state: 'listening' }
			assert.equal(
				await runFeedback(instance, 'stream_state', { publisherId: '1-all', state: 'listening' }),
				true,
			)

			instance.state.channels['1'].publishers['1'].status = { state: 'started' }
			assert.equal(await runFeedback(instance, 'stream_state', { publisherId: '1-all', state: 'started' }), true)

			instance.state.channels['1'].publishers['0'].status = { state: 'stopped' }
			instance.state.channels['1'].publishers['1'].status = { state: 'stopped' }
			assert.equal(await runFeedback(instance, 'stream_state', { publisherId: '1-all', state: 'stopped' }), true)
			// a channel without publishers is never anything but the "stopped" fallback
			assert.equal(await runFeedback(instance, 'stream_state', { publisherId: '2-all', state: 'stopped' }), true)
		})

		it('defaultStyle is stateStyle(green)', () => {
			const style = instance.definitions.feedbacks.stream_state.defaultStyle
			assert.equal(style.bgcolor, colors.green)
			assert.equal(style.color, colors.badgeText)
		})
	})

	// ------------------------------------------------------------------
	// layout_active
	// ------------------------------------------------------------------

	describe('layout_active', () => {
		it('is true for the active layout of its channel only', async () => {
			assert.equal(await runFeedback(instance, 'layout_active', { layoutId: '1-1' }), true)
			assert.equal(await runFeedback(instance, 'layout_active', { layoutId: '1-2' }), false)
			assert.equal(await runFeedback(instance, 'layout_active', { layoutId: '2-1' }), true)
			assert.equal(await runFeedback(instance, 'layout_active', { layoutId: '9-1' }), false)
			assert.equal(await runFeedback(instance, 'layout_active', { layoutId: 'garbage' }), false)
			assert.equal(await runFeedback(instance, 'layout_active', {}), false)
		})

		it('defaultStyle is stateStyle(amber)', () => {
			const style = instance.definitions.feedbacks.layout_active.defaultStyle
			assert.equal(style.bgcolor, colors.amber)
		})
	})

	// ------------------------------------------------------------------
	// singletouch_active
	// ------------------------------------------------------------------

	describe('singletouch_active', () => {
		it('"on" true while pressed, "error" true while status is false', async () => {
			assert.equal(await runFeedback(instance, 'singletouch_active', { stcId: '0', state: 'on' }), false)
			assert.equal(await runFeedback(instance, 'singletouch_active', { stcId: '0', state: 'error' }), false)
			instance.state.singleTouch['0'].state = { pressed: true, status: true }
			assert.equal(await runFeedback(instance, 'singletouch_active', { stcId: '0', state: 'on' }), true)
			assert.equal(await runFeedback(instance, 'singletouch_active', { stcId: '0', state: 'error' }), false)
			instance.state.singleTouch['0'].state = { pressed: false, status: false }
			assert.equal(await runFeedback(instance, 'singletouch_active', { stcId: '0', state: 'on' }), false)
			assert.equal(await runFeedback(instance, 'singletouch_active', { stcId: '0', state: 'error' }), true)
			assert.equal(await runFeedback(instance, 'singletouch_active', { stcId: '7', state: 'on' }), false)
		})
	})

	// ------------------------------------------------------------------
	// output_set (5 s optimistic window)
	// ------------------------------------------------------------------

	describe('output_set', () => {
		it('true only for the source last set on that output, within 5 s', async () => {
			instance.state.outputs.D1.source = 'console'
			instance.state.outputs.D1.setAt = Date.now()
			assert.equal(await runFeedback(instance, 'output_set', { outputId: 'D1', source: 'console' }), true)
			assert.equal(await runFeedback(instance, 'output_set', { outputId: 'D1', source: 'multiview' }), false)
			assert.equal(await runFeedback(instance, 'output_set', { outputId: 'nope', source: 'console' }), false)

			instance.state.outputs.D1.setAt = Date.now() - 5001
			assert.equal(await runFeedback(instance, 'output_set', { outputId: 'D1', source: 'console' }), false)
		})
	})

	// ------------------------------------------------------------------
	// storage_level (used ≥ 90% low, ≥ 97% full, else the device state)
	// ------------------------------------------------------------------

	describe('storage_level', () => {
		const setUsedPct = (usedPct) => {
			const free = Math.round(100 - usedPct)
			instance.state.storages.main.status = { state: 'ready', total: 100, free }
		}

		it('89% used: ok true, low false, full false', async () => {
			setUsedPct(89)
			assert.equal(await runFeedback(instance, 'storage_level', { storageId: 'main', level: 'ok' }), true)
			assert.equal(await runFeedback(instance, 'storage_level', { storageId: 'main', level: 'low' }), false)
			assert.equal(await runFeedback(instance, 'storage_level', { storageId: 'main', level: 'full' }), false)
		})

		it('90% used: low true, ok false, full false', async () => {
			setUsedPct(90)
			assert.equal(await runFeedback(instance, 'storage_level', { storageId: 'main', level: 'low' }), true)
			assert.equal(await runFeedback(instance, 'storage_level', { storageId: 'main', level: 'ok' }), false)
			assert.equal(await runFeedback(instance, 'storage_level', { storageId: 'main', level: 'full' }), false)
		})

		it('97% used: full true, low false, ok false', async () => {
			setUsedPct(97)
			assert.equal(await runFeedback(instance, 'storage_level', { storageId: 'main', level: 'full' }), true)
			assert.equal(await runFeedback(instance, 'storage_level', { storageId: 'main', level: 'low' }), false)
			assert.equal(await runFeedback(instance, 'storage_level', { storageId: 'main', level: 'ok' }), false)
		})

		it('device states map onto ro / nomedia / notready / formatting', async () => {
			instance.state.storages.main.status = { state: 'devro', total: 100, free: 50 }
			assert.equal(await runFeedback(instance, 'storage_level', { storageId: 'main', level: 'ro' }), true)
			instance.state.storages.external.status = { state: 'nodev' }
			assert.equal(
				await runFeedback(instance, 'storage_level', { storageId: 'external', level: 'nomedia' }),
				true,
			)
			instance.state.storages.external.status = { state: 'dev' }
			assert.equal(
				await runFeedback(instance, 'storage_level', { storageId: 'external', level: 'notready' }),
				true,
			)
			instance.state.storages.external.status = { state: 'formatting' }
			assert.equal(
				await runFeedback(instance, 'storage_level', { storageId: 'external', level: 'formatting' }),
				true,
			)
			assert.equal(await runFeedback(instance, 'storage_level', { storageId: 'nope', level: 'ok' }), false)
			// restore for later tests / poll comparisons
			await instance.pollAll()
		})
	})

	// ------------------------------------------------------------------
	// system (cpu_high/cpu_hot amber, afu_* amber/red/green)
	// ------------------------------------------------------------------

	describe('system', () => {
		it('cpu_high / cpu_hot follow systemStatus, both ways', async () => {
			instance.state.systemStatus = { cpuload_high: false, cputemp: 50, cputemp_threshold: 70 }
			assert.equal(await runFeedback(instance, 'system', { condition: 'cpu_high' }), false)
			assert.equal(await runFeedback(instance, 'system', { condition: 'cpu_hot' }), false)
			instance.state.systemStatus = { cpuload_high: true, cputemp: 80, cputemp_threshold: 70 }
			assert.equal(await runFeedback(instance, 'system', { condition: 'cpu_high' }), true)
			assert.equal(await runFeedback(instance, 'system', { condition: 'cpu_hot' }), true)
			instance.state.systemStatus = undefined
			assert.equal(await runFeedback(instance, 'system', { condition: 'cpu_high' }), false)
			assert.equal(await runFeedback(instance, 'system', { condition: 'cpu_hot' }), false)
		})

		it('afu_uploading / afu_paused / afu_error / afu_idle / afu_off', async () => {
			instance.state.afu = [{ status: { state: 'uploading' } }]
			assert.equal(await runFeedback(instance, 'system', { condition: 'afu_uploading' }), true)
			assert.equal(await runFeedback(instance, 'system', { condition: 'afu_idle' }), false)

			instance.state.afu = [{ status: { state: 'paused' } }]
			assert.equal(await runFeedback(instance, 'system', { condition: 'afu_paused' }), true)

			instance.state.afu = [{ status: { state: 'error' } }]
			assert.equal(await runFeedback(instance, 'system', { condition: 'afu_error' }), true)

			instance.state.afu = [{ status: { state: 'idle' } }]
			assert.equal(await runFeedback(instance, 'system', { condition: 'afu_idle' }), true)
			assert.equal(await runFeedback(instance, 'system', { condition: 'afu_off' }), false)

			instance.state.afu = [{ status: { state: 'disabled' } }]
			assert.equal(await runFeedback(instance, 'system', { condition: 'afu_off' }), true)

			instance.state.afu = []
			assert.equal(
				await runFeedback(instance, 'system', { condition: 'afu_off' }),
				true,
				'no entries also counts as off',
			)
			await instance.pollAll()
		})

		it('defaultStyle is stateStyle(amber)', () => {
			assert.equal(instance.definitions.feedbacks.system.defaultStyle.bgcolor, colors.amber)
		})
	})

	// ------------------------------------------------------------------
	// event_state / event_applies
	// ------------------------------------------------------------------

	describe('event_state and event_applies', () => {
		it('event_state resolves the seeded scheduled event as upcoming/scheduled, ongoing/none', async () => {
			assert.equal(await runFeedback(instance, 'event_state', { eventRef: 'upcoming', state: 'scheduled' }), true)
			assert.equal(await runFeedback(instance, 'event_state', { eventRef: 'ongoing', state: 'none' }), true)
			assert.equal(await runFeedback(instance, 'event_state', { eventRef: 'ongoing', state: 'running' }), false)
		})

		it('event_state: running / paused / ongoing (running-or-paused) / finished', async () => {
			instance.state.events.ongoing = { id: 'e1', status: 'running', title: 'Live', finish: 0 }
			assert.equal(await runFeedback(instance, 'event_state', { eventRef: 'ongoing', state: 'running' }), true)
			assert.equal(await runFeedback(instance, 'event_state', { eventRef: 'ongoing', state: 'ongoing' }), true)
			assert.equal(await runFeedback(instance, 'event_state', { eventRef: 'ongoing', state: 'paused' }), false)

			instance.state.events.ongoing = { id: 'e1', status: 'paused', title: 'Live', finish: 0 }
			assert.equal(await runFeedback(instance, 'event_state', { eventRef: 'ongoing', state: 'paused' }), true)
			assert.equal(await runFeedback(instance, 'event_state', { eventRef: 'ongoing', state: 'ongoing' }), true)

			instance.state.events.ongoing = null
			instance.state.events.list = [{ id: 'e2', status: 'finished', title: 'Done', finish: 100 }]
			assert.equal(await runFeedback(instance, 'event_state', { eventRef: 'completed', state: 'finished' }), true)
			await instance.pollAll()
		})

		it('event_applies mirrors utils.eventApplies for every op', async () => {
			instance.state.events.ongoing = { id: 'e1', status: 'running', title: 'Live', finish: 0 }
			assert.equal(await runFeedback(instance, 'event_applies', { eventRef: 'ongoing', op: 'pause' }), true)
			assert.equal(await runFeedback(instance, 'event_applies', { eventRef: 'ongoing', op: 'resume' }), false)
			assert.equal(await runFeedback(instance, 'event_applies', { eventRef: 'ongoing', op: 'stop' }), true)
			assert.equal(await runFeedback(instance, 'event_applies', { eventRef: 'ongoing', op: 'extend' }), true)
			assert.equal(await runFeedback(instance, 'event_applies', { eventRef: 'ongoing', op: 'start' }), false)

			instance.state.events.ongoing = { id: 'e1', status: 'paused', title: 'Live', finish: 0 }
			assert.equal(await runFeedback(instance, 'event_applies', { eventRef: 'ongoing', op: 'resume' }), true)
			assert.equal(await runFeedback(instance, 'event_applies', { eventRef: 'ongoing', op: 'pause' }), false)

			assert.equal(await runFeedback(instance, 'event_applies', { eventRef: 'upcoming', op: 'start' }), true)
			assert.equal(await runFeedback(instance, 'event_applies', { eventRef: 'upcoming', op: 'stop' }), false)
			await instance.pollAll()
		})

		it('defaultStyle: event_state stateStyle(green), event_applies stateStyle(cms)', () => {
			assert.equal(instance.definitions.feedbacks.event_state.defaultStyle.bgcolor, colors.green)
			assert.equal(instance.definitions.feedbacks.event_applies.defaultStyle.bgcolor, colors.cms)
		})
	})

	// ------------------------------------------------------------------
	// confirm_pending
	// ------------------------------------------------------------------

	describe('confirm_pending', () => {
		it('follows this.isConfirmPending(controlId)', async () => {
			assert.equal(await runFeedback(instance, 'confirm_pending', {}), false)
			instance.confirmPending = {
				key: 'x',
				controlId: 'c1',
				actionId: 'a1',
				label: 'x',
				until: Date.now() + 3000,
			}
			assert.equal(await runFeedback(instance, 'confirm_pending', {}), true)
			instance.clearConfirm()
			assert.equal(await runFeedback(instance, 'confirm_pending', {}), false)
		})

		it('defaultStyle is stateStyle(red)', () => {
			assert.equal(instance.definitions.feedbacks.confirm_pending.defaultStyle.bgcolor, colors.red)
		})
	})
})

// ------------------------------------------------------------------
// preview / layout_preview (advanced, subscribe/unsubscribe ref-count and fetch)
// ------------------------------------------------------------------

describe('preview feedback with preview_interval 0 (disabled)', () => {
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

	it('returns {} while disabled but still registers the subscription', async () => {
		assert.deepEqual(await runFeedback(instance, 'preview', { source: 'channel', sourceId: '1' }), {})
		mock.requests.length = 0
		await subscribeFeedback(instance, 'preview', { source: 'channel', sourceId: '1' })
		assert.equal(instance.previewSubscriptions.get('channel:1'), 1)
		await instance.pollPreviews()
		assert.ok(!mock.requests.some((r) => r.path.endsWith('/preview')), 'no image fetched while disabled')
		await unsubscribeFeedback(instance, 'preview', { source: 'channel', sourceId: '1' })
		assert.equal(instance.previewSubscriptions.size, 0)
	})
})

describe('preview feedback with preview_interval > 0', () => {
	let mock
	let instance

	before(async () => {
		mock = await startMockPearl()
		instance = await createInstance({ mock, config: { preview_interval: 1, preview_width: 144 } })
		mock.requests.length = 0
	})

	after(async () => {
		await instance.destroy()
		await mock.close()
	})

	it('subscribe fetches the image and the feedback returns png64 (channel/input/output)', async () => {
		await subscribeFeedback(instance, 'preview', { source: 'channel', sourceId: '1' })
		await subscribeFeedback(instance, 'preview', { source: 'input', sourceId: 'hdmi-a' })
		await subscribeFeedback(instance, 'preview', { source: 'output', sourceId: 'D1' })
		await instance.pollPreviews()

		const chReq = mock.requests.find((r) => r.path === '/api/v2.0/channels/1/preview')
		assert.ok(chReq)
		assert.deepEqual(chReq.query, { format: 'png', resolution: '144', keep_aspect_ratio: 'true' })
		const inReq = mock.requests.find((r) => r.path === '/api/v2.0/inputs/hdmi-a/preview')
		assert.ok(inReq)
		const outReq = mock.requests.find((r) => r.path === '/api/v2.0/outputs/D1/preview')
		assert.ok(outReq)
		assert.deepEqual(outReq.query, { format: 'png', resolution: '144x81' })

		assert.equal(
			(await runFeedback(instance, 'preview', { source: 'channel', sourceId: '1' })).png64,
			PNG_1X1.toString('base64'),
		)
		assert.equal(
			(await runFeedback(instance, 'preview', { source: 'input', sourceId: 'hdmi-a' })).png64,
			PNG_1X1.toString('base64'),
		)
		assert.equal(
			(await runFeedback(instance, 'preview', { source: 'output', sourceId: 'D1' })).png64,
			PNG_1X1.toString('base64'),
		)
		assert.ok(instance.checkedFeedbacks.some((ids) => ids.includes('preview')))
	})

	it('a missing entity yields no image and no error', async () => {
		instance.calls.log.length = 0
		await subscribeFeedback(instance, 'preview', { source: 'channel', sourceId: '99' })
		await instance.pollPreviews()
		assert.deepEqual(await runFeedback(instance, 'preview', { source: 'channel', sourceId: '99' }), {})
		assert.ok(!instance.calls.log.some((l) => l.level === 'error'))
		await unsubscribeFeedback(instance, 'preview', { source: 'channel', sourceId: '99' })
	})

	it('unsubscribe counts down and drops the cached image at zero', async () => {
		await subscribeFeedback(instance, 'preview', { source: 'channel', sourceId: '1' })
		assert.equal(instance.previewSubscriptions.get('channel:1'), 2)
		await unsubscribeFeedback(instance, 'preview', { source: 'channel', sourceId: '1' })
		assert.equal(instance.previewSubscriptions.get('channel:1'), 1)
		assert.ok(instance.previews['channel:1'])
		await unsubscribeFeedback(instance, 'preview', { source: 'channel', sourceId: '1' })
		assert.equal(instance.previewSubscriptions.has('channel:1'), false)
		assert.equal(instance.previews['channel:1'], undefined)
		assert.deepEqual(await runFeedback(instance, 'preview', { source: 'channel', sourceId: '1' }), {})
	})

	it('layout_preview fetches the undocumented per-layout endpoint on the legacy base, active or not', async () => {
		mock.requests.length = 0
		await subscribeFeedback(instance, 'layout_preview', { layoutId: '1-2' })
		assert.equal(instance.previewSubscriptions.get('layout:1-2'), 1)
		await instance.pollPreviews()
		const req = mock.requests.find((r) => r.path === '/api/channels/1/layouts/2/preview')
		assert.ok(req, 'requested on the legacy base, not /api/v2.0')
		assert.deepEqual(req.query, { resolution: '144x81' })
		assert.equal(
			(await runFeedback(instance, 'layout_preview', { layoutId: '1-2' })).png64,
			PNG_1X1.toString('base64'),
		)
		// the active layout gets its own independent image
		await subscribeFeedback(instance, 'layout_preview', { layoutId: '1-1' })
		await instance.pollPreviews()
		assert.equal(
			(await runFeedback(instance, 'layout_preview', { layoutId: '1-1' })).png64,
			PNG_1X1.toString('base64'),
		)
		await unsubscribeFeedback(instance, 'layout_preview', { layoutId: '1-1' })
		await unsubscribeFeedback(instance, 'layout_preview', { layoutId: '1-2' })
	})

	it('channel/input/output previews are skipped on legacy devices, but layout previews still work', async () => {
		const legacyMock = await startMockPearl({ firmware: '4.20.0', legacyOnly: true })
		const legacy = await createInstance({ mock: legacyMock, config: { preview_interval: 1 } })
		try {
			legacyMock.requests.length = 0
			await subscribeFeedback(legacy, 'preview', { source: 'channel', sourceId: '1' })
			await subscribeFeedback(legacy, 'layout_preview', { layoutId: '1-1' })
			await legacy.pollPreviews()
			assert.ok(!legacyMock.requests.some((r) => r.path.includes('/channels/1/preview')))
			assert.deepEqual(await runFeedback(legacy, 'preview', { source: 'channel', sourceId: '1' }), {})
			assert.ok(legacyMock.requests.some((r) => r.path === '/api/channels/1/layouts/1/preview'))
			assert.equal(
				(await runFeedback(legacy, 'layout_preview', { layoutId: '1-1' })).png64,
				PNG_1X1.toString('base64'),
			)
		} finally {
			await legacy.destroy()
			await legacyMock.close()
		}
	})
})
