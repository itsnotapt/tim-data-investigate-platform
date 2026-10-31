# Changelog

## 0.1.0 (2026-10-31)


### ⚠ BREAKING CHANGES

* **api,web,tim-actions:** rows take their id from an Id column the analyst switches in the browser ([#215](https://github.com/itsnotapt/tim-data-investigate-platform/issues/215))
* **api,web,chart,tim-actions:** one release version for TIM, with images named api and web ([#206](https://github.com/itsnotapt/tim-data-investigate-platform/issues/206))

### Features

* **api,web,chart,tim-actions:** one release version for TIM, with images named api and web ([#206](https://github.com/itsnotapt/tim-data-investigate-platform/issues/206)) ([ffba9a0](https://github.com/itsnotapt/tim-data-investigate-platform/commit/ffba9a02d759afc6172353f5a04af6feaf994237))
* **api,web,tim-actions:** a KQL query shows its declare statement above it, and the editor suggests its query parameters ([#213](https://github.com/itsnotapt/tim-data-investigate-platform/issues/213)) ([ed1f36b](https://github.com/itsnotapt/tim-data-investigate-platform/commit/ed1f36bb474d1962023475b8d4dea588f58e6be6))
* **api,web,tim-actions:** rows take their id from an Id column the analyst switches in the browser ([#215](https://github.com/itsnotapt/tim-data-investigate-platform/issues/215)) ([995d50d](https://github.com/itsnotapt/tim-data-investigate-platform/commit/995d50d9b159dd2176366661d05e8ba8f7d3b275))
* **backend,tim-actions,frontend:** label ids from the grid, shared through the change feed ([#157](https://github.com/itsnotapt/tim-data-investigate-platform/issues/157)) ([44fab6c](https://github.com/itsnotapt/tim-data-investigate-platform/commit/44fab6c9a6ce0cec8b01c35f9f661e008658ddd2))
* **backend,tim-actions,frontend:** preset query parameters and Copy as action file ([#168](https://github.com/itsnotapt/tim-data-investigate-platform/issues/168)) ([fd2df76](https://github.com/itsnotapt/tim-data-investigate-platform/commit/fd2df766750ce05fae793aaab58eb435a79c3a65))
* **backend,tim-actions,frontend:** Snowflake connections and Run SQL ([#185](https://github.com/itsnotapt/tim-data-investigate-platform/issues/185)) ([f9a40bc](https://github.com/itsnotapt/tim-data-investigate-platform/commit/f9a40bcd38f886578ad2a7c9580b00b42c4b8bbb))
* **backend,tim-actions:** action files, tim-api schema actions and tim-api check ([#135](https://github.com/itsnotapt/tim-data-investigate-platform/issues/135)) ([fc3dedc](https://github.com/itsnotapt/tim-data-investigate-platform/commit/fc3dedccb4b24445a09616627894ac817550c110))
* **backend,tim-actions:** kql_query action files with bound Kusto query parameters ([#154](https://github.com/itsnotapt/tim-data-investigate-platform/issues/154)) ([c42d20d](https://github.com/itsnotapt/tim-data-investigate-platform/commit/c42d20dfbc0be3fe86241f96e879d8a319dba2aa))
* **backend,tim-actions:** runs and rows on /api/runs ([#137](https://github.com/itsnotapt/tim-data-investigate-platform/issues/137)) ([c14c74b](https://github.com/itsnotapt/tim-data-investigate-platform/commit/c14c74bbec228226e206100cc9b2a33febe67762))
* **backend,tim-actions:** tim_actions.testing and its pytest plugin for provider authors ([#173](https://github.com/itsnotapt/tim-data-investigate-platform/issues/173)) ([f602ae0](https://github.com/itsnotapt/tim-data-investigate-platform/commit/f602ae06bc09ee75613c66373cd95314a52ac3a0))
* **backend,tim-actions:** tim-actions providers and GET /api/instance ([#132](https://github.com/itsnotapt/tim-data-investigate-platform/issues/132)) ([732745f](https://github.com/itsnotapt/tim-data-investigate-platform/commit/732745f2bc5b169c9c300715fcb2f7c45d53f533))
* **frontend,backend,tim-actions,chart:** sinks, After tagging, run… and right-click sink items ([#166](https://github.com/itsnotapt/tim-data-investigate-platform/issues/166)) ([22e06c9](https://github.com/itsnotapt/tim-data-investigate-platform/commit/22e06c9ede570e67ccc91812f9f23ddead7d4f60))
* **frontend,backend,tim-actions:** Action file panel and Copy column settings ([#176](https://github.com/itsnotapt/tim-data-investigate-platform/issues/176)) ([aa29ee5](https://github.com/itsnotapt/tim-data-investigate-platform/commit/aa29ee598cbc57932c69d75fd3def1d4468b61cb))
* **frontend,backend,tim-actions:** development actions and e2e against a real tim-api ([#138](https://github.com/itsnotapt/tim-data-investigate-platform/issues/138)) ([5107562](https://github.com/itsnotapt/tim-data-investigate-platform/commit/5107562460fca407f4396649506964334e2934e8))
* **frontend,backend,tim-actions:** Kusto connections and Run KQL ([#145](https://github.com/itsnotapt/tim-data-investigate-platform/issues/145)) ([d13dd2c](https://github.com/itsnotapt/tim-data-investigate-platform/commit/d13dd2c25caadb18198895e676866f910394377e))
* **frontend,backend,tim-actions:** pivots from result rows ([#155](https://github.com/itsnotapt/tim-data-investigate-platform/issues/155)) ([cb232f1](https://github.com/itsnotapt/tim-data-investigate-platform/commit/cb232f1beff7ff18296f38d7993266ac803dc50c))
* **frontend,backend,tim-actions:** schema completion in the Run KQL editor ([#150](https://github.com/itsnotapt/tim-data-investigate-platform/issues/150)) ([44b6c95](https://github.com/itsnotapt/tim-data-investigate-platform/commit/44b6c95c7c2b1764434abcd94187a7e3f1c7184f))
* **tim-actions,backend,frontend:** snowflake_query action files with params bound by position ([#187](https://github.com/itsnotapt/tim-data-investigate-platform/issues/187)) ([0b4dab9](https://github.com/itsnotapt/tim-data-investigate-platform/commit/0b4dab96b788038825a32b9e74449a9d2a777b26))
* **tim-actions:** an example instance and the actions guide ([#184](https://github.com/itsnotapt/tim-data-investigate-platform/issues/184)) ([4773811](https://github.com/itsnotapt/tim-data-investigate-platform/commit/47738114051e110c813945f71dd9ebe3984b7d88))


### Bug Fixes

* **api,tim-actions:** production compose starts without TIM_AUTH_CLIENT_SECRET when no connection uses obo ([#212](https://github.com/itsnotapt/tim-data-investigate-platform/issues/212)) ([400d0ac](https://github.com/itsnotapt/tim-data-investigate-platform/commit/400d0ac217177e7262d2a21d5d2174193b329e59))
* **backend,tim-actions,frontend:** a bigint column type for whole numbers above 2^53 ([#190](https://github.com/itsnotapt/tim-data-investigate-platform/issues/190)) ([d3025b2](https://github.com/itsnotapt/tim-data-investigate-platform/commit/d3025b2ad64ae6209ddb90c29ecf09147eba9eb5))
* **tim-actions,backend,frontend:** a pill's suggestions open under its field ([#200](https://github.com/itsnotapt/tim-data-investigate-platform/issues/200)) ([#202](https://github.com/itsnotapt/tim-data-investigate-platform/issues/202)) ([85afa52](https://github.com/itsnotapt/tim-data-investigate-platform/commit/85afa52c2f30a03b477b4f4ebfaafc8b219361f2))
