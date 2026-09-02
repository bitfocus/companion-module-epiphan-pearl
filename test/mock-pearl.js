/**
 * In-memory HTTP mock of an Epiphan Pearl device.
 *
 * Serves the REST API v2.0 endpoints used by the module (see doc/pearl-api-v2.0.yaml) under both
 * `/api/v2.0/...` and the legacy `/api/...` prefix, the legacy-only endpoints listed in
 * doc/ARCHITECTURE.md, and the `/admin/channelN/{get,set}_params.cgi` metadata CGIs.
 *
 * No dependencies beyond node:http / node:zlib.
 *
 * Usage:
 *   const { startMockPearl } = require('./mock-pearl')
 *   const mock = await startMockPearl({ firmware: '4.24.1', legacyOnly: false })
 *   mock.url        // 'http://127.0.0.1:<port>'
 *   mock.port
 *   mock.state      // live, mutable model (see seedState)
 *   mock.requests   // [{ method, path, query, body, headers }]
 *   mock.reset()    // reseed state (and clear requests)
 *   await mock.close()
 */
const http = require('node:http')
const zlib = require('node:zlib')

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

const NETWORK_INPUT_TYPES = ['rtsp', 'srt', 'ndi', 'web-graphics', 'dante']
const NETWORK_INPUT_PREFIX = { rtsp: 'RTSP', srt: 'SRT', ndi: 'NDI', 'web-graphics': 'WEBG', dante: 'DANTE' }
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

