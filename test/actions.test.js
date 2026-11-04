const assert = require('node:assert/strict')
const { test } = require('node:test')
const http = require('node:http')
const fs = require('node:fs')
const vm = require('node:vm')
const path = require('node:path')
const { createRequire } = require('node:module')
const base = require('@companion-module/base')
const { ActionManager } = require('@companion-module/base/dist/internal/actions.js')
const actions = require('../actions')

function instance() {
	let Module
	const filename = path.resolve(__dirname, '../index.js')
	const realRequire = createRequire(filename)
	vm.runInNewContext(fs.readFileSync(filename, 'utf8'), {
		require: (id) =>
			id === '@companion-module/base'
				? {
						...base,
						runEntrypoint: (cls) => {
							Module = cls
						},
					}
				: realRequire(id),
		global,
		Buffer,
		URL,
		AbortSignal,
		clearInterval,
	})
	const inst = Object.assign(Object.create(Module.prototype), actions)
	Object.assign(inst, {
		state: {
			channels: { 1: { name: 'Channel', publishers: {}, layouts: { 2: { name: 'Layout' } } } },
			recorders: {},
		},
		metadata: {},
		apiBasePath: '/api/v2.0',
		config: {},
		log() {},
		setStatus() {},
		parseVariablesInString() {
			throw new Error('Already parsed by API 1.13+ host')
		},
	})
	return inst
}

async function fixture(t) {
	const requests = []
	const layout = { name: '$(custom:literal)', elements: [{ text: 'A & B' }] }
	const server = http.createServer(async (req, res) => {
		let body = ''
		for await (const chunk of req) body += chunk
		requests.push({ method: req.method, url: req.url, body, auth: req.headers.authorization })
		res.setHeader('Content-Type', 'application/json')
		if (req.url.includes('/99/')) {
			res.writeHead(503)
			res.end('{}')
			return
		}
		res.end(JSON.stringify({ status: 'ok', result: layout }))
	})
	await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
	t.after(() => {
		server.closeAllConnections()
		server.close()
	})
	const inst = instance()
	inst.config = { host: '127.0.0.1', host_port: server.address().port, username: 'admin', password: 'secret' }
	const writes = []
	const manager = new ActionManager(
		() => {
			throw new Error('Unexpected variable reparse')
		},
		() => {},
		(msg) => writes.push(msg),
		() => {},
	)
	manager.setActionDefinitions(inst.get_actions())
	const execute = (actionId, options, controlId = 'bank:1') =>
		manager.handleExecuteAction({ action: { id: 'action-1', actionId, controlId, options } })
	return { inst, requests, layout, writes, execute }
}

test('layout GET uses HTTP and emits the SDK custom-variable message for this control', async (t) => {
	const f = await fixture(t)
	assert.equal((await f.execute('getLayoutData', { channelIdlayoutId: '1-2', destination: 'layout' })).success, true)
	assert.deepEqual(f.writes, [{ customVariableId: 'layout', value: JSON.stringify(f.layout), controlId: 'bank:1' }])
	assert.equal(f.requests[0].url, '/api/v2.0/channels/1/layouts/2/settings')
	assert.equal(f.requests[0].method, 'GET')
	assert.equal(f.requests[0].auth, 'Basic ' + Buffer.from('admin:secret').toString('base64'))
	await f.execute('getLayoutData', { channelIdlayoutId: '1-2', destination: 'second' }, 'bank:2')
	assert.equal(f.writes[1].controlId, 'bank:2')
})

test('layout PUT preserves once-resolved variable-like literals and rejects invalid JSON', async (t) => {
	const f = await fixture(t)
	await f.execute('setLayoutData', { channelIdlayoutId: '1-2', source: JSON.stringify(f.layout) })
	assert.equal(f.requests[0].method, 'PUT')
	assert.deepEqual(JSON.parse(f.requests[0].body), f.layout)
	await f.execute('setLayoutData', { channelIdlayoutId: '1-2', source: '{invalid' })
	assert.equal(f.requests.length, 1)
})

test('invalid selection and HTTP failure never publish a custom variable', async (t) => {
	const f = await fixture(t)
	await f.execute('getLayoutData', { channelIdlayoutId: '1-404', destination: 'layout' })
	assert.equal(f.requests.length, 0)
	f.inst.state.channels[1].layouts[99] = { name: 'Unavailable' }
	await f.execute('getLayoutData', { channelIdlayoutId: '1-99', destination: 'layout' })
	assert.equal(f.requests.length, 1)
	assert.deepEqual(f.writes, [])
})

test('marker and metadata actions preserve host-resolved literal variables', async (t) => {
	const f = await fixture(t)
	const defs = f.inst.get_actions()
	const markerId = Object.keys(defs).find((id) => defs[id].options.some((o) => o.id === 'markertext'))
	const sent = []
	f.inst.sendRequest = async (...args) => {
		sent.push(args)
	}
	await defs[markerId].callback({ options: { channel: 1, markertext: '$(custom:literal)' } })
	assert.equal(sent[0][2].text, '$(custom:literal)')
	// Avoid unrelated variable publication; metadata writes use the real HTTP path.
	f.inst.setVariableValues = () => {}
	await defs.setContentMetadata.callback({
		options: { channel: 1, title: '$(custom:literal)', author: 'A&B', prefix: 'take' },
	})
	const url = new URL(f.requests[0].url, 'http://localhost')
	assert.equal(url.searchParams.get('title'), '$(custom:literal)')
	assert.equal(url.searchParams.get('author'), 'A&B')
})
