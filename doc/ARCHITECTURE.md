# Architecture and implementation contract (v2.3.0 expansion)

This document is the contract every source file in `src/` follows. It exists so the
module can be worked on file-by-file without the pieces drifting apart. Keep it current
when behaviour changes.

Reference API spec: `doc/pearl-api-v2.0.yaml` (Pearl REST API v2.0, firmware >= 4.24.1).
Legacy v1 API (`/api/...`) is still served by the same firmware and is used for the few
things v2.0 does not expose (see "Legacy-only endpoints").

## File layout

```
index.js              entrypoint only: require('./src/instance') + runEntrypoint
src/instance.js       EpiphanPearl extends InstanceBase; wires everything; exports { EpiphanPearl, upgradeScripts, PearlApiError, MIN_API_V2_VERSION }
src/api.js            request layer (mixin methods: request, sendRequest, fetchPreviewImage)
src/poller.js         polling + state diff + variable/feedback refresh (mixin methods)
src/choices.js        dropdown choice builders (mixin methods)
src/actions.js        getActions()            -> action definitions
src/feedbacks.js      getFeedbacks()          -> feedback definitions
src/variables.js      buildVariables(self)    -> { definitions, values } ; updateVariables(self)
src/presets.js        getPresets()            -> preset definitions
src/config.js         getConfigFields()
src/upgrades.js       upgrade scripts array
src/utils.js          pure helpers (formatting, sanitising, diffing)
test/mock-pearl.js    in-memory HTTP mock of the Pearl (v2.0 + legacy endpoints used)
test/harness.js       stub of @companion-module/base injected via require.cache
test/*.test.js        node:test suites
```

All `src/*.js` files are CommonJS (`module.exports`), ES2022 syntax, tabs, no semicolons,
single quotes (prettier config from `@companion-module/tools`). Mixin files export an
object of methods that `instance.js` copies onto the class prototype with
`Object.assign(EpiphanPearl.prototype, api, poller, choices, actions, feedbacks, presets)`.
Inside mixin methods `this` is the instance.

## Instance state (`this.state`)

Built fresh on every poll and swapped in atomically. Never mutate `this.state` from
actions except for the documented optimistic updates.

```js
this.state = {
	channels: {
		[cid]: {
			id,
			name,
			layouts: { [lid]: { id, name, active } }, // from legacy GET /api/channels/{cid}/layouts
			publishers: { [pid]: { id, type, name, status } }, // status = PublisherStatus schema
			encoders: [Encoder], // may be []
			active_layout: { id, name } | undefined, // v2 only
		},
	},
	recorders: { [rid]: { id, name, multisource, status /* RecorderStatus */, lastFile /* ArchiveFile|undefined */ } },
	inputs: { [sid]: { id, name, type, audio, video, real_device_name } },
	outputs: { [did]: { id, name, source /* string|undefined, optimistic: last value set via Companion */ } },
	storages: { [stid]: { id, status /* StorageStatus|undefined */ } },
	singleTouch: { [stcid]: { id, state /* SingleTouchControlState|undefined */ } },
	presets: [{ name, description, sections, readonly }], // configuration presets on the device
	events: { upcoming: Event | null, ongoing: Event | null },
	systemStatus: SystemStatus | undefined,
	firmware: FirmwareDetails | undefined,
	identity: DeviceIdentity | undefined,
	afu: [IdentifiedAfuStatus], // [] when unknown
	connectivity: object | undefined, // /system/connectivity/details result
	speedtest: object | undefined, // last speed test result
	lastConfigPreset: { name, appliedAt } | undefined, // optimistic, set by applyConfigPreset, no read endpoint
}
```

Other instance fields:

- `this.metadata[cid] = { title, author, rec_prefix }` (legacy `/admin/channelN/get_params.cgi`). A failed fetch stores a
  retryable marker `{ title: '', author: '', rec_prefix: '', _failedAt: Date.now(), _attempts: n }` (previously known values are
  kept); `utils.metadataRetryDue(entry)` says when it is due again (`60 s * min(attempts, 10)`). Only the first failure logs
  'error', later ones 'debug'. Keys starting with `_` are internal and never become variables.
- `this.apiBasePath` = `'/api'` or `'/api/v2.0'` (decided by `determineApiBase()` in every `configUpdated()`)
- `this.isV2` getter = `this.apiBasePath === '/api/v2.0'`
- `this.previews = { [key]: { png64, fetchedAt } }` where key is `channel:<cid>`, `input:<sid>`, `output:<did>`
- `this.previewSubscriptions = Map<key, count>` maintained by preview feedback subscribe/unsubscribe. Keys are registered
  regardless of `preview_interval` (Companion calls `subscribe` only once per feedback); `configUpdated()` keeps them and
  calls `subscribeFeedbacks('channelPreview','inputPreview','outputPreview','channelLayoutPreview')` so Companion
  re-sends subscribe for placed feedbacks (all four preview feedback ids, `channelLayoutPreview` included).
