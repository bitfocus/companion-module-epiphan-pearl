/**
 * Test harness: replaces '@companion-module/base' in require.cache with a recording stub.
 *
 * IMPORTANT: require this file (or call installStub()) BEFORE anything requires src/instance.js,
 * otherwise the real InstanceBase is bound into the module's prototype chain.
 *
 *   const { createInstance, runAction, runFeedback } = require('./harness')
 *   const { startMockPearl } = require('./mock-pearl')
 *   const mock = await startMockPearl()
 *   const instance = await createInstance({ mock, config: { poll_archive: true } })
 *   await runAction(instance, 'recorderControlAll', { action: 'start' })
 *   instance.calls.log            // [{ level, message }]
 *   instance.calls.status         // [{ status, message }]
 *   instance.definitions.actions  // last setActionDefinitions() payload
 *   instance.variableValues       // merged setVariableValues() payloads
 *   instance.checkedFeedbacks     // [[...ids], ...] one entry per checkFeedbacks() call
 *   await instance.destroy(); await mock.close()
 */
const Module = require('node:module')
const path = require('node:path')

// ---------------------------------------------------------------------------
// Values copied from @companion-module/base (dist/module-api/enums.js, dist/util.js)
// ---------------------------------------------------------------------------

const InstanceStatus = Object.freeze({
	Ok: 'ok',
	Connecting: 'connecting',
	Disconnected: 'disconnected',
	ConnectionFailure: 'connection_failure',
	BadConfig: 'bad_config',
	UnknownError: 'unknown_error',
	UnknownWarning: 'unknown_warning',
	AuthenticationFailure: 'authentication_failure',
})

const Regex = Object.freeze({
	IP: '/^(?:(?:25[0-5]|2[0-4][0-9]|[01]?[0-9][0-9]?)\\.){3}(?:25[0-5]|2[0-4][0-9]|[01]?[0-9][0-9]?)$/',
	HOSTNAME:
		'/^(([a-zA-Z0-9]|[a-zA-Z0-9][a-zA-Z0-9-]*[a-zA-Z0-9])\\.)*([A-Za-z0-9]|[A-Za-z0-9][A-Za-z0-9-]*[A-Za-z0-9])$/',
	BOOLEAN: '/^(true|false|0|1)$/i',
	PORT: '/^([1-9]|[1-8][0-9]|9[0-9]|[1-8][0-9]{2}|9[0-8][0-9]|99[0-9]|[1-8][0-9]{3}|9[0-8][0-9]{2}|99[0-8][0-9]|999[0-9]|[1-5][0-9]{4}|6[0-4][0-9]{3}|65[0-4][0-9]{2}|655[0-2][0-9]|6553[0-4])$/',
	MAC_ADDRESS: '/^(?:[a-fA-F0-9]{2}:){5}([a-fA-F0-9]{2})$/',
	PERCENT: '/^(100|[0-9]|[0-9][0-9])$/',
	FLOAT: '/^([0-9]*\\.)?[0-9]+$/',
	SIGNED_FLOAT: '/^[+-]?([0-9]*\\.)?[0-9]+$/',
	FLOAT_OR_INT: '/^([0-9]+)(\\.[0-9]+)?$/',
	NUMBER: '/^\\d+$/',
	SIGNED_NUMBER: '/^[+-]?\\d+$/',
	SOMETHING: '/^.+$/',
	TIMECODE: '/^(0*[0-9]|1[0-9]|2[0-4]):(0*[0-9]|[1-5][0-9]|60):(0*[0-9]|[1-5][0-9]|60):(0*[0-9]|[12][0-9]|30)$/',
})

function combineRgb(r, g, b, a) {
	let colorNumber = ((r & 0xff) << 16) | ((g & 0xff) << 8) | (b & 0xff)
	if (a && a >= 0 && a < 1) {
		colorNumber += 0x1000000 * Math.round(255 * (1 - a))
	}
	return colorNumber
}

function splitRgb(color) {
	if (typeof color === 'number') {
		return {
			r: (color >> 16) & 0xff,
			g: (color >> 8) & 0xff,
			b: color & 0xff,
			a: color > 0xffffff ? 1 - ((color >>> 24) & 0xff) / 255 : 1,
		}
	}
	return { r: 0, g: 0, b: 0, a: 1 }
}

