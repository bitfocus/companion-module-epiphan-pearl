# companion-module-epiphan-pearl

[Bitfocus Companion](https://github.com/bitfocus/companion) connection module for
[Epiphan Pearl](https://www.epiphan.com/products/pearl/) encoders (Pearl-2, Pearl Mini, Pearl Nano, Pearl Nexus).

It talks to the Pearl REST API v2.0 (firmware 4.24.1 and newer) and falls back to the legacy `/api` on older firmware.
From Companion you can switch layouts, start/stop streams and recorders, rename and reconfigure publishers, mute and
route inputs and outputs, trigger single touch, eject storage, apply configuration presets, control CMS events, and
show live preview thumbnails and device state (storage, CPU, AFU, schedule) on your buttons.

The module targets `@companion-module/base` 1.12 (Companion 3.x and newer) and runs on the `node22` runtime.

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

- [doc/pearl-api-v2.0.yaml](doc/pearl-api-v2.0.yaml) is the OpenAPI 3.0 description of the Pearl REST API v2.0. Look up
  paths, query parameter names, request bodies and response shapes there; do not guess them.
- [doc/ARCHITECTURE.md](doc/ARCHITECTURE.md) is the implementation contract: file layout under `src/`, state shape,
  config fields, request layer, poller behaviour, choice builders and the ids of every action, feedback, variable and
  preset. Keep it up to date when behaviour changes.

Code style is CommonJS, ES2022, tabs, single quotes, no semicolons (prettier config from `@companion-module/tools`).
Existing action, feedback and option ids must not change so that users' buttons keep working; use `src/upgrades.js`
for migrations.

## Changelog

See [CHANGELOG.md](CHANGELOG.md).

## License

The MIT License (MIT). See [LICENSE](LICENSE).
