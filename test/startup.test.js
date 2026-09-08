const { describe, it } = require('node:test')
const assert = require('node:assert/strict')
const net = require('node:net')
const path = require('node:path')

const { installStub } = require('./harness')

const { InstanceStatus } = installStub()
const { EpiphanPearl } = require(path.join(__dirname, '..', 'src', 'instance.js'))

/**
 * Companion gives init()/configUpdated() only a few seconds before it restarts the module.
 * With an unreachable device the API probe and the first poll each run into the request timeout,
 * so the first contact must happen in the background and init() must return immediately.
 */
describe('startup with an unreachable device', () => {
	it('init() returns before the device answers and keeps retrying in the background', async () => {
		// accept TCP connections but never answer, so every request runs into the timeout
		const sockets = new Set()
		const dead = net.createServer((socket) => {
			sockets.add(socket)
			socket.on('error', () => {})
			socket.on('close', () => sockets.delete(socket))
		})
		await new Promise((resolve) => dead.listen(0, '127.0.0.1', resolve))
		const port = dead.address().port

		const instance = new EpiphanPearl({ id: 'test', upgradeScripts: [], _isInstanceBaseProps: true })
		try {
			const started = Date.now()
			await instance.init({
				host: '127.0.0.1',
				host_port: port,
				username: 'admin',
				password: 'x',
				poll_interval: 1000,
				timeout: 1500,
				use_api_v2: true,
				preview_interval: 0,
				preview_width: 144,
				poll_events: true,
				verbose: false,
			})
			const elapsed = Date.now() - started

			assert.ok(elapsed < 1000, `init() must not wait for the device (took ${elapsed} ms)`)
			assert.equal(instance.currentStatus, InstanceStatus.Connecting)
			assert.ok(instance.startupPromise, 'first contact runs in the background')
			// definitions are published immediately so Companion has something to show
			assert.equal(Object.keys(instance.definitions.actions).length, 11)
			assert.equal(Object.keys(instance.definitions.feedbacks).length, 14)
			assert.equal(instance.timer, undefined, 'polling interval starts after the first contact')

			await instance.startupPromise
			assert.equal(instance.currentStatus, InstanceStatus.ConnectionFailure)
			assert.equal(instance.apiBasePath, '/api', 'falls back to the legacy base when the probe fails')
			assert.ok(instance.timer, 'polling keeps retrying after a failed first contact')
		} finally {
			await instance.destroy()
			// the dead server never answers, so its sockets only go away when destroyed explicitly
			for (const socket of sockets) socket.destroy()
			await new Promise((resolve) => dead.close(resolve))
		}
	})

	it('destroy() called while connect() is still in flight leaves no timer running', async () => {
		// accept TCP connections but never answer, so the background connect() is still awaiting its
		// request timeout when destroy() runs
		const sockets = new Set()
		const dead = net.createServer((socket) => {
			sockets.add(socket)
			socket.on('error', () => {})
			socket.on('close', () => sockets.delete(socket))
		})
		await new Promise((resolve) => dead.listen(0, '127.0.0.1', resolve))
		const port = dead.address().port

		const instance = new EpiphanPearl({ id: 'test', upgradeScripts: [], _isInstanceBaseProps: true })
		try {
			await instance.init({
				host: '127.0.0.1',
				host_port: port,
				username: 'admin',
				password: 'x',
				poll_interval: 1000,
				timeout: 200,
				use_api_v2: true,
				preview_interval: 0,
				preview_width: 144,
				poll_events: true,
				verbose: false,
			})
			// init() returns before the device answers (see the test above); connect() is still running
			// its own request timeout in the background at this point
			assert.ok(instance.startupPromise, 'connect() is in flight')
			await instance.destroy()

			// let the in-flight connect() actually finish (it will fail against the dead server)
			await instance.startupPromise

			assert.equal(instance.timer, undefined, 'destroy() must prevent a timer from starting after teardown')
			assert.equal(instance.previewTimer, undefined)
		} finally {
			await instance.destroy()
			for (const socket of sockets) socket.destroy()
			await new Promise((resolve) => dead.close(resolve))
		}
	})
})