function literal(v) {
	return v
}

function runEntrypoint() {
	// no-op in tests
}

function emptyUpgradeResult() {
	return { updatedConfig: null, updatedActions: [], updatedFeedbacks: [] }
}

function EmptyUpgradeScript() {
	return emptyUpgradeResult()
}

function CreateConvertToBooleanFeedbackUpgradeScript(upgradeMap) {
	const fn = function convertToBooleanFeedbacks() {
		return emptyUpgradeResult()
	}
	fn.upgradeMap = upgradeMap
	return fn
}

function CreateUseBuiltinInvertForFeedbacksUpgradeScript(upgradeMap) {
	const fn = function useBuiltinInvert() {
		return emptyUpgradeResult()
	}
	fn.upgradeMap = upgradeMap
	return fn
}

// ---------------------------------------------------------------------------
// Recording InstanceBase stub
// ---------------------------------------------------------------------------

class InstanceBase {
	constructor(internal) {
		this.id = internal?.id ?? 'test'
		this.label = internal?.label ?? 'pearl'
		this.upgradeScripts = internal?.upgradeScripts ?? []

		this.calls = { log: [], status: [] }
		this.definitions = { actions: {}, feedbacks: {}, presets: {}, variables: [] }
		this.variableValues = {}
		this.checkedFeedbacks = []
		this.customVariables = {}
		this.savedConfig = undefined
		this.subscribeFeedbacksCalls = []
		this.subscribeActionsCalls = []
	}

	log(level, message) {
		this.calls.log.push({ level, message })
	}

	updateStatus(status, message) {
		this.calls.status.push({ status, message })
	}

	setActionDefinitions(actions) {
		this.definitions.actions = actions
	}

	setFeedbackDefinitions(feedbacks) {
		this.definitions.feedbacks = feedbacks
	}

	setPresetDefinitions(presets) {
		this.definitions.presets = presets
	}

	setVariableDefinitions(variables) {
		this.definitions.variables = variables
	}

	setVariableValues(values) {
		for (const [k, v] of Object.entries(values || {})) {
			if (v === undefined) delete this.variableValues[k]
			else this.variableValues[k] = v
		}
	}

	getVariableValue(variableId) {
		return this.variableValues[variableId]
	}

	setCustomVariableValue(variableName, value) {
		this.customVariables[variableName] = value
	}

	checkFeedbacks(...feedbackTypes) {
		this.checkedFeedbacks.push(feedbackTypes)
	}

	checkFeedbacksById() {
		// not used by the module; no-op
	}

	subscribeFeedbacks(...types) {
		this.subscribeFeedbacksCalls.push(types)
	}

	unsubscribeFeedbacks() {}

	subscribeActions(...types) {
		this.subscribeActionsCalls.push(types)
	}

	unsubscribeActions() {}

	saveConfig(config) {
		this.savedConfig = config
	}

	async parseVariablesInString(text) {
		return text
	}

	oscSend() {}
}

// ---------------------------------------------------------------------------
// require.cache injection
// ---------------------------------------------------------------------------

const stub = {
	InstanceBase,
	InstanceStatus,
	Regex,
	combineRgb,
	splitRgb,
	literal,
	runEntrypoint,
	EmptyUpgradeScript,
	CreateConvertToBooleanFeedbackUpgradeScript,
	CreateUseBuiltinInvertForFeedbacksUpgradeScript,
	__isPearlTestStub: true,
}

let installedAt = null

/**
 * Install the stub for '@companion-module/base' into require.cache. Idempotent.
 * @returns {object} the stub module exports
 */
function installStub() {
	if (installedAt && require.cache[installedAt]?.exports?.__isPearlTestStub) return stub

	const baseId = require.resolve('@companion-module/base', { paths: [path.join(__dirname, '..')] })
	const existing = require.cache[baseId]
	if (existing && existing.exports && existing.exports.__isPearlTestStub) {
		installedAt = baseId
		return stub
	}

	const m = new Module(baseId, null)
	m.filename = baseId
	m.paths = Module._nodeModulePaths(path.dirname(baseId))
	m.loaded = true
	m.exports = stub
	require.cache[baseId] = m
	installedAt = baseId
	return stub
}