function layoutSettings(name, sources) {
	return {
		name,
		video: sources.map((sid, i) => ({
			source: sid,
			settings: {
				crop: {},
				position: { left: `${i * 50}%`, top: '0%', width: '50%', height: '50%', keep_aspect_ratio: true },
			},
		})),
		audio: [{ source: 'analog-a', settings: { volume: 100 } }],
		background: '#000000',
		nosignal: { id: 'default' },
	}
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
				layoutSettings: {
					1: layoutSettings('Default', ['hdmi-a']),
					2: layoutSettings('Picture in picture', ['hdmi-a', 'USBA']),
				},
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
				layoutSettings: { 1: layoutSettings('Default', ['hdmi-a', 'USBA']) },
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
		archive: {
			1: [
				{
					id: 'VGA.1733956350.HDMI-A.mp4',
					name: 'HDMI-A_Dec11_17-32-30',
					extension: 'mp4',
					recording: false,
					downloaded: false,
					created: '2024-12-11T17:32:30-0500',
					duration: 1040,
					size: 407160404,
					recorder: '1',
					uploading: false,
					event_id: '',
				},
				{
					id: 'VGA.1733871268.HDMI-A.mp4',
					name: 'HDMI-A_Dec10_17-54-28',
					extension: 'mp4',
					recording: false,
					downloaded: false,
					created: '2024-12-10T17:54:28-0500',
					duration: 309,
					size: 120487978,
					recorder: '1',
					uploading: false,
					event_id: '4f5d44e94be94dd8ba850feb78718893',
				},
			],
			2: [],
			m1: [],
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
		storageTransfer: {
			external: { state: 'nomedia' },
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
		adhocSession: null,
		connectivity: {
			external_ip: '174.115.41.91',
			mdns: 'GSAA495529',
			dns: 'ok',
			http: 'ok',
			https: 'ok',
			captive_portal: 'ok',
			icmp: 'error',
			epiphan_edge: 'ok',
			vtun: 'disabled',
		},
		speedtest: { bandwidth: 91318568, bitrate_limit: 1000000000, duration: 10, udpLoss: 0 },
		control: { lastCommand: null, ejected: [] },
		counters: { publisher: 2, input: { RTSP: 0, SRT: 1, NDI: 0, WEBG: 0, DANTE: 0 }, event: 0 },
	}
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

function detectPublisherType(settings) {
	if (settings && typeof settings.type === 'string') return settings.type
	const keyToType = {
		rtmp: 'rtmp',
		rtsp: 'rtsp',
		srt: 'srt',
		hls: 'hls',
		ndi: 'ndi',
		mpegts_udp: 'mpegts-udp',
		mpegts_rtp: 'mpegts-rtp',
		rtp_udp: 'rtp-udp',
	}
	for (const [k, t] of Object.entries(keyToType)) if (settings && settings[k]) return t
	return 'rtmp'
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
 * @returns {Promise<{url:string, port:number, state:object, requests:object[], reset:Function, close:Function, server:import('node:http').Server}>}
 */
async function startMockPearl({ firmware = '4.24.1', legacyOnly = false, port = 0 } = {}) {
	const state = seedState(firmware)
	const requests = []

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
	const getAfu = (aid) => {
		const afu = state.afu.find((a) => a.id === aid)
		if (!afu) throw notFound(`AFU destination '${aid}' not found`)
		return afu
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

	const routes = []
	const route = (method, pattern, handler) => routes.push({ method, pattern, ...compile(pattern), handler })

	// -- AFU
	route('GET', '/afu', () => ({ result: state.afu.map((a) => ({ id: a.id })) }))
	route('GET', '/afu/status', () => ({ result: state.afu }))
	route('GET', '/afu/:aid/status', ({ params }) => ({ result: getAfu(params.aid).status }))

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
	route('GET', '/channels/:cid/name', ({ params }) => ({ result: getChannel(params.cid).name }))
	route('PUT', '/channels/:cid/name', ({ params, query, body }) => {
		const ch = getChannel(params.cid)
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
	route('GET', '/channels/:cid/layouts/:lid/settings', ({ params }) => {
		const ch = getChannel(params.cid)
		getLayout(ch, params.lid)
		return { result: ch.layoutSettings[params.lid] ?? {} }
	})
	route('PUT', '/channels/:cid/layouts/:lid/settings', ({ params, body }) => {
		const ch = getChannel(params.cid)
		const layout = getLayout(ch, params.lid)
		if (!isPlainObject(body)) throw badRequest('Layout settings must be a JSON object')
		ch.layoutSettings[params.lid] = body
		if (typeof body.name === 'string' && body.name) layout.name = body.name
		return { ok: true }
	})
	// undocumented (not part of the published OpenAPI spec), confirmed by Epiphan: renders the given
	// layout's own composition, whether or not it is the channel's active one
	route('GET', '/channels/:cid/layouts/:lid/preview', ({ params }) => {
		const ch = getChannel(params.cid)
		getLayout(ch, params.lid)
		return { png: true }
	})

	// -- Publishers
	route('GET', '/channels/:cid/publishers', ({ params }) => ({
		result: Object.values(getChannel(params.cid).publishers).map((p) => publicPublisher(p)),
	}))
	route('POST', '/channels/:cid/publishers', ({ params, body }) => {
		const ch = getChannel(params.cid)
		if (!isPlainObject(body) || !isPlainObject(body.settings)) throw badRequest('Missing publisher settings')
		const id = String(state.counters.publisher++)
		const type = detectPublisherType(body.settings)
		const settings = { ...body.settings, type }
		if (!isPlainObject(settings.common)) settings.common = { enabled: false, single_touch: false }
		const name = typeof body.name === 'string' && body.name ? body.name : `Stream ${Number(id) + 1}`
		ch.publishers[id] = {
			id,
			type,
			name,
			status: { is_configured: true, started: false, state: 'stopped' },
			settings,
		}
		return { code: 201, result: { id, name, settings } }
	})
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
	route('DELETE', '/channels/:cid/publishers/:pid', ({ params }) => {
		getPublisher(params.cid, params.pid)
		delete state.channels[params.cid].publishers[params.pid]
		return { ok: true }
	})
	route('POST', '/channels/:cid/publishers/:pid/control/:action', ({ params }) => {
		const pub = getPublisher(params.cid, params.pid)
		if (params.action === 'start') startPublisher(pub)
		else if (params.action === 'stop') stopPublisher(pub)
		else throw notFound(`Unknown publisher control '${params.action}'`)
		return { ok: true }
	})
	route('GET', '/channels/:cid/publishers/:pid/type', ({ params }) => ({
		result: getPublisher(params.cid, params.pid).type,
	}))
	route('GET', '/channels/:cid/publishers/:pid/name', ({ params }) => ({
		result: getPublisher(params.cid, params.pid).name,
	}))
	route('PUT', '/channels/:cid/publishers/:pid/name', ({ params, query, body }) => {
		const pub = getPublisher(params.cid, params.pid)
		const name = query.name ?? body?.name
		if (typeof name !== 'string' || name.length < 1) throw badRequest('Missing publisher name')
		pub.name = name
		return { result: name }
	})
	route('GET', '/channels/:cid/publishers/:pid/status', ({ params }) => ({
		result: getPublisher(params.cid, params.pid).status,
	}))
	route('GET', '/channels/:cid/publishers/:pid/settings', ({ params }) => ({
		result: getPublisher(params.cid, params.pid).settings,
	}))
	route('PUT', '/channels/:cid/publishers/:pid/settings', ({ params, body }) => {
		const pub = getPublisher(params.cid, params.pid)
		if (!isPlainObject(body)) throw badRequest('Publisher settings must be a JSON object')
		pub.settings = { ...body, type: pub.type }
		return { result: pub.settings }
	})
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
	route('POST', '/inputs', ({ body }) => {
		if (!isPlainObject(body) || typeof body.type !== 'string') throw badRequest('Missing input type')
		if (!NETWORK_INPUT_TYPES.includes(body.type)) throw notAllowed('Input type is not allowed')
		const prefix = NETWORK_INPUT_PREFIX[body.type]
		const n = (state.counters.input[prefix] = (state.counters.input[prefix] || 0) + 1)
		const id = `${prefix}${n}`
		const name = typeof body.name === 'string' && body.name ? body.name : `${prefix} ${n}`
		state.inputs[id] = {
			id,
			name,
			real_device_name: name,
			audio: body.type !== 'web-graphics',
			video: body.type !== 'dante',
			type: body.type,
			settings: isPlainObject(body.settings) ? body.settings : {},
		}
		return { code: 201, result: id }
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
	route('PUT', '/inputs/:sid/settings', ({ params, body }) => {
		const input = getInput(params.sid)
		if (!input.settings) throw notAllowed('Input settings are not supported')
		if (!isPlainObject(body)) throw badRequest('Input settings must be a JSON object')
		input.settings = body
		return { result: input.settings }
	})
	route('PATCH', '/inputs/:sid/settings', ({ params, body }) => {
		const input = getInput(params.sid)
		if (!input.settings) throw notAllowed('Input settings are not supported')
		if (!isPlainObject(body)) throw badRequest('Input settings must be a JSON object')
		input.settings = deepMerge(input.settings, body)
		return { result: input.settings }
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
	route('POST', '/recorders/control/:action', ({ params, query }) => {
		const filter = idsFilter(query)
		const targets = Object.values(state.recorders).filter((r) => !filter || filter.has(r.id))
		if (params.action === 'start') targets.forEach(startRecorder)
		else if (params.action === 'stop') targets.forEach(stopRecorder)
		else throw notFound(`Unknown recorder control '${params.action}'`)
		return { ok: true }
	})
	route('POST', '/recorders/:rid/control/:action', ({ params }) => {
		const rec = getRecorder(params.rid)
		if (params.action === 'start') startRecorder(rec)
		else if (params.action === 'stop') stopRecorder(rec)
		else if (params.action === 'reset') {
			// legacy: closes the current file and starts a new one when recording
			if (rec.status?.state === 'started') rec.status = { ...rec.status, duration: 0 }
		} else throw notFound(`Unknown recorder control '${params.action}'`)
		return { ok: true }
	})
	route('GET', '/recorders/:rid/status', ({ params }) => ({ result: getRecorder(params.rid).status }))
	route('GET', '/recorders/:rid/archive/files', ({ params, query }) => {
		getRecorder(params.rid)
		const files = state.archive[params.rid] || []
		const from = query.from !== undefined ? Math.max(0, parseInt(query.from, 10) || 0) : 0
		const limit = query.limit !== undefined ? Math.max(0, parseInt(query.limit, 10) || 0) : files.length
		return { result: files.slice(from, from + limit) }
	})
	route('GET', '/recorders/:rid/archive/files/:fid', ({ params }) => {
		getRecorder(params.rid)
		const file = (state.archive[params.rid] || []).find((f) => f.id === params.fid)
		if (!file) throw notFound('File not found')
		return { octet: Buffer.from(`mock file ${file.id}`) }
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
	route('POST', '/schedule/events', ({ body }) => {
		if (!isPlainObject(body)) throw badRequest('Missing event description')
		const now = nowSec()
		const n = ++state.counters.event
		const ev = {
			id: `adhoc${String(n).padStart(4, '0')}`,
			status: 'scheduled',
			title: typeof body.title === 'string' && body.title ? body.title : `Ad-hoc event ${n}`,
			start: Number.isFinite(Number(body.start)) ? Number(body.start) : now,
			finish: Number.isFinite(Number(body.finish)) ? Number(body.finish) : now + 3600,
			recorders: Array.isArray(body.recorders) ? body.recorders : [],
			streams: Array.isArray(body.streams) ? body.streams : [],
			tags: typeof body.tags === 'string' ? body.tags : '',
		}
		if (ev.finish <= ev.start) throw badRequest('Event finish must be after start')
		state.events.push(ev)
		return { code: 201, result: ev }
	})
	route('GET', '/schedule/events/adhoc/session', () => {
		if (!state.adhocSession) throw notFound('No active ad-hoc session')
		return { result: state.adhocSession }
	})
	route('POST', '/schedule/events/adhoc/session', ({ body }) => {
		if (!isPlainObject(body) || typeof body.id !== 'string' || !body.id) throw badRequest('Missing credentials')
		state.adhocSession = { id: body.id, name: body.id, expires: nowSec() + 3600 }
		return { result: state.adhocSession }
	})
	route('DELETE', '/schedule/events/adhoc/session', () => {
		state.adhocSession = null
		return { ok: true }
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
	route('GET', '/system/firmware/revision', () => ({ result: state.firmware.revision }))
	route('GET', '/system/firmware/product_id', () => ({ result: state.firmware.product_id }))
	route('GET', '/system/firmware/product_name', () => ({ result: state.firmware.product_name }))
	route('GET', '/system/ident', () => ({ result: state.identity }))
	route('POST', '/system/control/:command', ({ params }) => {
		if (!['reboot', 'shutdown', 'factoryreset'].includes(params.command)) {
			throw notFound(`Unknown system control '${params.command}'`)
		}
		state.control.lastCommand = params.command
		return { ok: true }
	})
	route('GET', '/system/connectivity/details', () => ({ result: state.connectivity }))
	route('GET', '/system/connectivity/tools/speedtest', ({ query }) => {
		const mode = query.mode ?? 'uplink'
		const protocol = query.protocol ?? 'tcp'
		if (!['uplink', 'downlink'].includes(mode)) throw badRequest('Invalid mode parameter')
		if (!['tcp', 'udp'].includes(protocol)) throw badRequest('Invalid protocol parameter')
		const timeout = query.timeout !== undefined ? parseInt(query.timeout, 10) : 30
		if (!Number.isFinite(timeout) || timeout < 1) throw badRequest('Invalid timeout parameter')
		const result = {
			protocol,
			mode,
			bandwidth: state.speedtest.bandwidth,
			bitrate_limit: state.speedtest.bitrate_limit,
			duration: Math.min(timeout, state.speedtest.duration),
		}
		if (protocol === 'udp') result.udp = { loss: state.speedtest.udpLoss }
		return { result }
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
	route('GET', '/system/storages/:stid/transfer/status', ({ params, query }) => {
		const st = getStorage(params.stid)
		if (params.stid === 'main') throw notAllowed("Storage 'main' does not support transfer")
		const result = { ...(state.storageTransfer[params.stid] || { state: 'disabled' }) }
		if (flag(query.storage)) result.storage = st
		return { result }
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

	function handleAdmin(req, res, url, query) {
		// /admin/channel{cid}/get_params.cgi?title&author&rec_prefix
		// /admin/channel{cid}/set_params.cgi?title=..&author=..&rec_prefix=..
		const m = /^\/admin\/channel([^/]+)\/(get_params|set_params)\.cgi$/.exec(url.pathname)
		if (!m) return false
		const channel = state.channels[m[1]]
		if (!channel) {
			res.writeHead(404, { 'Content-Type': 'text/plain' })
			res.end('Channel not found')
			return true
		}
		if (m[2] === 'set_params') {
			for (const key of ['title', 'author', 'rec_prefix']) {
				if (query[key] !== undefined) channel.metadata[key] = query[key]
			}
			res.writeHead(200, { 'Content-Type': 'text/plain' })
			res.end('')
			return true
		}
		const keys = Object.keys(query).filter((k) => k in channel.metadata)
		const wanted = keys.length > 0 ? keys : ['title', 'author', 'rec_prefix']
		const text = wanted.map((k) => `${k} = ${channel.metadata[k] ?? ''}`).join('\n') + '\n'
		res.writeHead(200, { 'Content-Type': 'text/plain', 'Content-Length': Buffer.byteLength(text) })
		res.end(text)
		return true
	}

	const server = http.createServer((req, res) => {
		const chunks = []
		req.on('data', (c) => chunks.push(c))
		req.on('end', () => {
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
				} else if ('result' in out) {
					sendJson(res, out.code || 200, { status: 'ok', result: out.result })
				} else {
					sendJson(res, out.code || 200, { status: 'ok' })
				}
			} catch (err) {
				sendError(res, err)
			}
		})
	})

	await new Promise((resolve, reject) => {
		server.once('error', reject)
		server.listen(port, '127.0.0.1', () => {
			server.off('error', reject)
			resolve()
		})
	})
	const actualPort = server.address().port

	return {
		url: `http://127.0.0.1:${actualPort}`,
		port: actualPort,
		state,
		requests,
		server,
		reset,
		close() {
			return new Promise((resolve) => {
				if (typeof server.closeAllConnections === 'function') server.closeAllConnections()
				server.close(() => resolve())
			})
		},
	}
}

module.exports = { startMockPearl, seedState, PNG_1X1, deepMerge }
