const { describe, it, before, after, beforeEach } = require('node:test')
const assert = require('node:assert/strict')

const { createInstance, runAction } = require('./harness')
const { startMockPearl } = require('./mock-pearl')

const V2 = '/api/v2.0'

/** requests recorded since the last mark() */
function recorded(mock, method, path) {
	return mock.requests.filter((r) => (!method || r.method === method) && (!path || r.path === path))
}

function one(mock, method, path) {
	const list = recorded(mock, method, path)
	assert.equal(list.length, 1, `expected exactly one ${method} ${path}, got ${list.length}`)
	return list[0]
}

function errors(instance) {
	return instance.calls.log.filter((l) => l.level === 'error').map((l) => l.message)
}

describe('actions against a v2.0 device', () => {
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

	beforeEach(() => {
		mock.requests.length = 0
		instance.calls.log.length = 0
	})

	it('channelChangeLayout sends the id as query and body', async () => {
		await runAction(instance, 'channelChangeLayout', { channelIdlayoutId: '1-2' })
		const req = one(mock, 'PUT', `${V2}/channels/1/layouts/active`)
		assert.deepEqual(req.query, { id: '2' })
		assert.deepEqual(req.body, { id: 2 })
		assert.equal(mock.state.channels['1'].layouts.find((l) => l.id === '2').active, true)
		assert.ok(instance.pollSoonTimer, 'poll nudged')
	})

	it('channelChangeLayout with an unknown layout logs an error and sends nothing', async () => {
		await runAction(instance, 'channelChangeLayout', { channelIdlayoutId: '1-9' })
		assert.equal(recorded(mock, 'PUT').length, 0)
		assert.ok(errors(instance).some((m) => /non existing layout/.test(m)))
	})

	it('controlStreaming start/stop a single publisher and all publishers', async () => {
		await runAction(instance, 'controlStreaming', { channelIdpublisherId: '1-0', startStopAction: 1 })
		one(mock, 'POST', `${V2}/channels/1/publishers/0/control/start`)
		assert.equal(mock.state.channels['1'].publishers['0'].status.state, 'started')

		await runAction(instance, 'controlStreaming', { channelIdpublisherId: '1-all', startStopAction: 0 })
		one(mock, 'POST', `${V2}/channels/1/publishers/control/stop`)
		assert.equal(mock.state.channels['1'].publishers['1'].status.state, 'stopped')

		await runAction(instance, 'controlStreaming', { channelIdpublisherId: '1-all', startStopAction: 99 })
		assert.equal(recorded(mock, 'POST').length, 2)
		mock.reset()
	})

	it('controlStreaming toggle on a started publisher sends stop, on a stopped one start', async () => {
		await instance.pollAll()
		mock.requests.length = 0
		assert.equal(instance.state.channels['1'].publishers['1'].status.state, 'started')
		await runAction(instance, 'controlStreaming', { channelIdpublisherId: '1-1', startStopAction: 3 })
		one(mock, 'POST', `${V2}/channels/1/publishers/1/control/stop`)

		assert.equal(instance.state.channels['1'].publishers['0'].status.state, 'stopped')
		await runAction(instance, 'controlStreaming', { channelIdpublisherId: '1-0', startStopAction: 3 })
		one(mock, 'POST', `${V2}/channels/1/publishers/0/control/start`)

		// toggle all: at least one stopped -> start all
		await instance.pollAll()
		mock.requests.length = 0
		await runAction(instance, 'controlStreaming', { channelIdpublisherId: '1-all', startStopAction: 3 })
		one(mock, 'POST', `${V2}/channels/1/publishers/control/start`)
		mock.reset()
		await instance.pollAll()
	})

	it('recorderRecording start/stop/toggle/reset', async () => {
		assert.equal(instance.state.recorders['2'].status.state, 'stopped')
		await runAction(instance, 'recorderRecording', { recorderId: '2', startStopAction: 3 })
		one(mock, 'POST', `${V2}/recorders/2/control/start`)

		await runAction(instance, 'recorderRecording', { recorderId: '1', startStopAction: 0 })
		one(mock, 'POST', `${V2}/recorders/1/control/stop`)

		await runAction(instance, 'recorderRecording', { recorderId: 'm1', startStopAction: 1 })
		one(mock, 'POST', `${V2}/recorders/m1/control/start`)

		// reset only exists in the legacy API
		await runAction(instance, 'recorderRecording', { recorderId: '1', startStopAction: 2 })
		one(mock, 'POST', '/api/recorders/1/control/reset')

		await runAction(instance, 'recorderRecording', { recorderId: '99', startStopAction: 1 })
		assert.equal(recorded(mock, 'POST').length, 4)
		mock.reset()
		await instance.pollAll()
	})

	it('insertMarker sends the text as query and body', async () => {
		await runAction(instance, 'insertMarker', { channel: '1', markertext: 'Hello marker' })
		const req = one(mock, 'POST', `${V2}/channels/1/bookmarks`)
		assert.deepEqual(req.query, { text: 'Hello marker' })
		assert.deepEqual(req.body, { text: 'Hello marker' })
		assert.equal(mock.state.channels['1'].bookmarks.length, 1)
		assert.ok(instance.calls.log.some((l) => l.level === 'info' && /Marker successfully sent/.test(l.message)))
	})

	it('insertMarker on a channel that is not recording logs the device error', async () => {
		await runAction(instance, 'insertMarker', { channel: '2', markertext: 'x' })
		one(mock, 'POST', `${V2}/channels/2/bookmarks`)
		assert.ok(errors(instance).some((m) => /409/.test(m) && /not being recorded/.test(m)))
	})

	it('channel actions validate the selected channel against the device state', async () => {
		await runAction(instance, 'insertMarker', { channel: '99', markertext: 'x' })
		assert.equal(recorded(mock, 'POST').length, 0)
		assert.ok(errors(instance).some((m) => /insert marker: unknown channel 99/.test(m)))

		await runAction(instance, 'getContentMetadata', { channel: '' })
		await runAction(instance, 'setContentMetadata', { channel: undefined, title: 't', author: 'a', prefix: 'p' })
		await runAction(instance, 'setChannelName', { channel: '../etc', name: 'x' })
		assert.equal(recorded(mock).length, 0)
		assert.ok(errors(instance).some((m) => /get content metadata: no channel selected/.test(m)))
		assert.ok(errors(instance).some((m) => /set content metadata: no channel selected/.test(m)))
		assert.ok(errors(instance).some((m) => /set name: unknown channel \.\.\/etc/.test(m)))
	})

	it('getLayoutData stores the legacy layout JSON in a custom variable', async () => {
		await runAction(instance, 'getLayoutData', { channelIdlayoutId: '1-1', destination: 'layout1' })
		one(mock, 'GET', '/api/channels/1/layouts/1/settings')
		const stored = JSON.parse(instance.customVariables.layout1)
		assert.equal(stored.name, 'Default')
		assert.equal(stored.video[0].source, 'hdmi-a')
	})

	it('setLayoutData PUTs the JSON to the legacy layout endpoint', async () => {
		await runAction(instance, 'setLayoutData', {
			channelIdlayoutId: '1-2',
			source: '{"name":"PiP renamed","video":[],"audio":[]}',
		})
		const req = one(mock, 'PUT', '/api/channels/1/layouts/2/settings')
		assert.equal(req.body.name, 'PiP renamed')
		assert.equal(mock.state.channels['1'].layouts.find((l) => l.id === '2').name, 'PiP renamed')
		mock.reset()
	})

	it('setLayoutData with invalid JSON logs an error and sends nothing', async () => {
		await runAction(instance, 'setLayoutData', { channelIdlayoutId: '1-2', source: '{not json' })
		assert.equal(recorded(mock, 'PUT').length, 0)
		assert.ok(errors(instance).some((m) => /not valid JSON/.test(m)))
	})

	it('systemReboot and systemShutdown', async () => {
		await runAction(instance, 'systemReboot', {})
		one(mock, 'POST', `${V2}/system/control/reboot`)
		assert.equal(mock.state.control.lastCommand, 'reboot')
		await runAction(instance, 'systemShutdown', {})
		one(mock, 'POST', `${V2}/system/control/shutdown`)
		assert.equal(mock.state.control.lastCommand, 'shutdown')
	})

	it('getContentMetadata refreshes the metadata variables', async () => {
		mock.state.channels['1'].metadata.title = 'Evening Show'
		await runAction(instance, 'getContentMetadata', { channel: '1' })
		const req = one(mock, 'GET', '/admin/channel1/get_params.cgi')
		assert.deepEqual(Object.keys(req.query).sort(), ['author', 'rec_prefix', 'title'])
		assert.equal(instance.metadata['1'].title, 'Evening Show')
		assert.equal(instance.variableValues.channel_1_metadata_title, 'Evening Show')
		mock.state.channels['1'].metadata.title = 'Morning Show'
	})

	it('setContentMetadata calls set_params.cgi and updates variables', async () => {
		await runAction(instance, 'setContentMetadata', {
			channel: '2',
			title: 'Title 2',
			author: 'Author 2',
			prefix: 'PFX',
		})
		const req = one(mock, 'GET', '/admin/channel2/set_params.cgi')
		assert.deepEqual(req.query, { title: 'Title 2', author: 'Author 2', rec_prefix: 'PFX' })
		assert.deepEqual(mock.state.channels['2'].metadata, { title: 'Title 2', author: 'Author 2', rec_prefix: 'PFX' })
		assert.equal(instance.variableValues.channel_2_metadata_title, 'Title 2')
		assert.equal(instance.variableValues.channel_2_metadata_rec_prefix, 'PFX')
		assert.deepEqual(errors(instance), [])
	})

	it('recorderControlAll', async () => {
		await runAction(instance, 'recorderControlAll', { action: 'stop' })
		one(mock, 'POST', `${V2}/recorders/control/stop`)
		assert.equal(mock.state.recorders['1'].status.state, 'stopped')
		await runAction(instance, 'recorderControlAll', { action: 'start' })
		one(mock, 'POST', `${V2}/recorders/control/start`)
		assert.equal(mock.state.recorders['2'].status.state, 'started')
		mock.reset()
	})

	it('setChannelName', async () => {
		await runAction(instance, 'setChannelName', { channel: '1', name: 'Main cam' })
		const req = one(mock, 'PUT', `${V2}/channels/1/name`)
		assert.deepEqual(req.query, { name: 'Main cam' })
		assert.equal(mock.state.channels['1'].name, 'Main cam')

		await runAction(instance, 'setChannelName', { channel: '1', name: '   ' })
		assert.equal(recorded(mock, 'PUT').length, 1)
		assert.ok(errors(instance).some((m) => /must not be empty/.test(m)))
		mock.reset()
	})

	it('setPublisherName', async () => {
		await runAction(instance, 'setPublisherName', { channelIdpublisherId: '1-0', name: 'YouTube' })
		const req = one(mock, 'PUT', `${V2}/channels/1/publishers/0/name`)
		assert.deepEqual(req.query, { name: 'YouTube' })
		assert.equal(mock.state.channels['1'].publishers['0'].name, 'YouTube')

		await runAction(instance, 'setPublisherName', { channelIdpublisherId: '1-all', name: 'x' })
		assert.equal(recorded(mock, 'PUT').length, 1)
		assert.ok(errors(instance).some((m) => /all publishers/.test(m)))
		mock.reset()
	})

	it('setPublisherEnabled and setPublisherSingleTouch PATCH common settings', async () => {
		await runAction(instance, 'setPublisherEnabled', { channelIdpublisherId: '1-0', enabled: 'false' })
		let req = one(mock, 'PATCH', `${V2}/channels/1/publishers/0/settings`)
		assert.deepEqual(req.body, { common: { enabled: false } })
		assert.equal(mock.state.channels['1'].publishers['0'].settings.common.enabled, false)
		assert.equal(mock.state.channels['1'].publishers['0'].settings.common.single_touch, false)

		mock.requests.length = 0
		await runAction(instance, 'setPublisherSingleTouch', { channelIdpublisherId: '1-0', single_touch: 'true' })
		req = one(mock, 'PATCH', `${V2}/channels/1/publishers/0/settings`)
		assert.deepEqual(req.body, { common: { single_touch: true } })
		assert.equal(mock.state.channels['1'].publishers['0'].settings.common.single_touch, true)
		assert.equal(mock.state.channels['1'].publishers['0'].settings.rtmp.url, 'rtmp://192.168.86.51')
		mock.reset()
	})

	it('setRtmpDestination only sends non-blank fields', async () => {
		await runAction(instance, 'setRtmpDestination', {
			channelIdpublisherId: '1-0',
			url: 'rtmp://a.rtmp.youtube.com/live2',
			stream: 'key-123',
			username: '',
			password: '',
		})
		const req = one(mock, 'PATCH', `${V2}/channels/1/publishers/0/settings`)
		assert.deepEqual(req.body, { rtmp: { url: 'rtmp://a.rtmp.youtube.com/live2', stream: 'key-123' } })
		const settings = mock.state.channels['1'].publishers['0'].settings
		assert.equal(settings.rtmp.stream, 'key-123')
		assert.equal(settings.rtmp.username, '')
		assert.equal(settings.type, 'rtmp')

		mock.requests.length = 0
		await runAction(instance, 'setRtmpDestination', {
			channelIdpublisherId: '1-0',
			url: '',
			stream: '',
			username: '',
			password: '',
		})
		assert.equal(recorded(mock, 'PATCH').length, 0)
		assert.ok(instance.calls.log.some((l) => l.level === 'warn' && /all fields blank/.test(l.message)))
		mock.reset()
	})

	it('setSrtDestination builds the srt object per mode and validates ranges', async () => {
		await runAction(instance, 'setSrtDestination', {
			channelIdpublisherId: '1-1',
			mode: 'listener',
			url: 'srt://ignored',
			stream_id: 'ignored',
			port: '1030',
			latency: '200',
		})
		let req = one(mock, 'PATCH', `${V2}/channels/1/publishers/1/settings`)
		assert.deepEqual(req.body, { srt: { mode: 'listener', port: 1030, latency: 200 } })

		mock.requests.length = 0
		await runAction(instance, 'setSrtDestination', {
			channelIdpublisherId: '1-1',
			mode: 'caller',
			url: 'srt://host:9000',
			stream_id: 'abc',
			port: '',
			latency: '',
		})
		req = one(mock, 'PATCH', `${V2}/channels/1/publishers/1/settings`)
		assert.deepEqual(req.body, { srt: { mode: 'caller', url: 'srt://host:9000', stream_id: 'abc' } })

		mock.requests.length = 0
		await runAction(instance, 'setSrtDestination', {
			channelIdpublisherId: '1-1',
			mode: 'rendezvous',
			url: 'srt://host:9000',
			stream_id: 'abc',
			port: '',
			latency: '',
		})
		req = one(mock, 'PATCH', `${V2}/channels/1/publishers/1/settings`)
		assert.deepEqual(req.body, { srt: { mode: 'rendezvous', url: 'srt://host:9000' } })

		mock.requests.length = 0
		await runAction(instance, 'setSrtDestination', {
			channelIdpublisherId: '1-1',
			mode: 'listener',
			url: '',
			stream_id: '',
			port: '80',
			latency: '',
		})
		assert.equal(recorded(mock, 'PATCH').length, 0)
		assert.ok(errors(instance).some((m) => /invalid port/.test(m)))

		await runAction(instance, 'setSrtDestination', {
			channelIdpublisherId: '1-1',
			mode: 'caller',
			url: '',
			stream_id: '',
			port: '',
			latency: '10',
		})
		assert.equal(recorded(mock, 'PATCH').length, 0)
		assert.ok(errors(instance).some((m) => /invalid latency/.test(m)))
		mock.reset()
	})

	it('setSrtDestination mode "unchanged" is the default and sends only the non-blank fields', async () => {
		const options = Object.fromEntries(instance.definitions.actions.setSrtDestination.options.map((o) => [o.id, o]))
		assert.equal(options.mode.default, 'unchanged')
		assert.equal(options.mode.choices[0].id, 'unchanged')
		// url / stream id / port are all offered while the mode is kept, otherwise only where applicable
		assert.ok(options.url.isVisible({ mode: 'unchanged' }))
		assert.ok(options.stream_id.isVisible({ mode: 'unchanged' }))
		assert.ok(options.port.isVisible({ mode: 'unchanged' }))
		assert.ok(!options.port.isVisible({ mode: 'caller' }))
		assert.ok(!options.stream_id.isVisible({ mode: 'listener' }))
		assert.ok(!options.url.isVisible({ mode: 'listener' }))

		await runAction(instance, 'setSrtDestination', {
			channelIdpublisherId: '1-1',
			mode: 'unchanged',
			url: 'srt://host:9000',
			stream_id: 'abc',
			port: '1030',
			latency: '120',
		})
		const req = one(mock, 'PATCH', `${V2}/channels/1/publishers/1/settings`)
		assert.deepEqual(req.body, { srt: { url: 'srt://host:9000', stream_id: 'abc', port: 1030, latency: 120 } })
		assert.equal('mode' in req.body.srt, false)

		mock.requests.length = 0
		await runAction(instance, 'setSrtDestination', {
			channelIdpublisherId: '1-1',
			mode: 'unchanged',
			url: '',
			stream_id: '',
			port: '',
			latency: '',
		})
		assert.equal(recorded(mock, 'PATCH').length, 0)
		assert.ok(instance.calls.log.some((l) => l.level === 'warn' && /nothing to change/.test(l.message)))

		// an unknown / missing mode option (old button config) behaves like "unchanged"
		mock.requests.length = 0
		await runAction(instance, 'setSrtDestination', { channelIdpublisherId: '1-1', latency: '300' })
		assert.deepEqual(one(mock, 'PATCH', `${V2}/channels/1/publishers/1/settings`).body, { srt: { latency: 300 } })
		mock.reset()
	})

	it('patchPublisherSettings sends the JSON verbatim, rejects invalid JSON', async () => {
		await runAction(instance, 'patchPublisherSettings', {
			channelIdpublisherId: '1-0',
			json: '{"common":{"enabled":true},"rtmp":{"url":"rtmp://x"}}',
		})
		const req = one(mock, 'PATCH', `${V2}/channels/1/publishers/0/settings`)
		assert.deepEqual(req.body, { common: { enabled: true }, rtmp: { url: 'rtmp://x' } })

		mock.requests.length = 0
		await runAction(instance, 'patchPublisherSettings', { channelIdpublisherId: '1-0', json: '{oops' })
		assert.equal(recorded(mock, 'PATCH').length, 0)
		assert.ok(errors(instance).some((m) => /not valid JSON/.test(m)))
		mock.reset()
	})

	it('addPublisher POSTs name and settings, requires a type', async () => {
		await runAction(instance, 'addPublisher', {
			channel: '1',
			name: 'New RTMP',
			json: '{"type":"rtmp","rtmp":{"url":"rtmp://a","stream":"b"},"common":{"enabled":true}}',
		})
		const req = one(mock, 'POST', `${V2}/channels/1/publishers`)
		assert.equal(req.body.name, 'New RTMP')
		assert.equal(req.body.settings.type, 'rtmp')
		assert.equal(req.body.settings.rtmp.url, 'rtmp://a')
		assert.equal(mock.state.channels['1'].publishers['2'].name, 'New RTMP')
		assert.ok(instance.calls.log.some((l) => l.level === 'info' && /Publisher added/.test(l.message)))

		// PublisherSettings requires common.enabled: a missing "common" block is defaulted
		mock.requests.length = 0
		await runAction(instance, 'addPublisher', {
			channel: '1',
			name: 'SRT out',
			json: '{"type":"srt","srt":{"mode":"listener","port":1040}}',
		})
		const req2 = one(mock, 'POST', `${V2}/channels/1/publishers`)
		assert.deepEqual(req2.body.settings.common, { enabled: false, single_touch: false })
		assert.deepEqual(req2.body.settings.srt, { mode: 'listener', port: 1040 })

		mock.requests.length = 0
		await runAction(instance, 'addPublisher', { channel: '1', name: '', json: '{"rtmp":{"url":"rtmp://a"}}' })
		assert.equal(recorded(mock, 'POST').length, 0)
		assert.ok(errors(instance).some((m) => /"type"/.test(m)))

		await runAction(instance, 'addPublisher', { channel: '42', name: '', json: '{"type":"rtmp"}' })
		assert.equal(recorded(mock, 'POST').length, 0)
		assert.ok(errors(instance).some((m) => /add publisher: unknown channel 42/.test(m)))
		mock.reset()
		await instance.pollAll()
	})

	it('setOutputSource PUTs the source as query and updates the optimistic state', async () => {
		await runAction(instance, 'setOutputSource', { output: 'D1', source: '2', customSource: '' })
		let req = one(mock, 'PUT', `${V2}/outputs/D1/settings`)
		assert.deepEqual(req.query, { source: '2' })
		assert.equal(req.body, null)
		assert.equal(mock.state.outputs.D1.source, '2')
		assert.equal(instance.state.outputs.D1.source, '2')
		assert.equal(instance.variableValues.output_D1_source, '2')

		mock.requests.length = 0
		await runAction(instance, 'setOutputSource', { output: 'D1', source: 'custom', customSource: ' console ' })
		req = one(mock, 'PUT', `${V2}/outputs/D1/settings`)
		assert.deepEqual(req.query, { source: 'console' })

		// the optimistic value survives a poll (the API cannot read it back)
		await instance.pollAll()
		assert.equal(instance.state.outputs.D1.source, 'console')
		assert.equal(instance.variableValues.output_D1_source, 'console')

		mock.requests.length = 0
		await runAction(instance, 'setOutputSource', { output: 'D1', source: 'custom', customSource: '' })
		assert.equal(recorded(mock, 'PUT').length, 0)
		assert.ok(errors(instance).some((m) => /no source given/.test(m)))
	})

	it('inputAudioMute PATCHes local_audio.mute', async () => {
		await runAction(instance, 'inputAudioMute', { input: 'analog-a', mute: 'true' })
		let req = one(mock, 'PATCH', `${V2}/inputs/analog-a/settings`)
		assert.deepEqual(req.body, { local_audio: { mute: true } })
		assert.equal(mock.state.inputs['analog-a'].settings.local_audio.mute, true)
		assert.equal(mock.state.inputs['analog-a'].settings.local_audio.gain, 27)

		mock.requests.length = 0
		await runAction(instance, 'inputAudioMute', { input: 'analog-a', mute: 'false' })
		req = one(mock, 'PATCH', `${V2}/inputs/analog-a/settings`)
		assert.deepEqual(req.body, { local_audio: { mute: false } })
	})

	it('inputAudioMute on an input without settings logs the 405 from the device', async () => {
		await runAction(instance, 'inputAudioMute', { input: 'hdmi-a', mute: 'true' })
		one(mock, 'PATCH', `${V2}/inputs/hdmi-a/settings`)
		assert.ok(errors(instance).some((m) => /405/.test(m)))
	})

	it('inputAudioMute / inputAudioDelay nest HDMI and SDI audio under hdmi.audio / sdi.audio', async () => {
		// HdmiInputSettings / SdiInputSettings in doc/pearl-api-v2.0.yaml
		await runAction(instance, 'inputAudioMute', { input: 'hdmi-a', mute: 'true' })
		let req = one(mock, 'PATCH', `${V2}/inputs/hdmi-a/settings`)
		assert.deepEqual(req.body, { hdmi: { audio: { mute: true } } })

		mock.requests.length = 0
		await runAction(instance, 'inputAudioDelay', { input: 'hdmi-a', delay: 20 })
		req = one(mock, 'PATCH', `${V2}/inputs/hdmi-a/settings`)
		assert.deepEqual(req.body, { hdmi: { audio: { delay: 20 } } })

		mock.requests.length = 0
		await runAction(instance, 'inputAudioMute', { input: 'D2P0.SDI-B', mute: 'false' })
		req = one(mock, 'PATCH', `${V2}/inputs/D2P0.SDI-B/settings`)
		assert.deepEqual(req.body, { sdi: { audio: { mute: false } } })

		mock.requests.length = 0
		await runAction(instance, 'inputAudioDelay', { input: 'D2P0.SDI-B', delay: -20 })
		req = one(mock, 'PATCH', `${V2}/inputs/D2P0.SDI-B/settings`)
		assert.deepEqual(req.body, { sdi: { audio: { delay: -20 } } })

		// analog inputs keep the flat shape
		mock.requests.length = 0
		await runAction(instance, 'inputAudioMute', { input: 'analog-a', mute: 'true' })
		assert.deepEqual(one(mock, 'PATCH', `${V2}/inputs/analog-a/settings`).body, { local_audio: { mute: true } })
		mock.requests.length = 0
		await runAction(instance, 'inputAudioDelay', { input: 'analog-a', delay: 5 })
		assert.deepEqual(one(mock, 'PATCH', `${V2}/inputs/analog-a/settings`).body, { audio: { delay: 5 } })
		mock.reset()
	})

	it('inputAudioGain for both channels and for a single channel', async () => {
		await runAction(instance, 'inputAudioGain', { input: 'analog-a', gain: 40, channel: 'both' })
		let req = one(mock, 'PATCH', `${V2}/inputs/analog-a/settings`)
		assert.deepEqual(req.body, { local_audio: { gain: 40 } })

		mock.requests.length = 0
		await runAction(instance, 'inputAudioGain', { input: 'analog-a', gain: 12, channel: 'B' })
		req = one(mock, 'PATCH', `${V2}/inputs/analog-a/settings`)
		assert.deepEqual(req.body, { local_audio: { stereo_pair: false, channels: { channelB: { gain: 12 } } } })
		assert.equal(mock.state.inputs['analog-a'].settings.local_audio.channels.channelB.gain, 12)
		assert.equal(mock.state.inputs['analog-a'].settings.local_audio.channels.channelA.gain, 27)
		mock.reset()
	})

	it('inputAudioDelay and inputPhantomPower', async () => {
		await runAction(instance, 'inputAudioDelay', { input: 'USBA', delay: -50 })
		let req = one(mock, 'PATCH', `${V2}/inputs/USBA/settings`)
		assert.deepEqual(req.body, { audio: { delay: -50 } })

		mock.requests.length = 0
		await runAction(instance, 'inputAudioDelay', { input: 'USBA', delay: 900 })
		req = one(mock, 'PATCH', `${V2}/inputs/USBA/settings`)
		assert.deepEqual(req.body, { audio: { delay: 300 } })

		mock.requests.length = 0
		await runAction(instance, 'inputPhantomPower', { input: 'analog-a', phantom_power: 'true' })
		req = one(mock, 'PATCH', `${V2}/inputs/analog-a/settings`)
		assert.deepEqual(req.body, { local_audio: { phantom_power: true } })
		assert.equal(mock.state.inputs['analog-a'].settings.local_audio.phantom_power, true)
		mock.reset()
	})

	it('patchInputSettings sends JSON, rejects invalid JSON', async () => {
		await runAction(instance, 'patchInputSettings', {
			input: 'SRT1',
			json: '{"srt":{"mode":"listener","port":1025}}',
		})
		const req = one(mock, 'PATCH', `${V2}/inputs/SRT1/settings`)
		assert.deepEqual(req.body, { srt: { mode: 'listener', port: 1025 } })
		assert.equal(mock.state.inputs.SRT1.settings.srt.port, 1025)
		assert.equal(mock.state.inputs.SRT1.settings.srt.latency, 80)

		mock.requests.length = 0
		await runAction(instance, 'patchInputSettings', { input: 'SRT1', json: '[1]' })
		assert.equal(recorded(mock, 'PATCH').length, 0)
		assert.ok(errors(instance).some((m) => /not valid JSON/.test(m)))
		mock.reset()
	})

	it('createNetworkInput POSTs type, name and settings', async () => {
		await runAction(instance, 'createNetworkInput', {
			type: 'rtsp',
			name: 'Cam 3',
			json: '{"rtsp":{"url":"rtsp://10.0.0.1:8554/stream","transport":"udp"}}',
		})
		let req = one(mock, 'POST', `${V2}/inputs`)
		assert.deepEqual(req.body, {
			type: 'rtsp',
			name: 'Cam 3',
			settings: { rtsp: { url: 'rtsp://10.0.0.1:8554/stream', transport: 'udp' } },
		})
		assert.equal(mock.state.inputs.RTSP1.name, 'Cam 3')

		mock.requests.length = 0
		await runAction(instance, 'createNetworkInput', { type: 'ndi', name: '', json: '{}' })
		req = one(mock, 'POST', `${V2}/inputs`)
		assert.deepEqual(req.body, { type: 'ndi' })

		mock.requests.length = 0
		await runAction(instance, 'createNetworkInput', { type: 'hdmi', name: '', json: '{}' })
		assert.equal(recorded(mock, 'POST').length, 0)
		assert.ok(errors(instance).some((m) => /unknown type/.test(m)))
		mock.reset()
		await instance.pollAll()
	})

	it('singleTouchToggle', async () => {
		await runAction(instance, 'singleTouchToggle', { stc: '0' })
		one(mock, 'POST', `${V2}/system/singletouchcontrol/0/control/toggle`)
		assert.equal(mock.state.singleTouch['0'].pressed, true)
		mock.reset()
	})

	it('applyConfigPreset URL-encodes the name and omits the body for "all sections"', async () => {
		await runAction(instance, 'applyConfigPreset', { preset: 'Show A', sections: [] })
		let req = one(mock, 'POST', `${V2}/system/presets/Show%20A/control/apply`)
		assert.equal(req.body, null)
		assert.equal(req.rawBody, undefined)
		assert.deepEqual(mock.state.appliedPresets[0].name, 'Show A')
		assert.equal(mock.state.appliedPresets[0].sections.length, 10)
		assert.ok(instance.calls.log.some((l) => l.level === 'info' && /rebooting/.test(l.message)))

		mock.requests.length = 0
		await runAction(instance, 'applyConfigPreset', { preset: 'Show A', sections: ['channels', 'sources'] })
		req = one(mock, 'POST', `${V2}/system/presets/Show%20A/control/apply`)
		assert.deepEqual(req.body, { sections: ['channels', 'sources'] })

		mock.requests.length = 0
		await runAction(instance, 'applyConfigPreset', { preset: 'Nope', sections: [] })
		one(mock, 'POST', `${V2}/system/presets/Nope/control/apply`)
		assert.ok(errors(instance).some((m) => /404/.test(m)))
		mock.reset()
	})

	it('storageEject', async () => {
		await runAction(instance, 'storageEject', { storage: 'external' })
		one(mock, 'POST', `${V2}/system/storages/external/control/eject`)
		assert.deepEqual(mock.state.control.ejected, ['external'])

		mock.requests.length = 0
		await runAction(instance, 'storageEject', { storage: 'main' })
		one(mock, 'POST', `${V2}/system/storages/main/control/eject`)
		assert.ok(errors(instance).some((m) => /405/.test(m) && /does not support eject/.test(m)))
		mock.reset()
	})

	it('eventControl with aliases and a custom id, eventExtend with finish seconds', async () => {
		const eventId = mock.state.events[0].id
		await runAction(instance, 'eventControl', { event: 'upcoming', eventId: '', action: 'start' })
		one(mock, 'POST', `${V2}/schedule/events/upcoming/control/start`)
		assert.equal(mock.state.events[0].status, 'running')

		mock.requests.length = 0
		await runAction(instance, 'eventControl', { event: 'custom', eventId, action: 'pause' })
		one(mock, 'POST', `${V2}/schedule/events/${eventId}/control/pause`)
		assert.equal(mock.state.events[0].status, 'paused')

		mock.requests.length = 0
		await runAction(instance, 'eventControl', { event: 'paused', eventId: '', action: 'resume' })
		one(mock, 'POST', `${V2}/schedule/events/paused/control/resume`)
		assert.equal(mock.state.events[0].status, 'running')

		mock.requests.length = 0
		const finishBefore = mock.state.events[0].finish
		await runAction(instance, 'eventExtend', { event: 'ongoing', eventId: '', seconds: 600 })
		const req = one(mock, 'POST', `${V2}/schedule/events/ongoing/control/extend`)
		assert.deepEqual(req.body, { finish: 600 })
		assert.equal(mock.state.events[0].finish, finishBefore + 600)

		mock.requests.length = 0
		await runAction(instance, 'eventControl', { event: 'ongoing', eventId: '', action: 'stop' })
		one(mock, 'POST', `${V2}/schedule/events/ongoing/control/stop`)
		assert.equal(mock.state.events[0].status, 'finished')

		mock.requests.length = 0
		await runAction(instance, 'eventControl', { event: 'custom', eventId: '  ', action: 'start' })
		assert.equal(recorded(mock, 'POST').length, 0)
		assert.ok(errors(instance).some((m) => /no event selected/.test(m)))

		await runAction(instance, 'eventControl', { event: 'upcoming', eventId: '', action: 'explode' })
		assert.equal(recorded(mock, 'POST').length, 0)
		mock.reset()
	})

	it('eventControl on a missing alias logs the 404 and keeps the instance status', async () => {
		await runAction(instance, 'eventControl', { event: 'ongoing', eventId: '', action: 'stop' })
		one(mock, 'POST', `${V2}/schedule/events/ongoing/control/stop`)
		assert.ok(errors(instance).some((m) => /404/.test(m)))
		assert.equal(instance.currentStatus, 'ok')
	})

	it('createAdhocEvent POSTs the JSON, rejects invalid JSON', async () => {
		await runAction(instance, 'createAdhocEvent', { json: '{"title":"Ad-hoc","duration":600}' })
		const req = one(mock, 'POST', `${V2}/schedule/events`)
		assert.deepEqual(req.body, { title: 'Ad-hoc', duration: 600 })
		assert.equal(mock.state.events.length, 2)
		assert.ok(
			instance.calls.log.some((l) => l.level === 'info' && /Ad-hoc event created: adhoc0001/.test(l.message)),
		)

		mock.requests.length = 0
		await runAction(instance, 'createAdhocEvent', { json: 'nope' })
		assert.equal(recorded(mock, 'POST').length, 0)
		assert.ok(errors(instance).some((m) => /not valid JSON/.test(m)))
		mock.reset()
	})

	it('adhocSessionLogout', async () => {
		mock.state.adhocSession = { id: 'x' }
		await runAction(instance, 'adhocSessionLogout', {})
		one(mock, 'DELETE', `${V2}/schedule/events/adhoc/session`)
		assert.equal(mock.state.adhocSession, null)
	})

	it('refreshConnectivity sets the connectivity variables', async () => {
		assert.equal(instance.variableValues.connectivity_external_ip, '')
		await runAction(instance, 'refreshConnectivity', {})
		one(mock, 'GET', `${V2}/system/connectivity/details`)
		assert.equal(instance.state.connectivity.external_ip, '174.115.41.91')
		assert.equal(instance.variableValues.connectivity_external_ip, '174.115.41.91')
		assert.equal(instance.variableValues.connectivity_icmp, 'error')
		assert.equal(instance.variableValues.connectivity_vtun, 'disabled')
		// survives the next poll
		await instance.pollAll()
		assert.equal(instance.variableValues.connectivity_external_ip, '174.115.41.91')
	})

	it('runSpeedTest passes mode/protocol/timeout and sets the speedtest variables', async () => {
		await runAction(instance, 'runSpeedTest', { mode: 'downlink', protocol: 'udp', timeout: 5 })
		const req = one(mock, 'GET', `${V2}/system/connectivity/tools/speedtest`)
		assert.deepEqual(req.query, { mode: 'downlink', protocol: 'udp', timeout: '5' })
		assert.equal(instance.variableValues.speedtest_bandwidth_mbps, 91.3)
		assert.equal(instance.variableValues.speedtest_mode, 'downlink')
		assert.equal(instance.variableValues.speedtest_protocol, 'udp')
		assert.equal(instance.variableValues.speedtest_duration, 5)
		assert.equal(instance.variableValues.speedtest_udp_loss, 0)
		assert.ok(instance.calls.log.some((l) => l.level === 'info' && /91\.3 Mbps/.test(l.message)))

		mock.requests.length = 0
		await runAction(instance, 'runSpeedTest', { mode: 'uplink', protocol: 'tcp', timeout: 10 })
		assert.equal(instance.variableValues.speedtest_udp_loss, '')
		await instance.pollAll()
		assert.equal(instance.variableValues.speedtest_bandwidth_mbps, 91.3)
	})

	it('refreshPoll polls immediately', async () => {
		await runAction(instance, 'refreshPoll', {})
		one(mock, 'GET', `${V2}/channels`)
		one(mock, 'GET', `${V2}/recorders/status`)
	})

	it('no action callback ever throws, even with garbage options', async () => {
		for (const [id, def] of Object.entries(instance.definitions.actions)) {
			await assert.doesNotReject(
				() => def.callback({ actionId: id, options: {}, id: 'a', controlId: 'c' }, {}),
				`action ${id} threw with empty options`,
			)
			await assert.doesNotReject(
				() =>
					def.callback({ actionId: id, options: { channelIdlayoutId: 42, channelIdpublisherId: null } }, {}),
				`action ${id} threw with garbage options`,
			)
		}
		mock.reset()
	})
})

