/**
 * The audio level meter: the pure drawing helpers of src/meter.js and the ref-counted 500 ms level
 * poll the `audio` feedback drives.
 */
const { describe, it, before, after, beforeEach } = require('node:test')
const assert = require('node:assert/strict')

const { createInstance, runAction, runFeedback, subscribeFeedback, unsubscribeFeedback } = require('./harness')
const { startMockPearl } = require('./mock-pearl')
const meter = require('../src/meter')

const HEX = {
	track: [0x2a, 0x2e, 0x35],
	green: [0x3c, 0xcf, 0x6a],
	amber: [0xf0, 0xa8, 0x3c],
	red: [0xe5, 0x48, 0x4d],
	text: [0xf4, 0xf6, 0xf8],
}

/** RGBA of one pixel of a rendered meter */
function pixel(buffer, width, x, y) {
	const at = (y * width + x) * 4
	return [buffer[at], buffer[at + 1], buffer[at + 2], buffer[at + 3]]
}

/** true when the pixel carries this opaque colour */
function isColour(buffer, width, x, y, colour) {
	const [r, g, b, a] = pixel(buffer, width, x, y)
	return a === 0xff && r === colour[0] && g === colour[1] && b === colour[2]
}

function sleep(ms) {
	return new Promise((resolve) => setTimeout(resolve, ms))
}

function levelRequests(mock) {
	return mock.requests.filter((r) => r.method === 'GET' && r.path === '/api/sources/status')
}

async function waitFor(check, timeout = 5000) {
	const deadline = Date.now() + timeout
	while (!check()) {
		if (Date.now() > deadline) assert.fail('condition not met in time')
		await sleep(20)
	}
}

