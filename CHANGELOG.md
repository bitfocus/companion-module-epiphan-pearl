# Changelog
All notable changes to this project will be documented in this file.
Most recent releases are shown at the top.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

---
## [Unreleased]

### Added
- Updated HTTP requests to use API version v2.0.
- Added option for verbose logging to aid in debugging.
- Optional controls for channel metadata and file name prefix.
- Added actions and feedbacks for Ad-Hoc events.
- Added actions to control Auto File Upload and trigger manual transfers.
- Added variables for the active layout of each channel.
### Fixed
- Updated identity, product name and event endpoints to match API changes.

---
## [2.1.0] (2023-05-26)

## New Features
* Added action to insert chapter markers in recordings
* Added action to get layout data and store it in a variable
* Added action to set layout data to device
* Added options to toggle streaming and recording based on current state
* Added preset for recorder reset action
* Don't show "All streams" any more if there are no individual streams in a channel
* completely redone internal handling of polling and updating the connection data, improved error handling

## [2.0.0] (2023-05-24)

## Major
* Rewrite of the module code for compatibility with Companion v3. The code is not backwards compatible, but configuration data is.

## New Features
* Upgraded Feedbacks to boolean type
* Added Reset option to recorder control
* Added option to change the feedback polling interval

## Dependencies
* Changed REST connection from request module to node's internal fetch
* Bump sentry 7.52 to 7.53
* Bump @types/eslint 8.37 to 8.40
* Bump electron-to-chromium 1.4.103 to 1.4.105
* Bump node-releases 2.0.11 to 2.0.12
* Bump terser 5.17.5. to 5.17.6
* Bump yaml 2.2.2 to 2.3.0

## Bugfixes
* Corrected some typos
  
---
## [1.0.9] (2022-09-26)

## Dependencies
* [#14](https://github.com/bitfocus/companion-module-epiphan-pearl/pull/14) - Bump ajv from 6.10.0 to 6.12.6

---
## [1.0.8] (2022-02-05)

## Cleanup
* Update package information to the future

---
## [1.0.7] (2021-06-03)

## Bug Fixes
* [#10](https://github.com/bitfocus/companion-module-epiphan-pearl/issues/10) - A sanity check is done if the action variable exists, which if the variable was 0 returned a fault.

---
## [1.0.6] (2021-02-15)

## New Features
* Ability to change the host port.

---
## [1.0.5] (2021-02-12)

## Bug Fixes
* [#5](https://github.com/bitfocus/companion-module-epiphan-pearl/issues/5) - Dropdown list not updating with correct ids  
This now results in an extra entry '---' to force the user to select a Channel or Recorder and assosiated action

---
## [1.0.4] (2021-01-30)

## Bug Fixes
* [#5](https://github.com/bitfocus/companion-module-epiphan-pearl/issues/5) - Fixed issue with recording not working.

---
## [1.0.3] (2020-06-16)

## Bug Fixes
* [#2](https://github.com/bitfocus/companion-module-epiphan-pearl/issues/2) - Fixed error on non existing action.

---

## [1.0.2] (2020-04-15)

## Bug Fixes
* Stop polling for information if instance gets disabled.

---

## [1.0.1] (2019-08-28)
## New Features
### Dynamic generated preset
With this new feature we have added presets to the module.
These presets are, for now, dynamically updated for every channel, 
publisher and recoreder that is configured on the Pearl.

## Bug Fixes
* [#1](https://github.com/bitfocus/companion-module-epiphan-pearl/issues/1) - Error on feedback channel layout

---

## [1.0.0] (2019-08-18)
## New Features
Actions:
* Change channel layout
* Start/Stop streaming (per stream or all)
* Start/Stop recording

Feedback:
* Active channel layout
* Recording
* Streaming
