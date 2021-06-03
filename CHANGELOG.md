# Changelog
All notable changes to this project will be documented in this file.
Most recent releases are shown at the top.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

---
## [Unreleased]

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