describe('meter helpers (pure)', () => {
	it('dbfsToLinear maps -60..0 dBFS onto 0..1 and clamps outside it', () => {
		assert.equal(meter.dbfsToLinear(-60), 0)
		assert.equal(meter.dbfsToLinear(0), 1)
		assert.equal(meter.dbfsToLinear(-30), 0.5)
		assert.equal(meter.dbfsToLinear(-20), 40 / 60)
		assert.equal(meter.dbfsToLinear(-120), 0)
		assert.equal(meter.dbfsToLinear(6), 1)
		assert.equal(meter.dbfsToLinear(Number.POSITIVE_INFINITY), 1)
		assert.equal(meter.dbfsToLinear(Number.NEGATIVE_INFINITY), 0)
		assert.equal(meter.dbfsToLinear(undefined), 0)
		assert.equal(meter.dbfsToLinear('nope'), 0)
	})

	it('renderMeter returns width * height * 4 RGBA bytes', () => {
		assert.equal(meter.renderMeter(72, 72, { left: 0.5, right: 0.5 }).length, 72 * 72 * 4)
		assert.equal(meter.renderMeter(96, 48, { left: 0.5 }).length, 96 * 48 * 4)
		assert.ok(meter.renderMeter(72, 72, { left: 0.5 }) instanceof Uint8Array)
	})

	it('the layout puts two bars against the right edge, between height/8 and 7*height/8', () => {
		const layout = meter.meterLayout(72, 72)
		assert.deepEqual(
			{ barWidth: layout.barWidth, gap: layout.gap, margin: layout.margin },
			{ barWidth: 5, gap: 2, margin: 4 },
		)
		assert.deepEqual({ top: layout.top, bottom: layout.bottom }, { top: 9, bottom: 63 })
		assert.equal(layout.rightX, 72 - 4 - 5)
		assert.equal(layout.leftX, layout.rightX - 2 - 5)
	})

	it('everything outside the bars stays transparent', () => {
		const layout = meter.meterLayout(72, 72)
		const buffer = meter.renderMeter(72, 72, { left: 1, right: 1 })
		assert.deepEqual(pixel(buffer, 72, 0, 0), [0, 0, 0, 0], 'top left corner')
		assert.deepEqual(pixel(buffer, 72, 10, 36), [0, 0, 0, 0], 'where the text goes')
		assert.deepEqual(pixel(buffer, 72, layout.rightX, layout.top - 1), [0, 0, 0, 0], 'above the bars')
		assert.deepEqual(pixel(buffer, 72, layout.rightX, layout.bottom), [0, 0, 0, 0], 'below the bars')
		assert.deepEqual(pixel(buffer, 72, 71, layout.top + 1), [0, 0, 0, 0], 'right margin')
	})

	it('the bottom of the left bar is green at -20 dBFS and the amber band starts at 62 %', () => {
		const layout = meter.meterLayout(72, 72)
		const level = meter.dbfsToLinear(-20)
		const buffer = meter.renderMeter(72, 72, { left: level, right: level })
		const x = layout.leftX

		for (const y of [layout.bottom - 1, layout.bottom - 2, layout.bottom - 10]) {
			assert.ok(isColour(buffer, 72, x, y, HEX.green), `row ${y} of the left bar is green`)
		}
		// the whole width of the bar is painted, and the gap between the bars is not
		for (let dx = 0; dx < layout.barWidth; dx++) {
			assert.ok(isColour(buffer, 72, x + dx, layout.bottom - 1, HEX.green), `column ${dx} of the bar`)
		}
		assert.deepEqual(pixel(buffer, 72, layout.leftX + layout.barWidth, layout.bottom - 1), [0, 0, 0, 0])

		// -20 dBFS fills 2/3 of the bar, so its top rows fall into the amber band (> 62 % of the bar)
		const filled = Math.round(level * layout.barHeight)
		assert.ok(isColour(buffer, 72, x, layout.bottom - filled, HEX.amber), 'the top of the fill is amber')
		// and the rows above the fill are the track colour, not a colour of the gradient
		assert.ok(isColour(buffer, 72, x, layout.bottom - filled - 2, HEX.track), 'unfilled rows are the track')
	})

	it('the red band is drawn above 82 % of the bar', () => {
		const layout = meter.meterLayout(72, 72)
		const buffer = meter.renderMeter(72, 72, { left: 1, right: 1 })
		assert.ok(isColour(buffer, 72, layout.leftX, layout.top, HEX.red), 'the very top of a full bar is red')
		assert.ok(isColour(buffer, 72, layout.leftX, layout.bottom - 1, HEX.green), 'its bottom is still green')
	})

	it('at silence the whole track is visible, top row included, and nothing is filled', () => {
		const layout = meter.meterLayout(72, 72)
		const buffer = meter.renderMeter(72, 72, { left: meter.dbfsToLinear(-120), right: meter.dbfsToLinear(-120) })
		for (const y of [layout.top, layout.top + 1, layout.top + 5]) {
			assert.ok(isColour(buffer, 72, layout.leftX, y, HEX.track), `top row ${y} of the track`)
			assert.ok(isColour(buffer, 72, layout.rightX, y, HEX.track), `top row ${y} of the right track`)
		}
		for (let y = layout.top; y < layout.bottom; y++) {
			assert.ok(isColour(buffer, 72, layout.leftX, y, HEX.track), `row ${y} is track, nothing filled`)
		}
	})

	it('a 2 px light peak tick sits at the peak level', () => {
		const layout = meter.meterLayout(72, 72)
		const peak = 0.5
		const buffer = meter.renderMeter(72, 72, { left: 0.1, right: 0.1, peakLeft: peak, peakRight: peak })
		const expected = Math.round(layout.bottom - peak * layout.barHeight) - 1
		assert.ok(isColour(buffer, 72, layout.leftX, expected, HEX.text), 'first row of the tick')
		assert.ok(isColour(buffer, 72, layout.leftX, expected + 1, HEX.text), 'second row of the tick')
		assert.ok(!isColour(buffer, 72, layout.leftX, expected + 2, HEX.text), 'the tick is only 2 px tall')
		assert.ok(isColour(buffer, 72, layout.rightX, expected, HEX.text), 'the right bar has one too')
	})

	it('only one bar is drawn when the right channel is unknown', () => {
		const layout = meter.meterLayout(72, 72)
		const buffer = meter.renderMeter(72, 72, { left: 1 })
		assert.ok(isColour(buffer, 72, layout.rightX, layout.bottom - 1, HEX.green), 'the right position is used')
		for (let y = layout.top; y < layout.bottom; y++) {
			assert.deepEqual(pixel(buffer, 72, layout.leftX, y), [0, 0, 0, 0], `no left bar at row ${y}`)
		}
	})

	it('meterOf turns state levels into 0..1 values, or undefined without levels', () => {
		assert.deepEqual(meter.meterOf({ levels: { rms: [-30, -60], peak: [-24, -48] } }), {
			left: 0.5,
			peakLeft: 36 / 60,
			right: 0,
			peakRight: 12 / 60,
		})
		assert.deepEqual(meter.meterOf({ levels: { rms: [-30], peak: [] } }), { left: 0.5 })
		assert.equal(meter.meterOf({ levels: { rms: [], peak: [] } }), undefined)
		assert.equal(meter.meterOf({}), undefined)
		assert.equal(meter.meterOf(undefined), undefined)
	})
})

