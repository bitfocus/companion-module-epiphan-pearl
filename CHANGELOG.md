# Changelog

All notable changes to this project will be documented in this file.
Most recent releases are shown at the top.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

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
