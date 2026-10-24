# Changelog

## [4.1.0](https://github.com/itsnotapt/tim-data-investigate-platform/compare/backend-v4.0.0...backend-v4.1.0) (2026-10-24)


### Features

* **backend,tim-actions,frontend:** label ids from the grid, shared through the change feed ([#157](https://github.com/itsnotapt/tim-data-investigate-platform/issues/157)) ([44fab6c](https://github.com/itsnotapt/tim-data-investigate-platform/commit/44fab6c9a6ce0cec8b01c35f9f661e008658ddd2))
* **backend,tim-actions:** action files, tim-api schema actions and tim-api check ([#135](https://github.com/itsnotapt/tim-data-investigate-platform/issues/135)) ([fc3dedc](https://github.com/itsnotapt/tim-data-investigate-platform/commit/fc3dedccb4b24445a09616627894ac817550c110))
* **backend,tim-actions:** runs and rows on /api/runs ([#137](https://github.com/itsnotapt/tim-data-investigate-platform/issues/137)) ([c14c74b](https://github.com/itsnotapt/tim-data-investigate-platform/commit/c14c74bbec228226e206100cc9b2a33febe67762))
* **backend,tim-actions:** tim-actions providers and GET /api/instance ([#132](https://github.com/itsnotapt/tim-data-investigate-platform/issues/132)) ([732745f](https://github.com/itsnotapt/tim-data-investigate-platform/commit/732745f2bc5b169c9c300715fcb2f7c45d53f533))
* **backend:** derived images and the Compose /etc/tim mount ([#162](https://github.com/itsnotapt/tim-data-investigate-platform/issues/162)) ([dbf49f1](https://github.com/itsnotapt/tim-data-investigate-platform/commit/dbf49f1a2084cbc6f0484a551f448efa74efc289))
* **frontend,backend,tim-actions,chart:** sinks, After tagging, run… and right-click sink items ([#166](https://github.com/itsnotapt/tim-data-investigate-platform/issues/166)) ([22e06c9](https://github.com/itsnotapt/tim-data-investigate-platform/commit/22e06c9ede570e67ccc91812f9f23ddead7d4f60))
* **frontend,backend,tim-actions:** development actions and e2e against a real tim-api ([#138](https://github.com/itsnotapt/tim-data-investigate-platform/issues/138)) ([5107562](https://github.com/itsnotapt/tim-data-investigate-platform/commit/5107562460fca407f4396649506964334e2934e8))
* **frontend,backend,tim-actions:** Kusto connections and Run KQL ([#145](https://github.com/itsnotapt/tim-data-investigate-platform/issues/145)) ([d13dd2c](https://github.com/itsnotapt/tim-data-investigate-platform/commit/d13dd2c25caadb18198895e676866f910394377e))
* **frontend,backend,tim-actions:** pivots from result rows ([#155](https://github.com/itsnotapt/tim-data-investigate-platform/issues/155)) ([cb232f1](https://github.com/itsnotapt/tim-data-investigate-platform/commit/cb232f1beff7ff18296f38d7993266ac803dc50c))
* **frontend,backend,tim-actions:** schema completion in the Run KQL editor ([#150](https://github.com/itsnotapt/tim-data-investigate-platform/issues/150)) ([44b6c95](https://github.com/itsnotapt/tim-data-investigate-platform/commit/44b6c95c7c2b1764434abcd94187a7e3f1c7184f))
* **frontend,backend:** action tab: open an action from the New menu, run it and see its results ([#140](https://github.com/itsnotapt/tim-data-investigate-platform/issues/140)) ([cc664fd](https://github.com/itsnotapt/tim-data-investigate-platform/commit/cc664fd7695f2d006911cae45e3c71b52ba782f2))
* **frontend,backend:** column views and the Views panel ([#169](https://github.com/itsnotapt/tim-data-investigate-platform/issues/169)) ([55e0956](https://github.com/itsnotapt/tim-data-investigate-platform/commit/55e09569ace0eb429684bc0e44b7c32e6e84781b))
* **frontend,backend:** presets and the New menu ([#160](https://github.com/itsnotapt/tim-data-investigate-platform/issues/160)) ([220f885](https://github.com/itsnotapt/tim-data-investigate-platform/commit/220f885b94115e65f54a7ece077841715a149859))
* **frontend,backend:** tags and comments, and the Annotate dialog ([#163](https://github.com/itsnotapt/tim-data-investigate-platform/issues/163)) ([fc039c7](https://github.com/itsnotapt/tim-data-investigate-platform/commit/fc039c7ae55ab598e97f6c35cfa96bfe71c0eba2))


### Documentation

* docs as short sentences and bullets, and a doc style rule ([#147](https://github.com/itsnotapt/tim-data-investigate-platform/issues/147)) ([2985150](https://github.com/itsnotapt/tim-data-investigate-platform/commit/2985150bcffabce5dded96a9d229d10a4f430cac))
* run the live Kusto tests locally ([#167](https://github.com/itsnotapt/tim-data-investigate-platform/issues/167)) ([b711c86](https://github.com/itsnotapt/tim-data-investigate-platform/commit/b711c8603935ed62e9024fc0ed94f6fc081cfb11))

## [4.0.0](https://github.com/itsnotapt/tim-data-investigate-platform/compare/backend-v3.0.4...backend-v4.0.0) (2026-10-08)


### ⚠ BREAKING CHANGES

* TIM v4 — current-state docs, Helm chart, independent releases ([#16](https://github.com/itsnotapt/tim-data-investigate-platform/issues/16))

### Features

* TIM v4 — current-state docs, Helm chart, independent releases ([#16](https://github.com/itsnotapt/tim-data-investigate-platform/issues/16)) ([3d45bd5](https://github.com/itsnotapt/tim-data-investigate-platform/commit/3d45bd5d25a46243d4ca7896554488410a9ff1d2))

## [3.0.4](https://github.com/itsnotapt/tim-data-investigate-platform/compare/backend-v3.0.3...backend-v3.0.4) (2023-03-04)


### Bug Fixes

* starttime and endtime for kusto queries ([c9ce5f3](https://github.com/itsnotapt/tim-data-investigate-platform/commit/c9ce5f3d3889c185553effccf7b7314c91ea1190))

## [3.0.2](https://github.com/itsnotapt/tim-data-investigate-platform/compare/backend-v3.0.1...backend-v3.0.2) (2023-02-26)


### Bug Fixes

* capture exception for kusto and throw database error. ([02ad822](https://github.com/itsnotapt/tim-data-investigate-platform/commit/02ad822a14e1a6cd75b87065061302672da46004))

## [3.0.1](https://github.com/itsnotapt/tim-data-investigate-platform/compare/backend-v3.0.0...backend-v3.0.1) (2023-02-21)


### Bug Fixes

* slight adjustment to env variables. ([3de24ac](https://github.com/itsnotapt/tim-data-investigate-platform/commit/3de24ac2b9477443a23e651f63946ead2743650d))

## [3.0.0](https://github.com/itsnotapt/tim-data-investigate-platform/compare/backend-v2.1.1...backend-v3.0.0) (2023-02-17)


### ⚠ BREAKING CHANGES

* add get kusto schema.

### Features

* add get kusto schema. ([8ba47f7](https://github.com/itsnotapt/tim-data-investigate-platform/commit/8ba47f7880cb624457f6170e636958df0c4dc12e))
* add support for mongodb and redis ([#22](https://github.com/itsnotapt/tim-data-investigate-platform/issues/22)) ([95bcf2e](https://github.com/itsnotapt/tim-data-investigate-platform/commit/95bcf2e02758c24c8470ab89e0e82dfaeb68ad60))
* reintroduce AAD authentication and OBO. ([887490c](https://github.com/itsnotapt/tim-data-investigate-platform/commit/887490cd973569df313ec5984696be1384f89016))


### Bug Fixes

* add time to live to couchbase upsert. ([887490c](https://github.com/itsnotapt/tim-data-investigate-platform/commit/887490cd973569df313ec5984696be1384f89016))
* always prompt to select account on logon. ([887490c](https://github.com/itsnotapt/tim-data-investigate-platform/commit/887490cd973569df313ec5984696be1384f89016))
* continue even if Kusto create tables failed. ([1ac713f](https://github.com/itsnotapt/tim-data-investigate-platform/commit/1ac713ff11272406073245271d82f0d520c26b1a))
* enum conversion on query run status. ([adbc273](https://github.com/itsnotapt/tim-data-investigate-platform/commit/adbc273806b9ea115ccdf4e125cee79a4c271f74))
* execution status panel wrong props. ([887490c](https://github.com/itsnotapt/tim-data-investigate-platform/commit/887490cd973569df313ec5984696be1384f89016))
* fake fix to initiate rebuild. ([02637f0](https://github.com/itsnotapt/tim-data-investigate-platform/commit/02637f0cd3d4361d4a6b8e75f6b36870c89598b4))
* increase timeout for initializing couchbase db. ([#15](https://github.com/itsnotapt/tim-data-investigate-platform/issues/15)) ([adbc273](https://github.com/itsnotapt/tim-data-investigate-platform/commit/adbc273806b9ea115ccdf4e125cee79a4c271f74))
* only load the selected database. ([95bcf2e](https://github.com/itsnotapt/tim-data-investigate-platform/commit/95bcf2e02758c24c8470ab89e0e82dfaeb68ad60))
* prevent camelcase default for couchbase. ([95bcf2e](https://github.com/itsnotapt/tim-data-investigate-platform/commit/95bcf2e02758c24c8470ab89e0e82dfaeb68ad60))
* proper model validation instead of 500 exceptions. ([adbc273](https://github.com/itsnotapt/tim-data-investigate-platform/commit/adbc273806b9ea115ccdf4e125cee79a4c271f74))
* return correct status for execute query and get results. ([adbc273](https://github.com/itsnotapt/tim-data-investigate-platform/commit/adbc273806b9ea115ccdf4e125cee79a4c271f74))
* support for building aggrid enterprise. ([887490c](https://github.com/itsnotapt/tim-data-investigate-platform/commit/887490cd973569df313ec5984696be1384f89016))
* support for cosmodb ([#24](https://github.com/itsnotapt/tim-data-investigate-platform/issues/24)) ([c58caf6](https://github.com/itsnotapt/tim-data-investigate-platform/commit/c58caf6713d3b61f329efc3cf297ca51bced3c88))
* use default auth for azure to support managed identities. ([#20](https://github.com/itsnotapt/tim-data-investigate-platform/issues/20)) ([1ac713f](https://github.com/itsnotapt/tim-data-investigate-platform/commit/1ac713ff11272406073245271d82f0d520c26b1a))
* validation of cluster uri with https. ([#17](https://github.com/itsnotapt/tim-data-investigate-platform/issues/17)) ([8ba47f7](https://github.com/itsnotapt/tim-data-investigate-platform/commit/8ba47f7880cb624457f6170e636958df0c4dc12e))
* wrong format for kusto cluster group. ([887490c](https://github.com/itsnotapt/tim-data-investigate-platform/commit/887490cd973569df313ec5984696be1384f89016))

## [2.1.1](https://github.com/microsoft/tim-data-investigate-platform/compare/backend-v2.1.0...backend-v2.1.1) (2023-02-17)


### Bug Fixes

* support for cosmodb ([#24](https://github.com/microsoft/tim-data-investigate-platform/issues/24)) ([c58caf6](https://github.com/microsoft/tim-data-investigate-platform/commit/c58caf6713d3b61f329efc3cf297ca51bced3c88))

## [2.1.0](https://github.com/microsoft/tim-data-investigate-platform/compare/backend-v2.0.1...backend-v2.1.0) (2023-02-17)


### Features

* add support for mongodb and redis ([#22](https://github.com/microsoft/tim-data-investigate-platform/issues/22)) ([95bcf2e](https://github.com/microsoft/tim-data-investigate-platform/commit/95bcf2e02758c24c8470ab89e0e82dfaeb68ad60))


### Bug Fixes

* only load the selected database. ([95bcf2e](https://github.com/microsoft/tim-data-investigate-platform/commit/95bcf2e02758c24c8470ab89e0e82dfaeb68ad60))
* prevent camelcase default for couchbase. ([95bcf2e](https://github.com/microsoft/tim-data-investigate-platform/commit/95bcf2e02758c24c8470ab89e0e82dfaeb68ad60))

## [2.0.1](https://github.com/microsoft/tim-data-investigate-platform/compare/backend-v2.0.0...backend-v2.0.1) (2023-02-16)


### Bug Fixes

* continue even if Kusto create tables failed. ([1ac713f](https://github.com/microsoft/tim-data-investigate-platform/commit/1ac713ff11272406073245271d82f0d520c26b1a))
* use default auth for azure to support managed identities. ([#20](https://github.com/microsoft/tim-data-investigate-platform/issues/20)) ([1ac713f](https://github.com/microsoft/tim-data-investigate-platform/commit/1ac713ff11272406073245271d82f0d520c26b1a))

## [2.0.0](https://github.com/microsoft/tim-data-investigate-platform/compare/backend-v1.1.2...backend-v2.0.0) (2023-02-15)


### ⚠ BREAKING CHANGES

* modified the API for kusto queries.

### Features

* add get kusto schema. ([8ba47f7](https://github.com/microsoft/tim-data-investigate-platform/commit/8ba47f7880cb624457f6170e636958df0c4dc12e))


### Bug Fixes

* validation of cluster uri with https. ([#17](https://github.com/microsoft/tim-data-investigate-platform/issues/17)) ([8ba47f7](https://github.com/microsoft/tim-data-investigate-platform/commit/8ba47f7880cb624457f6170e636958df0c4dc12e))

## [1.1.2](https://github.com/microsoft/tim-data-investigate-platform/compare/backend-v1.1.1...backend-v1.1.2) (2023-02-14)


### Bug Fixes

* enum conversion on query run status. ([adbc273](https://github.com/microsoft/tim-data-investigate-platform/commit/adbc273806b9ea115ccdf4e125cee79a4c271f74))
* increase timeout for initializing couchbase db. ([#15](https://github.com/microsoft/tim-data-investigate-platform/issues/15)) ([adbc273](https://github.com/microsoft/tim-data-investigate-platform/commit/adbc273806b9ea115ccdf4e125cee79a4c271f74))
* proper model validation instead of 500 exceptions. ([adbc273](https://github.com/microsoft/tim-data-investigate-platform/commit/adbc273806b9ea115ccdf4e125cee79a4c271f74))
* return correct status for execute query and get results. ([adbc273](https://github.com/microsoft/tim-data-investigate-platform/commit/adbc273806b9ea115ccdf4e125cee79a4c271f74))

## [1.1.1](https://github.com/microsoft/tim-data-investigate-platform/compare/backend-v1.1.0...backend-v1.1.1) (2023-02-13)


### Bug Fixes

* fake fix to initiate rebuild. ([02637f0](https://github.com/microsoft/tim-data-investigate-platform/commit/02637f0cd3d4361d4a6b8e75f6b36870c89598b4))

## [1.1.0](https://github.com/microsoft/tim-data-investigate-platform/compare/backend-v1.0.5...backend-v1.1.0) (2023-02-10)


### Features

* reintroduce AAD authentication and OBO. ([887490c](https://github.com/microsoft/tim-data-investigate-platform/commit/887490cd973569df313ec5984696be1384f89016))


### Bug Fixes

* add time to live to couchbase upsert. ([887490c](https://github.com/microsoft/tim-data-investigate-platform/commit/887490cd973569df313ec5984696be1384f89016))
