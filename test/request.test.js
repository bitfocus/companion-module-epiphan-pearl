const { describe, it, before, after } = require('node:test')
const assert = require('node:assert/strict')
const net = require('node:net')

const { createInstance, InstanceStatus, DEFAULT_CONFIG } = require('./harness')
const { startMockPearl } = require('./mock-pearl')

describe('request layer', () => {
	let mock
	let instance
	let PearlApiError

	before(async () => {
		mock = await startMockPearl()
		instance = await createInstance({ mock })
		// the harness installs the stub before src is loaded, so requiring src here is safe
		PearlApiError = require('../src/instance').PearlApiError
		assert.equal(instance.currentStatus, InstanceStatus.Ok)
	})

	after(async () => {
		await instance.destroy()
		await mock.close()
	})

	it('returns the result field of the envelope', async () => {
		const name = await instance.request('GET', '/channels/1/name')
		assert.equal(name, 'HDMI-A')
		const list = await instance.request('GET', '/recorders')
		assert.ok(Array.isArray(list))
	})

	it('returns true for an ok envelope without result', async () => {
		const result = await instance.request('POST', '/channels/1/publishers/0/control/stop')
		assert.equal(result, true)
	})

	it('a device clock in step with the host leaves the clock offset at 0', () => {
		assert.equal(instance.clockOffsetMs, 0)
		assert.ok(Math.abs(instance.deviceNow() - Date.now()) < 50)
	})

	it('uses plain http and the configured port by default', () => {
		assert.equal(instance.config.use_https, false)
		assert.equal(instance.config.accept_self_signed, true)
		assert.match(mock.url, /^http:/)
		assert.ok(instance.dispatcher, 'an undici Agent exists for the configuration')
	})

	it('strips a leading /api or /api/v2.0 and honours base v1 / raw', async () => {
		mock.requests.length = 0
		await instance.request('GET', '/api/channels')
		await instance.request('GET', '/api/v2.0/recorders')
		await instance.request('GET', '/channels/1/layouts', { base: 'v1' })
		await instance.request('GET', '/api/v2.0/system/status', { base: 'raw' })
		await instance.request('GET', 'recorders/status')
		assert.deepEqual(
			mock.requests.map((r) => r.path),
			[
				'/api/v2.0/channels',
				'/api/v2.0/recorders',
				'/api/channels/1/layouts',
				'/api/v2.0/system/status',
				'/api/v2.0/recorders/status',
			],
		)
	})

	it('encodes query values and skips undefined', async () => {
		mock.requests.length = 0
		await instance.request('GET', '/channels', { query: { publishers: true, ids: '1,2', x: undefined, n: 5 } })
		assert.deepEqual(mock.requests[0].query, { publishers: 'true', ids: '1,2', n: '5' })
	})

	it('sends JSON bodies with the content type, and string bodies verbatim', async () => {
		mock.requests.length = 0
		await instance.request('PATCH', '/channels/1/publishers/0/settings', { body: { common: { enabled: true } } })
		assert.equal(mock.requests[0].headers['content-type'], 'application/json')
		assert.deepEqual(mock.requests[0].body, { common: { enabled: true } })
		await instance.request('PATCH', '/channels/1/publishers/0/settings', { body: '{"common":{"enabled":false}}' })
		assert.deepEqual(mock.requests[1].body, { common: { enabled: false } })
		// GET never sends a body
		await instance.request('GET', '/channels', { body: { ignored: true } })
		assert.equal(mock.requests[2].body, null)
		assert.equal(mock.requests[2].headers['content-type'], undefined)
	})

	it('404 on a non-optional request throws PearlApiError and keeps the status Ok', async () => {
		instance.calls.log.length = 0
		instance.calls.status.length = 0
		await assert.rejects(instance.request('GET', '/channels/99/name'), (err) => {
			assert.ok(err instanceof PearlApiError)
			assert.equal(err.name, 'PearlApiError')
			assert.equal(err.status, 404)
			assert.equal(err.apiStatus, 'notfound')
			assert.equal(err.method, 'GET')
			assert.equal(err.path, '/channels/99/name')
			assert.match(err.message, /channel '99' not found/)
			return true
		})
		assert.equal(instance.currentStatus, InstanceStatus.Ok)
		assert.equal(instance.calls.status.length, 0, 'no status change reported')
		assert.equal(instance.calls.log.filter((l) => l.level === 'error').length, 1)
	})

	it('an HTTP 200 with a failing envelope throws PearlApiError and keeps the status Ok', async () => {
		instance.calls.log.length = 0
		instance.calls.status.length = 0
		await assert.rejects(instance.request('PUT', '/channels/1/name', { query: { softFail: true } }), (err) => {
			assert.ok(err instanceof PearlApiError)
			assert.equal(err.name, 'PearlApiError')
			assert.equal(err.status, 200)
			assert.equal(err.apiStatus, 'error')
			assert.equal(err.method, 'PUT')
			assert.equal(err.path, '/channels/1/name')
			assert.match(err.message, /rename rejected by device policy/)
			return true
		})
		assert.equal(instance.currentStatus, InstanceStatus.Ok)
		assert.equal(instance.calls.status.length, 0, 'no status change reported')
		assert.equal(instance.calls.log.filter((l) => l.level === 'error').length, 1)
	})

	it('silent suppresses the error log', async () => {
		instance.calls.log.length = 0
		await assert.rejects(instance.request('GET', '/channels/99/name', { silent: true }))
		assert.equal(instance.calls.log.filter((l) => l.level === 'error').length, 0)
	})

	it('optional returns null on 404 and 405', async () => {
		assert.equal(await instance.request('GET', '/channels/99/name', { optional: true }), null)
		assert.equal(await instance.request('GET', '/schedule/events/ongoing', { optional: true }), null)
		assert.equal(await instance.request('GET', '/inputs/hdmi-a/settings', { optional: true }), null)
		assert.equal(instance.currentStatus, InstanceStatus.Ok)
	})

	it('optional does not swallow other errors', async () => {
		await assert.rejects(instance.request('PUT', '/channels/1/name', { optional: true }), (err) => {
			assert.equal(err.status, 400)
			assert.equal(err.apiStatus, 'badrequest')
			return true
		})
	})

	it('a 409 from the device is a PearlApiError with the device message', async () => {
		await assert.rejects(instance.request('POST', '/channels/2/bookmarks', { query: { text: 'x' } }), (err) => {
			assert.equal(err.status, 409)
			assert.equal(err.apiStatus, 'conflict')
			assert.match(err.message, /not being recorded/)
			return true
		})
	})

	it('raw returns a Buffer and text returns a string', async () => {
		const png = await instance.request('GET', '/channels/1/preview', { raw: true, query: { format: 'png' } })
		assert.ok(Buffer.isBuffer(png))
		assert.equal(png.readUInt32BE(0), 0x89504e47)
		const text = await instance.request('GET', '/admin/channel1/get_params.cgi?title', { base: 'raw', text: true })
		assert.equal(typeof text, 'string')
		assert.match(text, /title = Morning Show/)
	})

	it('a timeout reports ConnectionFailure and throws with status 0', async () => {
		const sockets = new Set()
		const dead = net.createServer((socket) => {
			// accept the connection and never answer
			sockets.add(socket)
			socket.on('close', () => sockets.delete(socket))
		})
		await new Promise((resolve) => dead.listen(0, '127.0.0.1', resolve))
		const deadPort = dead.address().port
		const realPort = instance.config.host_port
		instance.config.host_port = String(deadPort)
		instance.calls.status.length = 0
		try {
			const started = Date.now()
			await assert.rejects(instance.request('GET', '/channels', { timeout: 300 }), (err) => {
				assert.ok(err instanceof PearlApiError)
				assert.equal(err.status, 0)
				assert.match(err.message, /timed out after 300 ms/)
				return true
			})
			assert.ok(Date.now() - started < 2000)
			assert.equal(instance.currentStatus, InstanceStatus.ConnectionFailure)
			assert.equal(instance.calls.status[0].status, InstanceStatus.ConnectionFailure)
		} finally {
			instance.config.host_port = realPort
			for (const socket of sockets) socket.destroy()
			await new Promise((resolve) => dead.close(resolve))
		}
		// back to normal on the next successful request
		await instance.request('GET', '/channels')
		assert.equal(instance.currentStatus, InstanceStatus.Ok)
	})

	it('a refused connection reports ConnectionFailure', async () => {
		const probe = net.createServer()
		await new Promise((resolve) => probe.listen(0, '127.0.0.1', resolve))
		const freePort = probe.address().port
		await new Promise((resolve) => probe.close(resolve))

		const realPort = instance.config.host_port
		instance.config.host_port = String(freePort)
		try {
			await assert.rejects(instance.request('GET', '/channels'), (err) => err.status === 0)
			assert.equal(instance.currentStatus, InstanceStatus.ConnectionFailure)
		} finally {
			instance.config.host_port = realPort
		}
		await instance.request('GET', '/channels')
		assert.equal(instance.currentStatus, InstanceStatus.Ok)
	})

	it('sendRequest is a compatibility wrapper', async () => {
		mock.requests.length = 0
		await instance.sendRequest('put', '/api/channels/1/name?name=Compat')
		assert.equal(mock.requests[0].method, 'PUT')
		assert.equal(mock.requests[0].path, '/api/v2.0/channels/1/name')
		assert.equal(mock.state.channels['1'].name, 'Compat')
		mock.reset()
	})

	it('fetchPreviewImage returns base64 or null', async () => {
		const png64 = await instance.fetchPreviewImage('channel', '1')
		assert.equal(typeof png64, 'string')
		assert.equal(await instance.fetchPreviewImage('channel', '99'), null)
		assert.equal(await instance.fetchPreviewImage('bogus', '1'), null)
		assert.equal(await instance.fetchPreviewImage('input', ''), null)
	})
})