- `this.previewFailedKeys = Set<key>` keys whose most recent fetch failed, so `pollPreviews()` logs a `'warn'` once on
  failure and once more on recovery instead of every poll; cleared on `configUpdated()`/`destroy()`.
- `this.pollCounter` integer incremented every poll (used for "every Nth poll" work)
- `this.pollPromise` promise of the running poll (`pollAll()` returns it to overlapping callers; `connect()` waits for a stale one before the first poll of a new configuration)
- `this.configGeneration` incremented by every `configUpdated()`; a poll started under an older generation discards its result
- `this.systemUpdateCount` number of `updateSystem()` calls (used by tests)
- `this.startupPromise` promise of the background `connect()` started by the last `configUpdated()`
- `this.timer`, `this.previewTimer` interval handles
- `this.lastVariableIds` string (sorted variable ids joined) to avoid redundant `setVariableDefinitions`

## Config fields (`src/config.js`)

| id                | type      | default         | notes                                                                 |
| ----------------- | --------- | --------------- | --------------------------------------------------------------------- |
| host              | textinput | 192.168.255.250 | IP or hostname, validated with `REGEX_IP_OR_HOSTNAME` (see below)     |
| host_port         | textinput | 80              | Regex.PORT                                                            |
| username          | textinput | admin           |                                                                       |
| password          | textinput | ''              |                                                                       |
| pollfreq          | number    | 10              | 1..300 seconds                                                        |
| timeout           | number    | 5000            | request timeout ms, 1000..60000                                       |
| use_api_v2        | checkbox  | true            |                                                                       |
| preview_interval  | number    | 2               | seconds between preview image refreshes; 0 disables preview feedbacks |
| preview_width     | number    | 144             | width in px requested from the device for preview images (72..720)    |
| poll_events       | checkbox  | true            | poll CMS schedule (upcoming/ongoing)                                  |
| poll_archive      | checkbox  | false           | poll last archive file per recorder                                   |
| poll_connectivity | checkbox  | false           | poll /system/connectivity/details every 6th poll                      |
| verbose           | checkbox  | false           |                                                                       |

Companion's `Regex.IP` and `Regex.HOSTNAME` are single anchored patterns, so `config.js` builds its own
`REGEX_IP_OR_HOSTNAME` constant (`/^(?:<IP>|<HOSTNAME>)$/`, both patterns with their slashes and anchors stripped and
combined as alternatives) and exports it alongside `getConfigFields` (`module.exports = { getConfigFields, get_config_fields, REGEX_IP_OR_HOSTNAME }`).
The field labels are the user-facing names used in `companion/HELP.md`; keep both in sync.

`upgrades.js` adds defaults for new fields when undefined. Companion runs each upgrade script only once per connection,
so an existing script is never extended: `setDefaultConfig` (v2.2.0) only sets `use_api_v2` / `verbose`, and the appended
`setDefaultConfigV230` fills `timeout`, `preview_interval`, `preview_width`, `poll_events`, `poll_archive`, `poll_connectivity`.
The exported order is fixed: `setDefaultConfig`, `renameStreaming`, `setDefaultConfigV230`; a future version appends
a new script (values from `CONFIG_DEFAULTS`, which must match the field defaults above).

`configUpdated(config)`: stops the timers, bumps `configGeneration`, normalises and validates the config (BadConfig -> still
`updateSystem()` so definitions exist, then return), resets state/metadata/previews, publishes the definitions for the empty
state and returns immediately, storing `this.startupPromise = this.connect(generation)`. Companion restarts a module whose
`init`/`configUpdated` takes more than a few seconds, and an unreachable device costs two request timeouts, so the first
contact must not be awaited. `connect(generation)` runs `determineApiBase()`, waits for a stale `pollPromise`, runs the first
`pollAll()` (which rebuilds the definitions when the structure changed), re-subscribes previews and starts the timers; it stops
silently when `configGeneration` moved on. Tests await `instance.startupPromise` after `init`/`configUpdated`.

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
 * @param {boolean} [opts.optional] 404/405 return null instead of throwing, and do not touch instance status
 * @param {boolean} [opts.silent]  do not log errors (caller handles)
 * @returns {Promise<any>} the `result` field of the JSON envelope ({status:'ok', result}), the whole
 *                         body when there is no result field, `true` for an ok envelope with no result,
 *                         Buffer when raw, null when optional and not found.
 * @throws {PearlApiError} with .status (HTTP code), .apiStatus (envelope status string), .message
 */
