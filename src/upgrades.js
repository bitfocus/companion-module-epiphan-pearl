const { PRESET_CATEGORY_IDS } = require('./presets')
const { splitPair, clampNumber } = require('./utils')

/**
 * Default values for config fields that were added after the first release.
 * Any field that is undefined in a stored config gets its default here.
 *
 * Companion runs every upgrade script exactly once per connection and remembers how far it got, so an
 * existing script must never be extended: fields added in a later version get their own script that is
 * APPENDED to the exported array (setDefaultConfig = v2.2.0, setDefaultConfigV230 = v2.3.0,
 * setDefaultConfigV260 = v2.6.0, setDefaultConfigV300Https = v3.0.0).
 */
const CONFIG_DEFAULTS = {
	use_api_v2: true,
	verbose: false,
	use_https: false,
	accept_self_signed: true,
	timeout: 5000,
	preview_interval: 2,
	preview_width: 144,
	poll_events: true,
	poll_archive: false,
	poll_connectivity: false,
	// every category was implicitly "on" before this setting existed, so an upgraded connection keeps
	// generating exactly the presets it already had
	preset_categories: PRESET_CATEGORY_IDS.slice(),
}

/** fields handled by setDefaultConfig (v2.2.0) */
const CONFIG_DEFAULT_KEYS_V220 = ['use_api_v2', 'verbose']
/** fields handled by setDefaultConfigV230 (v2.3.0) */
const CONFIG_DEFAULT_KEYS_V230 = [
	'timeout',
	'preview_interval',
	'preview_width',
	'poll_events',
	'poll_archive',
	'poll_connectivity',
]
/** fields handled by setDefaultConfigV260 (v2.6.0) */
const CONFIG_DEFAULT_KEYS_V260 = ['preset_categories']
/** fields handled by setDefaultConfigV300Https (v3.0.0) */
const CONFIG_DEFAULT_KEYS_V300_HTTPS = ['use_https', 'accept_self_signed']

/**
 * Build an upgrade script that fills the given config keys with their CONFIG_DEFAULTS value when undefined
 *
 * @param {string[]} keys
 * @returns {(context: unknown, props: {config?: object}) => object}
 */
function fillConfigDefaults(keys) {
	return (context, props) => {
		const result = {
			updatedConfig: null,
			updatedActions: [],
			updatedFeedbacks: [],
		}

		if (!props.config) return result

		const changed = {}
		for (const key of keys) {
			if (props.config[key] === undefined) {
				changed[key] = CONFIG_DEFAULTS[key]
			}
		}

		if (Object.keys(changed).length > 0) {
			result.updatedConfig = Object.assign({}, props.config, changed)
		}

		return result
	}
}

const setDefaultConfig = fillConfigDefaults(CONFIG_DEFAULT_KEYS_V220)
const setDefaultConfigV230 = fillConfigDefaults(CONFIG_DEFAULT_KEYS_V230)
const setDefaultConfigV260 = fillConfigDefaults(CONFIG_DEFAULT_KEYS_V260)
const setDefaultConfigV300Https = fillConfigDefaults(CONFIG_DEFAULT_KEYS_V300_HTTPS)
Object.defineProperty(setDefaultConfig, 'name', { value: 'setDefaultConfig' })
Object.defineProperty(setDefaultConfigV230, 'name', { value: 'setDefaultConfigV230' })
Object.defineProperty(setDefaultConfigV260, 'name', { value: 'setDefaultConfigV260' })
Object.defineProperty(setDefaultConfigV300Https, 'name', { value: 'setDefaultConfigV300Https' })

// Rename old streaming feedback and action identifiers
function renameStreaming(context, props) {
	const result = {
		updatedConfig: null,
		updatedActions: [],
		updatedFeedbacks: [],
	}

	for (const action of props.actions) {
		if (action.actionId === 'channelStreaming') {
			action.actionId = 'controlStreaming'
			result.updatedActions.push(action)
		}
	}

	for (const feedback of props.feedbacks) {
		if (feedback.feedbackId === 'channelStreaming') {
			feedback.feedbackId = 'streamingState'
			result.updatedFeedbacks.push(feedback)
		}
	}

	return result
}

