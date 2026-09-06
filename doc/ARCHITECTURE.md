# Architecture and implementation contract (v3.0.0 — Companion parity)

This document is the contract every source file in `src/` follows. It exists so the module can be worked
on file-by-file without the pieces drifting apart. Keep it current when behaviour changes.

Reference API spec: `doc/pearl-api-v2.0.yaml` (Pearl REST API v2.0, firmware >= 4.24.1). Legacy v1 API
(`/api/...`) is still served by the same firmware and is used for the handful of things v2.0 does not
expose (see "Legacy-only endpoints").

The module's control set (actions, feedbacks, variables, presets) is defined by
`doc/PARITY.md` (the Phase 0 contract that maps every Stream Deck action of the sibling
`Epiphan-StreamDeck` plugin onto this module) and the decisions recorded under its "Decisions taken"
heading (D1–D16, see "Decisions" at the end of this document). Where this file and `doc/PARITY.md`
disagree about what the target _should_ be, `doc/PARITY.md` wins; this file describes what the code
_does_, including the handful of judgment calls the parity documents left open (each one is called out
where it applies, with its rationale).

## File layout

```
index.js              entrypoint only: require('./src/instance') + runEntrypoint
src/instance.js       EpiphanPearl extends InstanceBase; wires everything; exports { EpiphanPearl, upgradeScripts, PearlApiError, MIN_API_V2_VERSION, normaliseConfig }
src/api.js            request layer (mixin methods: request, sendRequest, fetchPreviewImage, dispatcher/clock helpers)
src/poller.js         polling + state diff + variable/feedback refresh (mixin methods)
src/choices.js         dropdown choice builders (mixin methods)
src/actions.js        getActions()            -> action definitions; also mixes in confirm.js + rotary.js
src/feedbacks.js      getFeedbacks()          -> feedback definitions
src/variables.js      buildVariables(self)    -> { definitions, values } ; updateVariables(self)
src/presets.js        getPresets()            -> preset definitions; exports PRESET_CATEGORY_IDS, normalisePresetCategories
src/config.js         getConfigFields()
src/upgrades.js       upgrade scripts array; exports REMOVED_LEGACY, CONFIG_DEFAULTS
src/style.js          shared palette / state words / standard texts / style helpers (restStyle, stateStyle)
src/icons.js          base64 PNG icons, one per preset category, drawn on every generated preset
src/confirm.js        two-press confirm gate mixin (D2)
src/rotary.js         rotary-tick / rapid-press coalescing mixin (D4)
src/audio.js          pure helpers for an input's audio gain/delay read-modify-write and its levels
src/meter.js          audio level meter: the RGBA drawing helpers + the 500 ms level-poll mixin
src/utils.js          pure helpers (formatting, sanitising, diffing, toggle/aggregate rules)
test/mock-pearl.js    in-memory HTTP mock of the Pearl (v2.0 + the legacy endpoints still used)
test/harness.js       stub of @companion-module/base injected via require.cache
test/*.test.js        node:test suites
```

All `src/*.js` files are CommonJS (`module.exports`), ES2022 syntax, tabs, no semicolons,
single quotes (prettier config from `@companion-module/tools`). Mixin files export an
object of methods that `instance.js` copies onto the class prototype with
`Object.assign(EpiphanPearl.prototype, api, poller, choices, actions, feedbacks, presets, meter)`.
`actions.js` itself re-exports `confirm.js` and `rotary.js` (`module.exports = { ...confirm, ...rotary,
getActions, nudgeInputAudio }`), so that one `Object.assign` line also installs `confirmGate`,
`isConfirmPending`, `clearConfirm`, `clearConfirmTimer`, `coalesce` and `clearRotaryTimers` without a
separate entry in `instance.js`. Inside every mixin method `this` is the instance.

## Instance state (`this.state`)

Built fresh on every poll (`utils.emptyState()` plus what the poll filled in) and swapped in atomically.
Never mutate `this.state` from actions except for the documented optimistic updates (`output.source`/
`.setAt`, `storage.hint`, `lastConfigPreset`, `presetStatus`, `powerStatus`, `lastError`). The level poll
(`src/meter.js`) is the one other writer: it replaces `inputs[sid].levels`/`.audioState` in place, ten
times more often than a poll runs, and the poller carries both fields over into the state it swaps in.

```js
this.state = {
	channels: {
		[cid]: {
			id,
			name,
			layouts: { [lid]: { id, name, active } }, // from legacy GET /api/channels/{cid}/layouts
			publishers: { [pid]: { id, type, name, status } }, // status = PublisherStatus schema
			active_layout: { id, name } | undefined, // v2 only; legacy layouts list wins when v2 disagrees is impossible (v2 wins over v1's own active flag)
		},
	},
	recorders: { [rid]: { id, name, multisource, status /* RecorderStatus */ } },
	inputs: {
		[sid]: {
			id, name, type, audio, video, real_device_name,
			levels: { rms: [number], peak: [number] } | undefined, // legacy GET /api/sources/status, see "Audio meter"
			audioState: string | undefined, // e.g. 'active' | 'inactive', from the same legacy entry
			settings: object | undefined, // GET /inputs/{sid}/settings, audio-capable inputs only (feeds input_<id>_gain/_delay)
		},
	},
	outputs: { [did]: { id, name, source /* optimistic, carried across polls */, setAt /* ms, Date.now() of the last Companion-initiated set */ } },
	storages: { [stid]: { id, status /* StorageStatus|undefined */, hint /* {text,until}|undefined, optimistic, carried across polls */ } },
	singleTouch: { [stcid]: { id, state /* SingleTouchControlState|undefined */ } },
	presets: [{ name, description, sections, readonly }], // configuration presets on the device
	events: { upcoming: Event|null, ongoing: Event|null, list: Event[] }, // list = last GET /schedule/events?limit=10 (D5, feeds choicesEventRefs())
	systemStatus: SystemStatus | undefined,
	firmware: FirmwareDetails | undefined,
	identity: DeviceIdentity | undefined,
	afu: [IdentifiedAfuStatus], // [] when unknown
	lastConfigPreset: { name, appliedAt } | undefined, // optimistic: no read endpoint for the currently applied preset
	presetStatus: { text, until } | undefined, // set by the `preset` action when the device reports a reboot ('Rebooting…', 60 s)
	powerStatus: { text, until } | undefined, // set by the `power` action ('Command sent', 30 s)
	lastError: string | undefined, // message of the most recently failed action; exposed as the last_error variable
}
```

Dropped relative to the pre-3.0.0 shape (no Stream Deck counterpart, see `doc/PARITY.md` §2.6): `encoders`
on each channel, `lastFile` on each recorder, `connectivity`, `speedtest`, and the module-level `metadata`
map (content metadata, `fetchMetadata()`) — all removed along with the actions/feedbacks/variables/config
fields that only existed to expose them.

