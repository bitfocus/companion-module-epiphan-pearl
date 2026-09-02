const { describe, it, before, after, beforeEach } = require('node:test')
const assert = require('node:assert/strict')

const { createInstance } = require('./harness')
const { startMockPearl } = require('./mock-pearl')

const getParamsPath = (cid) => `/admin/channel${cid}/get_params.cgi`

function metadataErrors(instance, cid) {
	return instance.calls.log.filter(
		(l) => l.level === 'error' && new RegExp(`metadata for channel ${cid}`).test(l.message),
	)
}

describe('legacy content metadata: fetch, failure marker and retry back-off', () => {
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

	it('a successful fetch stores a plain entry that is not fetched again', async () => {
		assert.deepEqual(Object.keys(instance.metadata['1']).sort(), ['author', 'rec_prefix', 'title'])
		assert.equal(instance.metadata['1'].title, mock.state.channels['1'].metadata.title)
		await instance.pollAll()
		assert.equal(mock.requests.filter((r) => r.path.endsWith('/get_params.cgi')).length, 0)
	})

	it('a failed fetch logs an error once, debug afterwards, and leaves a retry marker', async () => {
		// channel 3 does not exist on the device: get_params.cgi answers 404
		await instance.fetchMetadata('3')
		const marker = instance.metadata['3']
		assert.deepEqual([marker.title, marker.author, marker.rec_prefix], ['', '', ''])
		assert.equal(marker._attempts, 1)
		assert.ok(Number.isFinite(marker._failedAt) && Date.now() - marker._failedAt < 5000)
		assert.equal(metadataErrors(instance, '3').length, 1)

		await instance.fetchMetadata('3')
		assert.equal(instance.metadata['3']._attempts, 2)
		assert.equal(metadataErrors(instance, '3').length, 1, 'no second error log')
		assert.ok(instance.calls.log.some((l) => l.level === 'debug' && /channel 3 \(attempt 2\)/.test(l.message)))

		// on the next poll the marker yields empty metadata variables instead of undefined ones
		await instance.pollAll()
		assert.equal(instance.variableValues.channel_3_metadata_title, '')
		assert.ok(!Object.keys(instance.variableValues).some((id) => /_(failedAt|attempts)$/.test(id)))
		delete instance.metadata['3']
		await instance.pollAll()
	})

	it('the poller skips a fresh failure marker and retries once the back-off has elapsed', async () => {
		instance.metadata['1'] = { title: '', author: '', rec_prefix: '', _failedAt: Date.now(), _attempts: 1 }
		await instance.pollAll()
		assert.equal(mock.requests.filter((r) => r.path === getParamsPath('1')).length, 0, 'not due yet')
		assert.equal(instance.metadata['1']._attempts, 1)

		instance.metadata['1']._failedAt = Date.now() - 60_001
		mock.requests.length = 0
		await instance.pollAll()
		assert.equal(mock.requests.filter((r) => r.path === getParamsPath('1')).length, 1, 'retried')
		assert.equal('_failedAt' in instance.metadata['1'], false, 'marker replaced by the fetched values')
		assert.equal(instance.metadata['1'].title, mock.state.channels['1'].metadata.title)

		// the back-off grows with the number of attempts: 3 attempts -> 3 minutes
		instance.metadata['1'] = { title: '', author: '', rec_prefix: '', _failedAt: Date.now() - 60_001, _attempts: 3 }
		mock.requests.length = 0
		await instance.pollAll()
		assert.equal(mock.requests.filter((r) => r.path === getParamsPath('1')).length, 0)
		instance.metadata['1']._failedAt = Date.now() - 180_001
		await instance.pollAll()
		assert.equal(mock.requests.filter((r) => r.path === getParamsPath('1')).length, 1)
		assert.equal('_failedAt' in instance.metadata['1'], false)
	})

	it('a failed fetch keeps previously known values and setContentMetadata clears the marker', async () => {
		instance.metadata['2'] = { title: 'Known', author: 'A', rec_prefix: 'P', _failedAt: Date.now(), _attempts: 2 }
		const def = instance.definitions.actions.setContentMetadata
		await def.callback(
			{ actionId: 'setContentMetadata', options: { channel: '2', title: 'New', author: 'B', prefix: 'Q' } },
			{ parseVariablesInString: async (t) => t },
		)
		assert.deepEqual(instance.metadata['2'], { title: 'New', author: 'B', rec_prefix: 'Q' })
		assert.equal(instance.variableValues.channel_2_metadata_title, 'New')
	})
})