// ------------------------------------------------------------------------------------------------
// v3.0.0: Companion-parity control-set rewrite (doc/PARITY.md §2, briefing §4 D1-D16, §7)
// ------------------------------------------------------------------------------------------------

/**
 * Legacy action/feedback ids removed by the 3.0.0 rewrite (no Stream Deck counterpart), collected here
 * as they are found. Upgrade scripts run before any module instance exists (no `this.log`), so they
 * cannot report anything themselves; `instance.js`'s `init()` reads this array once per module start,
 * logs one 'warn' line per distinct id (with how many buttons carried it) and empties the array (D13).
 * Each entry: { kind: 'action'|'feedback', id: legacy id, controlId: the button it was on }.
 */
const REMOVED_LEGACY = []

/**
 * INTERNAL: record one removed legacy action/feedback instance for init() to report (D13).
 * @param {'action'|'feedback'} kind
 * @param {string} id legacy action/feedback id
 * @param {string} [controlId]
 */
function recordRemovedLegacy(kind, id, controlId) {
	REMOVED_LEGACY.push({ kind, id, controlId: controlId ?? '' })
}

/** legacy `recorderRecording` / `recorderControlAll` numeric-or-string op -> the new `recorder.op` (§2.1) */
const RECORDER_OP_MAP = { 0: 'stop', 1: 'start', 2: 'reset', 3: 'toggle', 99: 'toggle' }
/** legacy `controlStreaming` numeric op -> the new `stream.op` (§2.1) */
const STREAM_OP_MAP = { 0: 'stop', 1: 'start', 3: 'toggle', 99: 'toggle' }
/** legacy `storageState` value -> the new `storage_level.level` (§2.2) */
const STORAGE_STATE_MAP = { ready: 'ok', nodev: 'nomedia', dev: 'notready', devro: 'ro', formatting: 'formatting' }
/** legacy `afuState` value -> the new `system.condition` (§2.2) */
const AFU_STATE_MAP = {
	idle: 'afu_idle',
	paused: 'afu_paused',
	uploading: 'afu_uploading',
	error: 'afu_error',
	disabled: 'afu_off',
}
/** legacy `eventStatus.which` -> the new `event_state` options (§2.2) */
const EVENT_WHICH_MAP = {
	upcoming: { eventRef: 'upcoming', state: 'scheduled' },
	running: { eventRef: 'ongoing', state: 'running' },
	paused: { eventRef: 'ongoing', state: 'paused' },
	ongoing: { eventRef: 'ongoing', state: 'ongoing' },
}

/**
 * Resolve the event id/alias an `eventControl` / `eventExtend` action targeted, into the new `eventRef`
 * (§2.1: `eventRef = event === 'custom' ? eventId : event`).
 * @param {object} opt legacy action options
 * @returns {string}
 */
function legacyEventRef(opt) {
	return opt?.event === 'custom' ? String(opt?.eventId ?? '') : String(opt?.event ?? 'ongoing')
}

/**
 * Companion parity control-set rewrite: converts every legacy action/feedback id to its new
 * counterpart (doc/PARITY.md §2.1/§2.2) and the connection config to the new field set (§2.4). Actions
 * and feedbacks with no Stream Deck counterpart are left exactly as stored (an upgrade script has no way
 * to delete a placed instance) and only recorded via recordRemovedLegacy so init() can warn once (D13).
 *
 * @param {unknown} context unused
 * @param {{config: object|null, actions: object[], feedbacks: object[]}} props
 * @returns {{updatedConfig: object|null, updatedActions: object[], updatedFeedbacks: object[]}}
 */
