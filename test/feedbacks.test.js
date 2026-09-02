const { describe, it, before, after } = require('node:test')
const assert = require('node:assert/strict')

const { createInstance, runFeedback, subscribeFeedback, unsubscribeFeedback } = require('./harness')
const { startMockPearl, PNG_1X1 } = require('./mock-pearl')

describe('boolean feedbacks', () => {
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

	it('channelLayout is true for the active layout only', async () => {
		assert.equal(await runFeedback(instance, 'channelLayout', { channelIdlayoutId: '1-1' }), true)
		assert.equal(await runFeedback(instance, 'channelLayout', { channelIdlayoutId: '1-2' }), false)
		assert.equal(await runFeedback(instance, 'channelLayout', { channelIdlayoutId: '2-1' }), true)
		assert.equal(await runFeedback(instance, 'channelLayout', { channelIdlayoutId: '9-1' }), false)
		assert.equal(await runFeedback(instance, 'channelLayout', { channelIdlayoutId: 'garbage' }), false)
		assert.equal(await runFeedback(instance, 'channelLayout', {}), false)
	})

	it('streamingState for a publisher and for all publishers of a channel', async () => {
		assert.equal(await runFeedback(instance, 'streamingState', { channelIdpublisherId: '1-1' }), true)
		assert.equal(await runFeedback(instance, 'streamingState', { channelIdpublisherId: '1-0' }), false)
		// one of two publishers is stopped -> not "all streaming"
		assert.equal(await runFeedback(instance, 'streamingState', { channelIdpublisherId: '1-all' }), false)
		// a channel without publishers is never "all streaming"
		assert.equal(await runFeedback(instance, 'streamingState', { channelIdpublisherId: '2-all' }), false)
		assert.equal(await runFeedback(instance, 'streamingState', { channelIdpublisherId: '9-all' }), false)

		mock.state.channels['1'].publishers['0'].status = { is_configured: true, started: true, state: 'started' }
		await instance.pollAll()
		assert.equal(await runFeedback(instance, 'streamingState', { channelIdpublisherId: '1-all' }), true)
		mock.reset()
		await instance.pollAll()
	})

	it('publisherState matches the exact state', async () => {
		assert.equal(
			await runFeedback(instance, 'publisherState', { channelIdpublisherId: '1-0', state: 'stopped' }),
			true,
		)
		assert.equal(
			await runFeedback(instance, 'publisherState', { channelIdpublisherId: '1-0', state: 'started' }),
			false,
		)
		assert.equal(
			await runFeedback(instance, 'publisherState', { channelIdpublisherId: '1-1', state: 'started' }),
			true,
		)
		assert.equal(
			await runFeedback(instance, 'publisherState', { channelIdpublisherId: '1-9', state: 'stopped' }),
			false,
		)
	})

	it('recorderRecording and recorderState', async () => {
		assert.equal(await runFeedback(instance, 'recorderRecording', { recorderId: '1' }), true)
		assert.equal(await runFeedback(instance, 'recorderRecording', { recorderId: '2' }), false)
		assert.equal(await runFeedback(instance, 'recorderRecording', { recorderId: 'nope' }), false)
		assert.equal(await runFeedback(instance, 'recorderState', { recorderId: '1', state: 'started' }), true)
		assert.equal(await runFeedback(instance, 'recorderState', { recorderId: '2', state: 'stopped' }), true)
		assert.equal(await runFeedback(instance, 'recorderState', { recorderId: '2', state: 'started' }), false)
		assert.equal(await runFeedback(instance, 'recorderState', { recorderId: 'm1', state: 'paused' }), false)
	})

	it('anyStreaming and anyRecording', async () => {
		assert.equal(await runFeedback(instance, 'anyStreaming', {}), true)
		assert.equal(await runFeedback(instance, 'anyRecording', {}), true)

		mock.state.channels['1'].publishers['1'].status = { is_configured: true, started: false, state: 'stopped' }
		mock.state.recorders['1'].status = { state: 'stopped' }
		await instance.pollAll()
		assert.equal(await runFeedback(instance, 'anyStreaming', {}), false)
		assert.equal(await runFeedback(instance, 'anyRecording', {}), false)
		assert.equal(instance.variableValues.recorders_active_count, 0)
		assert.equal(instance.variableValues.publishers_active_count, 0)
		mock.reset()
		await instance.pollAll()
		assert.equal(await runFeedback(instance, 'anyRecording', {}), true)
	})

	it('singleTouchPressed / singleTouchOk', async () => {
		assert.equal(await runFeedback(instance, 'singleTouchPressed', { stcId: '0' }), false)
		assert.equal(await runFeedback(instance, 'singleTouchOk', { stcId: '0' }), true)
		mock.state.singleTouch['0'].pressed = true
		mock.state.singleTouch['0'].status = false
		await instance.pollAll()
		assert.equal(await runFeedback(instance, 'singleTouchPressed', { stcId: '0' }), true)
		assert.equal(await runFeedback(instance, 'singleTouchOk', { stcId: '0' }), false)
		assert.equal(await runFeedback(instance, 'singleTouchOk', { stcId: '7' }), false)
		mock.reset()
		await instance.pollAll()
	})

	it('storageState and storageFreeBelow', async () => {
		assert.equal(await runFeedback(instance, 'storageState', { storageId: 'main', state: 'ready' }), true)
		assert.equal(await runFeedback(instance, 'storageState', { storageId: 'main', state: 'nodev' }), false)
		assert.equal(await runFeedback(instance, 'storageState', { storageId: 'external', state: 'nodev' }), true)
		assert.equal(await runFeedback(instance, 'storageState', { storageId: 'x', state: 'nodev' }), false)

		// main has 74.8 % free
		assert.equal(await runFeedback(instance, 'storageFreeBelow', { storageId: 'main', percent: 80 }), true)
		assert.equal(await runFeedback(instance, 'storageFreeBelow', { storageId: 'main', percent: 10 }), false)
		// 11821019136 / 15809413120 = 74.77 %
		assert.equal(await runFeedback(instance, 'storageFreeBelow', { storageId: 'main', percent: 74.8 }), true)
		assert.equal(await runFeedback(instance, 'storageFreeBelow', { storageId: 'main', percent: 74.7 }), false)
		// total unknown -> false
		assert.equal(await runFeedback(instance, 'storageFreeBelow', { storageId: 'external', percent: 50 }), false)

		mock.state.storages.main.free = 1e9
		await instance.pollAll()
		assert.equal(await runFeedback(instance, 'storageFreeBelow', { storageId: 'main', percent: 10 }), true)
		assert.equal(instance.variableValues.storage_main_free_percent, 6.3)
		mock.reset()
		await instance.pollAll()
	})

	it('afuState', async () => {
		assert.equal(await runFeedback(instance, 'afuState', { state: 'idle' }), true)
		assert.equal(await runFeedback(instance, 'afuState', { state: 'uploading' }), false)
		instance.state.afu = []
		assert.equal(await runFeedback(instance, 'afuState', { state: 'idle' }), false)
		await instance.pollAll()
		assert.equal(await runFeedback(instance, 'afuState', { state: 'idle' }), true)
	})

	it('cpuLoadHigh and cpuTempHigh both ways', async () => {
		assert.equal(await runFeedback(instance, 'cpuLoadHigh', {}), false)
		assert.equal(await runFeedback(instance, 'cpuTempHigh', {}), false)

		instance.state.systemStatus.cpuload_high = true
		instance.state.systemStatus.cputemp = 80
		assert.equal(await runFeedback(instance, 'cpuLoadHigh', {}), true)
		assert.equal(await runFeedback(instance, 'cpuTempHigh', {}), true)

		instance.state.systemStatus.cputemp = 70 // equal to threshold counts as high
		assert.equal(await runFeedback(instance, 'cpuTempHigh', {}), true)

		instance.state.systemStatus = undefined
		assert.equal(await runFeedback(instance, 'cpuLoadHigh', {}), false)
		assert.equal(await runFeedback(instance, 'cpuTempHigh', {}), false)

		await instance.pollAll()
		assert.equal(await runFeedback(instance, 'cpuTempHigh', {}), false)
	})

	it('eventStatus', async () => {
		assert.equal(await runFeedback(instance, 'eventStatus', { which: 'upcoming' }), true)
		assert.equal(await runFeedback(instance, 'eventStatus', { which: 'ongoing' }), false)
		assert.equal(await runFeedback(instance, 'eventStatus', { which: 'running' }), false)
		assert.equal(await runFeedback(instance, 'eventStatus', { which: 'paused' }), false)
		assert.equal(await runFeedback(instance, 'eventStatus', { which: 'bogus' }), false)

		mock.state.events[0].status = 'running'
		await instance.pollAll()
		assert.equal(await runFeedback(instance, 'eventStatus', { which: 'upcoming' }), false)
		assert.equal(await runFeedback(instance, 'eventStatus', { which: 'ongoing' }), true)
		assert.equal(await runFeedback(instance, 'eventStatus', { which: 'running' }), true)
		assert.equal(await runFeedback(instance, 'eventStatus', { which: 'paused' }), false)
		assert.equal(instance.variableValues.event_ongoing_title, 'Example event')
		assert.equal(instance.variableValues.event_ongoing_status, 'running')

		mock.state.events[0].status = 'paused'
		await instance.pollAll()
		assert.equal(await runFeedback(instance, 'eventStatus', { which: 'paused' }), true)
		assert.equal(await runFeedback(instance, 'eventStatus', { which: 'running' }), false)
		mock.reset()
		await instance.pollAll()
	})

	it('preview feedbacks return {} while previews are disabled (preview_interval 0) but keep their subscription', async () => {
		assert.deepEqual(await runFeedback(instance, 'channelPreview', { channel: '1' }), {})
		assert.deepEqual(await runFeedback(instance, 'inputPreview', { input: 'hdmi-a' }), {})
		assert.deepEqual(await runFeedback(instance, 'outputPreview', { output: 'D1' }), {})
		mock.requests.length = 0
		await subscribeFeedback(instance, 'channelPreview', { channel: '1' })
		// Companion calls subscribe only once per feedback, so the key must be registered even while
		// previews are off; otherwise enabling previews later would never fetch an image
		assert.equal(instance.previewSubscriptions.get('channel:1'), 1)
		await instance.pollPreviews()
		assert.ok(!mock.requests.some((r) => r.path.endsWith('/preview')), 'no image is fetched while disabled')
		assert.deepEqual(await runFeedback(instance, 'channelPreview', { channel: '1' }), {})
		await unsubscribeFeedback(instance, 'channelPreview', { channel: '1' })
		assert.equal(instance.previewSubscriptions.size, 0)
	})

	it('no feedback callback ever throws', async () => {
		for (const [id, def] of Object.entries(instance.definitions.feedbacks)) {
			assert.doesNotThrow(() => def.callback({ feedbackId: id, options: {} }, {}), `feedback ${id}`)
			assert.doesNotThrow(
				() => def.callback({ feedbackId: id, options: { channelIdlayoutId: 5, recorderId: null } }, {}),
				`feedback ${id}`,
			)
		}
	})
})

