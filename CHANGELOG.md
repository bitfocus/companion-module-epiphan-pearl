# Changelog

All notable changes to this project will be documented in this file.
Most recent releases are shown at the top.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

---

## [3.0.0] (unreleased)

Companion parity rewrite: the module's control set is now exactly the one offered by the sibling **Epiphan
Pearl** Stream Deck plugin — same 13 actions (by Stream Deck action suffix), same feedback/variable ids
(`doc/PARITY.md` §9 casing), same 13 preset categories, same colours and state words. See `doc/PARITY.md`
for the full target-set table and the exact legacy→new id conversion the upgrade script performs, and
`doc/ARCHITECTURE.md` for how each piece is implemented. **This is a breaking release for hand-built
buttons**: read "Upgrade notes" below before updating a production connection.

### Added

- **Confirm with a second press** (checkbox, default on) on the `preset` (Apply Preset), `power`
  (Reboot / Shutdown) and `storage` (Storage eject) actions, replacing the Stream Deck's hold-to-confirm
  gesture (Companion has no hold arc): the first press arms the button (`confirm_hint` = `Press again to
confirm`, boolean feedback `confirm_pending`) and sends nothing; the same button pressed again within 3
  seconds sends the command. Untick the checkbox to send immediately, as every existing button of this kind
  already did before this release (the upgrade script sets it to off for them).
- Rotary (Stream Deck+/encoder) support for the `audio` action: `rotate_left`/`rotate_right` nudge gain or
  delay, the push step re-reads. Ticks within 150 ms are combined into one request.
- Connection settings **Use HTTPS** and **Accept self-signed certificate** (off / on by default). Requests
  go through `undici`'s `fetch` with a dispatcher `Agent` built per connection; the port defaults to `443`
  when HTTPS is turned on and the port was left at `80` (or blank).
- New config field **Poll interval (ms)** replaces the old **Feedback polling frequency in seconds**: the
  default drops from 10 s to 2 s, and a poll that fails now waits longer before the next try (doubling per
  consecutive failure, capped at 15 s; the first success resets it) instead of retrying at a fixed rate.
- The module now reads the `Date` header of every response and keeps the offset between the Pearl's clock
  and the Companion host's (`clockOffsetMs`, changes under 2 s ignored). The event countdown variables are
  computed from that corrected clock instead of the host clock, so they stay accurate when the two disagree.
- New action `event`: start/stop/pause/resume/extend/toggle/status-only against an "Ongoing"/"Upcoming"/
  "Running"/"Paused"/"Completed" alias or a specific polled event, resolved live at press time. New
  feedbacks `event_state` and `event_applies`; new `event_upcoming_*`/`event_ongoing_*` time-text/state-word
  variables, the `event_ongoing_toggle_command` variable, and the `event_title`/`event_state`/
  `event_remaining` aliases.
- New action `audio`: nudges an input's gain (dB) or delay (ms) up/down by a configurable step, or just
  re-reads it, replacing the old absolute gain/delay setters. New `input_ID_gain`/`_delay` variables.
- New advanced feedback `audio`: a real stereo level meter drawn onto the button — two vertical bars with
  peak ticks on its right edge, over a −60..0 dBFS scale, green up to 62 % of the bar, amber to 82 %, red
  above, on a `#2a2e35` track. The bars are drawn over the button, so its own text, colour and other
  feedbacks stay visible; a mono input gets one bar, and an input without levels draws nothing.
- The levels behind that meter come from a **500 ms level poll** that runs only while at least one `audio`
  feedback is placed (its subscriptions are ref-counted; the last one taken off stops the poll again). One
  tick is one legacy `GET /api/sources/status` for every metered input at once, so a page full of meters
  costs the Pearl no more than a single one. Pressing an `audio` button with _Press adjusts_ = Nothing
  re-reads the levels immediately, with or without a meter placed.