async request(method, path, opts = {})
```

Behaviour:

- Uses global `fetch` with `AbortSignal.timeout(timeout)` (real timeout; the old `timeout:` fetch option did nothing).
- `Authorization: Basic` header from config; `Content-Type: application/json` when a body is sent.
- 401/403 -> `updateStatus(InstanceStatus.AuthenticationFailure, ...)` and throw.
- Network error / timeout -> `updateStatus(InstanceStatus.ConnectionFailure, message)` and throw.
- Other non-2xx -> parse `{status, message}` if JSON, throw `PearlApiError`; do NOT change instance status
  (a 404 from a user action is not a connection problem). Log at 'error' unless `silent`.
- Envelope with `status !== 'ok'` -> throw PearlApiError with the envelope message.
- On success, set `InstanceStatus.Ok` only if the current status is not already Ok (track `this.currentStatus`).
- `this.config.verbose` logs request line and response body at 'debug'.
- `sendRequest(type, url, body)` is kept as a compatibility wrapper: `request(type.toUpperCase(), url, { body })`.
- `fetchPreviewImage(kind, id)` -> `request('GET', '/<channels|inputs|outputs>/<id>/preview', { query: { resolution: String(this.config.preview_width), format: 'png', keep_aspect_ratio: true }, raw: true, optional: true })`
  returns base64 string or null. Outputs use `resolution: '<w>x<h>'` where h = round(w*9/16) because the
  output preview endpoint has no `auto`.
- `PearlApiError` class exported from `api.js`.

### Legacy-only endpoints (always `base: 'v1'`)

| purpose          | request                                                                                                                                                                                                                                                                                                                                                          |
| ---------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| list layouts     | `GET /channels/{cid}/layouts` -> `[ {id, name, active} ]`                                                                                                                                                                                                                                                                                                        |
| layout settings  | `GET/PUT /channels/{cid}/layouts/{lid}/settings`                                                                                                                                                                                                                                                                                                                 |
| layout preview   | `GET /channels/{cid}/layouts/{lid}/preview?resolution=WxH` -> JPEG. **Undocumented** — not in `doc/pearl-api-v2.0.yaml`; confirmed by Epiphan. Renders that layout's own composition regardless of whether it is active. Do not send `format`/`keep_aspect_ratio` — unconfirmed for this endpoint. `fetchPreviewImage('layout', '<cid>-<lid>')` in `src/api.js`. |
| recorder reset   | `POST /recorders/{rid}/control/reset`                                                                                                                                                                                                                                                                                                                            |
| content metadata | `GET /admin/channel{cid}/get_params.cgi?title&author&rec_prefix` (base 'raw', text/plain)                                                                                                                                                                                                                                                                        |
| set metadata     | `GET /admin/channel{cid}/set_params.cgi?title=..&author=..&rec_prefix=..` (base 'raw')                                                                                                                                                                                                                                                                           |

### v2 parameter conventions that differ from v1

- `PUT /channels/{cid}/layouts/active` -> send `query: { id }` AND `body: { id: Number(id) }` (v1 wants body, v2 wants query; both accepted).
- `POST /channels/{cid}/bookmarks` -> v2: `query: { text }`; v1: `body: { text }`. Send both.
- `PUT /channels/{cid}/name`, `PUT /channels/{cid}/publishers/{pid}/name` -> `query: { name }`.
- `PUT /outputs/{did}/settings` -> `query: { source }`.
- `GET /channels` boolean flags: v2 uses `true`; v1 used `yes`. Poller sends `true` on v2 and `yes` on v1.

## Poller (`src/poller.js`)

`async pollAll()` is the only poll entry point (bound to `this.timer`). It must never throw. While a poll is running
`this.pollPromise` holds its promise and an overlapping call returns that promise instead of starting a second poll.
`pollAllInner()` captures `this.configGeneration` at its start and skips the state swap / feedback checks / metadata
step when `configUpdated()` changed the generation meanwhile.

Order of work (all requests via `Promise.allSettled`, a failed optional request leaves that part of
state empty rather than aborting the whole poll):

1. Core (both API versions): channels, layouts (legacy), recorders, recorders/status.
   - v2: `GET /channels` with `{ publishers: true, 'publishers-status': true, encoders: true, active_layout: true }`
     gives publishers (id/type/name/status), encoders and active_layout in one call.
   - v1: `GET /channels?publishers=yes&encoders=yes` then per channel `/publishers/type` and `/publishers/status`.
   - Layout `active` flag comes from the legacy list; when v2 `active_layout` is present it wins.
2. v2 only, every poll: `/system/status`, `/afu/status` (optional), `/inputs`, `/outputs`,
   `/system/storages` + `/system/storages/{id}/status` each, `/system/singletouchcontrol` + `/{id}/state` each,
   and when `poll_events`: `/schedule/events/upcoming` and `/schedule/events/ongoing` (both `optional`; 404 -> null).
3. v2 only, on the first poll and then every 30th poll (`STRUCTURE_REFRESH_EVERY`): `/system/firmware`, `/system/ident`,
   `/system/presets?details=true`. In between, the previous values are carried over.
4. Conditional: `poll_archive` -> `/recorders/{rid}/archive/files?from=0&limit=1` per recorder (v2);
   `poll_connectivity` -> `/system/connectivity/details` on the first poll and then every 6th poll (`CONNECTIVITY_EVERY`, v2),
   previous value carried over in between.
5. Swap `this.state`. Preserve `outputs[did].source` from the previous state (optimistic value).
6. Diff:
   - `structureKey(state)` = JSON of ids+names of channels, layouts, publishers, recorders, inputs, outputs,
     storages, singleTouch, presets names. Changed -> `this.updateSystem()` (re-set action/feedback/preset
     definitions) and `checkFeedbacks()` with no args (all).
   - Otherwise compare per-domain JSON slices and call `checkFeedbacks(...ids)` only for changed domains:
     layouts active -> `channelLayout`; publisher status -> `streamingState`, `publisherState`, `anyStreaming`;
     recorder status -> `recorderRecording`, `recorderState`, `anyRecording`; storages -> `storageState`, `storageFreeBelow`;
     singleTouch -> `singleTouchPressed`, `singleTouchOk`; afu -> `afuState`; systemStatus -> `cpuLoadHigh`, `cpuTempHigh`;
     events -> `eventStatus`.
7. `variables.updateVariables(this)`.
8. Metadata: fetch legacy metadata for channels not yet in `this.metadata` and for failure markers whose back-off has
   elapsed (`utils.metadataRetryDue`).

`async pollPreviews()` (bound to `this.previewTimer`, interval `preview_interval` s, only when > 0):
for each key in `this.previewSubscriptions` with count > 0 fetch the image, store in `this.previews`,
then `checkFeedbacks('channelPreview', 'inputPreview', 'outputPreview', 'channelLayoutPreview')` if anything changed.
Keys are fetched `MAX_CONCURRENT_PREVIEWS` (3) at a time rather than all at once — the Pearl is an embedded device and a
page with many preview buttons firing simultaneous requests overwhelms it, so most of them time out instead of a few
taking slightly longer. A key whose fetch returns null (not found or the request failed/timed out) is added to
`this.previewFailedKeys` and logged at `'warn'` the first time only; a later success removes it and logs one `'info'`
line, so a persistently broken preview is visible without verbose logging but a single missed poll stays quiet. A call
while a refresh is already running queues exactly one follow-up refresh (so a key subscribed meanwhile gets its first
image) and resolves when that follow-up is done; an image whose key was unsubscribed while in flight is not cached.
No-op on v1 and while `preview_interval` is 0 (subscriptions are kept, nothing is fetched).

`updateSystem()` = setActionDefinitions(getActions()) + setFeedbackDefinitions(getFeedbacks()) + setPresetDefinitions(getPresets()).

## Choices (`src/choices.js`)

All return `[{ id, label }]` sorted as the device lists them. Existing ids formats are kept:

- `choicesChannel()` -> id `cid`
- `choicesChannelLayout()` -> id `${cid}-${lid}`, label `Channel - Layout`
- `choicesChannelPublishers()` -> id `${cid}-all` (only when channel has publishers) and `${cid}-${pid}`
- `choicesChannelPublishersOnly()` -> same without the `-all` entries
- `choicesRecorders()` -> id `rid`
- `choicesInputs()` -> id `sid`, label `name (type)`
- `choicesInputsWithAudio()` -> inputs where `audio === true`
- `choicesInputsWithVideo()` -> inputs where `video === true`; used for anything that shows a picture (input preview
  feedback/preset, output routing) so an audio-only child input (e.g. "HDMI-A Audio") is never offered
- `choicesOutputs()` -> id `did`
- `choicesOutputSources()` -> `[{id:'multiview',label:'Multi-viewer'},{id:'deviceinfo',...},{id:'console',...}]`
  followed by channels (`id: cid`, label `Channel: name`) and video-capable inputs only (`id: sid`, label `Input: name`)
- `choicesStorages()` -> id `stid`
- `choicesSingleTouch()` -> id `stcid`
- `choicesConfigPresets()` -> id `preset.name`
- `choicesEventAlias()` -> static `upcoming`, `ongoing`, `running`, `paused`, `completed`
- `firstId(arr)` -> id of first entry or ''

## Actions (`src/actions.js`) — `getActions()`

Existing action ids and option ids are unchanged (`channelChangeLayout`, `controlStreaming`, `recorderRecording`,
`insertMarker`, `getLayoutData`, `setLayoutData`, `systemReboot`, `systemShutdown`, `getContentMetadata`,
`setContentMetadata`). Fix in place: `this.debug(...)` -> `this.log('debug', ...)`, reset uses legacy base,
bookmarks/layouts use the v2 parameter conventions above.

New actions (all textinputs `useVariables: true`, values run through `await this.parseVariablesInString`):

| id                      | options                                                                                                                           | request                                                                                                                                                                         |
| ----------------------- | --------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| recorderControlAll      | action start/stop                                                                                                                 | `POST /recorders/control/{start                                                                                                                                                 | stop}` |
| setChannelName          | channel, name                                                                                                                     | `PUT /channels/{cid}/name?name=`                                                                                                                                                |
| setPublisherName        | publisher (no all), name                                                                                                          | `PUT /channels/{cid}/publishers/{pid}/name?name=`                                                                                                                               |
| setPublisherEnabled     | publisher (no all), enabled true/false                                                                                            | `PATCH .../settings {common:{enabled}}`                                                                                                                                         |
| setPublisherSingleTouch | publisher (no all), single_touch true/false                                                                                       | `PATCH .../settings {common:{single_touch}}`                                                                                                                                    |
| setRtmpDestination      | publisher, url, stream, username, password (blank = unchanged)                                                                    | `PATCH .../settings {rtmp:{...non-blank}}`                                                                                                                                      |
| setSrtDestination       | publisher, mode unchanged (default)/caller/listener/rendezvous, url, stream_id, port, latency (blank = unchanged)                 | `PATCH .../settings {srt:{...non-blank}}`; `mode` only when not 'unchanged'; url/stream_id/port only where the mode applies (all three when unchanged); nothing to send -> warn |
| patchPublisherSettings  | publisher, json                                                                                                                   | `PATCH .../settings <json>`                                                                                                                                                     |
| addPublisher            | channel, name, json settings                                                                                                      | `POST /channels/{cid}/publishers {name, settings}`; `settings.common` defaults to `{enabled:false,single_touch:false}`                                                          |
| setOutputSource         | output, source dropdown (choicesOutputSources) or custom text when source === 'custom'                                            | `PUT /outputs/{did}/settings?source=`; on success set `state.outputs[did].source`                                                                                               |
| inputAudioMute          | input (audio inputs), mute true/false                                                                                             | `PATCH /inputs/{sid}/settings` with `audioSettingsBody(sid,'mute',v)`: id contains hdmi -> `{hdmi:{audio:{mute}}}`, sdi -> `{sdi:{audio:{mute}}}`, else `{local_audio:{mute}}`  |
| inputAudioGain          | input, gain number, channel both/A/B                                                                                              | both: `{local_audio:{gain}}`; A/B: `{local_audio:{stereo_pair:false,channels:{channelA:{gain}}}}`                                                                               |
| inputAudioDelay         | input, delay -300..300                                                                                                            | `audioSettingsBody(sid,'delay',v)`: hdmi -> `{hdmi:{audio:{delay}}}`, sdi -> `{sdi:{audio:{delay}}}`, else `{audio:{delay}}` (HdmiInputSettings / SdiInputSettings)             |
| inputPhantomPower       | input, on/off                                                                                                                     | `PATCH {local_audio:{phantom_power}}`                                                                                                                                           |
| patchInputSettings      | input, json                                                                                                                       | `PATCH /inputs/{sid}/settings <json>`                                                                                                                                           |
| createNetworkInput      | type (rtsp/srt/ndi/web-graphics/dante), name, json settings                                                                       | `POST /inputs {type,name,settings}`                                                                                                                                             |
| singleTouchToggle       | stc                                                                                                                               | `POST /system/singletouchcontrol/{stcid}/control/toggle`                                                                                                                        |
| applyConfigPreset       | preset, sections multidropdown (system, network, sources, edid, channels, afu, cms, avstudio, frontscreen, displays; empty = all) | `POST /system/presets/{name}/control/apply {sections}`; log if result.reboot                                                                                                    |
| storageEject            | storage                                                                                                                           | `POST /system/storages/{stid}/control/eject`                                                                                                                                    |
| eventControl            | event alias dropdown (+ 'custom' with id text), action start/stop/pause/resume                                                    | `POST /schedule/events/{id}/control/{action}`                                                                                                                                   |
| eventExtend             | event alias/id, seconds (default 300)                                                                                             | `POST /schedule/events/{id}/control/extend {finish}`                                                                                                                            |
| createAdhocEvent        | json body                                                                                                                         | `POST /schedule/events <json>`                                                                                                                                                  |
| adhocSessionLogout      | –                                                                                                                                 | `DELETE /schedule/events/adhoc/session`                                                                                                                                         |
| refreshConnectivity     | –                                                                                                                                 | `GET /system/connectivity/details` -> `state.connectivity`, update variables                                                                                                    |
| runSpeedTest            | mode uplink/downlink, protocol tcp/udp, timeout s (default 10)                                                                    | `GET /system/connectivity/tools/speedtest` with request timeout = (timeout+15)s -> `state.speedtest`, variables                                                                 |
| refreshPoll             | –                                                                                                                                 | `await this.pollAll()`                                                                                                                                                          |

Actions touching v2-only endpoints must check `this.isV2` and log a warning + return when false.
Actions never throw: wrap requests in try/catch and `this.log('error', ...)`.
Every action that takes a channel option validates it with `parseChannel(label, value)` against `this.state.channels`
("no channel selected" / "unknown channel X" at 'error', then return); layouts/publishers use `parseLayout` /
`parsePublisher` the same way. Every id interpolated into a request path goes through `enc()` (`encodeURIComponent`).
Deliberately not exposed: factory reset, delete publisher, ad-hoc session login (credentials).
After a successful control action the poller is nudged: `this.schedulePollSoon()` (a one-shot 750 ms
timer that runs `pollAll` once, coalesced).

## Feedbacks (`src/feedbacks.js`) — `getFeedbacks()`

Existing: `channelLayout`, `streamingState`, `recorderRecording` (unchanged option ids).

New boolean feedbacks (all with `defaultStyle`):

| id                 | options                                                            | true when                                                                                           |
| ------------------ | ------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------- |
| publisherState     | publisher (no all), state started/stopped/starting/listening/error | `publishers[pid].status.state === state`                                                            |
| recorderState      | recorder, state started/stopped/paused/starting/error/disabled     | match                                                                                               |
| anyRecording       | –                                                                  | any recorder state === 'started'                                                                    |
| anyStreaming       | –                                                                  | any publisher state === 'started'                                                                   |
| singleTouchPressed | stc                                                                | `state.pressed`                                                                                     |
| singleTouchOk      | stc                                                                | `state.status`                                                                                      |
| storageState       | storage, state ready/nodev/dev/devro/formatting                    | match                                                                                               |
| storageFreeBelow   | storage, percent (default 10)                                      | free/total*100 < percent (false when total unknown)                                                 |
| afuState           | state idle/paused/uploading/error/disabled                         | any afu entry state matches                                                                         |
| cpuLoadHigh        | –                                                                  | `systemStatus.cpuload_high`                                                                         |
| cpuTempHigh        | –                                                                  | `cputemp >= cputemp_threshold`                                                                      |
| eventStatus        | which: upcoming/running/paused/ongoing                             | upcoming: events.upcoming != null; running/paused: events.ongoing?.status; ongoing: ongoing != null |

Two more boolean feedbacks are **optimistic**: the Pearl API has no read endpoint for either value, so they reflect
only what this connection itself last set, not a value confirmed by the device.

| id                     | options        | true when                                 |
| ---------------------- | -------------- | ----------------------------------------- |
| outputSourceOptimistic | output, source | `state.outputs[did].source === source`    |
| configPresetApplied    | preset         | `state.lastConfigPreset?.name === preset` |

Advanced feedbacks returning `{ png64 }` (or `{}` when no image yet):

| id                   | option            | preview key          | image shown when                     |
| -------------------- | ----------------- | -------------------- | ------------------------------------ |
| channelPreview       | channel           | `channel:<cid>`      | always (once fetched)                |
| inputPreview         | input             | `input:<sid>`        | always (once fetched)                |
| outputPreview        | output            | `output:<did>`       | always (once fetched)                |
| channelLayoutPreview | channelIdlayoutId | `layout:<cid>-<lid>` | always (once fetched), active or not |

`channelLayoutPreview` fetches the undocumented per-layout endpoint (see "Legacy-only endpoints") via
`fetchPreviewImage('layout', id)`, keyed `layout:<cid>-<lid>` — a namespace of its own, independent of
`channelPreview`'s `channel:<cid>` key, since it is a genuinely different image (that specific layout's own
composition, not the channel's current output). It is fetched regardless of `isV2` (see `pollPreviewsInner`) because
the endpoint is on the legacy base, and is NOT in the `layouts` domain of `DOMAIN_FEEDBACKS` — its image does not
depend on which layout is active, so an active-layout change has no reason to re-check it; only `pollPreviews()`'s own
refresh (like the other three preview feedbacks) updates it.

Each preview feedback has `subscribe(feedback)` incrementing `previewSubscriptions` for its key (also while previews
are disabled) and `unsubscribe` decrementing (delete at 0 and drop the cached image). Subscribe triggers
`this.pollPreviews()` once so the first image appears without waiting for the interval.

## Variables (`src/variables.js`)

`buildVariables(self)` returns `{ definitions: [{variableId,name}], values: {id: value} }`; `updateVariables(self)`
calls `setVariableDefinitions` only when the sorted id list differs from `self.lastVariableIds`, then `setVariableValues`.

Variable ids may only contain `[a-zA-Z0-9_-]`; use `utils.safeId(id)` (replace anything else with `_`).

Keep all existing ids. Add:

- per channel: `channel_{cid}_active_layout_id`, `channel_{cid}_publishers_count`, `channel_{cid}_streaming_count`
- per publisher: `stream_{cid}_{pid}_type`, `stream_{cid}_{pid}_duration`, `stream_{cid}_{pid}_duration_hms`, `stream_{cid}_{pid}_configured`
- per recorder: `recorder_{rid}_name`, `recorder_{rid}_duration_hms`, `recorder_{rid}_total`, and when poll_archive:
  `recorder_{rid}_last_file_name`, `recorder_{rid}_last_file_size_mb`, `recorder_{rid}_last_file_created`
- totals: `recorders_active_count`, `publishers_active_count`
- per input: `input_{safeId(sid)}_name`, `input_{safeId(sid)}_type`
- per output: `output_{safeId(did)}_name`, `output_{safeId(did)}_source` (optimistic, '' if unknown)
- per storage: `storage_{stid}_state`, `storage_{stid}_media_type`, `storage_{stid}_total_gb`, `storage_{stid}_free_gb`, `storage_{stid}_free_percent`
- per single touch: `stc_{id}_pressed`, `stc_{id}_status`, `stc_{id}_recorders_active`, `stc_{id}_recorders_total`, `stc_{id}_publishers_active`, `stc_{id}_publishers_total`
- afu (first entry): `afu_state` (existing, comma list), `afu_protocol`, `afu_queue_files`, `afu_queue_size_mb`, `afu_file_name`, `afu_file_progress_percent`, `afu_error`
- system: existing `system_status_*` plus `system_status_uptime_hms`, `system_cpuload_high`, `system_cputemp_threshold`, `firmware_revision`, `product_id`
- events: `event_upcoming_id`, `event_upcoming_title`, `event_upcoming_start` (unix), `event_upcoming_start_time` (local HH:MM), `event_upcoming_starts_in_hms`;
  `event_ongoing_id`, `event_ongoing_title`, `event_ongoing_status`, `event_ongoing_finish`, `event_ongoing_finish_time`, `event_ongoing_remaining_hms`
- connectivity: `connectivity_external_ip`, `connectivity_mdns`, `connectivity_dns`, `connectivity_http`, `connectivity_https`, `connectivity_captive_portal`, `connectivity_icmp`, `connectivity_epiphan_edge`, `connectivity_vtun`
- speedtest: `speedtest_bandwidth_mbps` (1 decimal), `speedtest_protocol`, `speedtest_mode`, `speedtest_duration`, `speedtest_udp_loss`
- `config_presets` (comma separated preset names)
- `last_config_preset` (optimistic, see `lastConfigPreset` above; `''` until an apply action succeeds)

Numbers stay numbers; unknown values are `''` (not `undefined`). `hms` = `HH:MM:SS` via `utils.formatHms(seconds)`;
`_time` = `HH:MM` local time via `utils.formatClock(unixSeconds)`; `*_mb`/`*_gb` rounded to 1 decimal.
Countdown variables (`starts_in`, `remaining`) are recomputed each poll from `Date.now()`.

## Presets (`src/presets.js`) — `getPresets()`

Keep existing (Channels layouts, Publishers toggle, Recorders toggle + reset), with one addition: each layout button
also carries the `channelLayoutPreview` feedback (`styleExtra: previewStyle`, same alignment as the Previews category),
showing a live preview of that specific layout's own composition, alongside the existing red highlight while it is
the active one. Add categories:

- `Recorders`: "All recorders start", "All recorders stop" (recorderControlAll) with `anyRecording` feedback
- `Outputs`: per output x choicesOutputSources entry (skip 'custom') -> setOutputSource, with `outputSourceOptimistic`
  (blue) so the button matching the last-set source is highlighted
- `Inputs`: per audio input mute/unmute pair (inputAudioMute)
- `Previews`: per channel (channelPreview advanced feedback, text = channel name, size 7, `pngalignment` center),
  per video-capable input via `choicesInputsWithVideo()` (inputPreview; audio-only inputs have nothing to show and are
  skipped), per output (outputPreview)
- `Single touch`: per stc toggle button with `singleTouchPressed` (green) and `singleTouchOk` false -> red text
- `Storage`: per storage status button (text uses `$(pearl:storage_{id}_free_gb) GB free`) with storageFreeBelow 10% red
- `System`: CPU load `$(pearl:system_status_cpuload)%` with cpuLoadHigh, CPU temp with cpuTempHigh, Uptime, Reboot (systemReboot), Refresh
- `Events`: "Start upcoming event", "Stop ongoing event", "Pause event", "Resume event", "Extend event +5 min", plus two status
  display buttons with eventStatus feedbacks: "Ongoing event status" (title / status / remaining, green when running, yellow when
  paused) and "Upcoming event status" (title / start time / countdown, purple when an upcoming event exists)
- `AFU`: status display with afuState uploading (blue) / error (red)
- `Config presets`: one button per device configuration preset (applyConfigPreset, empty sections = all), with
  `configPresetApplied` (blue) so the last-applied preset is highlighted

Preset ids must be unique and stable: `${category}_${safeId(...)}`; when two ids collide after `safeId` (e.g. config presets
"Show A" and "Show_A") the later ones get a `_2`, `_3`, ... suffix instead of being dropped. Every variable reference built
from an entity id uses `safeId(id)`, exactly like the variable ids. Use `type: 'button'`, `name` (not `label`).
Variables referenced in preset text/options are written as `$(pearl:variable_id)`. Companion rewrites the `pearl:` prefix
to the actual connection label when a preset is added to a button (`replaceAllVariables` in companion/lib/Instance/Definitions.ts),
so any prefix other than `local`/`internal`/`custom` works; `pearl` matches the manifest shortname and is the convention here.

## Utils (`src/utils.js`)

`safeId(str)`, `formatHms(seconds)`, `formatClock(unixSeconds)`, `bytesToMb(n)`, `bytesToGb(n)`, `round1(n)`,
`splitPair(str)` (`'1-2' -> ['1','2']`, null when invalid), `stableJson(obj)` (JSON with sorted keys, for diffing),
`parseJsonOption(text)` (returns object or throws with a readable message), `nonBlank(obj)` (drop '' / undefined values),
`toQueryString(query)` (`''` or `?a=b&c=d`; booleans -> 'true'/'false', undefined/null skipped, arrays comma-joined),
`parseKeyValueText(text)` (legacy `key=value` per line response of `get_params.cgi` -> object),
`firmwareVersionNumber(version)` (`'4.24.1' -> 42401`, null when unparseable; compared against `MIN_API_V2_VERSION`),
`clampNumber(value, def, min, max)` (config normalisation), `metadataRetryDue(entry, now)` (see "Other instance fields"),
`emptyState()` (the empty shape of `this.state` described above).

## Test harness

`test/harness.js` replaces `@companion-module/base` in `require.cache` with a stub exporting:
`InstanceBase` (constructor(internal) storing calls: `calls.log`, `calls.status`, `definitions.actions/feedbacks/presets/variables`,
`variableValues`, `checkedFeedbacks`; methods `log`, `updateStatus`, `setActionDefinitions`, `setFeedbackDefinitions`, `setPresetDefinitions`,
`setVariableDefinitions`, `setVariableValues`, `checkFeedbacks`, `subscribeFeedbacks`, `saveConfig`, `parseVariablesInString` (identity),
`setCustomVariableValue` (stored), `getVariableValue`), `InstanceStatus`, `Regex`, `combineRgb`, `runEntrypoint` (no-op),
`CreateConvertToBooleanFeedbackUpgradeScript` (returns a function). `createInstance({ mock, config })` returns an initialised instance
pointed at the given mock server (`config` = overrides of the harness `DEFAULT_CONFIG`); `runAction(instance, id, options)`,
`runFeedback(instance, id, options)`, `subscribeFeedback` / `unsubscribeFeedback` invoke definitions the way Companion would.
Every suite starts its own mock and destroys the instance in `after()`. Tests run with `node --test "test/**/*.test.js"`
(`yarn test`); Node >= 21 no longer expands a bare directory argument.

`test/mock-pearl.js` exports `startMockPearl({ firmware = '4.24.1', legacyOnly = false, port = 0 })` -> `{ url, port, state, requests, reset(), close() }`.
It serves every endpoint the module uses from an in-memory model (2 channels with layouts and publishers, 3 recorders, inputs,
1 output, storages, single touch, presets, events, afu, system), records `{ method, path, query, body }` for each request,
mutates state on control calls (start/stop publishers and recorders, layout activation, names, output source, single touch toggle,
patch settings), returns a 1x1 PNG for previews, and returns 404 JSON `{status:'notfound', message}` for unknown ids.
With `legacyOnly: true` it 404s everything under `/api/v2.0/` so v1 fallback can be tested.