describe('actions against a legacy-only device', () => {
	let mock
	let instance

	before(async () => {
		mock = await startMockPearl({ firmware: '4.20.0', legacyOnly: true })
		instance = await createInstance({ mock })
		mock.requests.length = 0
	})

	after(async () => {
		await instance.destroy()
		await mock.close()
	})

	it('existing actions use the /api base', async () => {
		await runAction(instance, 'channelChangeLayout', { channelIdlayoutId: '1-2' })
		const req = mock.requests.find((r) => r.method === 'PUT')
		assert.equal(req.path, '/api/channels/1/layouts/active')
		assert.deepEqual(req.body, { id: 2 })

		mock.requests.length = 0
		await runAction(instance, 'controlStreaming', { channelIdpublisherId: '1-0', startStopAction: 1 })
		assert.equal(mock.requests[0].path, '/api/channels/1/publishers/0/control/start')

		mock.requests.length = 0
		await runAction(instance, 'insertMarker', { channel: '1', markertext: 'm' })
		assert.equal(mock.requests[0].path, '/api/channels/1/bookmarks')
		assert.deepEqual(mock.requests[0].body, { text: 'm' })
	})

	it('v2-only actions log a warning and send nothing', async () => {
		const v2Only = [
			['recorderControlAll', { action: 'start' }],
			['setChannelName', { channel: '1', name: 'x' }],
			['setPublisherName', { channelIdpublisherId: '1-0', name: 'x' }],
			['setPublisherEnabled', { channelIdpublisherId: '1-0', enabled: 'true' }],
			['setPublisherSingleTouch', { channelIdpublisherId: '1-0', single_touch: 'true' }],
			['setRtmpDestination', { channelIdpublisherId: '1-0', url: 'rtmp://x' }],
			['setSrtDestination', { channelIdpublisherId: '1-1', mode: 'caller', url: 'srt://x' }],
			['patchPublisherSettings', { channelIdpublisherId: '1-0', json: '{}' }],
			['addPublisher', { channel: '1', name: '', json: '{"type":"rtmp"}' }],
			['setOutputSource', { output: 'D1', source: '1' }],
			['inputAudioMute', { input: 'analog-a', mute: 'true' }],
			['inputAudioGain', { input: 'analog-a', gain: 1, channel: 'both' }],
			['inputAudioDelay', { input: 'analog-a', delay: 0 }],
			['inputPhantomPower', { input: 'analog-a', phantom_power: 'true' }],
			['patchInputSettings', { input: 'analog-a', json: '{}' }],
			['createNetworkInput', { type: 'rtsp', name: '', json: '{}' }],
			['singleTouchToggle', { stc: '0' }],
			['applyConfigPreset', { preset: 'Default', sections: [] }],
			['storageEject', { storage: 'external' }],
			['eventControl', { event: 'upcoming', eventId: '', action: 'start' }],
			['eventExtend', { event: 'ongoing', eventId: '', seconds: 60 }],
			['createAdhocEvent', { json: '{}' }],
			['adhocSessionLogout', {}],
			['refreshConnectivity', {}],
			['runSpeedTest', { mode: 'uplink', protocol: 'tcp', timeout: 1 }],
		]
		for (const [id, options] of v2Only) {
			mock.requests.length = 0
			instance.calls.log.length = 0
			await runAction(instance, id, options)
			assert.equal(mock.requests.length, 0, `${id} sent a request on a legacy device`)
			assert.ok(
				instance.calls.log.some((l) => l.level === 'warn' && /API v2\.0/.test(l.message)),
				`${id} did not warn`,
			)
		}
	})

	it('refreshPoll works on legacy devices', async () => {
		mock.requests.length = 0
		await runAction(instance, 'refreshPoll', {})
		assert.ok(mock.requests.some((r) => r.path === '/api/channels'))
	})
})
