const { describe, it } = require('node:test')
const assert = require('node:assert/strict')

const { createInstance } = require('./harness')
const { startMockPearl } = require('./mock-pearl')

describe('poll loop lifecycle', () => {
	it('does not re-arm the poll timer when destroy() happens during a running poll', async () => {
		const mock = await startMockPearl()
		const instance = await createInstance({ mock })
		try {
			let release
			const gate = new Promise((resolve) => (release = resolve))
			instance.pollAll = () => gate
			instance.nextPollDelayMs = () => 1
			instance.initInterval()
			await new Promise((resolve) => setTimeout(resolve, 20)) // runOnce started, poll "running"
			await instance.destroy()
			release()
			await new Promise((resolve) => setTimeout(resolve, 20))
			assert.equal(instance.timer, undefined)
		} finally {
			await mock.close()
		}
	})
})