describe('authentication', () => {
	it('a device that rejects the credentials yields AuthenticationFailure', async () => {
		const mock = await startMockPearl()
		// wrap the mock: reject a specific password with 401
		const original = mock.server.listeners('request')[0]
		mock.server.removeAllListeners('request')
		mock.server.on('request', (req, res) => {
			const auth = req.headers.authorization || ''
			const decoded = Buffer.from(auth.replace(/^Basic /, ''), 'base64').toString()
			if (decoded === 'admin:wrong') {
				res.writeHead(401, { 'Content-Type': 'application/json' })
				res.end(JSON.stringify({ status: 'unauthorized', message: 'Authentication required' }))
				return
			}
			original(req, res)
		})
		const instance = await createInstance({ mock, config: { password: 'wrong' } })
		try {
			assert.equal(instance.currentStatus, InstanceStatus.AuthenticationFailure)
			assert.equal(Object.keys(instance.state.channels).length, 0)
			assert.equal(instance.apiBasePath, '/api')
			assert.ok(
				instance.calls.log.some((l) => l.level === 'error' && /Authentication failed \(401\)/.test(l.message)),
			)
		} finally {
			await instance.destroy()
			await mock.close()
		}
	})
})

describe('HTTPS with a self-signed certificate', () => {
	let mock

	before(async () => {
		mock = await startMockPearl({ https: true })
		assert.match(mock.url, /^https:/)
	})

	after(async () => {
		await mock.close()
	})

	it('is accepted when "Accept self-signed certificate" is on', async () => {
		const instance = await createInstance({ mock, config: { use_https: true, accept_self_signed: true } })
		try {
			assert.equal(instance.currentStatus, InstanceStatus.Ok)
			assert.equal(instance.apiBasePath, '/api/v2.0')
			assert.deepEqual(Object.keys(instance.state.channels).sort(), ['1', '2'])
			assert.ok(mock.requests.length > 0, 'requests reached the TLS mock')
			assert.deepEqual(
				instance.calls.log.filter((l) => l.level === 'error'),
				[],
			)
			// the request layer keeps working over TLS for actions as well
			await instance.request('POST', '/channels/1/publishers/0/control/start')
			assert.equal(mock.state.channels['1'].publishers['0'].status.state, 'started')
		} finally {
			await instance.destroy()
		}
	})

	it('is refused with ConnectionFailure and a certificate error when the setting is off', async () => {
		mock.reset()
		const instance = await createInstance({ mock, config: { use_https: true, accept_self_signed: false } })
		try {
			const { PearlApiError } = require('../src/instance')
			assert.equal(instance.currentStatus, InstanceStatus.ConnectionFailure)
			assert.equal(mock.requests.length, 0, 'the TLS handshake fails before any request is served')
			assert.equal(Object.keys(instance.state.channels).length, 0)
			const failure = instance.calls.status.find((s) => s.status === InstanceStatus.ConnectionFailure)
			assert.match(String(failure.message), /SELF_SIGNED|CERT/)
			assert.ok(
				instance.calls.log.some(
					(l) => l.level === 'error' && /self.signed certificate|certificate/i.test(l.message),
				),
				'the certificate problem is logged at error level',
			)
			// only the module's own error class leaves the request layer
			await assert.rejects(instance.request('GET', '/channels'), (err) => {
				assert.ok(
					err instanceof PearlApiError,
					`unexpected error type ${err?.constructor?.name}: ${err?.message}`,
				)
				assert.equal(err.status, 0)
				assert.match(err.message, /self.signed certificate|certificate/i)
				return true
			})
		} finally {
			await instance.destroy()
		}
	})
})