function convertToParityV300(context, props) {
	const result = { updatedConfig: null, updatedActions: [], updatedFeedbacks: [] }

	for (const action of props.actions || []) {
		if (!action) continue
		const opt = action.options || {}
		switch (action.actionId) {
			case 'channelChangeLayout': {
				const pair = splitPair(opt.channelIdlayoutId)
				action.actionId = 'layout'
				action.options = {
					channelId: pair ? pair[0] : '',
					layoutId: typeof opt.channelIdlayoutId === 'string' ? opt.channelIdlayoutId : '',
					layoutIdManual: '',
				}
				result.updatedActions.push(action)
				break
			}
			case 'controlStreaming': {
				const value = opt.channelIdpublisherId
				const pair = splitPair(value)
				action.actionId = 'stream'
				action.options = {
					channelId: pair ? pair[0] : '',
					publisherId: typeof value === 'string' ? value : '',
					op: STREAM_OP_MAP[opt.startStopAction] ?? 'toggle',
				}
				result.updatedActions.push(action)
				break
			}
			case 'recorderRecording': {
				action.actionId = 'recorder'
				action.options = {
					recorderId: opt.recorderId ?? '',
					op: RECORDER_OP_MAP[opt.startStopAction] ?? 'toggle',
				}
				result.updatedActions.push(action)
				break
			}
			case 'insertMarker': {
				action.actionId = 'bookmark'
				action.options = { channelId: opt.channel ?? '', text: opt.markertext || 'Marker', appendTime: false }
				result.updatedActions.push(action)
				break
			}
			case 'systemReboot': {
				action.actionId = 'power'
				action.options = { op: 'reboot', confirm: false }
				result.updatedActions.push(action)
				break
			}
			case 'systemShutdown': {
				action.actionId = 'power'
				action.options = { op: 'shutdown', confirm: false }
				result.updatedActions.push(action)
				break
			}
			case 'recorderControlAll': {
				// options.action is already the string 'start'/'stop' (CHOICES_START_STOP), not the
				// numeric startStopAction of recorderRecording, so it is copied through rather than
				// looked up in RECORDER_OP_MAP
				action.actionId = 'recorder'
				action.options = { recorderId: 'all', op: opt.action === 'stop' ? 'stop' : 'start' }
				result.updatedActions.push(action)
				break
			}
			case 'setOutputSource': {
				action.actionId = 'output'
				action.options = {
					outputId: opt.output ?? '',
					source: opt.source === 'custom' ? (opt.customSource ?? '') : (opt.source ?? ''),
				}
				result.updatedActions.push(action)
				break
			}
			case 'inputAudioGain': {
				action.actionId = 'audio'
				action.options = { inputId: opt.input ?? '', control: 'gain', direction: 'up', step: 1 }
				result.updatedActions.push(action)
				break
			}
			case 'inputAudioDelay': {
				action.actionId = 'audio'
				action.options = { inputId: opt.input ?? '', control: 'delay', direction: 'up', step: 1 }
				result.updatedActions.push(action)
				break
			}
			case 'singleTouchToggle': {
				action.actionId = 'singletouch'
				action.options = { stcId: opt.stc ?? '' }
				result.updatedActions.push(action)
				break
			}
			case 'applyConfigPreset': {
				action.actionId = 'preset'
				action.options = {
					presetName: opt.preset ?? '',
					sections: Array.isArray(opt.sections) ? opt.sections : [],
					confirm: false,
				}
				result.updatedActions.push(action)
				break
			}
			case 'storageEject': {
				action.actionId = 'storage'
				action.options = { storageId: opt.storage ?? '', confirm: false }
				result.updatedActions.push(action)
				break
			}
			case 'eventControl': {
				action.actionId = 'event'
				action.options = { eventRef: legacyEventRef(opt), op: opt.action ?? 'toggle', extendSeconds: 300 }
				result.updatedActions.push(action)
				break
			}
			case 'eventExtend': {
				action.actionId = 'event'
				action.options = { eventRef: legacyEventRef(opt), op: 'extend', extendSeconds: opt.seconds ?? 300 }
				result.updatedActions.push(action)
				break
			}
			case 'getLayoutData':
			case 'setLayoutData':
			case 'getContentMetadata':
			case 'setContentMetadata':
			case 'setChannelName':
			case 'setPublisherName':
			case 'setPublisherEnabled':
			case 'setPublisherSingleTouch':
			case 'setRtmpDestination':
			case 'setSrtDestination':
			case 'patchPublisherSettings':
			case 'addPublisher':
			case 'inputAudioMute':
			case 'inputPhantomPower':
			case 'patchInputSettings':
			case 'createNetworkInput':
			case 'createAdhocEvent':
			case 'adhocSessionLogout':
			case 'refreshConnectivity':
			case 'runSpeedTest':
			case 'refreshPoll':
				recordRemovedLegacy('action', action.actionId, action.controlId)
				break
			default:
				// already-converted (a fresh 3.0.0 action) or unrecognised: leave untouched
				break
		}
	}

	for (const feedback of props.feedbacks || []) {
		if (!feedback) continue
		const opt = feedback.options || {}
		switch (feedback.feedbackId) {
			case 'channelLayout':
				feedback.feedbackId = 'layout_active'
				feedback.options = { layoutId: opt.channelIdlayoutId ?? '' }
				result.updatedFeedbacks.push(feedback)
				break
			case 'channelLayoutPreview':
				feedback.feedbackId = 'layout_preview'
				feedback.options = { layoutId: opt.channelIdlayoutId ?? '' }
				result.updatedFeedbacks.push(feedback)
				break
			case 'streamingState':
				feedback.feedbackId = 'stream_state'
				feedback.options = { publisherId: opt.channelIdpublisherId ?? '', state: 'started' }
				result.updatedFeedbacks.push(feedback)
				break
			case 'recorderRecording':
				feedback.feedbackId = 'recorder_state'
				feedback.options = { recorderId: opt.recorderId ?? '', state: 'started' }
				result.updatedFeedbacks.push(feedback)
				break
			case 'publisherState':
				feedback.feedbackId = 'stream_state'
				feedback.options = { publisherId: opt.channelIdpublisherId ?? '', state: opt.state ?? 'started' }
				result.updatedFeedbacks.push(feedback)
				break
			case 'recorderState':
				feedback.feedbackId = 'recorder_state'
				feedback.options = { recorderId: opt.recorderId ?? '', state: opt.state ?? 'started' }
				result.updatedFeedbacks.push(feedback)
				break
			case 'anyRecording':
				feedback.feedbackId = 'recorder_state'
				feedback.options = { recorderId: 'all', state: 'started' }
				result.updatedFeedbacks.push(feedback)
				break
			case 'singleTouchPressed':
				feedback.feedbackId = 'singletouch_active'
				feedback.options = { stcId: opt.stcId ?? '', state: 'on' }
				result.updatedFeedbacks.push(feedback)
				break
			case 'singleTouchOk':
				feedback.feedbackId = 'singletouch_active'
				feedback.options = { stcId: opt.stcId ?? '', state: 'error' }
				feedback.isInverted = !feedback.isInverted
				result.updatedFeedbacks.push(feedback)
				break
			case 'storageState':
				feedback.feedbackId = 'storage_level'
				feedback.options = { storageId: opt.storageId ?? '', level: STORAGE_STATE_MAP[opt.state] ?? 'ok' }
				result.updatedFeedbacks.push(feedback)
				break
			case 'storageFreeBelow':
				feedback.feedbackId = 'storage_level'
				feedback.options = { storageId: opt.storageId ?? '', level: 'low' }
				result.updatedFeedbacks.push(feedback)
				break
			case 'afuState':
				feedback.feedbackId = 'system'
				feedback.options = { condition: AFU_STATE_MAP[opt.state] ?? 'afu_off' }
				result.updatedFeedbacks.push(feedback)
				break
			case 'cpuLoadHigh':
				feedback.feedbackId = 'system'
				feedback.options = { condition: 'cpu_high' }
				result.updatedFeedbacks.push(feedback)
				break
			case 'cpuTempHigh':
				feedback.feedbackId = 'system'
				feedback.options = { condition: 'cpu_hot' }
				result.updatedFeedbacks.push(feedback)
				break
			case 'eventStatus': {
				const mapped = EVENT_WHICH_MAP[opt.which] ?? EVENT_WHICH_MAP.ongoing
				feedback.feedbackId = 'event_state'
				feedback.options = { eventRef: mapped.eventRef, state: mapped.state }
				result.updatedFeedbacks.push(feedback)
				break
			}
			case 'channelPreview':
				feedback.feedbackId = 'preview'
				feedback.options = { source: 'channel', sourceId: opt.channel ?? '' }
				result.updatedFeedbacks.push(feedback)
				break
			case 'inputPreview':
				feedback.feedbackId = 'preview'
				feedback.options = { source: 'input', sourceId: opt.input ?? '' }
				result.updatedFeedbacks.push(feedback)
				break
			case 'outputPreview':
				feedback.feedbackId = 'preview'
				feedback.options = { source: 'output', sourceId: opt.output ?? '' }
				result.updatedFeedbacks.push(feedback)
				break
			case 'outputSourceOptimistic':
				feedback.feedbackId = 'output_set'
				feedback.options = { outputId: opt.output ?? '', source: opt.source ?? '' }
				result.updatedFeedbacks.push(feedback)
				break
			case 'anyStreaming':
			case 'configPresetApplied':
				recordRemovedLegacy('feedback', feedback.feedbackId, feedback.controlId)
				break
			default:
				// already-converted (a fresh 3.0.0 feedback) or unrecognised: leave untouched
				break
		}
	}

	if (props.config) {
		const config = { ...props.config }
		// D8: poll_interval (ms) replaces pollfreq (s)
		const pollfreqSeconds = clampNumber(config.pollfreq, 10, 1, 300)
		config.poll_interval = clampNumber(pollfreqSeconds * 1000, 2000, 500, 300000)
		delete config.pollfreq
		delete config.poll_archive
		delete config.poll_connectivity
		// D15: the stored category names ('Channels', 'Publishers', ...) match none of the 13 new
		// category names, so filling only when undefined (like the other upgrade scripts do) would
		// leave every category off for an upgraded connection; every one is turned on instead
		config.preset_categories = PRESET_CATEGORY_IDS.slice()
		result.updatedConfig = config
	}

	return result
}

