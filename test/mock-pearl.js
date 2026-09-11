/**
 * In-memory HTTP mock of an Epiphan Pearl device.
 *
 * Serves the target 3.0.0 control set's endpoints
 * under both `/api/v2.0/...` and the legacy `/api/...` prefix, plus the legacy-only endpoints that are
 * still used (layout list/active/preview, the audio settings PATCH, the
 * legacy `/sources/status` levels). Routes that only served a feature the 3.0.0 rewrite removed (admin CGI
 * content metadata, network connectivity/speedtest, recorder archive files, ad-hoc CMS sessions, publisher
 * create/rename/settings, channel rename, input creation, layout settings GET/PUT, and a handful of GETs
 * nothing in the module ever called) are gone.
 * One admin CGI route (`GET get_params.cgi`) is kept anyway: `test/request.test.js` uses it as a generic
 * text/plain endpoint to exercise the request layer's `base:'raw'`/`text:true` handling, unrelated to the
 * removed content-metadata feature itself.
 *
 * Recorder control (`applyRecorderOp`) answers pause/resume alongside start/stop (verified against real
 * hardware, even though the published API description lists start/stop only; behaviour verified on
 * hardware wins). `reset` is legacy-only: the v2.0 route 404s so the
 * `recorder` action's own v1 fallback (src/actions.js) is exercised for real by test/actions.test.js.
 *

 * No dependencies beyond node:http / node:https / node:zlib (+ the self-signed TLS pair in test/fixtures).
 *
 * Usage:
 *   const { startMockPearl } = require('./mock-pearl')
 *   const mock = await startMockPearl({ firmware: '4.24.1', legacyOnly: false, https: false, clockSkewMs: 0 })
 *   mock.url        // 'http://127.0.0.1:<port>' ('https://...' with https: true)
 *   mock.port
 *   mock.state      // live, mutable model (see seedState)
 *   mock.requests   // [{ method, path, query, body, headers }]
 *   mock.reset()    // reseed state (and clear requests)
 *   mock.setClockSkew(ms)  // offset applied to the Date header of every response from now on
 *   await mock.close()
 */
const fs = require('node:fs')
const http = require('node:http')
const https = require('node:https')
const path = require('node:path')
const zlib = require('node:zlib')

/** self-signed certificate for 127.0.0.1 (CN + SAN IP:127.0.0.1, DNS:localhost), test-only material */
const TLS_KEY_PATH = path.join(__dirname, 'fixtures', 'selfsigned.key')
const TLS_CERT_PATH = path.join(__dirname, 'fixtures', 'selfsigned.crt')

/** device serial prefix carried by the ids of the legacy /sources/status list (the /inputs ids lack it) */
const SOURCE_ID_PREFIX = 'D2P492324.'
const SOURCE_ID_PREFIX_RE = /^D2P[^.]*\./

// ---------------------------------------------------------------------------
// 1x1 PNG (built programmatically so the bytes are guaranteed valid)
// ---------------------------------------------------------------------------

const CRC_TABLE = (() => {
	const table = new Int32Array(256)
	for (let n = 0; n < 256; n++) {
		let c = n
		for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
		table[n] = c
	}
	return table
})()

function crc32(buf) {
	let crc = -1
	for (let i = 0; i < buf.length; i++) crc = CRC_TABLE[(crc ^ buf[i]) & 0xff] ^ (crc >>> 8)
	return (crc ^ -1) >>> 0
}

function pngChunk(type, data) {
	const len = Buffer.alloc(4)
	len.writeUInt32BE(data.length)
	const typeAndData = Buffer.concat([Buffer.from(type, 'ascii'), data])
	const crc = Buffer.alloc(4)
	crc.writeUInt32BE(crc32(typeAndData))
	return Buffer.concat([len, typeAndData, crc])
}

function buildPng1x1() {
	const signature = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])
	const ihdr = Buffer.alloc(13)
	ihdr.writeUInt32BE(1, 0) // width
	ihdr.writeUInt32BE(1, 4) // height
	ihdr[8] = 8 // bit depth
	ihdr[9] = 2 // colour type RGB
	ihdr[10] = 0 // compression
	ihdr[11] = 0 // filter
	ihdr[12] = 0 // interlace
	const raw = Buffer.from([0, 0, 0, 0]) // filter byte + one black RGB pixel
	return Buffer.concat([
		signature,
		pngChunk('IHDR', ihdr),
		pngChunk('IDAT', zlib.deflateSync(raw)),
		pngChunk('IEND', Buffer.alloc(0)),
	])
}

const PNG_1X1 = buildPng1x1()

// ---------------------------------------------------------------------------
// Seed model
// ---------------------------------------------------------------------------

const PRESET_SECTIONS = [
	'system',
	'network',
	'sources',
	'edid',
	'channels',
	'afu',
	'cms',
	'avstudio',
	'frontscreen',
	'displays',
]

function nowSec() {
	return Math.floor(Date.now() / 1000)
}