describe('device clock skew', () => {
	it('is picked up from the Date header and feeds the event countdowns', async () => {
		const mock = await startMockPearl({ clockSkewMs: 60000 })
		const instance = await createInstance({ mock })
		try {
			assert.ok(
				instance.clockOffsetMs > 55000 && instance.clockOffsetMs < 65000,
				`offset ${instance.clockOffsetMs} ms`,
			)
			assert.ok(Math.abs(instance.deviceNow() - Date.now() - instance.clockOffsetMs) < 50)
			// the event starts 3600 s after the mock was seeded (host clock); through a device clock that runs
			// 60 s ahead the countdown the module computes (event.start - deviceNow()) is about a minute shorter,
			// i.e. close to 00:59:00 rather than the raw 01:00:00 an uncorrected Date.now() would give
			assert.match(String(instance.variableValues.event_upcoming_starts_in_hms), /^00:(58:5\d|59:0\d)$/)
		} finally {
			await instance.destroy()
			await mock.close()
		}
	})

	it('ignores offset changes under 2 s, follows larger ones and restarts from 0 on a config change', async () => {
		const mock = await startMockPearl({ clockSkewMs: 5000 })
		const instance = await createInstance({ mock })
		try {
			const first = instance.clockOffsetMs
			assert.ok(first > 3500 && first < 6500, `offset ${first} ms`)
			mock.setClockSkew(6000)
			await instance.request('GET', '/channels')
			assert.equal(instance.clockOffsetMs, first, 'a 1 s change is within the resolution of the Date header')
			mock.setClockSkew(-30000)
			await instance.request('GET', '/channels')
			assert.ok(
				instance.clockOffsetMs < -28000 && instance.clockOffsetMs > -32000,
				`offset ${instance.clockOffsetMs} ms`,
			)
			await instance.configUpdated({ ...DEFAULT_CONFIG, host_port: mock.port })
			assert.equal(instance.clockOffsetMs, 0)
			await instance.startupPromise
		} finally {
			await instance.destroy()
			await mock.close()
		}
	})
})
