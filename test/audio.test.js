const { describe, it, before, after } = require('node:test')
const assert = require('node:assert/strict')

const { createInstance } = require('./harness')
const { startMockPearl } = require('./mock-pearl')
const audio = require('../src/audio')

describe('audio helper (pure)', () => {
	const paired = {
		audio: { delay: 0 },
		local_audio: { gain: 27, stereo_pair: true, channels: { channelA: { gain: 27 }, channelB: { gain: 27 } } },
	}
	const unpaired = {
		audio: { delay: 10 },
		local_audio: { stereo_pair: false, channels: { channelA: { gain: 20 }, channelB: { gain: 24 } } },
	}
	const usb = { audio: { delay: -5 }, local_audio: { gain: 50, mute: false } }
	const hdmi = { hdmi: { audio: { delay: 0, mute: false } } }
	const sdi = { sdi: { audio: { delay: 15, mute: false } } }
	const network = { audio: { delay: 0 }, srt: { port: 1024 } }

	it('readGain uses local_audio.gain for a stereo pair and channel A when unpaired', () => {
		assert.equal(audio.readGain(paired), 27)
		assert.equal(audio.readGain(usb), 50)
		assert.equal(audio.readGain(unpaired), 20)
		assert.equal(audio.readGain({ local_audio: { stereo_pair: false, channels: { channelB: { gain: 9 } } } }), 9)
		assert.equal(audio.readGain(network), undefined)
		assert.equal(audio.readGain(hdmi), undefined)
		assert.equal(audio.readGain(undefined), undefined)
		assert.equal(audio.readGain({ local_audio: { gain: '27' } }), undefined, 'only numbers count')
	})

	it('gainPatch writes the pair gain or both channels, clamped to 0..100', () => {
		assert.deepEqual(audio.gainPatch(paired, 40), { local_audio: { gain: 40 } })
		assert.deepEqual(audio.gainPatch(unpaired, 40), {
			local_audio: { channels: { channelA: { gain: 40 }, channelB: { gain: 40 } } },
		})
		assert.deepEqual(audio.gainPatch(usb, 150), { local_audio: { gain: 100 } })
		assert.deepEqual(audio.gainPatch(usb, -3), { local_audio: { gain: 0 } })
		assert.deepEqual(audio.gainPatch(usb, '12'), { local_audio: { gain: 12 } })
		assert.deepEqual(audio.gainPatch(usb, 12.6), { local_audio: { gain: 13 } })
		assert.equal(audio.gainPatch(network, 40), undefined)
		assert.equal(audio.gainPatch(hdmi, 40), undefined)
		assert.equal(audio.gainPatch(usb, 'abc'), undefined)
	})

	it('readDelay finds audio.delay, hdmi.audio.delay or sdi.audio.delay', () => {
		assert.deepEqual(audio.readDelay(paired), { path: 'audio', value: 0 })
		assert.deepEqual(audio.readDelay(hdmi), { path: 'hdmi', value: 0 })
		assert.deepEqual(audio.readDelay(sdi), { path: 'sdi', value: 15 })
		assert.deepEqual(audio.readDelay(usb), { path: 'audio', value: -5 })
		assert.equal(audio.readDelay({ local_audio: { gain: 1 } }), undefined)
		assert.equal(audio.readDelay(null), undefined)
	})

	it('delayPatch writes to the path the settings contain, clamped to -300..300', () => {
		assert.deepEqual(audio.delayPatch(paired, 20), { audio: { delay: 20 } })
		assert.deepEqual(audio.delayPatch(hdmi, 20), { hdmi: { audio: { delay: 20 } } })
		assert.deepEqual(audio.delayPatch(sdi, -20), { sdi: { audio: { delay: -20 } } })
		assert.deepEqual(audio.delayPatch(usb, 900), { audio: { delay: 300 } })
		assert.deepEqual(audio.delayPatch(usb, -900), { audio: { delay: -300 } })
		assert.equal(audio.delayPatch({ local_audio: { gain: 1 } }, 20), undefined)
		assert.equal(audio.delayPatch(hdmi, undefined), undefined)
	})

	it('levelSummary reports the peak, both channels and the text', () => {
		assert.deepEqual(audio.levelSummary({ levels: { rms: [-30, -32], peak: [-24, -26] } }), {
			peak: -24,
			left: -24,
			right: -26,
			text: '-24 dBFS',
		})
		assert.deepEqual(audio.levelSummary({ levels: { rms: [-30.4, -32] } }), {
			peak: -30,
			left: -30.4,
			right: -32,
			text: '-30 dBFS',
		})
		assert.deepEqual(audio.levelSummary({ levels: { rms: [-120, -120], peak: [-99, -110] } }), {
			peak: -99,
			left: -99,
			right: -110,
			text: 'silent',
		})
		const none = { peak: undefined, left: undefined, right: undefined }
		assert.deepEqual(audio.levelSummary({ audioState: 'inactive' }), { ...none, text: 'No signal' })
		assert.deepEqual(audio.levelSummary({ audioState: 'active' }), { ...none, text: '' })
		assert.deepEqual(audio.levelSummary({ levels: { rms: [] } }), { ...none, text: '' })
		assert.deepEqual(audio.levelSummary(undefined), { ...none, text: '' })
		assert.equal(audio.levelSummary({ levels: { rms: [-3], peak: [1] } }).text, '1 dBFS')
	})
})