function seedState(firmware) {
	const now = nowSec()
	return {
		firmware: {
			version: firmware,
			revision: '250107_1e4514f',
			product_id: 44,
			product_name: 'Pearl Mini',
		},
		identity: { name: 'Pearl Mini', location: 'Home', description: 'Pearl Mini at Home' },
		systemStatus: {
			date: '2025-02-14T08:41:09-05:00',
			uptime: 5490,
			cpuload: 25,
			cpuload_high: false,
			cputemp: 57,
			cputemp_threshold: 70,
		},
		channels: {
			1: {
				id: '1',
				name: 'HDMI-A',
				layouts: [
					{ id: '1', name: 'Default', active: true },
					{ id: '2', name: 'Picture in picture', active: false },
				],
				layoutSources: {
					video: [{ id: 'hdmi-a', name: 'HDMI-A' }],
					audio: [{ id: 'analog-a', name: 'Analog-A' }],
				},
				publishers: {
					0: {
						id: '0',
						type: 'rtmp',
						name: 'Stream 1',
						status: { is_configured: true, started: false, state: 'stopped' },
						settings: {
							rtmp: {
								disable_audio: false,
								url: 'rtmp://192.168.86.51',
								stream: 'live',
								username: '',
								password: '',
							},
							type: 'rtmp',
							common: { enabled: true, single_touch: false },
						},
					},
					1: {
						id: '1',
						type: 'srt',
						name: 'Stream 2',
						status: {
							is_configured: true,
							started: true,
							state: 'started',
							duration: 188,
							since: now - 188,
							statistics: {
								total: {
									duration: 182,
									pkt_sent: 62875,
									pkt_loss: 0,
									pkt_retrans: 0,
									pkt_drop: 0,
									latency: 125,
									byte_sent: 80118160,
									byte_retrans: 0,
									byte_drop: 0,
								},
								current: {
									duration: 20,
									send_rate: 3.61,
									loss_ratio: 0,
									retrans_ratio: 0,
									drop_ratio: 0,
									latency: 125,
									rtt: 342,
									estimated_bandwidth: 318.624,
									send_buffer: 1000,
									stream_id: '',
									ip: '192.168.86.102',
								},
							},
							reconnections: 0,
						},
						settings: {
							srt: {
								port: 1029,
								disable_audio: false,
								mode: 'listener',
								latency: 125,
								bw_recovery_overhead: 25,
								encryption: null,
							},
							type: 'srt',
							common: { enabled: true, single_touch: true },
						},
					},
				},
				encoders: [
					{ id: '0', type: 'video', name: 'H.264', resolution: '1920x1080', framerate: 30, bitrate: 3000 },
					{ id: '1', type: 'audio', name: 'AAC', channels: 2, bitrate: 128 },
				],
				metadata: { title: 'Morning Show', author: 'Epiphan', rec_prefix: 'HDMI-A' },
			},
			2: {
				id: '2',
				name: 'Multi',
				layouts: [{ id: '1', name: 'Default', active: true }],
				layoutSources: {
					video: [
						{ id: 'hdmi-a', name: 'HDMI-A' },
						{ id: 'USBA', name: 'USB-A' },
					],
					audio: [{ id: 'USBA', name: 'USB-A' }],
				},
				publishers: {},
				encoders: [
					{ id: '0', type: 'video', name: 'H.264', resolution: '1280x720', framerate: 30, bitrate: 2000 },
					{ id: '1', type: 'audio', name: 'AAC', channels: 2, bitrate: 128 },
				],
				metadata: { title: '', author: '', rec_prefix: 'Multi' },
			},
		},
		recorders: {
			1: {
				id: '1',
				name: 'HDMI-A',
				multisource: false,
				status: { state: 'started', duration: 58, active: '1', total: '1' },
			},
			2: { id: '2', name: 'Multi', multisource: false, status: { state: 'stopped' } },
			m1: { id: 'm1', name: 'Multitrack', multisource: true, status: { state: 'stopped' } },
		},
		inputs: {
			'hdmi-a': {
				id: 'hdmi-a',
				name: 'HDMI-A',
				real_device_name: 'HDMI-A',
				audio: false,
				video: true,
				type: 'embedded',
				settings: null, // 405 "Input settings are not supported"
			},
			'analog-a': {
				id: 'analog-a',
				name: 'Analog-A',
				real_device_name: 'XLR/TRS',
				audio: true,
				video: false,
				type: 'embedded',
				settings: {
					audio: { delay: 0 },
					local_audio: {
						gain: 27,
						mute: false,
						phantom_power: false,
						stereo_pair: true,
						channels: { channelA: { gain: 27, mute: false }, channelB: { gain: 27, mute: false } },
					},
				},
			},
			'analog-b': {
				id: 'analog-b',
				name: 'Analog-B',
				real_device_name: 'RCA',
				audio: true,
				video: false,
				type: 'embedded',
				settings: {
					audio: { delay: 0 },
					local_audio: {
						mute: false,
						phantom_power: false,
						stereo_pair: false,
						channels: { channelA: { gain: 20, mute: false }, channelB: { gain: 24, mute: false } },
					},
				},
			},
			'hdmi-b': {
				id: 'hdmi-b',
				name: 'HDMI-B',
				real_device_name: 'HDMI-B',
				audio: true,
				video: true,
				type: 'embedded',
				settings: {
					hdmi: { audio: { delay: 0, mute: false } },
				},
			},
			'sdi-a': {
				id: 'sdi-a',
				name: 'SDI-A',
				real_device_name: 'SDI-A',
				audio: true,
				video: true,
				type: 'embedded',
				// reported with inactive audio (no levels) by the legacy /sources/status list
				audioState: 'inactive',
				settings: {
					sdi: { audio: { delay: 0, mute: false } },
				},
			},
			USBA: {
				id: 'USBA',
				name: 'USB-A',
				real_device_name: 'USB Capture HDMI',
				audio: true,
				video: true,
				type: 'usb',
				settings: {
					audio: { delay: 0 },
					local_audio: { gain: 50, mute: false },
				},
			},
			SRT1: {
				id: 'SRT1',
				name: 'SRT 1',
				real_device_name: 'SRT 1',
				audio: true,
				video: true,
				type: 'srt',
				settings: {
					audio: { delay: 0 },
					video: {
						nosignal: { image: '', timeout: 5 },
						force_full_color_range: true,
						hwaccel_decoding: true,
					},
					srt: { mode: 'listener', latency: 80, encryption: null, port: 1024 },
				},
			},
		},
		outputs: {
			D1: { id: 'D1', name: 'HDMI', source: 'multiview' },
		},
		storages: {
			main: { state: 'ready', media_type: 'sdcard', total: 15809413120, free: 11821019136 },
			external: { state: 'nodev' },
			maintenance: { state: 'nodev' },
		},
		singleTouch: {
			0: {
				pressed: false,
				status: true,
				recorders: { total: 3, active: 1, success: 3 },
				publishers: { total: 2, active: 1, success: 2 },
			},
		},
		presets: [
			{ name: 'Default', description: 'Default profile', sections: ['all'], readonly: true },
			{
				name: 'Show A',
				description: 'Show A configuration',
				sections: [...PRESET_SECTIONS],
				hash: '4dfdea2c1ce6f14e46c7f7464d702358',
				size: 29696,
				readonly: false,
			},
		],
		appliedPresets: [],
		afu: [{ id: '0', status: { state: 'idle', protocol: 'webdav', queue: { files: 0, size: 0 } } }],
		events: [
			{
				id: '782ec0f4bbcc48e2a42a44eea5e69dc5',
				status: 'scheduled',
				title: 'Example event',
				start: now + 3600,
				finish: now + 7200,
				recorders: [{ id: '1' }],
				streams: [],
				tags: 'test',
			},
		],
		control: { lastCommand: null, ejected: [] },
		counters: { levelPolls: 0 },
	}
}