describe('preview feedbacks with preview_interval > 0', () => {
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

	it('starts the preview timer', () => {
		assert.ok(instance.previewTimer)
	})

	it('subscribe fetches the image and the feedback returns png64', async () => {
		await subscribeFeedback(instance, 'channelPreview', { channel: '1' })
		assert.equal(instance.previewSubscriptions.get('channel:1'), 1)
		await instance.pollPreviews()
		const req = mock.requests.find((r) => r.path === '/api/v2.0/channels/1/preview')
		assert.ok(req, 'channel preview requested')
		assert.deepEqual(req.query, { format: 'png', resolution: '144', keep_aspect_ratio: 'true' })

		const result = await runFeedback(instance, 'channelPreview', { channel: '1' })
		assert.equal(typeof result.png64, 'string')
		assert.equal(result.png64, PNG_1X1.toString('base64'))
		assert.ok(instance.checkedFeedbacks.some((ids) => ids.includes('channelPreview')))
	})

	it('input and output previews use their own endpoints and resolutions', async () => {
		await subscribeFeedback(instance, 'inputPreview', { input: 'hdmi-a' })
		await subscribeFeedback(instance, 'outputPreview', { output: 'D1' })
		await instance.pollPreviews()
		const input = mock.requests.find((r) => r.path === '/api/v2.0/inputs/hdmi-a/preview')
		assert.ok(input)
		assert.deepEqual(input.query, { format: 'png', resolution: '144', keep_aspect_ratio: 'true' })
		const output = mock.requests.find((r) => r.path === '/api/v2.0/outputs/D1/preview')
		assert.ok(output)
		assert.deepEqual(output.query, { format: 'png', resolution: '144x81' })

		assert.equal(
			(await runFeedback(instance, 'inputPreview', { input: 'hdmi-a' })).png64,
			PNG_1X1.toString('base64'),
		)
		assert.equal((await runFeedback(instance, 'outputPreview', { output: 'D1' })).png64, PNG_1X1.toString('base64'))
		assert.deepEqual(await runFeedback(instance, 'inputPreview', { input: 'USBA' }), {})
	})

	it('a missing entity yields no image and no error', async () => {
		instance.calls.log.length = 0
		await subscribeFeedback(instance, 'channelPreview', { channel: '99' })
		await instance.pollPreviews()
		assert.deepEqual(await runFeedback(instance, 'channelPreview', { channel: '99' }), {})
		assert.ok(!instance.calls.log.some((l) => l.level === 'error'))
		await unsubscribeFeedback(instance, 'channelPreview', { channel: '99' })
	})

	it('unsubscribe counts down and drops the cached image at zero', async () => {
		await subscribeFeedback(instance, 'channelPreview', { channel: '1' })
		assert.equal(instance.previewSubscriptions.get('channel:1'), 2)
		await unsubscribeFeedback(instance, 'channelPreview', { channel: '1' })
		assert.equal(instance.previewSubscriptions.get('channel:1'), 1)
		assert.ok(instance.previews['channel:1'])
		await unsubscribeFeedback(instance, 'channelPreview', { channel: '1' })
		assert.equal(instance.previewSubscriptions.has('channel:1'), false)
		assert.equal(instance.previews['channel:1'], undefined)
		assert.deepEqual(await runFeedback(instance, 'channelPreview', { channel: '1' }), {})

		// drain the refresh the subscribe above kicked off, then check what a fresh refresh requests
		await instance.pollPreviews()
		assert.equal(instance.previews['channel:1'], undefined, 'in-flight image of an unsubscribed key is dropped')
		mock.requests.length = 0
		await instance.pollPreviews()
		assert.ok(!mock.requests.some((r) => r.path === '/api/v2.0/channels/1/preview'))
		assert.ok(mock.requests.some((r) => r.path === '/api/v2.0/inputs/hdmi-a/preview'))
	})

	it('channel/input/output previews are skipped on legacy devices, but layout previews still work', async () => {
		const legacyMock = await startMockPearl({ firmware: '4.20.0', legacyOnly: true })
		const legacy = await createInstance({ mock: legacyMock, config: { preview_interval: 1 } })
		try {
			legacyMock.requests.length = 0
			await subscribeFeedback(legacy, 'channelPreview', { channel: '1' })
			await subscribeFeedback(legacy, 'channelLayoutPreview', { channelIdlayoutId: '1-1' })
			await legacy.pollPreviews()
			assert.ok(
				!legacyMock.requests.some((r) => r.path.includes('/channels/1/preview')),
				'the v2.0-only channel preview endpoint is not attempted',
			)
			assert.deepEqual(await runFeedback(legacy, 'channelPreview', { channel: '1' }), {})
			// the layout preview endpoint is on the legacy base, so it works even here
			assert.ok(legacyMock.requests.some((r) => r.path === '/api/channels/1/layouts/1/preview'))
			assert.equal(
				(await runFeedback(legacy, 'channelLayoutPreview', { channelIdlayoutId: '1-1' })).png64,
				PNG_1X1.toString('base64'),
			)
		} finally {
			await legacy.destroy()
			await legacyMock.close()
		}
	})
})

