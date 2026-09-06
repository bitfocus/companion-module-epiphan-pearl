/**
 * Dropdown choice builders. All return [{ id, label }] in the order the device lists them.
 * Mixed into the instance prototype, so `this` is the instance.
 */

/** separator between the channel and the item in a composite choice label */
const DASH = '–'

const OUTPUT_SOURCE_STATIC = [
	{ id: 'multiview', label: 'Built-in: Multiview' },
	{ id: 'deviceinfo', label: 'Built-in: Device info' },
	{ id: 'console', label: 'Built-in: Console' },
]

const EVENT_REFS = [
	{ id: 'upcoming', label: 'Upcoming (next scheduled)' },
	{ id: 'ongoing', label: 'Ongoing (running or paused)' },
	{ id: 'running', label: 'Running' },
	{ id: 'paused', label: 'Paused' },
	{ id: 'completed', label: 'Completed (most recent)' },
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

	/**
	 * Return `preferred` when the choices contain it, otherwise the first id
	 *
	 * @param {{id: string|number, label: string}[]} arr the dropdown array
	 * @param {string|number} preferred
	 * @returns {string|number}
	 */
	preferredId(arr, preferred) {
		if (Array.isArray(arr) && arr.some((choice) => String(choice?.id) === String(preferred))) return preferred
		return this.firstId(arr)
	},

	/** Channels -> id cid */
	choicesChannel() {
		return Object.values(this.state?.channels || {}).map((channel) => ({
			id: String(channel.id),
			label: channel.name ?? String(channel.id),
		}))
	},

	/** Channel/layout combinations -> id `${cid}-${lid}`, label `Channel – Layout` */
	choicesLayouts() {
		const choices = []
		for (const channel of Object.values(this.state?.channels || {})) {
			const cname = channel.name ?? String(channel.id)
			for (const layout of Object.values(channel.layouts || {})) {
				choices.push({
					id: `${channel.id}-${layout.id}`,
					label: `${cname} ${DASH} ${layout.name ?? layout.id}`,
				})
			}
		}
		return choices
	},

	/**
	 * Channel/publisher combinations -> id `${cid}-all` (label `Channel – All publishers`) first per
	 * channel, then `${cid}-${pid}` (label `Channel – Name (type)`)
	 */
	choicesPublishers() {
		const choices = []
		for (const channel of Object.values(this.state?.channels || {})) {
			const publishers = Object.values(channel.publishers || {})
			if (publishers.length === 0) continue
			const cname = channel.name ?? String(channel.id)
			choices.push({ id: `${channel.id}-all`, label: `${cname} ${DASH} All publishers` })
			for (const publisher of publishers) {
				const pname = publisher.name ?? String(publisher.id)
				choices.push({
					id: `${channel.id}-${publisher.id}`,
					label: publisher.type
						? `${cname} ${DASH} ${pname} (${publisher.type})`
						: `${cname} ${DASH} ${pname}`,
				})
			}
		}
		return choices
	},

	/** Recorders -> id rid */
	choicesRecorders() {
		return Object.values(this.state?.recorders || {}).map((recorder) => ({
			id: String(recorder.id),
			label: recorder.name ?? String(recorder.id),
		}))
	},

	/** Recorders with the `all` aggregate first */
	choicesRecordersWithAll() {
		return [{ id: 'all', label: 'All recorders' }, ...this.choicesRecorders()]
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

	/**
	 * Inputs that carry video, i.e. can produce a live preview image or be routed to a video output.
	 * Excludes audio-only child inputs such as "HDMI-A Audio" (they have no picture to show).
	 */
	choicesInputsWithVideo() {
		return Object.values(this.state?.inputs || {})
			.filter((input) => input.video === true)
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

	/** Output sources: static entries, then channels, then video-capable inputs (an output shows a picture, so an audio-only input is never a valid source) */
	choicesOutputSources() {
		const choices = OUTPUT_SOURCE_STATIC.map((c) => ({ ...c }))
		for (const channel of Object.values(this.state?.channels || {})) {
			choices.push({ id: String(channel.id), label: `Channel: ${channel.name ?? channel.id}` })
		}
		for (const input of Object.values(this.state?.inputs || {})) {
			if (input.video !== true) continue
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

	/**
	 * Union of channels, video-capable inputs and outputs for the advanced `preview` feedback's
	 * `sourceId` option, each labelled with its domain since Companion dropdown choices cannot depend
	 * on another option's value (the `source` option picks which of the three the id is looked up in).
	 */
	choicesPreviewSources() {
		const choices = []
		for (const channel of Object.values(this.state?.channels || {})) {
			choices.push({ id: String(channel.id), label: `Channel: ${channel.name ?? channel.id}` })
		}
		for (const input of Object.values(this.state?.inputs || {})) {
			if (input.video !== true) continue
			choices.push({ id: String(input.id), label: `Input: ${input.name ?? input.id}` })
		}
		for (const output of Object.values(this.state?.outputs || {})) {
			choices.push({ id: String(output.id), label: `Output: ${output.name ?? output.id}` })
		}
		return choices
	},

	/** The five schedule aliases, then the polled events labelled `title (status)` */
	choicesEventRefs() {
		const choices = EVENT_REFS.map((c) => ({ ...c }))
		const seen = new Set(choices.map((c) => c.id))
		for (const event of this.state?.events?.list || []) {
			if (!event || event.id === undefined || event.id === null) continue
			const id = String(event.id)
			if (seen.has(id)) continue
			seen.add(id)
			const title = typeof event.title === 'string' && event.title !== '' ? event.title : `Event ${id}`
			choices.push({ id, label: `${title} (${event.status ?? 'unknown'})` })
		}
		return choices
	},
}