// ---------------------------------------------------------------------------
// Instance factory and helpers
// ---------------------------------------------------------------------------

const DEFAULT_CONFIG = Object.freeze({
	host: '127.0.0.1',
	username: 'admin',
	password: 'x',
	pollfreq: 300,
	timeout: 2000,
	use_api_v2: true,
	preview_interval: 0,
	preview_width: 144,
	poll_events: true,
	poll_archive: true,
	poll_connectivity: false,
	verbose: false,
})

/**
 * Build and initialise an EpiphanPearl instance pointed at a mock server.
 *
 * @param {object} opts
 * @param {object} opts.mock       result of startMockPearl()
 * @param {object} [opts.config]   config overrides
 * @returns {Promise<import('../src/instance').EpiphanPearl>}
 */
async function createInstance({ config = {}, mock } = {}) {
	installStub()
	if (!mock || typeof mock.port !== 'number') {
		throw new Error('createInstance({ mock }) requires the object returned by startMockPearl()')
	}
	// required lazily so the stub is in place before src/instance.js binds InstanceBase
	const { EpiphanPearl } = require(path.join(__dirname, '..', 'src', 'instance.js'))

	const fullConfig = { ...DEFAULT_CONFIG, host_port: mock.port, ...config }
	const instance = new EpiphanPearl({ id: 'test', upgradeScripts: [], _isInstanceBaseProps: true })
	instance.mock = mock
	await instance.init(fullConfig)
	// init returns before the device is contacted (Companion limits its duration); wait for the first poll
	await instance.startupPromise
	return instance
}

function actionContext() {
	return { parseVariablesInString: async (text) => text }
}

/**
 * Run an action callback by id, the way Companion would.
 */
async function runAction(instance, actionId, options = {}) {
	const def = instance.definitions.actions[actionId]
	if (!def) throw new Error(`Unknown action '${actionId}' (is it defined for the current state?)`)
	if (typeof def.callback !== 'function') throw new Error(`Action '${actionId}' has no callback`)
	return await def.callback({ actionId, options, id: 'a1', controlId: 'c1' }, actionContext())
}

function feedbackEvent(def, feedbackId, options) {
	return {
		feedbackId,
		options,
		id: 'f1',
		controlId: 'c1',
		type: def.type,
		image: { width: 72, height: 72 },
	}
}

/**
 * Run a feedback callback by id and return its result (boolean or advanced style object).
 */
async function runFeedback(instance, feedbackId, options = {}) {
	const def = instance.definitions.feedbacks[feedbackId]
	if (!def) throw new Error(`Unknown feedback '${feedbackId}' (is it defined for the current state?)`)
	if (typeof def.callback !== 'function') throw new Error(`Feedback '${feedbackId}' has no callback`)
	return await def.callback(feedbackEvent(def, feedbackId, options), actionContext())
}

/**
 * Invoke a feedback definition's subscribe() hook (used by the preview feedbacks).
 */
async function subscribeFeedback(instance, feedbackId, options = {}) {
	const def = instance.definitions.feedbacks[feedbackId]
	if (!def) throw new Error(`Unknown feedback '${feedbackId}'`)
	if (typeof def.subscribe === 'function') return await def.subscribe(feedbackEvent(def, feedbackId, options))
	return undefined
}

/**
 * Invoke a feedback definition's unsubscribe() hook.
 */
async function unsubscribeFeedback(instance, feedbackId, options = {}) {
	const def = instance.definitions.feedbacks[feedbackId]
	if (!def) throw new Error(`Unknown feedback '${feedbackId}'`)
	if (typeof def.unsubscribe === 'function') return await def.unsubscribe(feedbackEvent(def, feedbackId, options))
	return undefined
}

module.exports = {
	installStub,
	createInstance,
	runAction,
	runFeedback,
	subscribeFeedback,
	unsubscribeFeedback,
	DEFAULT_CONFIG,
	stub,
	InstanceBase,
	InstanceStatus,
	Regex,
	combineRgb,
	splitRgb,
	runEntrypoint,
	EmptyUpgradeScript,
	CreateConvertToBooleanFeedbackUpgradeScript,
	CreateUseBuiltinInvertForFeedbacksUpgradeScript,
}