describe('channelLayoutPreview: a real image per layout, active or not', () => {
	let mock
	let instance

	before(async () => {
		mock = await startMockPearl()
		instance = await createInstance({ mock, config: { preview_interval: 1, preview_width: 144 } })
		// channel '1' seeds layout '1' (Default) active, layout '2' (Picture in picture) inactive
	})

	after(async () => {
		await instance.destroy()
		await mock.close()
	})

	it('fetches the undocumented per-layout endpoint on the legacy base, independent of active state', async () => {
		await subscribeFeedback(instance, 'channelLayoutPreview', { channelIdlayoutId: '1-2' })
		assert.equal(instance.previewSubscriptions.get('layout:1-2'), 1, 'each layout gets its own key')
		mock.requests.length = 0
		await instance.pollPreviews()
		const req = mock.requests.find((r) => r.path === '/api/channels/1/layouts/2/preview')
		assert.ok(req, 'requested on the legacy base, not /api/v2.0')
		assert.deepEqual(req.query, { resolution: '144x81' })

		const result = await runFeedback(instance, 'channelLayoutPreview', { channelIdlayoutId: '1-2' })
		assert.equal(result.png64, PNG_1X1.toString('base64'))
	})

	it('the active layout also gets its own image, independently of the inactive one', async () => {
		await subscribeFeedback(instance, 'channelLayoutPreview', { channelIdlayoutId: '1-1' })
		assert.equal(instance.previewSubscriptions.get('layout:1-1'), 1)
		await instance.pollPreviews()
		const result = await runFeedback(instance, 'channelLayoutPreview', { channelIdlayoutId: '1-1' })
		assert.equal(result.png64, PNG_1X1.toString('base64'))
		// unrelated to channelPreview's own cache (a different key namespace)
		assert.equal(instance.previews['channel:1'], undefined)
	})

	it('is unaffected by which layout becomes active', async () => {
		instance.checkedFeedbacks.length = 0
		for (const l of mock.state.channels['1'].layouts) l.active = l.id === '2'
		await instance.pollAll()
		// no longer tied to the layouts domain: an active-layout change does not need to re-check it
		assert.ok(!instance.checkedFeedbacks.flat().includes('channelLayoutPreview'))
		assert.equal(
			(await runFeedback(instance, 'channelLayoutPreview', { channelIdlayoutId: '1-1' })).png64,
			PNG_1X1.toString('base64'),
		)
		assert.equal(
			(await runFeedback(instance, 'channelLayoutPreview', { channelIdlayoutId: '1-2' })).png64,
			PNG_1X1.toString('base64'),
		)

		mock.reset()
		await instance.pollAll()
		await unsubscribeFeedback(instance, 'channelLayoutPreview', { channelIdlayoutId: '1-1' })
		await unsubscribeFeedback(instance, 'channelLayoutPreview', { channelIdlayoutId: '1-2' })
	})

	it('an unknown channel/layout pair never errors', async () => {
		instance.calls.log.length = 0
		await subscribeFeedback(instance, 'channelLayoutPreview', { channelIdlayoutId: '9-9' })
		await instance.pollPreviews()
		assert.deepEqual(await runFeedback(instance, 'channelLayoutPreview', { channelIdlayoutId: '9-9' }), {})
		assert.ok(!instance.calls.log.some((l) => l.level === 'error'))
		await unsubscribeFeedback(instance, 'channelLayoutPreview', { channelIdlayoutId: '9-9' })

		assert.deepEqual(await runFeedback(instance, 'channelLayoutPreview', { channelIdlayoutId: 'garbage' }), {})
		assert.deepEqual(await runFeedback(instance, 'channelLayoutPreview', {}), {})
	})
})

describe('optimistic feedbacks: outputSourceOptimistic and configPresetApplied', () => {
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

	it('outputSourceOptimistic is false for every source until an action sets one', async () => {
		// the Output schema has no source field, so a fresh device never satisfies this feedback
		assert.equal(
			await runFeedback(instance, 'outputSourceOptimistic', { output: 'D1', source: 'multiview' }),
			false,
		)
		assert.equal(await runFeedback(instance, 'outputSourceOptimistic', { output: 'D1', source: '' }), false)
		assert.equal(await runFeedback(instance, 'outputSourceOptimistic', { output: '', source: 'multiview' }), false)
	})

	it('configPresetApplied is false for every preset until an action applies one', async () => {
		assert.equal(await runFeedback(instance, 'configPresetApplied', { preset: 'Default' }), false)
		assert.equal(await runFeedback(instance, 'configPresetApplied', { preset: '' }), false)
	})
})
