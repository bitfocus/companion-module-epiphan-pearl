# companion-module-epiphan-pearl

[Bitfocus Companion](https://github.com/bitfocus/companion) connection module for
[Epiphan](https://www.epiphan.com/products/pearl/) encoders (Pearl-2, Pearl Mini, Pearl Nano, Pearl Nexus and newer models).

It talks to the encoders' REST API v2.0 (firmware 4.24.1 and newer) and falls back to the legacy `/api` on older firmware.
The control set matches the sibling Epiphan Encoders Stream Deck plugin one for one: Recorder, Stream, Layout, Single
Touch, Bookmark, Preview, Output Source, Apply Preset, Event, System Status, Reboot / Shutdown, Audio and Storage.
From Companion you can switch layouts, start/stop/pause streams and recorders, route outputs, nudge an audio input's
gain and delay, trigger single touch, insert recording bookmarks, apply configuration presets, control
CMS scheduled events, and show live preview thumbnails and device state (storage, CPU, AFU, schedule) on your
buttons — all with matching ready-made presets and icons.

The module targets `@companion-module/base` 2.2, which needs **Companion 5.1 or newer**, and runs on the `node26` runtime (develop with Node 26.5 or newer).

## Usage

Everything a user needs (requirements, connection settings, all actions, feedbacks, variables and presets with JSON
examples, tips and known limitations) is in [companion/HELP.md](companion/HELP.md). Companion shows the same document
under the connection's help button.

## Development

```sh
yarn install                # install dependencies
yarn lint                   # eslint (flat config, eslint.config.mjs)
yarn format                 # prettier -w .
yarn test                   # node --test "test/**/*.test.js"  (runs against the in-memory Pearl mock, no device needed)
yarn companion-module-build # build the module package for Companion
```

References while working on the code:

- The Pearl REST API v2.0 description and the module's design notes, which code comments cite as
  `doc/pearl-api-v2.0.yaml`, `doc/ARCHITECTURE.md` and `doc/PARITY.md`, are maintained by Epiphan outside this
  repository.
- `src/` holds the module code: `instance` (wiring), `api` (request layer), `poller`, `choices`, `actions`, `feedbacks`,
  `variables`, `presets`, `config`, `upgrades`, `utils`, plus the shared pieces the control set is built from — `style`
  (palette, state words, standard texts), `icons` (one PNG per preset category), `confirm` (the two-press gate),
  `rotary` (tick coalescing), `audio` (gain/delay read-modify-write helpers) and `meter` (the audio level meter's
  drawing helpers and its 500 ms level poll). `src/main.js` is only the entrypoint.
- `test/` holds the `node:test` suites plus `test/harness.js` (stub of `@companion-module/base`) and `test/mock-pearl.js`
  (in-memory Pearl serving the v2.0 and legacy endpoints the module uses).

Code style is CommonJS, ES2022, tabs, single quotes, no semicolons (prettier config from `@companion-module/tools`).
Existing action, feedback and option ids must not change so that users' buttons keep working; use `src/upgrades.js`
for migrations.

## Changelog

See [CHANGELOG.md](CHANGELOG.md).

## License

The MIT License (MIT). See [LICENSE](LICENSE).