// The levels are read by the 500 ms meter poll (src/meter.js), never by the interval poll; every test
// below therefore drives one tick itself with pollMeterLevels(). The poll's own timing, ref counting
// and rendering live in test/meter.test.js.
describe('audio levels from the legacy /sources/status list', () => {
	let mock
	let instance

	before(async () => {
		mock = await startMockPearl()
		instance = await createInstance({ mock })
		await instance.pollMeterLevels()
	})

	after(async () => {
		await instance.destroy()
		await mock.close()
	})

	it('is fetched from the legacy base, once per level tick', async () => {
		assert.ok(mock.requests.some((r) => r.method === 'GET' && r.path === '/api/sources/status'))
		assert.ok(!mock.requests.some((r) => r.path === '/api/v2.0/sources/status'))
		mock.requests.length = 0
		await instance.pollMeterLevels()
		assert.equal(mock.requests.filter((r) => r.path === '/api/sources/status').length, 1)
		assert.equal(mock.requests.length, 1, 'a level tick asks for nothing else')
	})

	it('attaches levels to the inputs although the legacy ids carry the D2P<serial>. prefix', async () => {
		const res = await fetch(`${mock.url}/api/sources/status`, {
			headers: { Authorization: 'Basic ' + Buffer.from('admin:x').toString('base64') },
		})
		const body = await res.json()
		assert.ok(body.result.length >= 7)
		assert.ok(
			body.result.every((e) => /^D2P492324\./.test(e.id)),
			'the mock reproduces the prefixed ids of a real Pearl',
		)

		const analog = instance.state.inputs['analog-a']
		assert.equal(analog.audioState, 'active')
		assert.equal(analog.levels.rms.length, 2)
		assert.equal(analog.levels.peak.length, 2)
		for (const v of [...analog.levels.rms, ...analog.levels.peak]) assert.equal(typeof v, 'number')
		assert.ok(analog.levels.peak[0] >= analog.levels.rms[0])

		// sdi-a reports inactive audio and no levels; hdmi-a has no audio at all
		assert.equal(instance.state.inputs['sdi-a'].audioState, 'inactive')
		assert.equal(instance.state.inputs['sdi-a'].levels, undefined)
		assert.equal(instance.state.inputs['hdmi-a'].levels, undefined)
		assert.equal(instance.state.inputs['hdmi-a'].audioState, undefined)
	})

	it('exposes the level variables for audio inputs only', () => {
		const v = instance.variableValues
		assert.equal(typeof v['input_analog-a_peak_dbfs'], 'number')
		assert.equal(typeof v['input_analog-a_peak_left'], 'number')
		assert.equal(typeof v['input_analog-a_peak_right'], 'number')
		assert.match(String(v['input_analog-a_level_text']), /^-\d+ dBFS$/)
		assert.equal(
			v['input_analog-a_peak_dbfs'],
			Math.max(v['input_analog-a_peak_left'], v['input_analog-a_peak_right']),
		)
		assert.equal(v['input_sdi-a_level_text'], 'No signal')
		assert.equal(v['input_sdi-a_peak_dbfs'], '')
		assert.equal(v['input_sdi-a_peak_left'], '')
		assert.equal(v['input_hdmi-a_peak_dbfs'], undefined, 'no level variables for a video-only input')
		assert.equal(v['input_hdmi-a_level_text'], undefined)
		const ids = instance.definitions.variables.map((d) => d.variableId)
		assert.ok(ids.includes('input_USBA_peak_dbfs'))
		assert.ok(ids.includes('input_USBA_peak_right'))
		assert.ok(!ids.includes('input_hdmi-a_peak_dbfs'))
	})

	it('two level ticks see different levels', async () => {
		const first = instance.variableValues['input_analog-a_peak_dbfs']
		await instance.pollMeterLevels()
		const second = instance.variableValues['input_analog-a_peak_dbfs']
		assert.equal(typeof second, 'number')
		assert.notEqual(first, second)
	})

	it('moving levels alone check only the meter feedback and update no definitions', async () => {
		instance.checkedFeedbacks.length = 0
		const before = instance.definitions.variables.length
		let definitionUpdates = 0
		const original = instance.setVariableDefinitions
		instance.setVariableDefinitions = function (...args) {
			definitionUpdates++
			return original.apply(this, args)
		}
		try {
			await instance.pollMeterLevels()
		} finally {
			delete instance.setVariableDefinitions
		}
		assert.deepEqual(instance.checkedFeedbacks, [['audio']])
		assert.equal(definitionUpdates, 0)
		assert.equal(instance.definitions.variables.length, before)
	})

	it('an interval poll neither fetches nor drops the levels', async () => {
		await instance.pollMeterLevels()
		const before = instance.variableValues['input_analog-a_peak_dbfs']
		mock.requests.length = 0
		await instance.pollAll()
		assert.equal(mock.requests.filter((r) => r.path === '/api/sources/status').length, 0)
		assert.ok(instance.state.inputs['analog-a'].levels, 'carried over into the new state')
		assert.equal(instance.variableValues['input_analog-a_peak_dbfs'], before)
	})

	it('matches an input whose /inputs id already carries the device prefix', async () => {
		mock.state.inputs['D2P496187.hdmi-c'] = {
			id: 'D2P496187.hdmi-c',
			name: 'HDMI-C',
			real_device_name: 'HDMI-C',
			audio: true,
			video: true,
			type: 'embedded',
			settings: { hdmi: { audio: { delay: 0, mute: false } } },
		}
		try {
			await instance.pollAll()
			await instance.pollMeterLevels()
			const input = instance.state.inputs['D2P496187.hdmi-c']
			assert.ok(input, 'input listed')
			assert.equal(input.audioState, 'active')
			assert.ok(input.levels, 'levels attached through the normalised id')
			assert.equal(typeof instance.variableValues['input_D2P496187_hdmi-c_peak_dbfs'], 'number')
		} finally {
			delete mock.state.inputs['D2P496187.hdmi-c']
			await instance.pollAll()
		}
	})

	it('a device without the legacy endpoint keeps polling without levels and without errors', async () => {
		const original = mock.server.listeners('request')[0]
		mock.server.removeAllListeners('request')
		mock.server.on('request', (req, res) => {
			if (req.url.startsWith('/api/sources/status')) {
				res.writeHead(404, { 'Content-Type': 'application/json' })
				res.end(JSON.stringify({ status: 'notfound', message: 'Not found' }))
				return
			}
			original(req, res)
		})
		instance.calls.log.length = 0
		try {
			await instance.pollAll()
			await instance.pollMeterLevels()
			assert.equal(instance.state.inputs['analog-a'].levels, undefined)
			assert.equal(instance.state.inputs['analog-a'].audioState, undefined)
			assert.equal(instance.variableValues['input_analog-a_level_text'], '')
			assert.equal(instance.variableValues['input_analog-a_peak_dbfs'], '')
			assert.deepEqual(
				instance.calls.log.filter((l) => l.level === 'error'),
				[],
			)
			assert.equal(Object.keys(instance.state.channels).length, 2, 'the rest of the poll is unaffected')
		} finally {
			mock.server.removeAllListeners('request')
			mock.server.on('request', original)
		}
	})

	it('is not requested while no meter is placed (legacy-only device, no subscriptions)', async () => {
		const legacy = await startMockPearl({ firmware: '4.20.0', legacyOnly: true })
		const other = await createInstance({ mock: legacy })
		try {
			assert.equal(other.isV2, false)
			assert.ok(!legacy.requests.some((r) => r.path === '/api/sources/status'))
		} finally {
			await other.destroy()
			await legacy.close()
		}
	})
})
