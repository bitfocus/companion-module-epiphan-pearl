# Changelog

All notable changes to this project will be documented in this file.
Most recent releases are shown at the top.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

---

## [3.2.0] (2026-10-07)

### Important

- Requires Companion 5.0 or newer
- The option "Use API v2.0" was removed. The module now automatically uses the best connection method for the firmware of your Pearl.
- "Get layout data" no longer asks for a custom variable. Choose where to store the result directly in Companion, like for other actions that return a value. Existing buttons are converted automatically.

### New Features

- If your Pearl runs a firmware older than 4.24.1, the connection shows a warning recommending a firmware update
- If the Pearl is not reachable, the module tries to reconnect every 10 seconds
- Pearls in the same network are found automatically and can be selected by their device name in the connection settings. For a Pearl in another network, the address is entered manually as before.
- The Pearl can be entered by hostname as well as by IP address, e.g. `<serial number>.local`
- A wrong username or password is shown as such in the connection status
- New variables (firmware 4.24.1 or newer):
  - Storage of the internal drive and USB drives: state, total, used and free space in GB and %, and the estimated remaining recording time based on the running recordings
  - Input signal (OK / No signal) and current total bitrate of each channel
  - Recording duration, stream duration and system uptime as hh:mm:ss
  - Stream reconnections and error description
  - Warnings for high CPU load and CPU temperature, using the thresholds of the Pearl

### Bug Fixes

- The settings page did not open when adding a new Pearl connection
- Changed settings (e.g. IP address or password) now take effect immediately, without restarting the connection
- With firmware 4.24.1 or newer, layouts were missing, and changing layouts, inserting markers, resetting recorders and getting or setting layout data did not work
- Streaming feedbacks from very old configurations lost their colors after updating
- Buttons and feedbacks could stop updating when the Pearl was not reachable or did not support a feature
- Presets now have proper names, and recorders with the same name each get their own presets
- Recorders without a name no longer show up as "undefined"
- The feedbacks for streaming and recording changed only with the next status query, up to the polling frequency after pressing the button. They now follow within about one to two seconds, and the variable of the active layout changes right away too.
- The bitrate variable showed 0 instead of the current bitrate when the bitrate is set to automatic
- The variables for resolution and bitrate stayed empty with firmware older than 4.24.1
- "Set Content Metadata" updated the metadata variables even if the Pearl rejected the new values
- The connection was shown as failed when the Pearl only rejected a single command, e.g. a marker
- Clearer error messages, e.g. when a marker can't be set because the channel is not recording
- Improved stability and error handling

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
