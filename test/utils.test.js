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

	it('compactDuration is m:ss below one hour, h:mm:ss from one hour up (§3.3)', () => {
		assert.equal(utils.compactDuration(0), '0:00')
		assert.equal(utils.compactDuration(65), '1:05')
		assert.equal(utils.compactDuration(300), '5:00')
		assert.equal(utils.compactDuration(750), '12:30')
		assert.equal(utils.compactDuration(3599), '59:59')
		assert.equal(utils.compactDuration(3600), '1:00:00')
		assert.equal(utils.compactDuration(3725), '1:02:05')
		assert.equal(utils.compactDuration(-5), '0:00')
		assert.equal(utils.compactDuration('x'), '0:00')
	})

	it('formatUptime reads "3d 4h" (days), "4h 05m" (hours), "12m" (§3.3)', () => {
		assert.equal(utils.formatUptime(3 * 86400 + 4 * 3600), '3d 4h')
		assert.equal(utils.formatUptime(4 * 3600 + 5 * 60), '4h 05m')
		assert.equal(utils.formatUptime(12 * 60), '12m')
		assert.equal(utils.formatUptime(0), '0m')
		assert.equal(utils.formatUptime(-5), '0m')
	})

	it('bytesToHuman reads "1.5 GB" and friends (§3.3), base 1024', () => {
		assert.equal(utils.bytesToHuman(0), '0 B')
		assert.equal(utils.bytesToHuman(512), '512 B')
		assert.equal(utils.bytesToHuman(1536), '1.5 KB')
		assert.equal(utils.bytesToHuman(1.5 * 1024 ** 3), '1.5 GB')
		assert.equal(utils.bytesToHuman(11 * 1024 ** 3), '11 GB')
		assert.equal(utils.bytesToHuman(128 * 1024 ** 3), '128 GB')
		assert.equal(utils.bytesToHuman(-5), '0 B')
		assert.equal(utils.bytesToHuman(undefined), '0 B')
	})

	it('normaliseInputId strips the D2P<serial>. prefix and sameInputId compares without it', () => {
		assert.equal(utils.normaliseInputId('D2P492324.analog-a'), 'analog-a')
		assert.equal(utils.normaliseInputId('D2P0.SDI-B'), 'SDI-B')
		assert.equal(utils.normaliseInputId('analog-a'), 'analog-a')
		assert.equal(utils.normaliseInputId('USBA'), 'USBA')
		assert.equal(utils.normaliseInputId('D2P.x'), 'x')
		assert.equal(
			utils.normaliseInputId('SRT1.something'),
			'SRT1.something',
			'only the D2P device prefix is removed',
		)
		assert.equal(utils.normaliseInputId(undefined), '')
		assert.equal(utils.sameInputId('D2P492324.analog-a', 'analog-a'), true)
		assert.equal(utils.sameInputId('D2P1.hdmi-a', 'D2P2.hdmi-a'), true)
		assert.equal(utils.sameInputId('analog-a', 'analog-b'), false)
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

	it('round1 rounds to one decimal', () => {
		assert.equal(utils.round1(1.26), 1.3)
		assert.equal(utils.round1('x'), '')
	})

	it('recorderToggleOp: stop while started/starting/paused, start otherwise (D14); "all" aggregates', () => {
		const recorders = { a: { status: { state: 'stopped' } }, b: { status: { state: 'started' } } }
		assert.equal(utils.recorderToggleOp(recorders, 'a'), 'start')
		assert.equal(utils.recorderToggleOp(recorders, 'b'), 'stop')
		assert.equal(utils.recorderToggleOp(recorders, 'all'), 'stop', 'any active recorder -> stop all')
		assert.equal(
			utils.recorderToggleOp({ a: { status: { state: 'stopped' } } }, 'all'),
			'start',
			'none active -> start all',
		)
		assert.equal(utils.recorderToggleOp(recorders, 'nope'), 'start', 'a missing recorder is treated as inactive')
		for (const state of ['starting', 'paused']) {
			assert.equal(utils.recorderToggleOp({ a: { status: { state } } }, 'a'), 'stop')
		}
		for (const state of ['error', 'disabled', undefined]) {
			assert.equal(utils.recorderToggleOp({ a: { status: { state } } }, 'a'), 'start')
		}
	})

	it('publisherToggleOp: stop while started/starting/listening, start otherwise (D14); "all" aggregates', () => {
		const publishers = { a: { status: { state: 'stopped' } }, b: { status: { state: 'listening' } } }
		assert.equal(utils.publisherToggleOp(publishers, 'a'), 'start')
		assert.equal(utils.publisherToggleOp(publishers, 'b'), 'stop')
		assert.equal(utils.publisherToggleOp(publishers, 'all'), 'stop')
		assert.equal(utils.publisherToggleOp({ a: { status: { state: 'stopped' } } }, 'all'), 'start')
		for (const state of ['started', 'starting', 'listening']) {
			assert.equal(utils.publisherToggleOp({ a: { status: { state } } }, 'a'), 'stop')
		}
		for (const state of ['error', 'stopped', undefined]) {
			assert.equal(utils.publisherToggleOp({ a: { status: { state } } }, 'a'), 'start')
		}
	})

	it('eventToggleOp: running->pause, paused->resume, scheduled->start, otherwise none applies', () => {
		assert.equal(utils.eventToggleOp('running'), 'pause')
		assert.equal(utils.eventToggleOp('paused'), 'resume')
		assert.equal(utils.eventToggleOp('scheduled'), 'start')
		assert.equal(utils.eventToggleOp('finished'), '')
		assert.equal(utils.eventToggleOp(undefined), '')
	})

	it('eventApplies: start/scheduled, stop+extend/running+paused, pause/running, resume/paused', () => {
		assert.equal(utils.eventApplies('start', 'scheduled'), true)
		assert.equal(utils.eventApplies('start', 'running'), false)
		assert.equal(utils.eventApplies('stop', 'running'), true)
		assert.equal(utils.eventApplies('stop', 'paused'), true)
		assert.equal(utils.eventApplies('stop', 'scheduled'), false)
		assert.equal(utils.eventApplies('extend', 'running'), true)
		assert.equal(utils.eventApplies('extend', 'finished'), false)
		assert.equal(utils.eventApplies('pause', 'running'), true)
		assert.equal(utils.eventApplies('pause', 'paused'), false)
		assert.equal(utils.eventApplies('resume', 'paused'), true)
		assert.equal(utils.eventApplies('resume', 'running'), false)
		assert.equal(utils.eventApplies('bogus', 'running'), false)
	})

	it('localTimeHms formats a Date as local HH:MM:SS', () => {
		const d = new Date(2025, 0, 1, 9, 5, 3)
		assert.equal(utils.localTimeHms(d), '09:05:03')
	})

	it('bookmarkText trims, defaults to "Marker" and optionally appends the local time', () => {
		const d = new Date(2025, 0, 1, 9, 5, 3)
		assert.equal(utils.bookmarkText('Intro', false, d), 'Intro')
		assert.equal(utils.bookmarkText('  Intro  ', false, d), 'Intro')
		assert.equal(utils.bookmarkText('', false, d), 'Marker')
		assert.equal(utils.bookmarkText(undefined, false, d), 'Marker')
		assert.equal(utils.bookmarkText('Intro', true, d), 'Intro 09:05:03')
		assert.equal(utils.bookmarkText('', true, d), 'Marker 09:05:03')
	})

	it('emptyState has the target 3.0.0 shape (doc/PARITY.md §1 state shape target)', () => {
		const s = utils.emptyState()
		assert.deepEqual(Object.keys(s).sort(), [
			'afu',
			'channels',
			'events',
			'firmware',
			'identity',
			'inputs',
			'lastConfigPreset',
			'lastError',
			'outputs',
			'powerStatus',
			'presetStatus',
			'presets',
			'recorders',
			'singleTouch',
			'storages',
			'systemStatus',
		])
		assert.deepEqual(s.events, { upcoming: null, ongoing: null, list: [] })
		assert.deepEqual(s.channels, {})
		assert.deepEqual(s.presets, [])
		assert.deepEqual(s.afu, [])
		// connectivity, speedtest and per-entity encoders/metadata/lastFile are gone (removed with the
		// features that read them; see doc/PARITY.md §2.6)
		assert.equal('connectivity' in s, false)
		assert.equal('speedtest' in s, false)
	})
})