// The order is part of the contract: scripts are only ever appended, never reordered or removed.
module.exports = [
	// v2.2.0: default values for use_api_v2 / verbose
	setDefaultConfig,
	// v2.2.0: channelStreaming -> controlStreaming / streamingState
	renameStreaming,
	// v2.3.0: default values for the polling / preview options
	setDefaultConfigV230,
	// v2.6.0: default value (every category) for the new preset_categories setting
	setDefaultConfigV260,
	// v3.0.0: default values (HTTPS off, self-signed accepted) for the connection security settings
	setDefaultConfigV300Https,
	// v3.0.0: Companion-parity control-set rewrite (briefing §7, doc/PARITY.md §2)
	convertToParityV300,
]

module.exports.CONFIG_DEFAULTS = CONFIG_DEFAULTS
module.exports.CONFIG_DEFAULT_KEYS_V220 = CONFIG_DEFAULT_KEYS_V220
module.exports.CONFIG_DEFAULT_KEYS_V230 = CONFIG_DEFAULT_KEYS_V230
module.exports.CONFIG_DEFAULT_KEYS_V260 = CONFIG_DEFAULT_KEYS_V260
module.exports.CONFIG_DEFAULT_KEYS_V300_HTTPS = CONFIG_DEFAULT_KEYS_V300_HTTPS
module.exports.REMOVED_LEGACY = REMOVED_LEGACY