`{ text, until }` markers (`presetStatus`, `powerStatus`, `storages[id].hint`) are rendered by
`variables.js`'s `activeText()` helper: the text shows only while `Date.now() < until`; once expired the
variable reads `''` without anything having to clear the marker explicitly (the poller still carries the
stale object over — clearing on read, not on write, keeps the poller's carry-over logic a one-liner).

### Other instance fields

- `this.apiBasePath` = `'/api'` or `'/api/v2.0'` (decided by `determineApiBase()` in every `configUpdated()`); `this.isV2` getter = `this.apiBasePath === '/api/v2.0'`.
- `this.previews = { [key]: { png64, fetchedAt } }` where key is `channel:<cid>`, `input:<sid>`, `output:<did>` or `layout:<cid>-<lid>`.
- `this.previewSubscriptions = Map<key, count>` maintained by the `preview` / `layout_preview` feedbacks' subscribe/unsubscribe. Keys are registered regardless of `preview_interval` (Companion calls `subscribe` only once per feedback); `resubscribePreviews()` re-sends `subscribeFeedbacks('preview', 'layout_preview')` after every `configUpdated()`.
- `this.meterSubscriptions = Map<inputId, count>` maintained the same way by the `audio` feedback's subscribe/unsubscribe; the 500 ms level poll runs while it is non-empty (see "Audio meter"). Unlike the preview keys these are **not** rebuilt after a `configUpdated()` (nothing re-sends `subscribe` for them), so `connect()` simply restarts the timer for whatever is still counted here.
- `this.previewFailedKeys = Set<key>` — keys whose most recent fetch failed, so `pollPreviews()` logs a `'warn'` once on failure and once more on recovery instead of every poll; cleared on `configUpdated()`/`destroy()`.
- `this.pollCounter` — incremented every poll (drives "every 30th poll").
- `this.pollFailureCount` — consecutive failed polls; drives the D8 failure backoff (`nextPollDelayMs()`). Reset to 0 by the first successful poll and by every `configUpdated()`.
- `this.pollPromise` — promise of the running poll (`pollAll()` returns it to overlapping callers; `connect()` waits for a stale one before the first poll of a new configuration).
- `this.configGeneration` — incremented by every `configUpdated()` (and by `destroy()`, so a `connect()` still in flight cannot start timers after teardown); a poll started under an older generation discards its result.
- `this.systemUpdateCount` — number of `updateSystem()` calls (used by tests).
- `this.startupPromise` — promise of the background `connect()` started by the last `configUpdated()`.
- `this.timer` (poll, now a chained `setTimeout` handle — see "Poller"), `this.previewTimer`, `this.pollSoonTimer` (750 ms one-shot after a control action, coalesced), `this.meterTimer` (500 ms level poll, also a chained `setTimeout`; `this.meterPollPromise` holds the tick in flight).
- `this.lastVariableIds` — sorted variable ids joined, kept by `variables.updateVariables` to skip a redundant `setVariableDefinitions`.
- `this.clockOffsetMs` — device clock minus host clock, in ms, from the `Date` header of every response (`api.syncClock`); reset to `0` by every `configUpdated()`. `deviceNow()` = `Date.now() + clockOffsetMs`.
- `this.dispatcher` — the `undici` `Agent` requests are sent through, carrying the TLS settings (`use_https` / `accept_self_signed`) of the current configuration; rebuilt by `configUpdated()` (`api.resetDispatcher`), closed by `destroy()` (`api.closeDispatcher`).
- `this.confirmPending = { key, controlId, actionId, label, until }` and `this.confirmTimer` — the single pending two-press confirm (`src/confirm.js`, D2). One slot per instance, not one per button: arming a second button while the first is still armed silently displaces the first rather than tracking both independently (see "Confirm gate" below).
- `this.rotaryPending = Map<key, { total, flush, timer }>` — pending coalesced rotary/rapid-press totals (`src/rotary.js`, D4).
- `this.rotaryWindowMs` / `this.confirmWindowMs` / `this.meterIntervalMs` — optional per-instance overrides of the 150 ms / 3000 ms / 500 ms defaults, read by `coalesce()` / `confirmGate()` / `meterPollIntervalMs()` when set (used by tests; production code never sets them).

## Config fields (`src/config.js`)

| id                 | type          | default         | notes                                                                                                                                                                                                                                                                           |
| ------------------ | ------------- | --------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| info               | static-text   | —               | requirements summary                                                                                                                                                                                                                                                            |
| host               | textinput     | 192.168.255.250 | IP or hostname, validated with `REGEX_IP_OR_HOSTNAME` (see below)                                                                                                                                                                                                               |
| host_port          | textinput     | 80              | `Regex.PORT`; becomes `443` when `use_https` is on and the port was left at `80`/blank (see `normaliseConfig`)                                                                                                                                                                  |
| username           | textinput     | admin           |                                                                                                                                                                                                                                                                                 |
| password           | textinput     | ''              |                                                                                                                                                                                                                                                                                 |
| use_https          | checkbox      | false           | label "Use HTTPS", tooltip verbatim `If HTTPS is enabled on the Pearl, enable it here too.`                                                                                                                                                                                     |
| accept_self_signed | checkbox      | true            | label "Accept self-signed certificate"; `isVisible` only while `use_https` is on                                                                                                                                                                                                |
| poll_interval      | number        | 2000            | "Poll interval (ms)", 500..300000 (D8; replaces the old `pollfreq` seconds field)                                                                                                                                                                                               |
| timeout            | number        | 5000            | "Request timeout (ms)", 1000..60000                                                                                                                                                                                                                                             |
| preview_interval   | number        | 2               | "Preview image refresh interval (s, 0 disables previews)", 0..300 (D10: module-wide, seconds; the Stream Deck's per-key `refreshMs` has no Companion equivalent)                                                                                                                |
| preview_width      | number        | 144             | "Preview image width (px)", 72..720 (D10)                                                                                                                                                                                                                                       |
| poll_events        | checkbox      | true            | "Poll CMS schedule"                                                                                                                                                                                                                                                             |
| verbose            | checkbox      | false           | "Enable verbose logging"                                                                                                                                                                                                                                                        |
| use_api_v2         | checkbox      | true            | "Use API v2.0 (if available)"; kept last among the operational settings, immediately before `preset_categories` (D9)                                                                                                                                                            |
| preset_categories  | multidropdown | every category  | "Preset categories to generate"; which categories `getPresets()` generates (see "Presets" and `PRESET_CATEGORY_IDS` in `src/presets.js`); an id outside the D15 list is dropped, an absent/non-array value defaults to all, an explicit `[]` is respected as "generate nothing" |

Removed (D8, no Stream Deck counterpart): `pollfreq` (seconds; converted to `poll_interval` by the upgrade
script), `poll_archive`, `poll_connectivity`.

Companion's `Regex.IP` and `Regex.HOSTNAME` are single anchored patterns, so `config.js` builds its own
`REGEX_IP_OR_HOSTNAME` constant (`/^(?:<IP>|<HOSTNAME>)$/`, both patterns with their slashes and anchors
stripped and combined as alternatives) and exports it alongside `getConfigFields`
(`module.exports = { getConfigFields, get_config_fields, REGEX_IP_OR_HOSTNAME }`). The field labels are the
user-facing names used in `companion/HELP.md`; keep both in sync. `preset_categories`'s choices/default come
from `presets.js`'s `PRESET_CATEGORY_IDS` (imported by `config.js`), not hand-copied here.

`normaliseConfig(config)` (exported from `src/instance.js`) coerces `use_https` / `accept_self_signed` to
real booleans (anything but `true` counts as off / on respectively); when `use_https` is on and `host_port`
was left at `80` or blank, rewrites `host_port` to `443` (a port the caller set explicitly, including `443`
itself, is never touched again); clamps `poll_interval` to 500..300000 with a 2000 default (D8); and runs
`presets.normalisePresetCategories()` on `preset_categories`.

### Upgrade scripts (`src/upgrades.js`)

Companion runs each upgrade script exactly once per connection and remembers how far it got, so an existing
script must never be extended — a field or id added later gets its own script, appended to the exported
array. The order is part of the contract and is only ever appended to:

1. `setDefaultConfig` (v2.2.0) — fills `use_api_v2` / `verbose` when undefined.
2. `renameStreaming` (v2.2.0) — renames the pre-2.2.0 `channelStreaming` action/feedback ids to
   `controlStreaming` / `streamingState` so the newer rules below (and, historically, later scripts) see a
   consistent id.
3. `setDefaultConfigV230` (v2.3.0) — fills `timeout`, `preview_interval`, `preview_width`, `poll_events`,
   `poll_archive`, `poll_connectivity`.
4. `setDefaultConfigV260` (v2.6.0) — fills `preset_categories` (every category the connection already had,
   under the pre-3.0.0 category names).
5. `setDefaultConfigV300Https` (v3.0.0) — fills `use_https` (`false`) / `accept_self_signed` (`true`), so an
   upgraded connection keeps using plain HTTP until it opts in.
6. `convertToParityV300` (v3.0.0) — the Companion-parity control-set rewrite (`doc/PARITY.md` §2, briefing
   §4 D1–D16, §7): converts every legacy action id, feedback id and config field to its 3.0.0 counterpart
   (tables below); anything with no Stream Deck counterpart is left exactly as stored (an upgrade script has
   no way to delete a placed action/feedback instance) and is only recorded via `recordRemovedLegacy()`.

`CONFIG_DEFAULTS` holds the default value for every field any of scripts 1–5 can fill, keyed by field name;
tests compare it against the config field defaults with `assert.deepEqual` (some, like `preset_categories`,
are arrays). `fillConfigDefaults(keys)` builds a script from a list of keys into `CONFIG_DEFAULTS`.

**Action id conversions** (`convertToParityV300`, legacy → new, `doc/PARITY.md` §2.1):

| legacy id                                                                                                                                                                                                                                                                                                                                                                                                                                    | new id        | option translation                                                                                                       |
| -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------- | ------------------------------------------------------------------------------------------------------------------------ |
| `channelChangeLayout {channelIdlayoutId}`                                                                                                                                                                                                                                                                                                                                                                                                    | `layout`      | `channelId = cid`, `layoutId = 'cid-lid'`, `layoutIdManual = ''`                                                         |
| `controlStreaming {channelIdpublisherId, startStopAction}`                                                                                                                                                                                                                                                                                                                                                                                   | `stream`      | `channelId = cid`, `publisherId = 'cid-pid'\|'cid-all'`, `op`: `RECORDER`-style map `0`→stop, `1`→start, `3`/`99`→toggle |
| `recorderRecording {recorderId, startStopAction}`                                                                                                                                                                                                                                                                                                                                                                                            | `recorder`    | `op`: `0`→stop, `1`→start, `2`→reset, `3`/`99`→toggle                                                                    |
| `recorderControlAll {action}`                                                                                                                                                                                                                                                                                                                                                                                                                | `recorder`    | `recorderId = 'all'`, `op` copied through (already the string `'start'`/`'stop'`, not the numeric code above)            |
| `insertMarker {channel, markertext}`                                                                                                                                                                                                                                                                                                                                                                                                         | `bookmark`    | `channelId = channel`, `text = markertext \|\| 'Marker'`, `appendTime = false`                                           |
| `systemReboot`                                                                                                                                                                                                                                                                                                                                                                                                                               | `power`       | `op = 'reboot'`, `confirm = false` (an existing button fired immediately; keeps doing so)                                |
| `systemShutdown`                                                                                                                                                                                                                                                                                                                                                                                                                             | `power`       | `op = 'shutdown'`, `confirm = false`                                                                                     |
| `setOutputSource {output, source, customSource}`                                                                                                                                                                                                                                                                                                                                                                                             | `output`      | `outputId = output`, `source = source === 'custom' ? customSource : source`                                              |
| `inputAudioGain {input}`                                                                                                                                                                                                                                                                                                                                                                                                                     | `audio`       | `inputId = input`, `control = 'gain'`, `direction = 'up'`, `step = 1` (D11: the absolute value is not carried over)      |
| `inputAudioDelay {input}`                                                                                                                                                                                                                                                                                                                                                                                                                    | `audio`       | `inputId = input`, `control = 'delay'`, `direction = 'up'`, `step = 1` (D11)                                             |
| `singleTouchToggle {stc}`                                                                                                                                                                                                                                                                                                                                                                                                                    | `singletouch` | `stcId = stc`                                                                                                            |
| `applyConfigPreset {preset, sections}`                                                                                                                                                                                                                                                                                                                                                                                                       | `preset`      | `presetName = preset`, `sections`, `confirm = false`                                                                     |
| `storageEject {storage}`                                                                                                                                                                                                                                                                                                                                                                                                                     | `storage`     | `storageId = storage`, `confirm = false`                                                                                 |
| `eventControl {event, eventId, action}`                                                                                                                                                                                                                                                                                                                                                                                                      | `event`       | `eventRef = event === 'custom' ? eventId : event`, `op = action`, `extendSeconds = 300`                                  |
| `eventExtend {event, eventId, seconds}`                                                                                                                                                                                                                                                                                                                                                                                                      | `event`       | `eventRef` as above, `op = 'extend'`, `extendSeconds = seconds`                                                          |
| `getLayoutData`, `setLayoutData`, `getContentMetadata`, `setContentMetadata`, `setChannelName`, `setPublisherName`, `setPublisherEnabled`, `setPublisherSingleTouch`, `setRtmpDestination`, `setSrtDestination`, `patchPublisherSettings`, `addPublisher`, `inputAudioMute`, `inputPhantomPower`, `patchInputSettings`, `createNetworkInput`, `createAdhocEvent`, `adhocSessionLogout`, `refreshConnectivity`, `runSpeedTest`, `refreshPoll` | removed       | no Stream Deck counterpart; recorded via `recordRemovedLegacy('action', id, controlId)` (D13)                            |

**Feedback id conversions** (`doc/PARITY.md` §2.2):

| legacy id                                                                      | new id               | option translation                                                                                                           |
| ------------------------------------------------------------------------------ | -------------------- | ---------------------------------------------------------------------------------------------------------------------------- |
| `channelLayout {channelIdlayoutId}`                                            | `layout_active`      | `layoutId = value`                                                                                                           |
| `channelLayoutPreview {channelIdlayoutId}`                                     | `layout_preview`     | `layoutId = value`                                                                                                           |
| `streamingState {channelIdpublisherId}`                                        | `stream_state`       | `publisherId = value`, `state = 'started'`                                                                                   |
| `publisherState {channelIdpublisherId, state}`                                 | `stream_state`       | `publisherId`, `state`                                                                                                       |
| `recorderRecording {recorderId}`                                               | `recorder_state`     | `state = 'started'`                                                                                                          |
| `recorderState {recorderId, state}`                                            | `recorder_state`     | same                                                                                                                         |
| `anyRecording`                                                                 | `recorder_state`     | `recorderId = 'all'`, `state = 'started'`                                                                                    |
| `singleTouchPressed {stcId}`                                                   | `singletouch_active` | `state = 'on'`                                                                                                               |
| `singleTouchOk {stcId}`                                                        | `singletouch_active` | `state = 'error'`, `isInverted` flipped                                                                                      |
| `storageState {storageId, state}`                                              | `storage_level`      | `ready`→`ok`, `nodev`→`nomedia`, `dev`→`notready`, `devro`→`ro`, `formatting`→`formatting`                                   |
| `storageFreeBelow {storageId}`                                                 | `storage_level`      | `level = 'low'` (the percent option is dropped — the new feedback uses fixed 90 %/97 % thresholds)                           |
| `afuState {state}`                                                             | `system`             | `idle`→`afu_idle`, `paused`→`afu_paused`, `uploading`→`afu_uploading`, `error`→`afu_error`, `disabled`→`afu_off`             |
| `cpuLoadHigh`                                                                  | `system`             | `condition = 'cpu_high'`                                                                                                     |
| `cpuTempHigh`                                                                  | `system`             | `condition = 'cpu_hot'`                                                                                                      |
| `eventStatus {which}`                                                          | `event_state`        | `upcoming`→`{upcoming,scheduled}`, `running`→`{ongoing,running}`, `paused`→`{ongoing,paused}`, `ongoing`→`{ongoing,ongoing}` |
| `channelPreview {channel}` / `inputPreview {input}` / `outputPreview {output}` | `preview`            | `source = 'channel'\|'input'\|'output'`, `sourceId` = the legacy option's value                                              |
| `outputSourceOptimistic {output, source}`                                      | `output_set`         | `outputId = output`, `source`                                                                                                |
| `anyStreaming`, `configPresetApplied`                                          | removed              | no Stream Deck counterpart; recorded via `recordRemovedLegacy('feedback', id, controlId)` (D13)                              |

**Config field conversion**: `poll_interval = clampNumber(clampNumber(pollfreq, 10, 1, 300) * 1000, 2000, 500, 300000)`, then `pollfreq` / `poll_archive` / `poll_connectivity` are deleted; `preset_categories` is unconditionally set to every D15 category (the stored pre-3.0.0 category names match none of the 13 new ones, so filling only when undefined — the pattern every other upgrade script uses — would leave every category off for an upgraded connection).

**D13 — reporting removed legacy ids.** Upgrade scripts run before any module instance exists, so they
cannot call `this.log`. `convertToParityV300` instead pushes `{ kind: 'action'|'feedback', id, controlId }`
into the exported, module-level `REMOVED_LEGACY` array as it finds them. `instance.js`'s `init()` calls
`reportRemovedLegacy()` once, which groups the array by `kind:id`, logs one `'warn'` line per distinct id
(naming how many buttons carried it) of the form:

> Removed legacy action 'refreshPoll' (2 buttons): no longer available after the 3.0.0 Companion-parity
> rewrite. Remove it from the affected button(s) or replace it with its listed counterpart (see
> CHANGELOG.md).

and then empties the array, so a second `init()` in the same process (or a second connection instance
sharing the process — a standing assumption, not verified against a real Companion host) does not repeat it.

## Request layer (`src/api.js`)

```js
/**
 * @param {'GET'|'POST'|'PUT'|'PATCH'|'DELETE'} method
 * @param {string} path      path WITHOUT the /api prefix, e.g. '/channels/1/publishers/status'.
 *                           For backwards compat a path starting with '/api/' has that prefix stripped.
 * @param {object} [opts]
 * @param {object} [opts.query]    key/value; booleans -> 'true'/'false'; undefined/null skipped
 * @param {object} [opts.body]     JSON body (only for non-GET)
 * @param {'auto'|'v1'|'raw'} [opts.base='auto']  auto = this.apiBasePath, v1 = '/api', raw = path used verbatim (e.g. '/admin/...')
 * @param {number} [opts.timeout]  ms, default this.config.timeout (5000)
 * @param {boolean} [opts.raw]     return Buffer of the response body instead of parsed JSON result
 * @param {boolean} [opts.text]    return the response body as a string (text/plain endpoints)
 * @param {boolean} [opts.optional] 404/405 return null instead of throwing, and do not touch instance status
 * @param {boolean} [opts.silent]  do not log errors (caller handles)
 * @returns {Promise<any>} the `result` field of the JSON envelope ({status:'ok', result}), the whole
 *                         body when there is no result field, `true` for an ok envelope with no result,
 *                         Buffer when raw, string when text, null when optional and not found.
 * @throws {PearlApiError} with .status (HTTP code), .apiStatus (envelope status string), .message
 */
async request(method, path, opts = {})
```

Behaviour:

- Uses `undici`'s `fetch` (imported explicitly — `const { fetch, Agent } = require('undici')` — not the
  global one, so requests run on a Node.js HTTP implementation independent of whatever Node version
  Companion embeds) with `AbortSignal.timeout(timeout)` (a real timeout).
- URL scheme is `https` when `config.use_https === true`, else `http`; the port is `config.host_port`
  (already defaulted to `443` by `normaliseConfig` when HTTPS is on and the port was left at `80`/blank).
  Every request carries `dispatcher: this.ensureDispatcher()`, an `undici` `Agent` built by
  `createDispatcher(config)` with `connect: { rejectUnauthorized: !(use_https && accept_self_signed) }` —
  the only way a self-signed certificate is accepted is that flag on that Agent; `NODE_TLS_REJECT_UNAUTHORIZED`
  is never touched (that would blind the whole Node process, not just this connection). `resetDispatcher()` /
  `closeDispatcher()` / `ensureDispatcher()` manage `this.dispatcher` (built in `configUpdated()`, closed
  gracefully in `configUpdated()` and `destroy()` so requests already in flight on the old Agent can finish).
- `Authorization: Basic` header from config; `Content-Type: application/json` when a body is sent.
- On every response that comes back at all (a fetch that fails before a response arrives — e.g. a TLS or
  timeout failure — has none to read), `syncClock(response)` reads the `Date` header, parses it, and — when
  the resulting offset from `Date.now()` differs from the stored `this.clockOffsetMs` by 2000 ms
  (`CLOCK_SLACK_MS`) or more — replaces `this.clockOffsetMs` with it (a smaller change is within the
  header's 1 s resolution and is ignored). `deviceNow()` returns `Date.now() + this.clockOffsetMs`;
  `variables.js` uses it (not `Date.now()`) as "now" for the event countdown variables, so a Pearl whose
  clock disagrees with the Companion host still counts down correctly.
- A TLS failure (untrusted self-signed certificate, wrong host, etc.) surfaces through the same catch
  branch as any other network error — `error.cause.code` from Node's TLS stack (e.g.
  `DEPTH_ZERO_SELF_SIGNED_CERT`) is included in the logged message and the `ConnectionFailure` status.
- 401/403 -> `updateStatus(InstanceStatus.AuthenticationFailure, ...)` and throw.
- Network error / timeout -> `updateStatus(InstanceStatus.ConnectionFailure, message)` and throw.
- Other non-2xx -> parse `{status, message}` if JSON, throw `PearlApiError`; do NOT change instance status
  (a 404 from a user action is not a connection problem). Log at 'error' unless `silent`.
- Envelope with `status !== 'ok'` -> throw `PearlApiError` with the envelope message.
- On success, set `InstanceStatus.Ok` only if the current status is not already Ok (`applyStatus` tracks
  `this.currentStatus`/`this.currentStatusMessage` and skips a redundant `updateStatus` call).
- `this.config.verbose` logs the request line and response body at 'debug'.
- `sendRequest(type, url, body)` is kept as a compatibility wrapper: `request(type.toUpperCase(), url, { body })`.
- `fetchPreviewImage(kind, id)` for kind `channel`/`input`/`output` ->
  `GET /<channels|inputs|outputs>/<id>/preview` with `{ resolution, format: 'png', keep_aspect_ratio: true }`
  (outputs use `resolution: '<w>x<h>'`, h = round(w\*9/16), because the output preview endpoint has no
  `auto`), `raw: true, optional: true` -> base64 string or null. For kind `layout`, `id` is `'<cid>-<lid>'`;
  see the undocumented endpoint below (`base: 'v1'`, no `format`/`keep_aspect_ratio`).
- `PearlApiError` class exported from `api.js`.

### Legacy-only endpoints (always `base: 'v1'`)

| purpose            | request                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               |
| ------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| list layouts       | `GET /channels/{cid}/layouts` -> `[ {id, name, active} ]` (poller, used by the `layout` action's dropdown and `layout_active`)                                                                                                                                                                                                                                                                                                                                                                        |
| layout preview     | `GET /channels/{cid}/layouts/{lid}/preview?resolution=WxH` -> JPEG. **Undocumented** — not in `doc/pearl-api-v2.0.yaml`; confirmed by Epiphan. Renders that layout's own composition regardless of whether it is active. No `format`/`keep_aspect_ratio` (unconfirmed for this endpoint). `fetchPreviewImage('layout', '<cid>-<lid>')`; backs the `layout_preview` feedback.                                                                                                                          |
| recorder reset     | `POST /recorders/{rid}/control/reset` — the `recorder` action's fallback when the v2.0 route 404s (older firmware has no v2.0 reset endpoint; see "Actions").                                                                                                                                                                                                                                                                                                                                         |
| input audio levels | `GET /sources/status` (`optional: true`) -> `[ {id, name, status: {audio: {state, levels: {rms:[], peak:[]}}, video: {...}}} ]`, dBFS. **Requested by the 500 ms level poll only** (`src/meter.js`, while an `audio` feedback is subscribed) — the interval poll never asks for it. Its ids carry a `D2P<serial>.` device prefix the v2.0 `/inputs` ids lack; see "Audio meter" and `utils.normaliseInputId`/`sameInputId`. Feeds the `audio` feedback's image and `input_<id>_peak_*`/`_level_text`. |

Removed along with the 3.0.0 control set (`doc/PARITY.md` §2.6, no Stream Deck counterpart): the admin CGI
content-metadata pair, `/system/connectivity/details`, the speed test endpoint, recorder archive files,
ad-hoc CMS session/event creation, publisher create/rename/settings, channel rename, input creation, and
layout settings GET/PUT.

### v2 parameter conventions that differ from v1

- `PUT /channels/{cid}/layouts/active` -> send `query: { id }` AND `body: { id: Number(id) }` (v1 wants
  body, v2 wants query; both accepted) — used by the `layout` action.
- `POST /channels/{cid}/bookmarks` -> v2 wants `query: { text }`; v1 wants `body: { text }`. The `bookmark`
  action sends both.
- `PUT /outputs/{did}/settings` -> `query: { source }` — used by the `output` action (v2-only endpoint).
- `GET /channels` boolean flags: v2 uses `true`; v1 used `yes`. The poller sends `true` on v2 and `'yes'` on
  v1 for `publishers`.

### Test-only routes kept in the mock beyond what the module itself calls

`GET`/`PUT /channels/:cid/name`, `PATCH /channels/:cid/publishers/:pid/settings` and the admin CGI
`GET get_params.cgi` route back no action or feedback in the 3.0.0 control set (the actions that used to
call them — `setChannelName`, the publisher-settings actions, the content-metadata actions — are all
removed, see `doc/PARITY.md` §2.1). They are kept in `test/mock-pearl.js` purely because
`test/request.test.js` (the Phase 1 request-layer suite) calls them directly as convenient, already-working
text-in/text-out endpoints to exercise `request()`'s generic body/response handling (envelope unwrapping,
404, a 400 on a bad body, `base:'raw'`/`text:true`, `sendRequest`'s compatibility wrapper) — deleting them
would cost 22 otherwise-unrelated green tests to satisfy the letter of the removed-route table for routes
nothing else needs gone. If `test/request.test.js` is ever repointed at still-current endpoints, these three
mock routes can be deleted too.

## Poller (`src/poller.js`)

`async pollAll()` is the only poll entry point (bound to `this.timer`). It must never throw. While a poll is
running `this.pollPromise` holds its promise and an overlapping call returns that promise instead of
starting a second poll. `pollAllInner()` captures `this.configGeneration` at its start and skips the state
swap / feedback checks / variable update when `configUpdated()` changed the generation meanwhile.

**Poll interval and failure backoff (D8).** `pollIntervalMs()` returns `config.poll_interval` clamped
500..300000, default 2000 — `normaliseConfig()` always fills this field (the upgrade script converts any
stored legacy `pollfreq` seconds value before a config ever reaches the instance), so no fallback to the
old field is needed here. `nextPollDelayMs()`
returns that base interval while `pollFailureCount === 0`, otherwise `min(15000, base * 2 ** failures)` — the
delay doubles with every consecutive failed poll and is capped at 15 s; the first successful poll resets
`pollFailureCount` to 0. `instance.js`'s `initInterval()` chains via `setTimeout` (not a fixed `setInterval`)
specifically so this widened delay takes effect between polls, not just on the failure that triggered it.
Why milliseconds and not the old `pollfreq` seconds field: the audio meter (500 ms) and the rotary/confirm
timers already think in milliseconds, and 2000 ms — Companion's own convention for poll-style connections —
is a more useful default than the old 10 s.

**Order of work** (all requests via `Promise.allSettled`; a failed optional request leaves that part of
state empty rather than aborting the whole poll):

1. Core (both API versions): `GET /channels` (`{publishers:true,'publishers-status':true,active_layout:true}`
   on v2, `{publishers:'yes'}` on v1), `GET /recorders`, `GET /recorders/status`. If either of the first two
   rejects, the poll logs `'error'` once (then `'debug'` while it keeps failing, unless verbose) and
   increments `pollFailureCount` — nothing else in this round runs.
2. Legacy layouts per channel (`GET /channels/{cid}/layouts`, always) and, on v1 only, per-channel
   `/publishers/type` + `/publishers/status`. On v2: `GET /system/status`, `GET /afu/status` (optional),
   `GET /inputs` (also fetches `GET /inputs/{sid}/settings` for every audio-capable input, cached at
   `state.inputs[sid].settings` — feeds `input_<id>_gain`/`_delay`), `GET /outputs`, `GET
/system/storages` + per-storage `/status`, `GET
/system/singletouchcontrol` + per-control `/state`, and — when `poll_events` — `GET
/schedule/events/upcoming`, `GET /schedule/events/ongoing` and `GET /schedule/events?limit=10` (the last
   one feeds `state.events.list`, which `choicesEventRefs()` and the `event_state`/`event_applies` feedbacks
   read for a specific event id, D5).
3. On the first poll and then every 30th (`STRUCTURE_REFRESH_EVERY`): `GET /system/firmware`, `GET
/system/ident`, `GET /system/presets?details=true`. In between, the previous values are carried over.
4. Audio levels are **not** part of this poll (they move ten times faster than it runs): the 500 ms level
   poll of "Audio meter" owns `inputs[sid].levels`/`.audioState`, and step 2 only carries the previous
   state's values over so a state swap does not blank a running meter for a tick. Levels are not part of
   `structureKey` or any `DOMAIN_FEEDBACKS` slice either — a level changing never rebuilds definitions and
   only ever checks the `audio` feedback, from the level poll itself.
5. Swap `this.state`. `outputs[did].source`/`.setAt` and `storages[id].hint` are preserved from the previous
   state (optimistic values with no read endpoint); `lastConfigPreset`, `presetStatus`, `powerStatus`,
   `lastError` are copied over unconditionally every poll.
6. Diff: `structureKey(state)` = JSON of ids+names of channels, layouts, publishers, recorders, inputs,
   outputs, storages, single touch, preset names. Changed -> `updateSystem()` (rebuild action/feedback/preset
   definitions) and `checkFeedbacks()` with no ids (Companion's "recheck everything"). Otherwise, per-domain
   JSON slices are compared and `checkFeedbacks(...ids)` is called only for the feedback ids of the domains
   that changed:

   | domain         | feedback ids                   |
   | -------------- | ------------------------------ |
   | `layouts`      | `layout_active`                |
   | `publishers`   | `stream_state`                 |
   | `recorders`    | `recorder_state`               |
   | `storages`     | `storage_level`                |
   | `singleTouch`  | `singletouch_active`           |
   | `afu`          | `system`                       |
   | `systemStatus` | `system`                       |
   | `events`       | `event_state`, `event_applies` |

   (`afu` and `systemStatus` both map to `'system'`; the ids to recheck are collected in a `Set`, so a poll
   where both changed still checks `system` once, not twice.) `output_set` has **no** `DOMAIN_FEEDBACKS`
   entry — its truth is a 5 s time window from `setAt`, not a state diff — so on a poll where nothing else
   changed it is instead rechecked whenever some output's `setAt` is within `5000 + pollIntervalMs()` ms (a
   margin of one poll interval past the nominal 5 s window covers the fall-off even at a slow
   `poll_interval`), and left alone entirely when no output has ever been set.

7. `variables.updateVariables(this)`.

`async pollPreviews()` (bound to `this.previewTimer`, interval `preview_interval` s, only when > 0): for
each key in `this.previewSubscriptions` with count > 0, fetch the image (channel/input/output previews only
on v2; layout previews regardless, since that endpoint is on the legacy base), store in `this.previews`,
then `checkFeedbacks('preview', 'layout_preview')` if anything changed. Keys are fetched
`MAX_CONCURRENT_PREVIEWS` (3) at a time — a page with many preview buttons firing simultaneous requests
overwhelms the embedded device, so most of them would time out instead of a few taking slightly longer. A
key whose fetch returns null is added to `this.previewFailedKeys` and logged at `'warn'` the first time
only; a later success removes it and logs one `'info'` line. A call while a refresh is already running
queues exactly one follow-up refresh (so a key subscribed meanwhile gets its first image) and resolves when
that follow-up is done; an image whose key was unsubscribed while in flight is not cached. No-op while
`preview_interval` is 0 (subscriptions are kept, nothing is fetched).

`updateSystem()` = `setActionDefinitions(getActions())` + `setFeedbackDefinitions(getFeedbacks())` +
`setPresetDefinitions(getPresets())`, each wrapped so one failing step logs `'error'` and does not stop the
others. `schedulePollSoon()` (`instance.js`) is a 750 ms one-shot, coalesced timer that every control action
calls after a successful request so feedbacks/variables update without waiting for the full poll interval.

## Choices (`src/choices.js`)

All return `[{ id, label }]`. `firstId(arr)` -> id of the first entry or `''`; `preferredId(arr, preferred)`
-> `preferred` when present among the ids, else `firstId(arr)`.

- `choicesChannel()` -> id `cid`.
- `choicesLayouts()` -> id `` `${cid}-${lid}` `` (D5 composite), label `` `${channel} – ${layout}` `` (en dash).
- `choicesPublishers()` -> per channel with publishers, `` `${cid}-all` `` (label `Channel – All publishers`)
  first, then `` `${cid}-${pid}` `` (label `Channel – Name (type)`).
- `choicesRecorders()` -> id `rid`; `choicesRecordersWithAll()` -> the same with `all` "All recorders" first.
- `choicesInputs()` -> id `sid`, label `name (type)`; `choicesInputsWithAudio()` / `choicesInputsWithVideo()`
  filter to `audio === true` / `video === true`.
- `choicesOutputs()` -> id `did`.
- `choicesOutputSources()` -> the three built-in sources (`multiview` "Built-in: Multiview", `deviceinfo`
  "Built-in: Device info", `console` "Built-in: Console"), then channels (`Channel: name`), then
  video-capable inputs (`Input: name`) — an output shows a picture, so an audio-only input is never offered.
- `choicesStorages()` -> id `stid`, label = the id (the device gives storages no separate name).
- `choicesSingleTouch()` -> id `stcid`, label `Single touch control <id>`.
- `choicesConfigPresets()` -> id `preset.name`, label `name (description)` when a description exists.
- `choicesPreviewSources()` -> channels ∪ video-capable inputs ∪ outputs, each labelled by domain
  (`Channel:`/`Input:`/`Output:`) — used only by the `preview` feedback's `sourceId` option, since a
  Companion dropdown's choices cannot depend on another option's value (the `source` option itself picks
  which of the three domains the chosen id is looked up in).
- `choicesEventRefs()` -> the five schedule aliases (D5: `upcoming`, `ongoing` (default), `running`,
  `paused`, `completed`), then the events of the last poll (`state.events.list`) labelled `title (status)`,
  deduplicated by id (`Event <id>` when a title is blank).

**D5 rationale (composite ids).** Companion dropdown choices cannot depend on another option's current
value, so a channel-scoped list cannot be "layouts of the channel picked above." Packing the channel into
the id itself (`<cid>-<lid>`, `<cid>-<pid>` / `<cid>-all`) sidesteps that limitation entirely: one dropdown,
already scoped, always in sync with itself. `channelId` still exists as a separate option only where a
composite cannot be produced at all (`layout.layoutIdManual`, a text fallback for firmware that lists no
layouts) — there the plain `channelId` says which channel the typed layout id belongs to.

## Style (`src/style.js`)

The shared palette, state-word list and two style helpers, all sourced from `doc/PARITY.md` §3
(`COMPANION-PARITY.md` §3.1–§3.3):

```js
HEX = { bg:'#1b1d22', text:'#f4f6f8', muted:'#b8c0cc', track:'#2a2e35', badgeText:'#14161a',
  amber:'#f0a83c', red:'#e5484d', green:'#3ccf6a', grey:'#7a8390', cms:'#5aa9ff' }
colors  // same keys, each run through combineRgb() — derived from HEX so hex and combineRgb can never drift apart
STATE_WORDS  // the full §3.2 list (incl. EC20-only words, so both sibling modules can share one source)
TEXT  // { LOADING, OFFLINE, NO_MEDIA, NOTHING_SCHEDULED, NO_ONGOING_EVENT, PICK_A_CHANNEL, STARTING, FINISHED }
restStyle()        -> { bgcolor: colors.bg, color: colors.text }       // every preset at rest
stateStyle(color)  -> { bgcolor: color, color: colors.badgeText }      // a feedback that represents a state
```

`src/feedbacks.js` imports `colors`/`stateStyle` from here rather than defining its own (they were briefly
duplicated during the rewrite; that duplication is gone). Every `defaultStyle`/preset feedback style in this
module is one of these two shapes, or the "grey out an inapplicable command" shape (`{ color: colors.grey }`,
no `bgcolor`, applied via `isInverted`) used by the Bookmarks preset and the CMS events command buttons — see
"Presets".

## Icons (`src/icons.js`)

`module.exports = { ICONS }`, thirteen base64 72×72 transparent PNGs, one per preset category
(`audio bookmark event layout output power preset preview recorder singletouch storage stream system`),
rasterised from the sibling Stream Deck plugin's own `icon.svg` artwork by the lead's render script (white
glyph, same framing the sibling `companion-module-epiphan-ec20` uses) so a Companion preset button visually
matches the Stream Deck key for the same control. `src/presets.js`'s `CATEGORY_ICON` maps every one of the 13
D15 categories onto exactly one of these keys; every generated preset gets its category's icon at
`pngalignment: 'center:top'` with its text at `alignment: 'center:bottom'`.

## Confirm gate (`src/confirm.js`, D2)

```js
confirmGate(action, label) // -> true only on the second press of the same controlId+actionId within
//    this.confirmWindowMs ?? CONFIRM_WINDOW_MS (3000 ms); otherwise arms
//    confirmPending, sets confirm_hint, checkFeedbacks('confirm_pending'),
//    starts a clearing timer, and returns false (caller sends nothing)
isConfirmPending(controlId) // for the confirm_pending feedback
clearConfirm() // full clear: timer, state, confirm_hint variable, confirm_pending feedback
clearConfirmTimer() // timer + state only, no variable/feedback touch — the destroy() hook
```

Exports `CONFIRM_WINDOW_MS` (3000) and `CONFIRM_HINT` (`'Press again to confirm'`, also read by
`variables.js` when composing `confirm_hint`). Used by the `preset`, `power` and `storage` actions'
`confirm` checkbox (default `true`); untick it to send the command on the first press, matching the old
"fires immediately" behaviour the upgrade script preserves for existing buttons (`confirm = false`).

**D2 rationale.** The Stream Deck plugin gates its equivalent destructive actions behind a hold — press and
keep holding until a progress arc completes. Companion actions have no continuous "how long has this been
held" signal a callback can read (no key-up event reaches an action at all, only a full press/release cycle
per step), so a hold cannot be reproduced directly. A second press within a short window is the nearest
Companion-native equivalent that still requires deliberate, repeated intent before something irreversible
happens, and it composes with Companion's own long-press step grouping for anyone who wants an actual
"hold" gesture back (see `companion/HELP.md`'s "Confirm and hold" section). `this.confirmPending` is a
**single slot per instance**, not a map keyed by `controlId`: pressing a different confirm-gated button while
one is already armed silently re-arms the new one and drops the first rather than tracking both
independently. Nothing in `doc/PARITY.md` specifies concurrent-button semantics, and this is the simplest
implementation that satisfies the one-button case the design decision actually describes; revisit if
independent per-button confirms turn out to matter in practice (the fix is confined to this file — key
`confirmPending` by `controlId` instead of overwriting one field).

## Rotary coalescing (`src/rotary.js`, D4)

```js
coalesce(key, delta, flush, (windowMs = ROTARY_WINDOW_MS)) // sums delta per key; flush(total) fires once no
// further call for the same key arrives for
// windowMs (default 150 ms); every call restarts
// the wait
clearRotaryTimers() // drops every pending total without flushing — the destroy() hook
```

Exports `ROTARY_WINDOW_MS` (150). The `audio` action is the only Pearl action that uses it today: its key is
`` `${controlId} ${actionId} ${inputId} ${control}` ``, so a burst of dial ticks (or rapid presses of the
same gain/delay button) on one input's one control collapses into a single read-modify-write instead of one
request per tick.

**D4 rationale.** A Stream Deck+ dial can emit many rotate ticks within a fraction of a second; sending one
Pearl request per tick would both hammer the device and race itself (each request reads the settings fresh,
so an in-flight PATCH can be overtaken by the next tick's PATCH before either lands). Coalescing turns "five
ticks in 80 ms" into one flush carrying the summed delta, matching the 150 ms the Stream Deck plugin itself
uses for the same purpose (`doc/PARITY.md` §4/D4).

## Audio helper (`src/audio.js`)

Unchanged from Phase 1 (pure functions, no instance access, no side effects — every value they need comes in
as a parameter, tested without a mock server in `test/audio.test.js`). `src/actions.js`'s `nudgeInputAudio()`
and `src/variables.js` are the only callers.

- `readGain(settings)` / `gainPatch(settings, newGain)`: gain lives at `local_audio.gain` for a stereo pair,
  or at both `local_audio.channels.channelA/B.gain` when `local_audio.stereo_pair === false` (both channels
  move together to the same clamped 0..100 value — an unpaired input has no single "gain"). `undefined`
  (send nothing) when the input has no gain setting at all.
- `readDelay(settings)` / `delayPatch(settings, newDelay)`: delay lives at whichever of `audio.delay`
  (analog/USB/network inputs), `hdmi.audio.delay` or `sdi.audio.delay` the settings actually contain
  (checked in that order) and is patched back at that same path, clamped −300..300. `undefined` when none of
  the three paths is present.
- `levelSummary(input)` turns `state.inputs[sid]` (`.levels: {rms, peak}`, `.audioState`) into the display
  shape `variables.js` uses: `peak` (loudest of all peak/RMS values, rounded), `left`/`right` (that
  channel's peak, or RMS when no peak value exists), `text` (`'-18 dBFS'`, `'silent'` at or below
  `SILENT_DBFS` (−99), `'No signal'` when `audioState === 'inactive'` with no levels, `''` before the first
  poll).

## Audio meter (`src/meter.js`)

Two halves in one file: pure drawing helpers (no instance access, tested without a server) and the mixin
methods of the level poll that feeds them.

**Drawing.** `dbfsToLinear(db)` = `clamp((db + 60) / 60, 0, 1)` — the linear −60..0 dBFS scale the Stream
Deck plugin uses. `meterOf(input)` turns one `state.inputs[sid]` into `{left, right?, peakLeft?,
peakRight?}` in that 0..1 scale (RMS drives the bars, peak the ticks; `undefined` when the input has no
levels at all, which is what makes the feedback draw nothing). `meterLayout(width, height)` derives the
geometry from the button size — bar width `w/14`, gap `w/36`, right margin `w/18`, vertical span `h/8` to
`7h/8` (5 px bars, 2 px gap, 4 px margin, rows 9..62 on a 72×72 button; the same proportions as the Stream
Deck's 144×144 key). `renderMeter(width, height, levels)` returns a `Uint8Array` of `width * height * 4`
RGBA bytes that is **transparent everywhere except the bars**, so Companion keeps drawing the button's own
text and background underneath: each bar is the track colour `#2a2e35` over its full span, filled from the
bottom in proportion to the level, coloured by the row's own fraction of the bar (green `#3ccf6a` to 62 %,
amber `#f0a83c` to 82 %, red `#e5484d` above — the flat-band reading of the Stream Deck's linear gradient,
so a loud bar is green at the bottom and red at the top), with a 2 px `#f4f6f8` peak tick. Only one bar is
drawn (at the right-hand position) when `right` is missing.

**Level poll.** `startMeterTimer()` / `stopMeterTimer()` / `pollMeterLevels()` / `applyMeterSnapshot(list)`
plus `hasMeterSubscriptions()` and `meterPollIntervalMs()` (500 ms, `this.meterIntervalMs` overrides).
The timer chains via `setTimeout` and runs **only while `this.meterSubscriptions` is non-empty**; the
`audio` feedback's `subscribe` starts it and the unsubscribe that empties the map stops it and clears the
levels (so the variables read `''` again instead of freezing at their last value). It is started by
`subscribe` and by `connect()`, and cleared by `stopTimers()` (hence by `configUpdated()` and `destroy()`).
One tick is exactly one legacy `GET /sources/status` **whatever the number of subscribed inputs** — that
request lists every input at once — applied through the poller's own `applyInputLevels()`; when the
snapshot differs from the previous one it refreshes the variables and calls `checkFeedbacks('audio')`, and
when it does not it does nothing at all. A failing or missing endpoint clears the levels rather than
freezing them, and never logs above `'debug'`. The `audio` action's `control: 'none'` ("Nothing" / dial
push) calls `pollMeterLevels()` once directly, so a re-read works even with no meter placed.

**Why levels are not in the interval poll.** They move far faster than `poll_interval` (2 s by default) and
are worth nothing to a connection that shows no meter, so polling them there would be both too slow for the
meter and pure waste for everyone else. Tying the 500 ms request to the ref-counted subscriptions of the
one feedback that needs it keeps the device idle until a meter is actually on a button. The cost is that
`input_<id>_peak_dbfs`/`_peak_left`/`_peak_right`/`_level_text` read `''` while no `audio` feedback is
subscribed — a text-only "level" button therefore needs the meter feedback placed on some button of the
same connection.

## Actions (`src/actions.js`) — `getActions()`

Every callback is wrapped so it never throws: `wrap(label, fn)` catches, logs `'error'`, and sets
`state.lastError`; validation failures (`fail(label, message)`) do the same without needing to throw at all.
Every id the action reads out of an option is validated against `this.state` before any request is sent.
Every id interpolated into a request path goes through `enc()` (`encodeURIComponent`). Text options that
`useVariables: true` are resolved with `this.parseVariablesInString`. A v2.0-only action calls
`requireV2(label)` first (logs `'warn'` and returns without sending anything on legacy firmware). After a
successful control call, `this.schedulePollSoon()` runs a poll 750 ms later (coalesced) so feedbacks and
variables update promptly.

| id            | options (id — label — values — default)                                                                                                                                                                                                                                    | request                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| ------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `recorder`    | `recorderId` — Recorder — `choicesRecordersWithAll()` — **`all`**; `op` — Action — toggle(default)/start/stop/pause/resume/reset                                                                                                                                           | `op==='toggle'` resolves via `utils.recorderToggleOp` (D14); `POST /recorders/{id}/control/{op}` (or `/recorders/control/{op}` for `all`); `reset` tries the v2.0 route silently, and on a 404 falls back to the legacy `base:'v1'` route. `pause`/`resume` and `recorderId:'all'` require v2 (`requireV2`); single-recorder start/stop/toggle/reset do not (both API generations support them).                                                                                                                                                                                 |
| `stream`      | `channelId` — Channel — channels — first; `publisherId` — Publisher — `choicesPublishers()` composite — first; `op` — Action — toggle(default)/start/stop                                                                                                                  | the composite's own channel wins over `channelId` when both parse; `op==='toggle'` resolves via `utils.publisherToggleOp` (D14); `POST /channels/{cid}/publishers/{pid}/control/{op}` (or `.../publishers/control/{op}` for `-all`). No v2 gate.                                                                                                                                                                                                                                                                                                                                 |
| `layout`      | `channelId` — Channel; `layoutId` — Layout — `choicesLayouts()` composite — first; `layoutIdManual` — Layout ID — text, `useVariables` — **`''`**                                                                                                                          | composite parses first; falls back to `channelId` + the trimmed, variable-expanded `layoutIdManual` when the composite is empty. `PUT /channels/{cid}/layouts/active` with `query:{id}` and `body:{id:Number(id)\|\|id}` (both accepted). No v2 gate.                                                                                                                                                                                                                                                                                                                            |
| `singletouch` | `stcId` — Single touch control — `choicesSingleTouch()` — `preferredId(..., '0')`                                                                                                                                                                                          | `POST /system/singletouchcontrol/{id}/control/toggle`. Requires v2.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              |
| `bookmark`    | `channelId` — Channel; `text` — Text — text, `useVariables` — **`'Marker'`**; `appendTime` — Append the current time (HH:MM:SS) — checkbox — **false**                                                                                                                     | `utils.bookmarkText(text, appendTime)` → the trimmed text (or `'Marker'` if blank), with `` ` ${HH:MM:SS}` `` appended when `appendTime`. `POST /channels/{cid}/bookmarks` with both `query:{text}` and `body:{text}`. No v2 gate.                                                                                                                                                                                                                                                                                                                                               |
| `output`      | `outputId` — Output — outputs — first; `source` — Source — `choicesOutputSources()` — first                                                                                                                                                                                | `PUT /outputs/{did}/settings?source=`. Requires v2. On success, sets `state.outputs[did].source`/`.setAt` directly (optimistic, no read endpoint), calls `refreshVariables()` and `checkFeedbacks('output_set')` immediately (not only after the next poll).                                                                                                                                                                                                                                                                                                                     |
| `preset`      | `presetName` — Preset — device presets — first; `sections` — Sections — multidropdown (`system network sources edid channels afu cms avstudio frontscreen displays`) — **`[]`**; `confirm` — Confirm with a second press — checkbox — **true**                             | Requires v2. `confirm !== false` gates on `confirmGate()` (D2). `POST /system/presets/{name}/control/apply` with `body:{sections}` only when `sections` is non-empty. `result.reboot` → `presetStatus = {text:'Rebooting…', until:+60000}`, else clears it. Sets `lastConfigPreset`.                                                                                                                                                                                                                                                                                             |
| `event`       | `eventRef` — Event — `choicesEventRefs()`, `allowCustom:true` — **`'ongoing'`**; `op` — Action — status/toggle(default)/start/stop/pause/resume/extend; `extendSeconds` — Extend by — number 30–21600 step 30 — **300** — visible only while `op==='extend'`               | Requires v2. `op==='status'` only calls `schedulePollSoon()`. Otherwise resolves the event **live** (`GET /schedule/events/{ref}`, optional) rather than from the last poll — an alias may point at a different event by press time. `toggle` resolves via `utils.eventToggleOp(status)` (D14); a fixed op is checked against `utils.eventApplies(op, status)` and, when it does not apply, only logs `'warn'` and sends nothing. `extend` → `POST /schedule/events/{id}/control/extend` `{finish: extendSeconds}`; everything else → `POST /schedule/events/{id}/control/{op}`. |
| `power`       | `op` — Action — reboot(default)/shutdown; `confirm` — Confirm with a second press — checkbox — **true**                                                                                                                                                                    | `confirm !== false` gates on `confirmGate()`. `POST /system/control/{op}`. Sets `powerStatus = {text:'Command sent', until:+30000}`.                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| `audio`       | `inputId` — Input — audio inputs — first; `control` — Press adjusts — none(default,"Nothing")/gain/delay; `direction` — Direction — up(default)/down — visible only while `control!=='none'`; `step` — Step — number 1–100 — **1** — visible only while `control!=='none'` | Requires v2. `control==='none'` (the "push"/re-read) sends one immediate `pollMeterLevels()` and calls `schedulePollSoon()` for the rest. Otherwise `coalesce(key, ±step, nudgeInputAudio, this.rotaryWindowMs)` with key `` `${controlId} ${actionId} ${inputId} ${control}` `` (D4).                                                                                                                                                                                                                                                                                           |
| `storage`     | `storageId` — Storage — storages — `preferredId(..., 'main')`; `confirm` — Confirm with a second press — checkbox — **true**                                                                                                                                               | Requires v2. `storage.status.state === 'nodev'` logs `'info'` ("Nothing to eject") and returns **before** the confirm gate — a button that can do nothing never arms a confirm. Otherwise `confirm !== false` gates on `confirmGate()`, then `POST /system/storages/{id}/control/eject`; sets `storage.hint = {text:'Ejected', until:+4000}`.                                                                                                                                                                                                                                    |

`nudgeInputAudio(label, sid, control, delta)` (also exported from `actions.js` as a plain method, called from
the rotary flush so it handles its own try/catch rather than relying on `wrap()`): `GET
/inputs/{sid}/settings`, then `gainPatch`/`delayPatch` from `src/audio.js` against the current value + delta,
`PATCH /inputs/{sid}/settings`, `schedulePollSoon()`. Logs `'warn'` and sends nothing when the input has no
such setting.

## Feedbacks (`src/feedbacks.js`) — `getFeedbacks()`

Every callback wraps its state read in try/catch, logs `'error'` and returns `false`/`{}` on failure — a
malformed option value never throws out of a feedback callback. `defaultStyle` is `stateStyle(<colour>)`
except `layout_preview`, `preview` and `audio` (advanced, no default style — they draw an image) and
`confirm_pending` (`stateStyle(colors.red)`).

| id                   | type     | options                                                                              | true when / result                                                                                                                                                                                                                                                                                                                                                                   | colour |
| -------------------- | -------- | ------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------ |
| `recorder_state`     | boolean  | `recorderId` (+`all`); `state`: started/starting/paused/error/stopped/disabled       | exact match; `all` = the aggregate (`aggregateState`, priority `started > starting > paused > error`, else `stopped`)                                                                                                                                                                                                                                                                | red    |
| `stream_state`       | boolean  | `publisherId` composite (+`-all`); `state`: started/starting/listening/error/stopped | exact match; `-all` = aggregate (`started > starting > listening > error`, else `stopped`)                                                                                                                                                                                                                                                                                           | green  |
| `layout_active`      | boolean  | `layoutId` composite                                                                 | `channels[cid].layouts[lid].active === true`                                                                                                                                                                                                                                                                                                                                         | amber  |
| `layout_preview`     | advanced | `layoutId` composite                                                                 | `png64` from `this.previews['layout:<cid>-<lid>']`; subscribe/unsubscribe ref-count the key                                                                                                                                                                                                                                                                                          | —      |
| `singletouch_active` | boolean  | `stcId`; `state`: on/error                                                           | `on` = `pressed === true`; `error` = `status === false`                                                                                                                                                                                                                                                                                                                              | green  |
| `preview`            | advanced | `source`: channel(default)/input/output; `sourceId` (`choicesPreviewSources()`)      | `png64` from `this.previews['<source>:<sourceId>']`; subscribe/unsubscribe ref-count the key                                                                                                                                                                                                                                                                                         | —      |
| `output_set`         | boolean  | `outputId`; `source`                                                                 | `outputs[did].source === source && Date.now() - setAt < 5000`                                                                                                                                                                                                                                                                                                                        | green  |
| `event_state`        | boolean  | `eventRef` (+`allowCustom`); `state`: running/paused/ongoing/scheduled/finished/none | resolves `eventRef` against the polled snapshot (`resolveEventRef`, mirrors the action's own alias resolution but from the last poll, not a live request); `ongoing` = running ‖ paused; `none` = nothing resolved                                                                                                                                                                   | green  |
| `event_applies`      | boolean  | `eventRef`; `op`: start/stop/pause/resume/extend                                     | `utils.eventApplies(op, resolved.status)`                                                                                                                                                                                                                                                                                                                                            | cms    |
| `system`             | boolean  | `condition`: cpu_high/cpu_hot/afu_uploading/afu_paused/afu_error/afu_idle/afu_off    | `cpu_high`→`systemStatus.cpuload_high`; `cpu_hot`→`cputemp >= cputemp_threshold`; `afu_off`→no AFU entries or any `disabled`; else any AFU entry in that state                                                                                                                                                                                                                       | amber  |
| `storage_level`      | boolean  | `storageId`; `level`: low/full/ro/nomedia/notready/formatting/ok                     | `low`=ready & 90≤used%<97; `full`=ready & used%≥97; `ro`=`devro`; `nomedia`=`nodev`; `notready`=`dev`; `formatting`=`formatting`; `ok`=ready & used%<90                                                                                                                                                                                                                              | amber  |
| `audio`              | advanced | `inputId` (audio inputs)                                                             | `{imageBuffer, imageBufferEncoding: {pixelFormat: 'RGBA'}, imageBufferPosition: {x:0, y:0, width, height}}` drawn by `meter.renderMeter()` at `feedback.image.width/height` (72×72 when Companion gives none), or `{}` when that input has no levels (the button keeps its text); `subscribe`/`unsubscribe` ref-count `this.meterSubscriptions` and start/stop the 500 ms level poll | —      |
| `confirm_pending`    | boolean  | –                                                                                    | `this.isConfirmPending(feedback.controlId)`                                                                                                                                                                                                                                                                                                                                          | red    |

Module-private helpers (not exported): `aggregateState(entities, order, fallback)` (shared by
`recorder_state`/`stream_state`'s aggregate branch and by `variables.js`'s own copy for the aggregate
variables); `resolveEventRef(state, ref)` (alias/id → event object or `null`); `previewKey`/`previewsEnabled`/
`subscribePreview`/`unsubscribePreview` (the `preview`/`layout_preview` ref-counting, unchanged pattern from
before this rewrite); `subscribeMeter`/`unsubscribeMeter` (the same pattern for `this.meterSubscriptions`,
plus starting the level poll on the first subscribe and stopping/clearing it on the last unsubscribe).

## Variables (`src/variables.js`)

`buildVariables(self)` returns `{ definitions: [{variableId,name}], values: {id: value} }` (pure function of
`self.state` and `self.confirmPending`); `updateVariables(self)` calls `setVariableDefinitions` only when the
sorted id list differs from `self.lastVariableIds`, then always calls `setVariableValues`. Variable ids may
only contain `[a-zA-Z0-9_-]`; `utils.safeId(id)` replaces anything else with `_`. Unknown values are always
`''` (never `undefined`). Countdown variables use `self.deviceNow()` (falls back to `Date.now()` when
`self` has no `deviceNow`, e.g. a hand-built test double), not the uncorrected host clock — see "Request
layer"'s clock skew correction.

- **System / identity / firmware / AFU**: `cpu_load`, `cpu_temp`, `uptime_seconds`, `uptime` (`3d 4h` /
  `4h 05m` / `12m`, `utils.formatUptime`), `system_status_text` (`47°C · up 3d 4h`, parts dropped when
  unknown), `afu_state` (comma list of every AFU entry's state, unchanged shape), `afu_text`
  (`Uploading`/`Idle`/`Paused`/`Error`/`AFU off`), `afu_protocol`, `afu_queue_files`, `afu_error` — all four
  AFU text/protocol/queue/error variables read from the same "active" AFU entry (`pickAfu`: first entry that
  is not `disabled`, else `[0]`), so they never disagree with each other; `product_name`, `firmware`,
  `device_name`.
- **Per storage** (`storage_<safeId(stid)>_*`): `_state`, `_free`/`_total` (`utils.bytesToHuman`),
  `_used_pct` (used, not free; `utils.round1`), `_text` (`free of <total>` / `No media` / `Not ready` /
  `Formatting…` / `No data`), `_level_word` (`LOW`/`FULL`/`RO`/`''` — `utils.storageLevel().word`, the same
  helper the `storage_level` feedback and the Storage presets use, so the 90 % / 97 % thresholds exist
  once), `_hint` (the `{text,until}` marker, text only while still active).
- **Per recorder** (`recorder_<safeId(rid)>_*`): `_name`, `_state`, `_state_word` (`REC`/`PAUSED`/`ERR`/
  `OFF`/`?`), `_duration` (s), `_duration_text` (`utils.compactDuration`, `m:ss`/`h:mm:ss`), `_duration_hms`
  (`utils.formatHms`, `HH:MM:SS`); aggregates `recorder_all_state_word` (same aggregate order as the
  `recorder_state` feedback's `all`) and `recorders_active_count` (count in state `started`).
- **Per publisher** (`channel_<safeId(cid)>_publisher_<safeId(pid)>_*`): `_name`, `_type`, `_state`,
  `_state_word` (`LIVE`/`STARTING`/`LISTEN`/`ERR`/`OFF`/`?`), `_error` (`status.description`). Per channel:
  `channel_<cid>_publishers_state_word` (aggregate, same order as `stream_state`'s aggregate), `_name`,
  `_active_layout` (name), `_active_layout_id`.
- **Per single touch** (`singletouch_<safeId(stcid)>_*`): `_active` (pressed), `_status_ok`, `_summary`
  (`rec a/t · str a/t`), `_state_word` (`ERR` when `status===false`, `ON` when pressed, else `''`).
- **Events**: `event_upcoming_id`/`_title`/`_start`/`_start_time`/`_starts_in_hms`/`_time_text` (`in 5:00` /
  `Starting…` / `Nothing scheduled`)/`_state_word` (`SCHED`/`—`); `event_ongoing_id`/`_title`/`_status`/
  `_finish`/`_finish_time`/`_remaining_hms`/`_time_text` (`"<compact> left"` / `No ongoing event`)/
  `_state_word` (`LIVE`/`PAUSED`/`—`); `event_ongoing_toggle_command` (`PAUSE`/`RESUME` from the ongoing
  event, falling back to the upcoming event's `START` when nothing is ongoing, else `''` — see rationale
  below); aliases `event_title`/`event_state`/`event_remaining` (all three mirror the ongoing event only).
- **Per audio input** (`input_<safeId(sid)>_*`, gated on `input.audio === true` except `_name` which is
  unconditional — a video-only input still needs its name for the Previews preset): `_name`; `_peak_dbfs`,
  `_peak_left`, `_peak_right`, `_level_text` (all via `audio.levelSummary`, and all `''` unless an `audio`
  feedback is subscribed — see "Audio meter"); `_gain`, `_delay` (from the cached
  `state.inputs[sid].settings`, via `audio.readGain`/`readDelay`, independent of the meter).
- **Per output** (`output_<safeId(did)>_*`): `_name`, `_source` (optimistic).
- **Configuration presets**: `preset_names` (comma-joined), `preset_last_applied` (optimistic), `preset_status`.
- **Module-level**: `power_status`, `confirm_hint` (derived from `self.confirmPending` + the imported
  `CONFIRM_HINT` constant from `confirm.js`, so it agrees with `confirm.js`'s own direct
  `setVariableValues({confirm_hint})` calls rather than fighting them), `last_error`.

**`event_ongoing_toggle_command` rationale.** Neither `doc/PARITY.md` nor the Stream Deck's own `event.ts`
says what this variable should read when nothing is ongoing but something is scheduled, even though `START`
is one of its three listed possible values. Falling back to the upcoming event's `START` in that case is the
only reading that makes all three listed words reachable at all (the alternative — leaving it `''` whenever
nothing is ongoing — would make `START` unreachable), so it is implemented that way; flag for review if a
different rule was intended.

## Presets (`src/presets.js`) — `getPresets()`

`PRESET_CATEGORY_IDS` (exported, also imported by `config.js` for the `preset_categories` field and by
`instance.js`/tests via `normalisePresetCategories`) is the D15 category list, one per Stream Deck action, in
this fixed order: `Recording, Streaming, Layouts, Single touch, Bookmarks, Previews, Outputs, Configuration
presets, CMS events, System, Power, Audio, Storage`. `normalisePresetCategories(value)` defaults a
missing/non-array stored value to every category, and filters an array value down to known ids (a stale id
from a removed category cannot linger; an explicit `[]` is respected as "generate nothing").

`getPresets()` computes `enabledCategories = new Set(normalisePresetCategories(this.config?.preset_categories))`
once; its local `add(id, preset)` helper skips a preset outright when its category is not enabled (one gate,
shared by every category), and gives a colliding id (after `safeId`) a `_2`, `_3`, ... suffix instead of
dropping it.

The local `button({category, name, text, size, actions, feedbacks, rotary})` helper builds one preset:
`restStyle()` at rest, the category's icon (`CATEGORY_ICON[category]` → `ICONS[...]`) at
`pngalignment:'center:top'` with the text at `alignment:'center:bottom'` (every one of the 13 categories has
a matching icon, including the three display-only ones — Previews, Layouts and Audio's meter button — so a
placeholder icon shows before the live image/meter arrives and is naturally overdrawn by it once one does).
`actions` become the single `down` step; **Pearl has no hold-to-move motion actions** (D3 is EC20-only), so
every Pearl preset's `up` step is empty. Passing `rotary: {rotateLeft, rotateRight}` additionally sets
`options.rotaryActions: true` and the `rotate_left`/`rotate_right` step arrays (D4) — used only by the two
Audio rotary presets (gain, delay); their `down` step re-reads (`control:'none'`), matching the dial's "push
= re-read" behaviour.

Per category (against the mock's default seed data — 2 channels, 3 recorders, 6 inputs, 1 output, 3
storages, 1 single touch control, 2 configuration presets):

- **Recording**: one toggle button per `choicesRecordersWithAll()` entry (incl. `all`); `recorder_state`
  started/error → red, paused/starting → amber.
- **Streaming**: one toggle button per `choicesPublishers()` entry (incl. each channel's `-all`);
  `stream_state` started → green, starting/listening → amber, error → red.
- **Layouts**: one button per channel × layout (walked directly off `state.channels`, not through a choices
  helper, so the layout name and channel name can be separate text lines); `layout_active` amber +
  `layout_preview`.
- **Single touch**: one toggle per `choicesSingleTouch()` entry; `singletouch_active` on → green, error → red.
- **Bookmarks**: one button per `choicesChannel()` entry, action `bookmark {channelId, text:'Marker',
appendTime:false}`; feedback `recorder_state {recorderId: channel.id, state:'started'}` **isInverted** →
  `{color: colors.grey}` (the channel's own recorder id doubles as the bookmark button's "is this channel
  recording" check, per `doc/PARITY.md` §5's "recorderId = cid").
- **Previews**: one button per channel / `choicesInputsWithVideo()` entry / output; feedback `preview
{source, sourceId}`; text = the entity's name variable.
- **Outputs**: one button per output × the three built-in sources (`OUTPUT_BUILTIN_SOURCES`, labelled
  without the dropdown's "Built-in:" grouping prefix — matching `doc/PARITY.md` §5.7's plain "Multiview" /
  "Device info" / "Console"); `output_set` → green.
- **Configuration presets**: one button per `choicesConfigPresets()` entry; action `preset {presetName,
sections:[], confirm:true}`; feedback `confirm_pending` → red; text `` `Apply\n<name>\n$(pearl:confirm_hint)$(pearl:preset_status)` ``.
- **CMS events**: eight fixed buttons (no entity list) — ongoing status, upcoming status, toggle,
  start-upcoming, stop, pause, resume, extend +5:00. The three status/toggle buttons use `event_state
{eventRef, state}` (running → green, paused → amber, `none` → grey — read as the reference's "DONE grey"
  describing the fallback when nothing is ongoing, since `event_state` never resolves a literal `finished`
  event through the `ongoing` alias). The five command buttons use `event_applies {eventRef, op}`
  **isInverted** → `{color: colors.grey}` (a command that does not currently apply greys out its text; a
  press still only alerts, since Companion has no way to make a press itself conditional).
- **System**: CPU (`system` cpu_high/cpu_hot → amber), AFU (`system` afu_uploading → green, afu_paused →
  amber, afu_error → red), Info (display only, no feedback).
- **Power**: Reboot, Shut down — action `power {op, confirm:true}`; feedback `confirm_pending` → red; text
  `` `<Op>\n$(pearl:confirm_hint)$(pearl:power_status)` ``.
- **Audio**: seven buttons per audio-capable input — meter (`audio` feedback, text = name only; placing it
  is what starts the 500 ms level poll), gain +/−, delay +/−, rotary gain, rotary delay (both rotary
  buttons' `down` step re-reads).
- **Storage**: one button per `choicesStorages()` entry; action `storage {storageId, confirm:true}`;
  feedbacks `storage_level` for the three `utils.STORAGE_SEVERITY` levels (ok → green, low → amber, full →
  red, worst last so it wins) plus nomedia → grey and `confirm_pending` → red; text
  `` `<free>\n<text>\n$(pearl:confirm_hint)$(pearl:storage_<id>_hint)` ``.

**Confirm-hint / status-line sharing.** Every confirm-gated preset (Power, Configuration presets, Storage)
puts `$(pearl:confirm_hint)` and the action's own post-command status variable
(`preset_status`/`power_status`/`storage_<id>_hint`) on the _same_ text line, concatenated
(`` `$(pearl:confirm_hint)$(pearl:X_status)` ``) rather than needing a conditional-text mechanism Companion
does not have. This is safe because the two are provably never non-empty at the same time: `confirmGate()`'s
confirming-press branch calls `clearConfirm()` (which empties `confirm_hint`) _before_ the action body runs
and sets the status marker — so the button shows "Press again to confirm" while armed, then seamlessly shows
"Rebooting…" / "Command sent" / "Ejected" once the command actually fires.

## Utils (`src/utils.js`)

Pure, no instance access: `safeId(str)`, `formatHms(seconds)` (`HH:MM:SS`, hours not wrapped at 24),
`formatClock(unixSeconds)` (local `HH:MM`), `round1(n)`, `bytesToHuman(bytes)` (base-1024, `'11 GB'`/`'0 B'`),
`compactDuration(seconds)` (`m:ss`/`h:mm:ss`), `formatUptime(seconds)` (`Xd Yh`/`Xh YYm`/`Xm`),
`splitPair(str)` (`'1-2' -> ['1','2']`, only the first dash, null when invalid), `stableJson(obj)` (sorted-key
JSON, for diffing), `parseJsonOption(text)`, `nonBlank(obj)`, `toQueryString(query)`,
`firmwareVersionNumber(version)` (`'4.24.1' -> 42401`), `clampNumber(value, def, min, max)`,
`normaliseInputId(id)` / `sameInputId(a, b)` (strip/compare the `D2P<serial>.` prefix),
`recorderToggleOp(recorders, recorderId)` / `publisherToggleOp(publishers, publisherId)` (D14 toggle
direction, `'start'|'stop'`, `'all'`/`-all'` aggregate over `ACTIVE_RECORDER_STATES`/
`ACTIVE_PUBLISHER_STATES`), `eventToggleOp(status)` (D14, `'pause'|'resume'|'start'|''`),
`eventApplies(op, status)` (boolean, shared by the `event` action's fixed-command gate and the
`event_applies` feedback), `localTimeHms(date?)`, `bookmarkText(text, appendTime, date?)`,
`storageLevel(status)` (`{usedPct, level: 'ok'|'low'|'full', word}` — the single source of the
`STORAGE_LOW_PCT` (90) / `STORAGE_FULL_PCT` (97) thresholds and of `STORAGE_SEVERITY`, shared by the
`storage_level` feedback, the `storage_<id>_level_word` variable and the Storage presets; mount states
(`nodev`/`dev`/`devro`/`formatting`) are the caller's own check, not part of severity), `emptyState()`
(the shape documented above). Also exported: `ACTIVE_RECORDER_STATES = ['started','starting','paused']`,
`ACTIVE_PUBLISHER_STATES = ['started','starting','listening']`.

## Test harness and mock

`test/harness.js` replaces `@companion-module/base` in `require.cache` with a recording stub (`InstanceBase`,
`InstanceStatus`, `Regex`, `combineRgb`/`splitRgb`, `runEntrypoint`,
`CreateConvertToBooleanFeedbackUpgradeScript`, ...). `createInstance({ mock, config })` builds and
initialises an instance against a mock server and awaits its `startupPromise` (the first poll); its
`DEFAULT_CONFIG` uses `poll_interval: 300000` (D8's unit) so the interval poller never fires on its own
during a test — same 5-minute effective quiet period the old `pollfreq: 300` gave every test before D8.
`runAction(instance, actionId, options, { controlId='c1', id='a1' })` invokes an action's callback the way
Companion would, and now accepts an explicit `controlId` so confirm-gate tests can drive two independent
buttons; `runRotate(instance, actionId, options, meta)` is a thin, documented alias for `runAction` — a
rotary step is invoked by Companion exactly like a `down` press, just against the preset's `rotate_left`/
`rotate_right` action array, so it needs no different plumbing, only a clearer name at call sites.
`runFeedback`/`subscribeFeedback`/`unsubscribeFeedback` do the equivalent for feedback definitions.

`test/mock-pearl.js` exports `startMockPearl({ firmware, legacyOnly, port, https, clockSkewMs })` ->
`{ url, port, state, requests, reset(), setClockSkew(ms), close() }`. It serves the 3.0.0 control set's
endpoints (v2.0 and legacy, see the tables above) from an in-memory model — 2 channels with layouts and
publishers, 3 recorders, inputs including an unpaired-stereo input, an HDMI input with `hdmi.audio.delay` and
an SDI input with `sdi.audio.delay` (for the audio helper), 1 output, storages, single touch, configuration
presets, schedule events, AFU, system status — records every request (`{method,path,query,body,headers}`),
mutates its model on control calls (recorder start/stop/**pause/resume** via `applyRecorderOp`, publisher
start/stop, layout activation, output source, single touch toggle, settings PATCH), and returns 404 JSON
`{status:'notfound', message}` for unknown ids. `legacyOnly: true` 404s everything under `/api/v2.0/` so the
v1 fallback paths get real coverage; the v2.0 recorder-reset route specifically 404s **always** (even off
`legacyOnly`) — there is no v2.0 reset endpoint in `doc/pearl-api-v2.0.yaml` or in the parity document's own
legacy-only-endpoints list — so the `recorder` action's legacy fallback for `reset` is exercised for real
rather than only in a `legacyOnly` device. `https: true` serves TLS with the self-signed pair in
`test/fixtures/selfsigned.{key,crt}` (CN/SAN `127.0.0.1` + `localhost`, valid to 2036, regenerate only if it
expires). `clockSkewMs` (and `setClockSkew(ms)` to change it live) offsets the `Date` response header from
the real clock on every response, exercising the clock-skew correction in "Request layer". `GET
/sources/status` answers with the model's inputs prefixed `D2P492324.` (or left alone if already prefixed),
with wandering dBFS levels each call so two polls differ.

## Decisions

`doc/PARITY.md`'s "Decisions taken" section (D1–D16) is the canonical record of every operator-level
decision this contract implements — one action per Stream Deck action (D1), the confirm gate instead of a
hold arc (D2, rationale also inlined above under "Confirm gate"), the motion-stop value (D3, EC20-only, no
effect on this module), rotary coalescing (D4, rationale inlined under "Rotary coalescing"), composite ids
(D5, rationale inlined under "Choices"), display-only settings dropped (D6), feedback/variable id casing
(D7), the millisecond poll interval and its failure backoff (D8, rationale inlined under "Poller"), the
legacy API fallback (D9), module-wide preview settings (D10), absolute gain/delay converting to nudges
(D11), `refreshPoll`'s removal (D12), the once-per-start legacy-id warning (D13, detailed under "Upgrade
scripts"), toggle/aggregate semantics (D14, implemented in `utils.js` and mirrored by
`variables.js`/`feedbacks.js`'s own aggregate helpers), preset categories (D15, "Presets" above) and the
3.0.0 version number itself (D16). Consult that document — not this paraphrase of it — when a decision's
exact wording matters.