- New preset categories **Bookmarks**, **Outputs** (restored — see Changed), **Power** and **Audio**.
- New `src/style.js` (shared palette/state-word/standard-text module) and `src/icons.js` (one icon per
  preset category, rendered from the Stream Deck plugin's own artwork) — every generated preset now carries
  a matching icon and the same background/text/badge colours as the Stream Deck key for the same control.
- Removed legacy actions/feedbacks that are still placed on a button (no longer possible to add new ones)
  are now reported: once per module start, the connection log prints one `warn` line per distinct removed
  id, naming how many buttons carried it and pointing at its replacement.
- Input level variables `input_ID_peak_dbfs`, `_peak_left`, `_peak_right`, `_level_text` for every
  audio-capable input, filled by the level poll above from the legacy `GET /api/sources/status` list (its
  ids carry a device-serial prefix the v2.0 `/inputs` ids lack; matched with that prefix stripped). They
  read empty while no `audio` feedback is placed anywhere in the connection — keep one meter button (or
  press a _Press adjusts_ = Nothing button) to feed a text-only level readout.
- New variables: `recorder_ID_state_word`/`_duration_text`, `recorder_all_state_word`,
  `channel_CID_publisher_PID_state_word`/`_error`, `channel_CID_publishers_state_word`, `uptime`,
  `system_status_text`, `afu_text`, `storage_ID_text`/`_level_word`/`_hint`, `singletouch_ID_summary`/
  `_state_word`, `preset_status`, `power_status`, `confirm_hint`, `last_error`.

### Changed

- Every action, feedback and (where the reference names one) variable id now matches the Stream Deck
  plugin's naming (`doc/PARITY.md` §2, §9): `channelChangeLayout`→`layout`, `controlStreaming`→`stream`,
  `recorderRecording`+`recorderControlAll`→`recorder`, `insertMarker`→`bookmark`, `systemReboot`/
  `systemShutdown`→`power`, `setOutputSource`→`output`, `singleTouchToggle`→`singletouch`,
  `applyConfigPreset`→`preset` (now confirm-gated by default), `storageEject`→`storage` (now confirm-gated
  by default), `eventControl`+`eventExtend`→`event`, `inputAudioGain`/`inputAudioDelay`→`audio` (now a
  relative nudge, not an absolute set — the upgrade script converts an existing button to "up, step 1" and
  logs that the old absolute value is not carried over). Feedback ids are now snake_case
  (`channelLayout`→`layout_active`, `streamingState`/`publisherState`→`stream_state`,
  `recorderRecording`/`recorderState`/`anyRecording`→`recorder_state`, `singleTouchPressed`/
  `singleTouchOk`→`singletouch_active`, `storageState`/`storageFreeBelow`→`storage_level`, `afuState`/
  `cpuLoadHigh`/`cpuTempHigh`→`system`, `eventStatus`→`event_state`, `channelPreview`/`inputPreview`/
  `outputPreview`→`preview`, `channelLayoutPreview`→`layout_preview`, `outputSourceOptimistic`→`output_set`).
  See `doc/PARITY.md` §2.1/§2.2 for every option translation the upgrade script applies.
- Config field **Feedback polling frequency in seconds** (`pollfreq`) is now **Poll interval (ms)**
  (`poll_interval`); **Target IP or hostname**/**Target Port** are now **Host**/**Port**; **Request timeout
  in milliseconds** is now **Request timeout (ms)**; the preview interval/width labels are shortened.
  **Use API v2.0 (if available)** now sits last among the operational settings, immediately before **Preset
  categories to generate**.
- **Preset categories to generate** now offers the 13 Stream-Deck-matching categories (`Recording`,
  `Streaming`, `Layouts`, `Single touch`, `Bookmarks`, `Previews`, `Outputs`, `Configuration presets`, `CMS
events`, `System`, `Power`, `Audio`, `Storage`) instead of the previous 11; `Channels`→`Layouts`,
  `Publishers`→`Streaming`, `Recorders`→`Recording`, `Events`→`CMS events`, `Config presets`→`Configuration
presets` are 1:1 renames, `AFU` is folded into `System`. The upgrade script turns on every new category
  for an existing connection.
- **Outputs** preset category is back (removed in 2.6.0): one button per output × the three built-in
  sources (Multiview, Device info, Console), highlighted for 5 s after a press.
- `storage_ID_total_gb`/`_free_gb` are now `storage_ID_total`/`_free` (human-readable, e.g. `11 GB`, not a
  fixed-unit number); `storage_ID_free_percent` is now `storage_ID_used_pct` (used, not free — the sense is
  flipped); `identity_name` is now `device_name`; `firmware_version` is now `firmware`.

### Removed

No longer available; see `doc/PARITY.md` §2 for the conversion each replaces (where one exists) and
`companion/HELP.md`'s Requirements section for what happens to a button that still holds one.

- **Actions** (21, no Stream Deck counterpart): `getLayoutData`, `setLayoutData`, `getContentMetadata`,
  `setContentMetadata`, `setChannelName`, `setPublisherName`, `setPublisherEnabled`,
  `setPublisherSingleTouch`, `setRtmpDestination`, `setSrtDestination`, `patchPublisherSettings`,
  `addPublisher`, `inputAudioMute`, `inputPhantomPower`, `patchInputSettings`, `createNetworkInput`,
  `createAdhocEvent`, `adhocSessionLogout`, `refreshConnectivity`, `runSpeedTest`, `refreshPoll` (Companion
  polls on its own interval and after every action, so a manual refresh action is redundant).
- **Feedbacks** (2): `anyStreaming`, `configPresetApplied`.
- **Variables**: `channel_CID_resolution`/`_fps`/`_bitrate` (encoder details), `channel_CID_publishers_count`/
  `_streaming_count`, `channel_CID_metadata_title`/`_author`/`_rec_prefix`, `stream_CID_PID_bitrate`/
  `_duration`/`_duration_hms`/`_configured`, `recorder_ID_active`/`_total`, `recorder_ID_last_file_name`/
  `_last_file_size_mb`/`_last_file_created`, `publishers_active_count`, `input_ID_type`,
  `storage_ID_media_type`, `afu_queue_size_mb`/`afu_file_name`/`afu_file_progress_percent`,
  `system_status_date`, `system_cpuload_high`/`system_cputemp_threshold` (the `system` feedback's own
  thresholds replace them), `firmware_revision`, `product_id`, `identity_location`, `identity_description`,
  `connectivity_*` (9 variables), `speedtest_*` (5 variables), `config_presets` (renamed `preset_names`),
  `last_config_preset` (renamed `preset_last_applied`).
- **Config fields**: `pollfreq` (converted to `poll_interval`), `poll_archive` (last archive file per
  recorder), `poll_connectivity` (network connectivity details every 6th poll).
- **Preset categories**: `Channels`, `Publishers`, `Recorders`, `Config presets` (all renamed, see Changed),
  `Inputs` (per-input mute/unmute buttons — `inputAudioMute` has no Stream Deck counterpart; the new
  **Audio** category replaces it with meters and gain/delay nudges), `AFU` (folded into **System**).
- **Poll targets**: recorder archive files (`poll_archive`), network connectivity details
  (`poll_connectivity`, every 6th poll), content metadata (the admin CGI `get_params.cgi` pair), each
  channel's `encoders` list.

### Fixed

- `Input: audio gain` and `Input: audio delay` used to write a blind absolute value straight into the
  settings body. Setting a single channel (**Audio channel** = Channel A/B) still writes directly — the
  body needs nothing from the device — but **Both (stereo pair)** and `Input: audio delay` now read the
  input's current settings first (shared helper `src/audio.js`) and patch the gain (both channels together
  when the input's `local_audio.stereo_pair` is already `false`) or the delay at whichever path the input
  actually keeps it (`audio.delay`, `hdmi.audio.delay` or `sdi.audio.delay`), logging an error and sending
  nothing for an input with no such setting. (These two actions are themselves replaced by the new `audio`
  nudge action above; the fix lives on in `src/audio.js`, which the new action also uses.)

### Upgrade notes

Opening an existing connection with this release runs a new upgrade script, `convertToParityV300`,
automatically: every action and feedback listed under Changed is rewritten in place to its new id and
options (existing buttons keep working, though a few option layouts changed — for example `layout` gained a
manual-entry fallback, and `audio` now nudges instead of setting an absolute value); `pollfreq` becomes
`poll_interval` in milliseconds; `preset_categories` is reset to include every one of the 13 new categories.
Anything listed under Removed that is still placed on a button cannot be converted (there is nothing to
convert it to) — it is left exactly as it was, and the connection log prints one line like:

> Removed legacy action 'refreshPoll' (2 buttons): no longer available after the 3.0.0 Companion-parity
> rewrite. Remove it from the affected button(s) or replace it with its listed counterpart (see
> CHANGELOG.md).

once per module start for each such id still in use, naming how many buttons carried it. Companion does not
rewrite variable references inside button text, so a button whose text uses a renamed or removed variable
(see Changed/Removed above) needs updating by hand; nothing logs this case since Companion gives the module
no way to detect it.

---

## [2.6.1] (2026-09-03)

### Bug Fixes

- `destroy()` did not increment `configGeneration`, so a `connect()` still in flight from the last
  `configUpdated()` (waiting on its own request timeout against an unreachable device) could start the
  polling/preview timers _after_ `destroy()` already ran, leaking a live timer past teardown. `destroy()`
  now bumps the generation like `configUpdated()` already does, so that guard in `connect()` correctly
  stops it. Found while building the sibling `companion-module-epiphan-ec20` module, which shares the
  same background-connect pattern

---

## [2.6.0] (2026-09-02)

### New Features

- New connection setting **Preset categories to generate** (multi-select, default: every category) controls which
  groups of auto-generated buttons appear in Companion's drag-and-drop preset list. Unchecking a category only stops
  it from being generated there; the underlying actions and feedbacks stay available for a hand-built button, and
  anything already placed on a page keeps working. Upgrade script `setDefaultConfigV260` sets existing connections to
  every category, so nothing changes until you deliberately narrow the selection
- With several channels, layouts or inputs, some categories (Inputs, Previews, and previously Outputs) can produce a
  large number of buttons; this setting is the way to trim the ones you do not use

### Changes

- Removed the **Outputs** preset category outright (one button per output x source produced dozens of buttons with a
  double-digit input count, for routing that is usually only a few buttons in practice). `Output: set source` and the
  `outputSourceOptimistic` feedback are unaffected and still available to build your own output-routing button by hand

---

## [2.5.0] (2026-09-02)

### New Features

- Layout-switch buttons now show a real live preview image of that specific layout's own composition, whether or not
  it is currently active — not just the active one. This uses `GET /channels/{cid}/layouts/{lid}/preview`, an
  endpoint that is not part of Epiphan's published REST API v2.0 specification but was confirmed working by Epiphan.
  It runs on the legacy API base, so it works on every supported firmware version, not only 4.24.1+
- The `Channel: layout preview` feedback (and the Channels presets, which carry it again by default) is no longer
  restricted to the active layout

### Changes

- `pollPreviews()` no longer skips fetching entirely on legacy (v1-only) firmware: channel/input/output previews
  remain v2.0-only, but layout previews are attempted regardless, since their endpoint does not require it

---

## [2.4.2] (2026-09-02)

### Changes

- The auto-generated _Channels_ layout-switch buttons no longer attach the layout preview feedback by default. A
  channel can have many layouts (dozens, on some setups) and the Pearl API only ever exposes a live image for
  whichever one is currently active, so attaching a "preview" to every layout button meant one showed a picture and
  the rest stayed blank — indistinguishable from broken. The `channelLayoutPreview` feedback itself is unchanged and
  still available to add to a specific button by hand. The _Previews_ category's per-channel button already shows a
  live image of whatever is on air, independent of which layout that is, without this problem.

---

## [2.4.1] (2026-09-02)

### Bug Fixes

- Preview images are now fetched a few at a time instead of all subscribed previews at once. On real hardware, a page
  with a dozen or more preview buttons fired that many simultaneous requests at the Pearl, an embedded device that
  cannot reliably answer that many concurrent requests, so most images came back blank
- A preview that stays unreachable now logs one warning (not one every poll) and one more when it recovers, so a
  persistently broken preview is visible without turning on verbose logging
- `channelLayoutPreview` (the new layout-button preview) is now re-subscribed after a config change, like the other
  three preview feedbacks; it was previously omitted from that list and lost its subscription on any config change
- Audio-only inputs (for example an "HDMI-A Audio" child input) are no longer offered a preview button — they have no
  picture to show — and are no longer offered as an output routing source, since an output shows a picture

---

## [2.4.0] (2026-09-02)

### New Features

- Layout-switch buttons now show a live preview image of the channel while that layout is the active one, in addition
  to the existing highlight. Only the currently active layout can show a real image (the Pearl API exposes a live view
  of a channel's current output, not a stored thumbnail per layout), so a button for a layout you are not on stays
  plain-colored until you switch to it, and the previous button's image disappears the moment you do
- New feedback `Output: source matches (optimistic)` highlights the output-routing button matching the source last set
  through Companion. The API has no endpoint to read an output's current source back, so this reflects only what this
  connection itself last set — it goes stale if the source is changed from the Pearl web UI or another controller
- New feedback `Config preset: last applied (optimistic)` highlights the configuration preset button last applied
  through Companion, for the same reason: the API cannot report which preset (if any) currently matches the device
- New variable `last_config_preset`

### Changes

- Output-routing and configuration-preset presets now carry their new optimistic feedback by default

---

## [2.3.0] (2026-09-02)

### New Features

- Full coverage of the Pearl REST API v2.0 (firmware 4.24.1+) with automatic fallback to the legacy API on older firmware
- Actions: control all recorders, set channel and publisher names, enable/disable publishers and their single touch flag,
  set RTMP and SRT destinations, patch publisher settings and add publishers from JSON
- Actions: input audio mute, gain (stereo pair or channel A/B), delay and phantom power, patch input settings, create
  network inputs (RTSP, SRT, NDI, Web Graphics, Dante) from JSON
- Actions: set output source, single touch toggle, eject storage, apply configuration presets (all or selected sections)
- Actions: CMS event start/stop/pause/resume/extend for the upcoming/ongoing event or a custom id, create ad-hoc event,
  ad-hoc session logout
- Actions: refresh connectivity details, run speed test, refresh state now
- Feedbacks: publisher state, recorder state, any streaming, any recording, single touch pressed/OK, storage state and
  free-space-below, AFU state, CPU load high, CPU temperature high, CMS event status
- Live preview images of channels, inputs and outputs as feedbacks (Stream Deck thumbnails), with configurable refresh
  interval and width; only previews placed on buttons are fetched
- Variables for publishers (type, duration, configured), recorders (name, duration HH:MM:SS, total, last archive file),
  inputs, outputs, storages, single touch controls, AFU queue/progress, CMS events (with countdowns), connectivity,
  speed test, configuration presets, firmware revision and product id
- Presets for all recorders, outputs, input mute/unmute, previews, single touch, storage, system, events, AFU and
  configuration presets
- New connection settings: request timeout, preview refresh interval and width, poll CMS schedule, poll last archive
  file, poll network connectivity details
- Poller nudges a refresh shortly after every successful control action so feedbacks update without waiting for the
  next interval
- Set SRT destination defaults to mode "Unchanged": the mode configured on the device is kept and only the filled-in
  fields are sent
- Upgrade script `setDefaultConfigV230` fills the new v2.3.0 connection settings (timeout, preview interval and width,
  poll CMS schedule, poll last archive file, poll connectivity) with their defaults on existing connections

### Changes

- Source split into `src/` (instance, api, poller, choices, actions, feedbacks, variables, presets, config, upgrades,
  utils); `index.js` is now only the entrypoint
- State is rebuilt on every poll and diffed per domain so only affected feedbacks are re-checked
- Requests use the `/api/v2.0` base when available; the few endpoints v2.0 does not offer (layout list and settings,
  recorder reset, content metadata) stay on the legacy API
- Module targets `@companion-module/base` 1.12 and the `node22` runtime; manifest lists Pearl-2, Pearl Mini,
  Pearl Nano and Pearl Nexus
- Test suite (`node --test`) with an in-memory Pearl mock covering v2.0 and legacy behaviour
- Rewritten HELP.md with connection settings, all actions/feedbacks/variables/presets, JSON examples, tips and known
  limitations

### Bug Fixes

- Request timeout is now real (`AbortSignal.timeout`); the previous `timeout:` fetch option had no effect
- Fixed `this.debug is not a function` crash when validating action options
- The error message returned by the device is now logged instead of a generic failure
- Bookmarks and active layout use the v2.0 query-parameter conventions (both v1 and v2 forms are sent, so both API
  versions accept them)
- Recorder reset works on v2.0 firmware (the endpoint only exists in the legacy API and is now always called there)
- Variable definitions are only re-registered when the set of variables changes, removing redundant churn on every poll
- Input audio mute and delay send the nested `hdmi.audio` / `sdi.audio` settings for HDMI and SDI inputs, as required by
  the InputSettings schema; other inputs keep using `local_audio` / `audio.delay`
- Initialisation no longer blocks on the device: `init`/`configUpdated` publish the definitions and return at once while
  the API probe and first poll run in the background. Previously an unreachable device made Companion time out the
  init call and restart the module in a loop
- A config change no longer races with a running poll: results from the previous configuration are discarded
- Preview feedbacks already placed on buttons are re-subscribed after a config change, so thumbnails resume without
  re-adding the feedback
- Content metadata fetch failures are retried with an increasing back-off (1..10 minutes) and only the first failure
  is logged as an error
- Line endings normalised from CRLF to LF
- ESLint moved to flat config (`eslint.config.mjs`)
- Manifest runtime set to `node22`

## [2.2.0] (2025-10-20)

### New Features

- Support for Pearl API v2.0 with automatic fallback
- Verbose logging option
- New variables for channel, recorder, system and device information
- Actions for starting/stopping streaming and recording
- Actions to reboot or shutdown the device
- Actions to get and set content metadata

## [2.1.0] (2023-05-26)

## New Features

- Added action to insert chapter markers in recordings
- Added action to get layout data and store it in a variable
- Added action to set layout data to device
- Added options to toggle streaming and recording based on current state
- Added preset for recorder reset action
- Don't show "All streams" any more if there are no individual streams in a channel
- completely redone internal handling of polling and updating the connection data, improved error handling

## [2.0.0] (2023-05-24)

## Major

- Rewrite of the module code for compatibility with Companion v3. The code is not backwards compatible, but configuration data is.

## New Features

- Upgraded Feedbacks to boolean type
- Added Reset option to recorder control
- Added option to change the feedback polling interval

## Dependencies

- Changed REST connection from request module to node's internal fetch
- Bump sentry 7.52 to 7.53
- Bump @types/eslint 8.37 to 8.40
- Bump electron-to-chromium 1.4.103 to 1.4.105
- Bump node-releases 2.0.11 to 2.0.12
- Bump terser 5.17.5. to 5.17.6
- Bump yaml 2.2.2 to 2.3.0

## Bugfixes

- Corrected some typos

---

## [1.0.9] (2022-09-26)

## Dependencies

- [#14](https://github.com/bitfocus/companion-module-epiphan-pearl/pull/14) - Bump ajv from 6.10.0 to 6.12.6

---

## [1.0.8] (2022-02-05)

## Cleanup

- Update package information to the future

---

## [1.0.7] (2021-06-03)

## Bug Fixes

- [#10](https://github.com/bitfocus/companion-module-epiphan-pearl/issues/10) - A sanity check is done if the action variable exists, which if the variable was 0 returned a fault.

---

## [1.0.6] (2021-02-15)

## New Features

- Ability to change the host port.

---

## [1.0.5] (2021-02-12)

## Bug Fixes

- [#5](https://github.com/bitfocus/companion-module-epiphan-pearl/issues/5) - Dropdown list not updating with correct ids  
  This now results in an extra entry '---' to force the user to select a Channel or Recorder and assosiated action

---

## [1.0.4] (2021-01-30)

## Bug Fixes

- [#5](https://github.com/bitfocus/companion-module-epiphan-pearl/issues/5) - Fixed issue with recording not working.

---

## [1.0.3] (2020-06-16)

## Bug Fixes

- [#2](https://github.com/bitfocus/companion-module-epiphan-pearl/issues/2) - Fixed error on non existing action.

---

## [1.0.2] (2020-04-15)

## Bug Fixes

- Stop polling for information if instance gets disabled.

---

## [1.0.1] (2019-08-28)

## New Features

### Dynamic generated preset

With this new feature we have added presets to the module.
These presets are, for now, dynamically updated for every channel,
publisher and recoreder that is configured on the Pearl.

## Bug Fixes

- [#1](https://github.com/bitfocus/companion-module-epiphan-pearl/issues/1) - Error on feedback channel layout

---

## [1.0.0] (2019-08-18)

## New Features

Actions:

- Change channel layout
- Start/Stop streaming (per stream or all)
- Start/Stop recording

Feedback:

- Active channel layout
- Recording
- Streaming
