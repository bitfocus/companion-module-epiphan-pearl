/**
 * Dropdown choice builders. All return [{ id, label }] in the order the device lists them.
 * Mixed into the instance prototype, so `this` is the instance.
 */

const OUTPUT_SOURCE_STATIC = [
	{ id: 'multiview', label: 'Multi-viewer' },
	{ id: 'deviceinfo', label: 'Device information' },
	{ id: 'console', label: 'Console' },
]

const EVENT_ALIASES = [
	{ id: 'upcoming', label: 'Upcoming (next scheduled) event' },
	{ id: 'ongoing', label: 'Ongoing event (running or paused)' },
	{ id: 'running', label: 'Running event' },
	{ id: 'paused', label: 'Paused event' },
	{ id: 'completed', label: 'Most recent completed event' },
]

module.exports = {
	/**
	 * Return the id of the first item of dropdown choices array
	 *
	 * @param {{id: string|number, label: string}[]} arr the dropdown array
	 * @returns {string|number}
	 */
	firstId(arr) {
		if (Array.isArray(arr) && arr.length > 0 && (typeof arr[0].id === 'string' || typeof arr[0].id === 'number')) {
			return arr[0].id
		}
		return ''
	},

	/** Channels -> id cid */
	choicesChannel() {
		return Object.values(this.state?.channels || {}).map((channel) => ({
			id: String(channel.id),
			label: channel.name ?? String(channel.id),
		}))
	},

	/** Channel/layout combinations -> id `${cid}-${lid}` */
	choicesChannelLayout() {
		const choices = []
		for (const channel of Object.values(this.state?.channels || {})) {
			for (const layout of Object.values(channel.layouts || {})) {
				choices.push({
					id: `${channel.id}-${layout.id}`,
					label: `${channel.name} - ${layout.name}`,
				})
			}
		}
		return choices
	},

	/** Channel/publisher combinations including a `${cid}-all` entry per channel with publishers */
	choicesChannelPublishers() {
		const choices = []
		for (const channel of Object.values(this.state?.channels || {})) {
			const publishers = Object.values(channel.publishers || {})
			if (publishers.length === 0) continue
			choices.push({
				id: `${channel.id}-all`,
				label: `${channel.name} - All Streams`,
			})
			for (const publisher of publishers) {
				choices.push({
					id: `${channel.id}-${publisher.id}`,
					label: `${channel.name} - ${publisher.name ?? publisher.id}`,
				})
			}
		}
		return choices
	},

	/** Channel/publisher combinations without the `-all` entries */
	choicesChannelPublishersOnly() {
		return this.choicesChannelPublishers().filter((choice) => !String(choice.id).endsWith('-all'))
	},

	/** Recorders -> id rid */
	choicesRecorders() {
		return Object.values(this.state?.recorders || {}).map((recorder) => ({
			id: String(recorder.id),
			label: recorder.name ?? String(recorder.id),
		}))
	},

	/** Inputs -> id sid, label `name (type)` */
	choicesInputs() {
		return Object.values(this.state?.inputs || {}).map((input) => ({
			id: String(input.id),
			label: input.type ? `${input.name ?? input.id} (${input.type})` : `${input.name ?? input.id}`,
		}))
	},

	/** Inputs that carry audio */
	choicesInputsWithAudio() {
		return Object.values(this.state?.inputs || {})
			.filter((input) => input.audio === true)
			.map((input) => ({
				id: String(input.id),
				label: input.type ? `${input.name ?? input.id} (${input.type})` : `${input.name ?? input.id}`,
			}))
	},

	/** Outputs -> id did */
	choicesOutputs() {
		return Object.values(this.state?.outputs || {}).map((output) => ({
			id: String(output.id),
			label: output.name ?? String(output.id),
		}))
	},

	/** Output sources: static entries, then channels, then inputs */
	choicesOutputSources() {
		const choices = OUTPUT_SOURCE_STATIC.map((c) => ({ ...c }))
		for (const channel of Object.values(this.state?.channels || {})) {
			choices.push({ id: String(channel.id), label: `Channel: ${channel.name ?? channel.id}` })
		}
		for (const input of Object.values(this.state?.inputs || {})) {
			choices.push({ id: String(input.id), label: `Input: ${input.name ?? input.id}` })
		}
		return choices
	},

	/** Storages -> id stid */
	choicesStorages() {
		return Object.values(this.state?.storages || {}).map((storage) => ({
			id: String(storage.id),
			label: String(storage.id),
		}))
	},

	/** Single touch control objects -> id stcid */
	choicesSingleTouch() {
		return Object.values(this.state?.singleTouch || {}).map((stc) => ({
			id: String(stc.id),
			label: `Single touch control ${stc.id}`,
		}))
	},

	/** Configuration presets stored on the device -> id preset.name */
	choicesConfigPresets() {
		return (this.state?.presets || [])
			.filter((preset) => preset && typeof preset.name === 'string')
			.map((preset) => ({
				id: preset.name,
				label: preset.description ? `${preset.name} (${preset.description})` : preset.name,
			}))
	},

	/** Static event aliases accepted by the schedule endpoints */
	choicesEventAlias() {
		return EVENT_ALIASES.map((c) => ({ ...c }))
	},
}