/**
 * Audio levels in dBFS for one /sources/status request; they wander per request so two polls differ
 */
function audioLevels(state) {
	const phase = state.counters.levelPolls++ / 2
	const left = Math.round(-30 + 8 * Math.sin(phase))
	const right = Math.round(-32 + 8 * Math.cos(phase))
	return { rms: [left, right], peak: [Math.min(0, left + 6), Math.min(0, right + 6)] }
}

/**
 * One entry of the legacy GET /api/sources/status list: the id carries the device serial prefix
 * (unless it already has one), audio inputs carry levels unless their audio is inactive
 */
function sourceStatus(state, input) {
	const status = {}
	if (input.video) status.video = { state: 'active', resolution: '1920x1080', actual_fps: 30 }
	if (input.audio) {
		status.audio =
			input.audioState === 'inactive'
				? { state: 'inactive' }
				: { state: 'active', levels: audioLevels(state), codec: 'pcm', sample_rate: 48000 }
	}
	const id = SOURCE_ID_PREFIX_RE.test(input.id) ? input.id : `${SOURCE_ID_PREFIX}${input.id}`
	return { id, name: input.name, status }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function isPlainObject(v) {
	return v !== null && typeof v === 'object' && !Array.isArray(v)
}

function deepMerge(target, patch) {
	if (!isPlainObject(patch)) return patch
	const out = isPlainObject(target) ? { ...target } : {}
	for (const [k, v] of Object.entries(patch)) {
		if (isPlainObject(v) && isPlainObject(out[k])) out[k] = deepMerge(out[k], v)
		else out[k] = v
	}
	return out
}

function flag(v) {
	if (v === undefined || v === null) return false
	const s = String(v).toLowerCase()
	return s === '' || s === 'true' || s === 'yes' || s === '1' || s === 'on'
}

function idsFilter(query) {
	if (query.ids === undefined || query.ids === '') return null
	return new Set(
		String(query.ids)
			.split(',')
			.map((s) => s.trim())
			.filter(Boolean),
	)
}

function publicPublisher(pub, { status = false, settings = false } = {}) {
	const out = { id: pub.id, type: pub.type, name: pub.name }
	if (status) out.status = pub.status
	if (settings) out.settings = pub.settings
	return out
}

function activeLayoutOf(channel) {
	const active = channel.layouts.find((l) => l.active)
	if (!active) return undefined
	return { id: active.id, name: active.name, sources: channel.layoutSources }
}

// Route pattern compiler: '/channels/:cid/publishers/:pid' -> regex with named groups
function compile(pattern) {
	const keys = []
	const re = pattern
		.split('/')
		.map((seg) => {
			if (seg.startsWith(':')) {
				keys.push(seg.slice(1))
				return '([^/]+)'
			}
			return seg.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
		})
		.join('/')
	return { re: new RegExp(`^${re}$`), keys }
}

// ---------------------------------------------------------------------------
// Server
// ---------------------------------------------------------------------------

class HttpError extends Error {
	constructor(code, status, message) {
		super(message)
		this.code = code
		this.apiStatus = status
	}
}

const notFound = (message) => new HttpError(404, 'notfound', message)
const badRequest = (message) => new HttpError(400, 'badrequest', message)
const conflict = (message) => new HttpError(409, 'conflict', message)
const notAllowed = (message) => new HttpError(405, 'notallowed', message)

/**
 * Start the mock device.
 *
 * @param {object} [opts]
 * @param {string} [opts.firmware='4.24.1']  firmware version reported by /system/firmware(/version)
 * @param {boolean} [opts.legacyOnly=false]  when true every /api/v2.0/ path returns 404
 * @param {number} [opts.port=0]             0 = ephemeral
 * @param {boolean} [opts.https=false]       serve TLS with the self-signed pair in test/fixtures
 * @param {number} [opts.clockSkewMs=0]      offset added to the Date header of every response (device clock skew)
 * @returns {Promise<{url:string, port:number, state:object, requests:object[], reset:Function, setClockSkew:Function, close:Function, server:import('node:http').Server}>}
 */
async function startMockPearl({
	firmware = '4.24.1',
	legacyOnly = false,
	port = 0,
	https: useHttps = false,
	clockSkewMs = 0,
} = {}) {
	const state = seedState(firmware)
	const requests = []
	const clock = { skewMs: Number(clockSkewMs) || 0 }

	function reset({ clearRequests = true } = {}) {
		const fresh = seedState(firmware)
		for (const k of Object.keys(state)) delete state[k]
		Object.assign(state, fresh)
		if (clearRequests) requests.length = 0
	}

	// ---- model accessors (throw HttpError on unknown ids) ------------------

	const getChannel = (cid) => {
		const ch = state.channels[cid]
		if (!ch) throw notFound(`channel '${cid}' not found`)
		return ch
	}
	const getPublisher = (cid, pid) => {
		const ch = getChannel(cid)
		const pub = ch.publishers[pid]
		if (!pub) throw notFound(`streamer '${pid}' for channel '${cid}' not found`)
		return pub
	}
	const getLayout = (ch, lid) => {
		const layout = ch.layouts.find((l) => l.id === String(lid))
		if (!layout) throw notFound(`layout '${lid}' for channel '${ch.id}' not found`)
		return layout
	}
	const getRecorder = (rid) => {
		const rec = state.recorders[rid]
		if (!rec) throw notFound('Recorder not found')
		return rec
	}
	const getInput = (sid) => {
		const input = state.inputs[sid]
		if (!input) throw notFound('Input not found')
		return input
	}
	const getOutput = (did) => {
		const out = state.outputs[did]
		if (!out) throw notFound(`output '${did}' not found`)
		return out
	}
	const getStorage = (stid) => {
		const st = state.storages[stid]
		if (!st) throw notFound(`Storage '${stid}' not found`)
		return st
	}
	const getSingleTouch = (stcid) => {
		const stc = state.singleTouch[stcid]
		if (!stc) throw notFound(`single touch control object '${stcid}' not found`)
		return stc
	}
	const getPreset = (name) => {
		const preset = state.presets.find((p) => p.name === name)
		if (!preset) throw notFound(`Configuration preset ${name} is not found`)
		return preset
	}
	const EVENT_ALIASES = ['upcoming', 'ongoing', 'running', 'paused', 'completed']
	function resolveEvent(eventId) {
		let ev
		const byStart = (a, b) => a.start - b.start
		switch (eventId) {
			case 'upcoming':
				ev = state.events.filter((e) => e.status === 'scheduled').sort(byStart)[0]
				break
			case 'ongoing':
				ev = state.events.find((e) => e.status === 'running' || e.status === 'paused')
				break
			case 'running':
				ev = state.events.find((e) => e.status === 'running')
				break
			case 'paused':
				ev = state.events.find((e) => e.status === 'paused')
				break
			case 'completed':
				ev = state.events.filter((e) => e.status === 'finished').sort((a, b) => b.finish - a.finish)[0]
				break
			default:
				ev = state.events.find((e) => e.id === eventId)
		}
		if (!ev) throw notFound(`Event '${eventId}' not found`)
		return ev
	}

	function eventControl(ev, action, body) {
		const now = nowSec()
		switch (action) {
			case 'start':
				if (ev.status !== 'scheduled') throw conflict(`Event '${ev.id}' is not scheduled`)
				ev.status = 'running'
				ev.start = now
				break
			case 'stop':
				if (ev.status !== 'running' && ev.status !== 'paused') throw conflict(`Event '${ev.id}' is not ongoing`)
				ev.status = 'finished'
				ev.finish = now
				break
			case 'pause':
				if (ev.status !== 'running') throw conflict(`Event '${ev.id}' is not running`)
				ev.status = 'paused'
				break
			case 'resume':
				if (ev.status !== 'paused') throw conflict(`Event '${ev.id}' is not paused`)
				ev.status = 'running'
				break
			case 'extend': {
				if (ev.status !== 'running' && ev.status !== 'paused') throw conflict(`Event '${ev.id}' is not ongoing`)
				const finish = body && Number(body.finish)
				if (!Number.isFinite(finish) || finish <= 0) throw badRequest('Missing or invalid finish parameter')
				ev.finish += finish
				break
			}
			default:
				throw notFound(`Unknown event control '${action}'`)
		}
	}

	function startPublisher(pub) {
		pub.status = {
			...pub.status,
			is_configured: true,
			started: true,
			state: 'started',
			duration: 0,
			since: nowSec(),
		}
	}
	function stopPublisher(pub) {
		pub.status = { is_configured: pub.status?.is_configured ?? true, started: false, state: 'stopped' }
	}
	function startRecorder(rec) {
		rec.status = { state: 'started', duration: 0, active: '1', total: '1' }
	}
	function stopRecorder(rec) {
		rec.status = { state: 'stopped' }
	}
	function pauseRecorder(rec) {
		if (rec.status?.state !== 'started') throw conflict(`Recorder '${rec.id}' is not recording`)
		rec.status = { ...rec.status, state: 'paused' }
	}
	function resumeRecorder(rec) {
		if (rec.status?.state !== 'paused') throw conflict(`Recorder '${rec.id}' is not paused`)
		rec.status = { ...rec.status, state: 'started' }
	}
	// pause/resume/reset are not in the published API description (start/stop only) but the behaviour
	// verified on real hardware wins; reset in particular is legacy-only, so the v2.0 route 404s and the
	// action's own fallback (src/actions.js) retries on the legacy base - exercised by test/actions.test.js
	function applyRecorderOp(rec, action) {
		switch (action) {
			case 'start':
				startRecorder(rec)
				break
			case 'stop':
				stopRecorder(rec)
				break
			case 'pause':
				pauseRecorder(rec)
				break
			case 'resume':
				resumeRecorder(rec)
				break
			case 'reset':
				if (rec.status?.state === 'started') rec.status = { ...rec.status, duration: 0 }
				break
			default:
				throw notFound(`Unknown recorder control '${action}'`)
		}
	}

	function presetView(preset, query) {
		const details = flag(query.details)
		const out = { name: preset.name }
		if (details || flag(query.description)) out.description = preset.description ?? ''
		if (details || flag(query.sections)) out.sections = preset.sections
		if ((details || flag(query.hash)) && preset.hash !== undefined) out.hash = preset.hash
		if ((details || flag(query.size)) && preset.size !== undefined) out.size = preset.size
		if (details || flag(query.readonly)) out.readonly = Boolean(preset.readonly)
		return out
	}

	// ---- routes -----------------------------------------------------------
	// Each handler receives ctx = { params, query, body, v2 } and returns either
	//   { result }              -> 200 {status:'ok', result}
	//   { ok: true }            -> 200 {status:'ok'}
	//   { code, result }        -> <code> {status:'ok', result}
	//   { png: true }           -> image/png
	//   { text: string }        -> text/plain
	//   { octet: Buffer }       -> application/octet-stream
	//   { envelopeError }       -> 200 {status: envelopeStatus||'error', message: envelopeError} — a real
	//                              Pearl quirk: the device answers 200 with a failing envelope instead of
	//                              a non-2xx status (see PUT /channels/:cid/name's softFail flag below)

	const routes = []
	const route = (method, pattern, handler) => routes.push({ method, pattern, ...compile(pattern), handler })

	// -- AFU
	route('GET', '/afu/status', () => ({ result: state.afu }))

	// -- Channels
	route('GET', '/channels', ({ query }) => {
		const filter = idsFilter(query)
		const includePublishers = flag(query.publishers)
		const includeStatus = flag(query['publishers-status'])
		const includeSettings = flag(query['publishers-settings'])
		const includeEncoders = flag(query.encoders)
		const includeActiveLayout = flag(query.active_layout)
		const result = Object.values(state.channels)
			.filter((ch) => !filter || filter.has(ch.id))
			.map((ch) => {
				const out = { id: ch.id, name: ch.name }
				if (includePublishers) {
					out.publishers = Object.values(ch.publishers).map((p) =>
						publicPublisher(p, { status: includeStatus, settings: includeSettings }),
					)
				}
				if (includeEncoders) out.encoders = ch.encoders
				if (includeActiveLayout) out.active_layout = activeLayoutOf(ch)
				return out
			})
		return { result }
	})
	route('GET', '/channels/:cid/preview', ({ params }) => {
		getChannel(params.cid)
		return { png: true }
	})
	// GET/PUT channel name: the "channel rename" feature (setChannelName) is removed, but this pair is
	// kept as a generic text-in/text-out endpoint that test/request.test.js exercises directly against
	// the request layer (result envelope unwrapping, 404, 400 on a bad body, and — via the softFail flag
	// below — a real Pearl quirk where the device answers HTTP 200 with a failing {status:'error', ...}
	// envelope instead of a non-2xx status) — see the mock's header comment
	route('GET', '/channels/:cid/name', ({ params }) => ({ result: getChannel(params.cid).name }))
	route('PUT', '/channels/:cid/name', ({ params, query, body }) => {
		const ch = getChannel(params.cid)
		if (flag(query.softFail)) return { envelopeError: `Channel '${ch.id}' rename rejected by device policy` }
		const name = query.name ?? body?.name
		if (typeof name !== 'string' || name.length < 1) throw badRequest('Missing channel name')
		ch.name = name
		return { result: name }
	})
	route('POST', '/channels/:cid/bookmarks', ({ params, query, body }) => {
		const ch = getChannel(params.cid)
		const text = query.text ?? body?.text
		if (typeof text !== 'string' || text.length === 0) throw badRequest('Missing bookmark text')
		const rec = state.recorders[ch.id]
		if (!rec || rec.status?.state !== 'started') throw conflict('The channel is not being recorded')
		ch.bookmarks = ch.bookmarks || []
		ch.bookmarks.push({ text, at: nowSec() })
		return { ok: true }
	})
	route('PUT', '/channels/:cid/layouts/active', ({ params, query, body }) => {
		const ch = getChannel(params.cid)
		const lid = query.id ?? body?.id
		if (lid === undefined || lid === null || lid === '') throw badRequest('Missing layout id')
		const layout = getLayout(ch, lid)
		for (const l of ch.layouts) l.active = l === layout
		return { ok: true }
	})

	// -- Legacy layouts (v1 only on a real device; served for both prefixes here)
	route('GET', '/channels/:cid/layouts', ({ params }) => ({
		result: getChannel(params.cid).layouts.map((l) => ({ id: l.id, name: l.name, active: l.active })),
	}))
	// undocumented (not part of the published OpenAPI spec), confirmed by Epiphan: renders the given
	// layout's own composition, whether or not it is the channel's active one
	route('GET', '/channels/:cid/layouts/:lid/preview', ({ params }) => {
		const ch = getChannel(params.cid)
		getLayout(ch, params.lid)
		return { png: true }
	})

	// -- Publishers
	route('GET', '/channels/:cid/publishers/type', ({ params }) => ({
		result: Object.values(getChannel(params.cid).publishers).map((p) => publicPublisher(p)),
	}))
	route('GET', '/channels/:cid/publishers/status', ({ params }) => ({
		result: Object.values(getChannel(params.cid).publishers).map((p) => ({
			id: p.id,
			type: p.type,
			status: p.status,
		})),
	}))
	route('POST', '/channels/:cid/publishers/control/:action', ({ params }) => {
		const ch = getChannel(params.cid)
		if (params.action === 'start') Object.values(ch.publishers).forEach(startPublisher)
		else if (params.action === 'stop') Object.values(ch.publishers).forEach(stopPublisher)
		else throw notFound(`Unknown publisher control '${params.action}'`)
		return { ok: true }
	})
	route('POST', '/channels/:cid/publishers/:pid/control/:action', ({ params }) => {
		const pub = getPublisher(params.cid, params.pid)
		if (params.action === 'start') startPublisher(pub)
		else if (params.action === 'stop') stopPublisher(pub)
		else throw notFound(`Unknown publisher control '${params.action}'`)
		return { ok: true }
	})
	// GET/PUT publisher name and settings (setPublisherName / setPublisherEnabled / setPublisherSingleTouch
	// / setRtmpDestination / setSrtDestination / patchPublisherSettings) are removed with those actions.
	// PATCH .../settings stays: test/request.test.js exercises the request layer's JSON-vs-string body
	// handling against it directly (independent of any action), and it is the shape `audio`-adjacent
	// PATCH .../settings calls use elsewhere in the target set (inputs, not publishers, but the same verb).
	route('PATCH', '/channels/:cid/publishers/:pid/settings', ({ params, body }) => {
		const pub = getPublisher(params.cid, params.pid)
		if (!isPlainObject(body)) throw badRequest('Publisher settings must be a JSON object')
		pub.settings = { ...deepMerge(pub.settings, body), type: pub.type }
		return { result: pub.settings }
	})

	// -- Inputs
	route('GET', '/inputs', ({ query }) => {
		const filter = idsFilter(query)
		const types = query.types
			? new Set(
					String(query.types)
						.split(',')
						.map((s) => s.trim()),
				)
			: null
		const result = Object.values(state.inputs)
			.filter((i) => !filter || filter.has(i.id))
			.filter((i) => !types || types.has(i.type))
			.map(({ id, name, real_device_name, audio, video, type }) => ({
				id,
				name,
				real_device_name,
				audio,
				video,
				type,
			}))
		return { result }
	})
	route('GET', '/inputs/:sid/preview', ({ params }) => {
		getInput(params.sid)
		return { png: true }
	})
	route('GET', '/inputs/:sid/settings', ({ params }) => {
		const input = getInput(params.sid)
		if (!input.settings) throw notAllowed('Input settings are not supported')
		return { result: input.settings }
	})
	route('PATCH', '/inputs/:sid/settings', ({ params, body }) => {
		const input = getInput(params.sid)
		if (!input.settings) throw notAllowed('Input settings are not supported')
		if (!isPlainObject(body)) throw badRequest('Input settings must be a JSON object')
		input.settings = deepMerge(input.settings, body)
		return { result: input.settings }
	})
	// legacy only: the VU-meter list of the Admin UI, every input with its status incl. audio levels in dBFS
	route('GET', '/sources/status', ({ v2 }) => {
		if (v2) throw notFound('Not found: GET /api/v2.0/sources/status')
		return { result: Object.values(state.inputs).map((input) => sourceStatus(state, input)) }
	})

	// -- Outputs
	route('GET', '/outputs', ({ query }) => {
		const filter = idsFilter(query)
		return {
			result: Object.values(state.outputs)
				.filter((o) => !filter || filter.has(o.id))
				.map(({ id, name }) => ({ id, name })),
		}
	})
	route('GET', '/outputs/:did/preview', ({ params }) => {
		getOutput(params.did)
		return { png: true }
	})
	route('PUT', '/outputs/:did/settings', ({ params, query, body }) => {
		const out = getOutput(params.did)
		const source = query.source ?? body?.source
		if (typeof source !== 'string' || source.length < 1) throw badRequest('Missing source parameter')
		out.source = source
		return { ok: true }
	})

	// -- Recorders
	route('GET', '/recorders', ({ query }) => {
		const filter = idsFilter(query)
		return {
			result: Object.values(state.recorders)
				.filter((r) => !filter || filter.has(r.id))
				.map(({ id, name, multisource }) => ({ id, name, multisource })),
		}
	})
	route('GET', '/recorders/status', ({ query }) => {
		const filter = idsFilter(query)
		return {
			result: Object.values(state.recorders)
				.filter((r) => !filter || filter.has(r.id))
				.map(({ id, name, status }) => ({ id, name, status })),
		}
	})
	route('POST', '/recorders/control/:action', ({ params, query, v2 }) => {
		// reset is legacy-only on a real device; v2.0 answers 404 so the action's own fallback retries
		// against the legacy base (see applyRecorderOp's comment)
		if (params.action === 'reset' && v2) throw notFound(`Not found: recorder reset is legacy-only`)
		const filter = idsFilter(query)
		const targets = Object.values(state.recorders).filter((r) => !filter || filter.has(r.id))
		for (const rec of targets) applyRecorderOp(rec, params.action)
		return { ok: true }
	})
	route('POST', '/recorders/:rid/control/:action', ({ params, v2 }) => {
		const rec = getRecorder(params.rid)
		if (params.action === 'reset' && v2) throw notFound(`Not found: recorder reset is legacy-only`)
		// legacy reset closes the current file and starts a new one when recording
		applyRecorderOp(rec, params.action)
		return { ok: true }
	})
	// -- Schedule / events
	route('GET', '/schedule/events', ({ query }) => {
		let list = [...state.events]
		if (query.status) list = list.filter((e) => e.status === query.status)
		if (query.from) {
			const from = Math.floor(new Date(query.from).getTime() / 1000)
			if (Number.isFinite(from)) list = list.filter((e) => e.start >= from)
		}
		if (query.to) {
			const to = Math.floor(new Date(query.to).getTime() / 1000)
			if (Number.isFinite(to)) list = list.filter((e) => e.finish <= to)
		}
		list.sort((a, b) => a.start - b.start)
		if (query.limit !== undefined) list = list.slice(0, Math.max(0, parseInt(query.limit, 10) || 0))
		return { result: list }
	})
	// alias routes must be registered before the generic :eventId route
	for (const alias of EVENT_ALIASES) {
		route('GET', `/schedule/events/${alias}`, () => ({ result: resolveEvent(alias) }))
	}
	route('GET', '/schedule/events/:eventId', ({ params }) => ({ result: resolveEvent(params.eventId) }))
	route('POST', '/schedule/events/:eventId/control/:action', ({ params, body }) => {
		const ev = resolveEvent(params.eventId)
		eventControl(ev, params.action, body)
		return { ok: true }
	})

	// -- System
	route('GET', '/system/status', () => ({ result: state.systemStatus }))
	route('GET', '/system/firmware', () => ({ result: state.firmware }))
	route('GET', '/system/firmware/version', () => ({ result: state.firmware.version }))
	route('GET', '/system/ident', () => ({ result: state.identity }))
	route('POST', '/system/control/:command', ({ params }) => {
		if (!['reboot', 'shutdown', 'factoryreset'].includes(params.command)) {
			throw notFound(`Unknown system control '${params.command}'`)
		}
		state.control.lastCommand = params.command
		return { ok: true }
	})
	route('GET', '/system/singletouchcontrol', () => ({
		result: Object.keys(state.singleTouch).map((id) => ({ id })),
	}))
	route('GET', '/system/singletouchcontrol/:stcid/state', ({ params }) => ({
		result: getSingleTouch(params.stcid),
	}))
	route('POST', '/system/singletouchcontrol/:stcid/control/toggle', ({ params }) => {
		const stc = getSingleTouch(params.stcid)
		stc.pressed = !stc.pressed
		stc.recorders.active = stc.pressed ? stc.recorders.total : 0
		stc.publishers.active = stc.pressed ? stc.publishers.total : 0
		stc.status = true
		return { ok: true }
	})
	route('GET', '/system/presets', ({ query }) => ({ result: state.presets.map((p) => presetView(p, query)) }))
	route('POST', '/system/presets/:pid/control/apply', ({ params, body }) => {
		const preset = getPreset(params.pid)
		const sections =
			Array.isArray(body?.sections) && body.sections.length > 0 ? body.sections : [...PRESET_SECTIONS]
		state.appliedPresets.push({ name: preset.name, sections })
		const reboot = sections.includes('system') || sections.includes('network') || sections.includes('all')
		return { result: { reboot } }
	})
	route('GET', '/system/storages', () => ({ result: Object.keys(state.storages).map((id) => ({ id })) }))
	route('GET', '/system/storages/:stid/status', ({ params }) => ({ result: getStorage(params.stid) }))
	route('POST', '/system/storages/:stid/control/eject', ({ params }) => {
		const st = getStorage(params.stid)
		if (params.stid === 'main') throw notAllowed("Storage 'main' does not support eject")
		st.state = 'nodev'
		delete st.media_type
		delete st.total
		delete st.free
		state.control.ejected.push(params.stid)
		return { ok: true }
	})
	// ---- dispatch ---------------------------------------------------------

	function findRoute(method, restPath) {
		let pathMatched = false
		for (const r of routes) {
			const m = r.re.exec(restPath)
			if (!m) continue
			pathMatched = true
			if (r.method !== method) continue
			const params = {}
			r.keys.forEach((k, i) => (params[k] = decodeURIComponent(m[i + 1])))
			return { route: r, params }
		}
		return { route: null, pathMatched }
	}

	function sendJson(res, code, payload) {
		const data = Buffer.from(JSON.stringify(payload))
		res.writeHead(code, { 'Content-Type': 'application/json', 'Content-Length': data.length })
		res.end(data)
	}

	function sendError(res, err) {
		if (err instanceof HttpError) {
			sendJson(res, err.code, { status: err.apiStatus, message: err.message })
		} else {
			sendJson(res, 500, {
				status: 'internalservererror',
				message: err && err.message ? err.message : String(err),
			})
		}
	}

	// GET /admin/channel{cid}/get_params.cgi?title&author&rec_prefix: the content-metadata feature this
	// once backed (getContentMetadata/setContentMetadata, fetchMetadata) is removed along with set_params,
	// but this read is kept as a real text/plain endpoint test/request.test.js exercises the request
	// layer's base:'raw'/text:true handling against — see the mock's header comment.
	function handleAdmin(req, res, url, query) {
		const m = /^\/admin\/channel([^/]+)\/get_params\.cgi$/.exec(url.pathname)
		if (!m) return false
		const channel = state.channels[m[1]]
		if (!channel) {
			res.writeHead(404, { 'Content-Type': 'text/plain' })
			res.end('Channel not found')
			return true
		}
		const keys = Object.keys(query).filter((k) => k in channel.metadata)
		const wanted = keys.length > 0 ? keys : ['title', 'author', 'rec_prefix']
		const text = wanted.map((k) => `${k} = ${channel.metadata[k] ?? ''}`).join('\n') + '\n'
		res.writeHead(200, { 'Content-Type': 'text/plain', 'Content-Length': Buffer.byteLength(text) })
		res.end(text)
		return true
	}

	/** one-shot failures queued by failNext(), consumed by the first matching request (tests of error paths) */
	const injectedFailures = []
	const takeInjectedFailure = (method, path) => {
		const i = injectedFailures.findIndex(
			(f) => f.method === method && (f.path instanceof RegExp ? f.path.test(path) : f.path === path),
		)
		return i < 0 ? undefined : injectedFailures.splice(i, 1)[0]
	}

	const handler = (req, res) => {
		const chunks = []
		req.on('data', (c) => chunks.push(c))
		req.on('end', () => {
			res.setHeader('Date', new Date(Date.now() + clock.skewMs).toUTCString())
			const url = new URL(req.url, 'http://localhost')
			const query = Object.fromEntries(url.searchParams)
			const rawBody = Buffer.concat(chunks).toString('utf8')
			let body = null
			if (rawBody.length > 0) {
				try {
					body = JSON.parse(rawBody)
				} catch {
					body = null
				}
			}
			const record = { method: req.method, path: url.pathname, query, body, headers: { ...req.headers } }
			if (rawBody.length > 0 && body === null) record.rawBody = rawBody
			requests.push(record)

			try {
				if (!req.headers.authorization) {
					res.writeHead(401, {
						'Content-Type': 'application/json',
						'WWW-Authenticate': 'Basic realm="Pearl"',
					})
					res.end(JSON.stringify({ status: 'unauthorized', message: 'Authentication required' }))
					return
				}

				const injected = takeInjectedFailure(req.method, url.pathname)
				if (injected) {
					res.writeHead(injected.status, { 'Content-Type': 'application/json' })
					res.end(JSON.stringify(injected.body))
					return
				}

				if (url.pathname.startsWith('/admin/')) {
					if (handleAdmin(req, res, url, query)) return
					throw notFound(`Not found: ${req.method} ${url.pathname}`)
				}

				let v2 = false
				let rest
				if (url.pathname === '/api/v2.0' || url.pathname.startsWith('/api/v2.0/')) {
					v2 = true
					rest = url.pathname.slice('/api/v2.0'.length) || '/'
				} else if (url.pathname === '/api' || url.pathname.startsWith('/api/')) {
					rest = url.pathname.slice('/api'.length) || '/'
				} else {
					throw notFound(`Not found: ${req.method} ${url.pathname}`)
				}
				if (rest.length > 1 && rest.endsWith('/')) rest = rest.slice(0, -1)

				if (legacyOnly && v2) throw notFound(`Not found: ${req.method} ${url.pathname}`)

				const { route: matched, params, pathMatched } = findRoute(req.method, rest)
				if (!matched) {
					if (pathMatched) throw notAllowed(`Method ${req.method} not allowed for ${url.pathname}`)
					throw notFound(`Not found: ${req.method} ${url.pathname}`)
				}

				const out = matched.handler({ params, query, body, v2, req }) || { ok: true }
				if (out.png) {
					res.writeHead(200, { 'Content-Type': 'image/png', 'Content-Length': PNG_1X1.length })
					res.end(PNG_1X1)
				} else if (typeof out.text === 'string') {
					res.writeHead(200, { 'Content-Type': 'text/plain', 'Content-Length': Buffer.byteLength(out.text) })
					res.end(out.text)
				} else if (out.octet) {
					res.writeHead(200, {
						'Content-Type': 'application/octet-stream',
						'Content-Length': out.octet.length,
					})
					res.end(out.octet)
				} else if (out.envelopeError) {
					sendJson(res, out.code || 200, {
						status: out.envelopeStatus || 'error',
						message: out.envelopeError,
					})
				} else if ('result' in out) {
					sendJson(res, out.code || 200, { status: 'ok', result: out.result })
				} else {
					sendJson(res, out.code || 200, { status: 'ok' })
				}
			} catch (err) {
				sendError(res, err)
			}
		})
	}
	const server = useHttps
		? https.createServer({ key: fs.readFileSync(TLS_KEY_PATH), cert: fs.readFileSync(TLS_CERT_PATH) }, handler)
		: http.createServer(handler)

	await new Promise((resolve, reject) => {
		server.once('error', reject)
		server.listen(port, '127.0.0.1', () => {
			server.off('error', reject)
			resolve()
		})
	})
	const actualPort = server.address().port

	return {
		url: `${useHttps ? 'https' : 'http'}://127.0.0.1:${actualPort}`,
		port: actualPort,
		https: useHttps,
		state,
		requests,
		server,
		reset,
		/** Answer the next `method path` (full pathname string or RegExp) with `status` and `body` instead of the route */
		failNext(method, path, status, body = { status: 'error', message: 'injected failure' }) {
			injectedFailures.push({ method, path, status, body })
		},
		setClockSkew(ms) {
			clock.skewMs = Number(ms) || 0
		},
		close() {
			return new Promise((resolve) => {
				if (typeof server.closeAllConnections === 'function') server.closeAllConnections()
				server.close(() => resolve())
			})
		},
	}
}

module.exports = { startMockPearl, seedState, PNG_1X1, deepMerge }