describe('audio level poll (500 ms, ref-counted by the audio feedback)', () => {
	let mock
	let instance

	before(async () => {
		mock = await startMockPearl()
		instance = await createInstance({ mock })
	})

	beforeEach(async () => {
		// leave every test a stopped poll, no subscriptions and no recorded requests
		for (const id of [...instance.meterSubscriptions.keys()]) {
			await unsubscribeFeedback(instance, 'audio', { inputId: id })
		}
		instance.stopMeterTimer()
		instance.meterSubscriptions.clear()
		instance.applyMeterSnapshot([])
		mock.requests.length = 0
		instance.calls.log.length = 0
		instance.checkedFeedbacks.length = 0
	})

	after(async () => {
		await instance.destroy()
		await mock.close()
	})

	it('the interval poll does not request /sources/status at all', async () => {
		await instance.pollAll()
		assert.equal(levelRequests(mock).length, 0)
		assert.ok(mock.requests.some((r) => r.path === '/api/v2.0/inputs'))
		assert.equal(instance.state.inputs['analog-a'].levels, undefined)
		assert.equal(instance.variableValues['input_analog-a_peak_dbfs'], '', 'no meter subscribed, no levels')
		assert.equal(instance.variableValues['input_analog-a_level_text'], '')
	})

	it('subscribing starts the poll: one request per tick, whatever the number of inputs', async () => {
		await subscribeFeedback(instance, 'audio', { inputId: 'analog-a' })
		await subscribeFeedback(instance, 'audio', { inputId: 'analog-b' })
		await subscribeFeedback(instance, 'audio', { inputId: 'USBA' })
		assert.equal(instance.meterSubscriptions.size, 3)
		assert.ok(instance.meterTimer, 'the level timer runs')
		assert.equal(levelRequests(mock).length, 0, 'nothing is requested before the first tick')

		await waitFor(() => levelRequests(mock).length >= 1)
		assert.equal(levelRequests(mock).length, 1, 'one request for all three inputs')
		assert.equal(mock.requests.length, 1, 'and nothing else')

		await waitFor(() => levelRequests(mock).length >= 3)
		assert.equal(levelRequests(mock).length, 3, 'exactly one per tick')
	})

	it('a tick stores the levels, updates the variables and checks the audio feedback', async () => {
		await subscribeFeedback(instance, 'audio', { inputId: 'analog-a' })
		await waitFor(() => typeof instance.variableValues['input_analog-a_peak_dbfs'] === 'number')

		const levels = instance.state.inputs['analog-a'].levels
		assert.equal(instance.state.inputs['analog-a'].audioState, 'active')
		assert.equal(levels.rms.length, 2)
		assert.equal(levels.peak.length, 2)
		assert.equal(typeof instance.variableValues['input_analog-a_peak_left'], 'number')
		assert.equal(typeof instance.variableValues['input_analog-a_peak_right'], 'number')
		assert.match(String(instance.variableValues['input_analog-a_level_text']), /^-?\d+ dBFS$/)
		assert.ok(
			instance.checkedFeedbacks.some((ids) => ids.includes('audio')),
			'the meter feedback is rechecked',
		)
	})

	it('unsubscribing to zero stops the poll and blanks the level variables', async () => {
		await subscribeFeedback(instance, 'audio', { inputId: 'analog-a' })
		await subscribeFeedback(instance, 'audio', { inputId: 'analog-b' })
		await waitFor(() => typeof instance.variableValues['input_analog-a_peak_dbfs'] === 'number')

		await unsubscribeFeedback(instance, 'audio', { inputId: 'analog-a' })
		assert.ok(instance.meterTimer, 'one subscription is left, the poll keeps running')

		await unsubscribeFeedback(instance, 'audio', { inputId: 'analog-b' })
		assert.equal(instance.meterSubscriptions.size, 0)
		assert.equal(instance.meterTimer, undefined, 'the poll is stopped')
		assert.equal(instance.state.inputs['analog-a'].levels, undefined)
		assert.equal(instance.variableValues['input_analog-a_peak_dbfs'], '')
		assert.equal(instance.variableValues['input_analog-a_level_text'], '')

		mock.requests.length = 0
		await sleep(700)
		assert.equal(mock.requests.length, 0, 'no request after unsubscribing')
	})

	it('two subscriptions of the same input are ref-counted, not doubled', async () => {
		await subscribeFeedback(instance, 'audio', { inputId: 'analog-a' })
		await subscribeFeedback(instance, 'audio', { inputId: 'analog-a' })
		assert.equal(instance.meterSubscriptions.get('analog-a'), 2)
		await unsubscribeFeedback(instance, 'audio', { inputId: 'analog-a' })
		assert.equal(instance.meterSubscriptions.get('analog-a'), 1)
		assert.ok(instance.meterTimer, 'still one meter placed')
		await unsubscribeFeedback(instance, 'audio', { inputId: 'analog-a' })
		assert.equal(instance.meterTimer, undefined)
	})

	it('the feedback returns an RGBA image buffer of the button size once levels are known', async () => {
		assert.deepEqual(await runFeedback(instance, 'audio', { inputId: 'analog-a' }), {}, 'nothing without levels')

		await subscribeFeedback(instance, 'audio', { inputId: 'analog-a' })
		await waitFor(() => instance.state.inputs['analog-a'].levels !== undefined)

		const result = await runFeedback(instance, 'audio', { inputId: 'analog-a' })
		assert.equal(result.imageBuffer.length, 72 * 72 * 4)
		assert.deepEqual(result.imageBufferEncoding, { pixelFormat: 'RGBA' })
		assert.deepEqual(result.imageBufferPosition, { x: 0, y: 0, width: 72, height: 72 })
		assert.equal(result.text, undefined, "the button's own text is kept")

		// an input without levels (sdi-a reports inactive audio) still draws nothing
		assert.deepEqual(await runFeedback(instance, 'audio', { inputId: 'sdi-a' }), {})
		assert.deepEqual(await runFeedback(instance, 'audio', { inputId: 'nope' }), {})
	})

	it('a state swap by the interval poll does not blank a running meter', async () => {
		await subscribeFeedback(instance, 'audio', { inputId: 'analog-a' })
		await waitFor(() => instance.state.inputs['analog-a'].levels !== undefined)
		await instance.pollAll()
		assert.ok(instance.state.inputs['analog-a'].levels, 'levels carried over into the new state')
		assert.equal(typeof instance.variableValues['input_analog-a_peak_dbfs'], 'number')
	})

	it('the audio action with "Nothing" fetches the levels once, immediately', async () => {
		await runAction(instance, 'audio', { inputId: 'analog-a', control: 'none', direction: 'up', step: 1 })
		await waitFor(() => levelRequests(mock).length >= 1)
		assert.equal(levelRequests(mock).length, 1)
		assert.equal(
			mock.requests.filter((r) => r.method === 'PATCH').length,
			0,
			'"Nothing" changes nothing on the device',
		)
		assert.ok(instance.state.inputs['analog-a'].levels, 'the levels are read even without a meter placed')
	})

	it('a device without the legacy endpoint reports no levels and no error', async () => {
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
		try {
			await instance.pollMeterLevels()
			assert.equal(instance.state.inputs['analog-a'].levels, undefined)
			assert.equal(instance.variableValues['input_analog-a_level_text'], '')
			assert.deepEqual(
				instance.calls.log.filter((l) => l.level === 'error'),
				[],
			)
		} finally {
			mock.server.removeAllListeners('request')
			mock.server.on('request', original)
		}
	})

	it('destroy() stops the level poll', async () => {
		const other = await createInstance({ mock })
		await subscribeFeedback(other, 'audio', { inputId: 'analog-a' })
		assert.ok(other.meterTimer)
		await other.destroy()
		assert.equal(other.meterTimer, undefined)
		mock.requests.length = 0
		await sleep(700)
		assert.equal(levelRequests(mock).length, 0)
	})
})
