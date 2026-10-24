# Changelog

## [1.8.0](https://github.com/itsnotapt/tim-data-investigate-platform/compare/frontend-v1.7.0...frontend-v1.8.0) (2026-10-24)


### Features

* **backend,tim-actions,frontend:** label ids from the grid, shared through the change feed ([#157](https://github.com/itsnotapt/tim-data-investigate-platform/issues/157)) ([44fab6c](https://github.com/itsnotapt/tim-data-investigate-platform/commit/44fab6c9a6ce0cec8b01c35f9f661e008658ddd2))
* **backend,tim-actions:** runs and rows on /api/runs ([#137](https://github.com/itsnotapt/tim-data-investigate-platform/issues/137)) ([c14c74b](https://github.com/itsnotapt/tim-data-investigate-platform/commit/c14c74bbec228226e206100cc9b2a33febe67762))
* **backend,tim-actions:** tim-actions providers and GET /api/instance ([#132](https://github.com/itsnotapt/tim-data-investigate-platform/issues/132)) ([732745f](https://github.com/itsnotapt/tim-data-investigate-platform/commit/732745f2bc5b169c9c300715fcb2f7c45d53f533))
* **frontend,backend,tim-actions,chart:** sinks, After tagging, run… and right-click sink items ([#166](https://github.com/itsnotapt/tim-data-investigate-platform/issues/166)) ([22e06c9](https://github.com/itsnotapt/tim-data-investigate-platform/commit/22e06c9ede570e67ccc91812f9f23ddead7d4f60))
* **frontend,backend,tim-actions:** development actions and e2e against a real tim-api ([#138](https://github.com/itsnotapt/tim-data-investigate-platform/issues/138)) ([5107562](https://github.com/itsnotapt/tim-data-investigate-platform/commit/5107562460fca407f4396649506964334e2934e8))
* **frontend,backend,tim-actions:** Kusto connections and Run KQL ([#145](https://github.com/itsnotapt/tim-data-investigate-platform/issues/145)) ([d13dd2c](https://github.com/itsnotapt/tim-data-investigate-platform/commit/d13dd2c25caadb18198895e676866f910394377e))
* **frontend,backend,tim-actions:** pivots from result rows ([#155](https://github.com/itsnotapt/tim-data-investigate-platform/issues/155)) ([cb232f1](https://github.com/itsnotapt/tim-data-investigate-platform/commit/cb232f1beff7ff18296f38d7993266ac803dc50c))
* **frontend,backend,tim-actions:** schema completion in the Run KQL editor ([#150](https://github.com/itsnotapt/tim-data-investigate-platform/issues/150)) ([44b6c95](https://github.com/itsnotapt/tim-data-investigate-platform/commit/44b6c95c7c2b1764434abcd94187a7e3f1c7184f))
* **frontend,backend:** action tab: open an action from the New menu, run it and see its results ([#140](https://github.com/itsnotapt/tim-data-investigate-platform/issues/140)) ([cc664fd](https://github.com/itsnotapt/tim-data-investigate-platform/commit/cc664fd7695f2d006911cae45e3c71b52ba782f2))
* **frontend,backend:** column views and the Views panel ([#169](https://github.com/itsnotapt/tim-data-investigate-platform/issues/169)) ([55e0956](https://github.com/itsnotapt/tim-data-investigate-platform/commit/55e09569ace0eb429684bc0e44b7c32e6e84781b))
* **frontend,backend:** presets and the New menu ([#160](https://github.com/itsnotapt/tim-data-investigate-platform/issues/160)) ([220f885](https://github.com/itsnotapt/tim-data-investigate-platform/commit/220f885b94115e65f54a7ece077841715a149859))
* **frontend,backend:** tags and comments, and the Annotate dialog ([#163](https://github.com/itsnotapt/tim-data-investigate-platform/issues/163)) ([fc039c7](https://github.com/itsnotapt/tim-data-investigate-platform/commit/fc039c7ae55ab598e97f6c35cfa96bfe71c0eba2))
* **frontend:** action tab: cancel a run, see its details in a Run tab, and keep the last results through failures ([#141](https://github.com/itsnotapt/tim-data-investigate-platform/issues/141)) ([ce706a6](https://github.com/itsnotapt/tim-data-investigate-platform/commit/ce706a6d50e6ab5c3961bbeebae7a2f45eb2ebf2))
* **frontend:** preset pivots on the right-click menu ([#164](https://github.com/itsnotapt/tim-data-investigate-platform/issues/164)) ([3c2e1a6](https://github.com/itsnotapt/tim-data-investigate-platform/commit/3c2e1a6aafd766cc3441075cab3b25e825b772b3))


### Bug Fixes

* **frontend:** update dompurify for GHSA-cg2g-xh64-v4q7 ([#161](https://github.com/itsnotapt/tim-data-investigate-platform/issues/161)) ([539bd35](https://github.com/itsnotapt/tim-data-investigate-platform/commit/539bd35bb6a3739cf3bff4900dc7200779caa1e9))

## [1.7.0](https://github.com/itsnotapt/tim-data-investigate-platform/compare/frontend-v1.6.0...frontend-v1.7.0) (2026-10-10)


### Features

* dark mode: Settings › Appearance offers Light, Dark and System (the default) ([78cdcd0](https://github.com/itsnotapt/tim-data-investigate-platform/commit/78cdcd0b7013a7186d758c4e8dea003e809dbef9))
* optional determination symbols beside the row checkbox: right-click a checkbox cell or the checkbox column header and choose Show determination symbols ([78cdcd0](https://github.com/itsnotapt/tim-data-investigate-platform/commit/78cdcd0b7013a7186d758c4e8dea003e809dbef9))
* tagged rows get new determination fills and a stripe, in light and dark ([78cdcd0](https://github.com/itsnotapt/tim-data-investigate-platform/commit/78cdcd0b7013a7186d758c4e8dea003e809dbef9))
* the code editors follow the light or dark scheme ([78cdcd0](https://github.com/itsnotapt/tim-data-investigate-platform/commit/78cdcd0b7013a7186d758c4e8dea003e809dbef9))


### Bug Fixes

* colour contrast of the snackbar Dismiss button, the tree badge and the grid status bar ([78cdcd0](https://github.com/itsnotapt/tim-data-investigate-platform/commit/78cdcd0b7013a7186d758c4e8dea003e809dbef9))

## [1.6.0](https://github.com/itsnotapt/tim-data-investigate-platform/compare/frontend-v1.5.6...frontend-v1.6.0) (2026-10-08)


### ⚠ BREAKING CHANGES

* TIM v4 — current-state docs, Helm chart, independent releases ([#16](https://github.com/itsnotapt/tim-data-investigate-platform/issues/16))

### Features

* TIM v4 — current-state docs, Helm chart, independent releases ([#16](https://github.com/itsnotapt/tim-data-investigate-platform/issues/16)) ([3d45bd5](https://github.com/itsnotapt/tim-data-investigate-platform/commit/3d45bd5d25a46243d4ca7896554488410a9ff1d2))

## [1.5.6](https://github.com/itsnotapt/tim-data-investigate-platform/compare/frontend-v1.5.5...frontend-v1.5.6) (2023-02-26)


### Bug Fixes

* nginx 426 error ([b2e6f12](https://github.com/itsnotapt/tim-data-investigate-platform/commit/b2e6f12429d27d656c5b46e272dada3d2d8b451b))

## [1.5.5](https://github.com/itsnotapt/tim-data-investigate-platform/compare/frontend-v1.5.4...frontend-v1.5.5) (2023-02-26)


### Bug Fixes

* support for ssl nginx ([16e760e](https://github.com/itsnotapt/tim-data-investigate-platform/commit/16e760e144bad257e7a5a9772d2ab7a9ad8e5464))

## [1.5.3](https://github.com/itsnotapt/tim-data-investigate-platform/compare/frontend-v1.5.2...frontend-v1.5.3) (2023-02-22)


### Bug Fixes

* remove host header from nginx ([6db99a5](https://github.com/itsnotapt/tim-data-investigate-platform/commit/6db99a53c918ff91666efec7054a83a2b7da71c7))

## [1.5.2](https://github.com/itsnotapt/tim-data-investigate-platform/compare/frontend-v1.5.1...frontend-v1.5.2) (2023-02-21)


### Bug Fixes

* config.js now blocking. ([fd4e914](https://github.com/itsnotapt/tim-data-investigate-platform/commit/fd4e9145f65930cced163f50af17c66dd5231121))

## [1.5.1](https://github.com/itsnotapt/tim-data-investigate-platform/compare/frontend-v1.5.0...frontend-v1.5.1) (2023-02-18)


### Bug Fixes

* config.js defer loading. ([53adc0c](https://github.com/itsnotapt/tim-data-investigate-platform/commit/53adc0cb322a11ebab9ed619c5ed17eac4bdc0bc))
* config.js defer loading. ([0b4718a](https://github.com/itsnotapt/tim-data-investigate-platform/commit/0b4718a660a62378c88337593e55325be08476a5))
* nginx refer to backend. ([53adc0c](https://github.com/itsnotapt/tim-data-investigate-platform/commit/53adc0cb322a11ebab9ed619c5ed17eac4bdc0bc))
* nginx refer to backend. ([0b4718a](https://github.com/itsnotapt/tim-data-investigate-platform/commit/0b4718a660a62378c88337593e55325be08476a5))

## [1.5.0](https://github.com/itsnotapt/tim-data-investigate-platform/compare/frontend-v1.4.0...frontend-v1.5.0) (2023-02-17)


### Features

* add syntax highlighting and autocomplete with Kusto Monaco. ([#8](https://github.com/itsnotapt/tim-data-investigate-platform/issues/8)) ([1326939](https://github.com/itsnotapt/tim-data-investigate-platform/commit/1326939629a66aeff37a60a5d748686d79ecd94d))
* reintroduce AAD authentication and OBO. ([887490c](https://github.com/itsnotapt/tim-data-investigate-platform/commit/887490cd973569df313ec5984696be1384f89016))
* support for schema autocomplete for queries. ([#18](https://github.com/itsnotapt/tim-data-investigate-platform/issues/18)) ([b5a9121](https://github.com/itsnotapt/tim-data-investigate-platform/commit/b5a9121f98bb33112726cb93d7d8f848ec02fb9c))


### Bug Fixes

* add runtime config to frontend. ([#10](https://github.com/itsnotapt/tim-data-investigate-platform/issues/10)) ([a0a7070](https://github.com/itsnotapt/tim-data-investigate-platform/commit/a0a707023445c8a826aaa5453fbfb43b8f2a1122))
* add time to live to couchbase upsert. ([887490c](https://github.com/itsnotapt/tim-data-investigate-platform/commit/887490cd973569df313ec5984696be1384f89016))
* always prompt to select account on logon. ([887490c](https://github.com/itsnotapt/tim-data-investigate-platform/commit/887490cd973569df313ec5984696be1384f89016))
* env inject config.js and nginx ([#27](https://github.com/itsnotapt/tim-data-investigate-platform/issues/27)) ([9fa9eb9](https://github.com/itsnotapt/tim-data-investigate-platform/commit/9fa9eb9115d15f3f0b8f6a0ce6b50517330d4e36))
* execution status panel wrong props. ([887490c](https://github.com/itsnotapt/tim-data-investigate-platform/commit/887490cd973569df313ec5984696be1384f89016))
* fake fix to initiate rebuild. ([02637f0](https://github.com/itsnotapt/tim-data-investigate-platform/commit/02637f0cd3d4361d4a6b8e75f6b36870c89598b4))
* load monaco kusto once. ([b5a9121](https://github.com/itsnotapt/tim-data-investigate-platform/commit/b5a9121f98bb33112726cb93d7d8f848ec02fb9c))
* match backend API changes. ([#14](https://github.com/itsnotapt/tim-data-investigate-platform/issues/14)) ([e1c68a4](https://github.com/itsnotapt/tim-data-investigate-platform/commit/e1c68a4a0e3e0c221d601325e185bf0895131fc1))
* move cluster groups into runtime config. ([e1c68a4](https://github.com/itsnotapt/tim-data-investigate-platform/commit/e1c68a4a0e3e0c221d601325e185bf0895131fc1))
* split kusto monaco and others. ([b5a9121](https://github.com/itsnotapt/tim-data-investigate-platform/commit/b5a9121f98bb33112726cb93d7d8f848ec02fb9c))
* support for building aggrid enterprise. ([887490c](https://github.com/itsnotapt/tim-data-investigate-platform/commit/887490cd973569df313ec5984696be1384f89016))
* wrong format for kusto cluster group. ([887490c](https://github.com/itsnotapt/tim-data-investigate-platform/commit/887490cd973569df313ec5984696be1384f89016))

## [1.4.0](https://github.com/microsoft/tim-data-investigate-platform/compare/frontend-v1.3.2...frontend-v1.4.0) (2023-02-15)


### Features

* support for schema autocomplete for queries. ([#18](https://github.com/microsoft/tim-data-investigate-platform/issues/18)) ([b5a9121](https://github.com/microsoft/tim-data-investigate-platform/commit/b5a9121f98bb33112726cb93d7d8f848ec02fb9c))


### Bug Fixes

* load monaco kusto once. ([b5a9121](https://github.com/microsoft/tim-data-investigate-platform/commit/b5a9121f98bb33112726cb93d7d8f848ec02fb9c))
* split kusto monaco and others. ([b5a9121](https://github.com/microsoft/tim-data-investigate-platform/commit/b5a9121f98bb33112726cb93d7d8f848ec02fb9c))

## [1.3.2](https://github.com/microsoft/tim-data-investigate-platform/compare/frontend-v1.3.1...frontend-v1.3.2) (2023-02-14)


### Bug Fixes

* match backend API changes. ([#14](https://github.com/microsoft/tim-data-investigate-platform/issues/14)) ([e1c68a4](https://github.com/microsoft/tim-data-investigate-platform/commit/e1c68a4a0e3e0c221d601325e185bf0895131fc1))
* move cluster groups into runtime config. ([e1c68a4](https://github.com/microsoft/tim-data-investigate-platform/commit/e1c68a4a0e3e0c221d601325e185bf0895131fc1))

## [1.3.1](https://github.com/microsoft/tim-data-investigate-platform/compare/frontend-v1.3.0...frontend-v1.3.1) (2023-02-13)


### Bug Fixes

* fake fix to initiate rebuild. ([02637f0](https://github.com/microsoft/tim-data-investigate-platform/commit/02637f0cd3d4361d4a6b8e75f6b36870c89598b4))

## [1.3.0](https://github.com/microsoft/tim-data-investigate-platform/compare/frontend-v1.2.0...frontend-v1.3.0) (2023-02-13)


### Features

* add syntax highlighting and autocomplete with Kusto Monaco. ([#8](https://github.com/microsoft/tim-data-investigate-platform/issues/8)) ([1326939](https://github.com/microsoft/tim-data-investigate-platform/commit/1326939629a66aeff37a60a5d748686d79ecd94d))


### Bug Fixes

* add runtime config to frontend. ([#10](https://github.com/microsoft/tim-data-investigate-platform/issues/10)) ([a0a7070](https://github.com/microsoft/tim-data-investigate-platform/commit/a0a707023445c8a826aaa5453fbfb43b8f2a1122))

## [1.2.0](https://github.com/microsoft/tim-data-investigate-platform/compare/frontend-v1.1.0...frontend-v1.2.0) (2023-02-10)


### Bug Fixes

* always prompt to select account on logon. ([887490c](https://github.com/microsoft/tim-data-investigate-platform/commit/887490cd973569df313ec5984696be1384f89016))
* execution status panel wrong props. ([887490c](https://github.com/microsoft/tim-data-investigate-platform/commit/887490cd973569df313ec5984696be1384f89016))
* support for building aggrid enterprise. ([887490c](https://github.com/microsoft/tim-data-investigate-platform/commit/887490cd973569df313ec5984696be1384f89016))
