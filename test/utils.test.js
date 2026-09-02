const { describe, it } = require('node:test')
const assert = require('node:assert/strict')

const utils = require('../src/utils')

describe('utils', () => {
	it('formatHms formats seconds as HH:MM:SS', () => {
		assert.equal(utils.formatHms(0), '00:00:00')
		assert.equal(utils.formatHms(59), '00:00:59')
		assert.equal(utils.formatHms(3661), '01:01:01')
		assert.equal(utils.formatHms('3661'), '01:01:01')
		assert.equal(utils.formatHms(90000), '25:00:00')
		assert.equal(utils.formatHms(-61), '-00:01:01')
		assert.equal(utils.formatHms('abc'), '')
		assert.equal(utils.formatHms(undefined), '')
	})

	it('formatClock returns local HH:MM or empty', () => {
		const ts = Math.floor(new Date(2025, 0, 1, 9, 5, 0).getTime() / 1000)
		assert.equal(utils.formatClock(ts), '09:05')
		assert.equal(utils.formatClock(0), '')
		assert.equal(utils.formatClock('x'), '')
	})

	it('safeId replaces everything outside [a-zA-Z0-9_-]', () => {
		assert.equal(utils.safeId('D2P496187.hdmi-a'), 'D2P496187_hdmi-a')
		assert.equal(utils.safeId('weird id!'), 'weird_id_')
		assert.equal(utils.safeId(1), '1')
		assert.equal(utils.safeId(undefined), '')
		assert.match(utils.safeId('a b/c.d:e'), /^[a-zA-Z0-9_-]+$/)
	})

	it('splitPair splits on the first dash only', () => {
		assert.deepEqual(utils.splitPair('1-2'), ['1', '2'])
		assert.deepEqual(utils.splitPair('1-all'), ['1', 'all'])
		assert.deepEqual(utils.splitPair('1-a-b'), ['1', 'a-b'])
		assert.equal(utils.splitPair('1'), null)
		assert.equal(utils.splitPair('-1'), null)
		assert.equal(utils.splitPair('1-'), null)
		assert.equal(utils.splitPair(12), null)
		assert.equal(utils.splitPair(undefined), null)
	})

	it('nonBlank drops empty, undefined and null values', () => {
		assert.deepEqual(utils.nonBlank({ a: 'x', b: '', c: undefined, d: null, e: 0, f: false }), {
			a: 'x',
			e: 0,
			f: false,
		})
		assert.deepEqual(utils.nonBlank(null), {})
	})

	it('parseJsonOption parses objects and rejects everything else', () => {
		assert.deepEqual(utils.parseJsonOption(''), {})
		assert.deepEqual(utils.parseJsonOption('   '), {})
		assert.deepEqual(utils.parseJsonOption('{"a":1}'), { a: 1 })
		assert.throws(() => utils.parseJsonOption('{bad'), /not valid JSON/)
		assert.throws(() => utils.parseJsonOption('[1,2]'), /JSON object/)
		assert.throws(() => utils.parseJsonOption('"str"'), /JSON object/)
		assert.throws(() => utils.parseJsonOption('null'), /JSON object/)
	})

	it('stableJson sorts keys recursively', () => {
		assert.equal(utils.stableJson({ b: 1, a: { d: 2, c: 3 } }), '{"a":{"c":3,"d":2},"b":1}')
		assert.equal(utils.stableJson([{ b: 1, a: 2 }]), '[{"a":2,"b":1}]')
	})

	it('toQueryString encodes booleans, skips undefined and joins arrays', () => {
		assert.equal(utils.toQueryString(), '')
		assert.equal(utils.toQueryString({}), '')
		assert.equal(
			utils.toQueryString({ a: true, b: false, c: undefined, d: null, e: 'x y', f: [1, 2] }),
			'?a=true&b=false&e=x+y&f=1%2C2',
		)
	})

	it('parseKeyValueText parses get_params.cgi output', () => {
		assert.deepEqual(utils.parseKeyValueText('title = Morning Show\nauthor = Epiphan\nrec_prefix=HDMI-A\n'), {
			title: 'Morning Show',
			author: 'Epiphan',
			rec_prefix: 'HDMI-A',
		})
		assert.deepEqual(utils.parseKeyValueText(undefined), {})
	})

	it('firmwareVersionNumber converts version strings', () => {
		assert.equal(utils.firmwareVersionNumber('4.24.1'), 42401)
		assert.equal(utils.firmwareVersionNumber('4.20.0'), 42000)
		assert.equal(utils.firmwareVersionNumber('4.25'), 42500)
		assert.equal(utils.firmwareVersionNumber('4.24.1.b12'), 42401)
		assert.equal(utils.firmwareVersionNumber('x'), null)
		assert.equal(utils.firmwareVersionNumber(undefined), null)
	})

	it('clampNumber clamps and defaults', () => {
		assert.equal(utils.clampNumber(5, 10, 1, 300), 5)
		assert.equal(utils.clampNumber('500', 10, 1, 300), 300)
		assert.equal(utils.clampNumber(0, 10, 1, 300), 1)
		assert.equal(utils.clampNumber('', 10, 1, 300), 10)
		assert.equal(utils.clampNumber(undefined, 10, 1, 300), 10)
	})

	it('byte and rounding helpers', () => {
		assert.equal(utils.round1(1.26), 1.3)
		assert.equal(utils.round1('x'), '')
		assert.equal(utils.bytesToMb(407160404), 388.3)
		assert.equal(utils.bytesToGb(15809413120), 14.7)
		assert.equal(utils.bytesToGb(undefined), '')
	})

	it('metadataRetryDue backs off failed metadata fetches', () => {
		const now = 10_000_000
		assert.equal(utils.metadataRetryDue(undefined, now), true, 'never fetched')
		assert.equal(utils.metadataRetryDue(null, now), true)
		assert.equal(utils.metadataRetryDue({ title: 'x', author: '', rec_prefix: '' }, now), false, 'fetched fine')
		const marker = (ageMs, attempts) => ({
			title: '',
			author: '',
			rec_prefix: '',
			_failedAt: now - ageMs,
			_attempts: attempts,
		})
		assert.equal(utils.metadataRetryDue(marker(1000, 1), now), false)
		assert.equal(utils.metadataRetryDue(marker(60_001, 1), now), true)
		assert.equal(utils.metadataRetryDue(marker(60_001, 2), now), false)
		assert.equal(utils.metadataRetryDue(marker(120_001, 2), now), true)
		assert.equal(utils.metadataRetryDue(marker(600_000, 50), now), false, 'factor capped at 10')
		assert.equal(utils.metadataRetryDue(marker(600_001, 50), now), true)
		assert.equal(utils.metadataRetryDue({ _failedAt: now - 60_001 }, now), true, 'missing attempts counts as 1')
	})

	it('emptyState has the documented shape', () => {
		const s = utils.emptyState()
		assert.deepEqual(Object.keys(s).sort(), [
			'afu',
			'channels',
			'connectivity',
			'events',
			'firmware',
			'identity',
			'inputs',
			'lastConfigPreset',
			'outputs',
			'presets',
			'recorders',
			'singleTouch',
			'speedtest',
			'storages',
			'systemStatus',
		])
		assert.deepEqual(s.events, { upcoming: null, ongoing: null })
	})
})
