const assert = require('node:assert/strict')
const { test } = require('node:test')
const actions = require('../actions')

function fixture() {
	const sent = []
	const instance = {
		state: { channels: { 1: { name: 'Channel', layouts: { 2: { name: 'Layout' } } } } },
		choicesChannelLayout: () => [],
		choicesChannelPublishers: () => [],
		choicesRecorders: () => [],
		choicesChannel: () => [],
		firstId: () => '',
		log() {},
		parseVariablesInString() {
			throw new Error('API 1.13+ host already prepared action text')
		},
		sendRequest: async (...args) => {
			sent.push(args)
			return { name: '$(custom:literal)' }
		},
	}
	return { definitions: actions.get_actions.call(instance), sent }
}

test('retrieved layout is written through the invoking action context', async () => {
	const { definitions, sent } = fixture()
	const writes = []
	await definitions.getLayoutData.callback(
		{ options: { channelIdlayoutId: '1-2', destination: 'layout' } },
		{ setCustomVariableValue: (...args) => writes.push(args) },
	)
	assert.deepEqual(sent, [['GET', '/api/channels/1/layouts/2/settings', {}]])
	assert.deepEqual(writes, [['layout', JSON.stringify({ name: '$(custom:literal)' })]])
})

test('layout JSON preserves variable-like text already prepared by the host', async () => {
	const { definitions, sent } = fixture()
	const layout = { name: '$(custom:literal)' }
	await definitions.setLayoutData.callback({ options: { channelIdlayoutId: '1-2', source: JSON.stringify(layout) } })
	assert.deepEqual(sent, [['PUT', '/api/channels/1/layouts/2/settings', layout]])
})

test('marker preserves variable-like text already prepared by the host', async () => {
	const { definitions, sent } = fixture()
	const marker = Object.values(definitions).find((definition) =>
		definition.options.some((option) => option.id === 'markertext'),
	)
	await marker.callback({ options: { channel: 1, markertext: '$(custom:literal)' } })
	assert.equal(sent[0][2].text, '$(custom:literal)')
})
