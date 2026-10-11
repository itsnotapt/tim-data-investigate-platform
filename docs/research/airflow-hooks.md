# Can Airflow hooks and connections be used without Airflow?

Question: [#66](https://github.com/itsnotapt/tim-data-investigate-platform/issues/66) (map [#65](https://github.com/itsnotapt/tim-data-investigate-platform/issues/65)).
Versions checked (latest on PyPI on 2026-10-10): `apache-airflow` 3.3.2 (`apache-airflow-core` 3.3.2, `apache-airflow-task-sdk` 1.3.2), `apache-airflow-providers-microsoft-azure` 15.2.0, `apache-airflow-providers-snowflake` 6.18.0, `apache-airflow-providers-common-sql` 2.2.0, `apache-airflow-providers-common-compat` 1.20.0.
Source was read from the published wheels (`pip download --no-deps`); paths below are relative to the wheel root. Measurements came from throwaway Python 3.12 venvs (TIM's `requires-python`) built with `uv`, containing TIM's `api/pyproject.toml` runtime dependencies plus the package under test.

Sources:

- [P1] PyPI JSON metadata (`requires_dist`): https://pypi.org/pypi/apache-airflow-providers-microsoft-azure/15.2.0/json, https://pypi.org/pypi/apache-airflow-providers-snowflake/6.18.0/json, https://pypi.org/pypi/apache-airflow-providers-common-sql/2.2.0/json, https://pypi.org/pypi/apache-airflow/3.3.2/json, https://pypi.org/pypi/apache-airflow-core/3.3.2/json, https://pypi.org/pypi/apache-airflow-task-sdk/1.3.2/json (and 1.0.0, 1.1.0, 1.2.2)
- [S1] `airflow/providers/microsoft/azure/hooks/adx.py` (`AzureDataExplorerHook`)
- [S2] `airflow/providers/snowflake/hooks/snowflake.py` (`SnowflakeHook`), `snowflake_sql_api.py` (`SnowflakeSqlApiHook`)
- [S3] `airflow/sdk/bases/hook.py` (`BaseHook.get_connection`), `airflow/sdk/definitions/connection.py` (`Connection`)
- [S4] `airflow/sdk/execution_time/context.py` (`_get_connection`, `_preset_connections`), `airflow/sdk/execution_time/supervisor.py` (`ensure_secrets_backend_loaded`)
- [S5] `airflow/__init__.py`, `airflow/settings.py` (`initialize`) from `apache-airflow-core`
- [S6] `apache_airflow_providers_snowflake-6.18.0.dist-info/entry_points.txt`, `airflow/providers/snowflake/get_provider_info.py`
- [D1] Airflow docs, Managing Connections: https://airflow.apache.org/docs/apache-airflow/stable/howto/connection.html
- [D2] Airflow docs, Secrets Backend: https://airflow.apache.org/docs/apache-airflow/stable/security/secrets/secrets-backend/index.html
- [D3] Azure provider docs, Azure Data Explorer connection: https://airflow.apache.org/docs/apache-airflow-providers-microsoft-azure/stable/connections/adx.html
- [D4] Snowflake provider docs, Snowflake connection: https://airflow.apache.org/docs/apache-airflow-providers-snowflake/stable/connections/snowflake.html
- [D5] Airflow Task SDK docs: https://airflow.apache.org/docs/task-sdk/stable/index.html
- [D6] Snowflake docs, Connecting with the Python connector (OAuth): https://docs.snowflake.com/en/developer-guide/python-connector/python-connector-connect
- [M] Local measurements (venvs and scripts described inline)

## Short answer

Technically yes, but it's not worth it. Both provider packages hard-depend on `apache-airflow`, which pulls in all of Airflow core: about 145 extra packages for the Azure provider alone and about 510 MB of extra site-packages for both providers. Airflow core also caps FastAPI below TIM's version. Importing a hook runs Airflow's process initialisation, which replaces TIM's root logging handler. Connections need no metadata database: `AIRFLOW_CONN_<ID>` environment variables or a custom secrets backend are enough. Neither hook can run as the analyst, though. `AzureDataExplorerHook` has no user-token or OBO auth method. `SnowflakeHook` always fetches its own OAuth token from a refresh token, client credentials or an Azure connection, so it ignores a passed-in user token. Both need subclassing that overrides `get_conn`/private methods. **Recommendation: copy the pattern, not the code.** A small TIM-owned `Connection` (named, typed, preconfigured per instance) and a `Hook` base with `get_conn()`, with hooks built per request from the analyst's token, used directly with `azure-kusto-data` and `snowflake-connector-python`.

## 1. What the provider packages pull in

- Both providers require `apache-airflow>=2.11.0` plus `apache-airflow-providers-common-compat` [P1]. Snowflake also requires `apache-airflow-providers-common-sql`, `pandas`, `pyarrow`, `snowflake-connector-python`, `snowflake-sqlalchemy` and `snowflake-snowpark-python` (below Python 3.14) [P1]. The Azure provider requires the SDKs for every Azure service it wraps (Batch, Cosmos, Data Factory, Service Bus, Synapse, Storage, Key Vault, Graph/Kiota, `adlfs`, `azure-kusto-data`, ...), even if you only want Kusto [P1].
- `apache-airflow` 3.3.2 is a meta-package for `apache-airflow-core==3.3.2` and `apache-airflow-task-sdk==1.3.2` [P1]. Core brings its own FastAPI server, Alembic migrations, SQLAlchemy, OpenTelemetry, structlog, cadwyn, pendulum and more, plus four more providers (`common-io`, `common-sql`, `smtp`, `standard`) [P1].
- There is no "hooks only" install. The Task SDK docs say DAG authors can import classes "without installing the full Airflow core" [D5]. But every `apache-airflow-task-sdk` release so far (1.0.0, 1.1.0, 1.2.2, 1.3.2) declares a hard dependency on a matching `apache-airflow-core` range [P1], and the providers depend on `apache-airflow` itself, not on the SDK [P1].

Measured footprint [M] (Python 3.12, TIM's runtime deps as the baseline):

| venv | site-packages | packages |
|---|---|---|
| TIM api deps only | 96 MB | 50 |
| + `snowflake-connector-python` (direct, no Airflow) | 139 MB | 63 |
| + `apache-airflow-providers-microsoft-azure` | 290 MB | 195 |
| + both providers, `apache-airflow==3.3.2` | 608 MB | 219 (adds pandas, pyarrow, numpy, Snowpark) |

Version coupling [P1][M]:

- `apache-airflow-core` 3.3.2 pins `fastapi[standard-no-fastapi-cloud-cli]>=0.129.0,<0.137.0`, `sqlalchemy[asyncio]>=2.0.50`, `alembic<2.0`, `structlog>=26.1.0` and `pydantic>=2.11.0`. TIM's `fastapi` is unpinned, so installing the Azure provider made `uv` **backtrack to Airflow 3.2.2** to keep FastAPI 0.143.0. Forcing `apache-airflow==3.3.2` **downgraded FastAPI to 0.136.3**. Either way, Airflow's release cadence would set TIM's web framework and ORM versions.

Import cost [M]: `from airflow.providers.microsoft.azure.hooks.adx import AzureDataExplorerHook` took 0.7 to 2 s and loaded about 1,740 modules (210 of them `airflow.*`, SQLAlchemy included).

## 2. Connections without the metadata database

Yes, a connection can be resolved without Airflow's metadata DB.

- `BaseHook.get_connection(conn_id)` calls `Connection.get`, then `_get_connection` [S3][S4]. That function checks an in-process preset dict, then a secret cache, then the secrets backends from `ensure_secrets_backend_loaded()` [S4].
- Outside a worker (no `SUPERVISOR_COMMS`) and without `_AIRFLOW_PROCESS_CONTEXT=server`, the backend chain is the "fallback chain": "only env vars + external backends from config, no MetastoreBackend" [S4]. A missing ID raises `AirflowNotFoundException("The conn_id ... isn't defined")` [S4][M].
- **Environment variables**: `AIRFLOW_CONN_{CONN_ID}`, uppercase, holding JSON (`conn_type`, `host`, `login`, `password`, `schema`, `port`, `extra`) or a URI. These "are not stored in the metadata database" [D1]. Verified: with `AIRFLOW_CONN_ADX='{"conn_type":"azure_data_explorer","host":"https://help.kusto.windows.net","extra":{"auth_method":"AZURE_TOKEN_CRED"}}'` and no DB, `AzureDataExplorerHook("adx").get_conn()` returned a `KustoClient` [M].
- **Secrets backend**: subclass `BaseSecretsBackend` and implement `get_connection()` or `get_conn_value()`. Configure it with `[secrets] backend` / `backend_kwargs` (or the `AIRFLOW__SECRETS__BACKEND*` env vars). It is searched before env vars [D2][S4]. This is how TIM could feed connections from its own config.
- **Constructed in code**: `airflow.sdk.Connection(conn_id=..., conn_type=..., host=..., extra=...)` can be built directly [S3]. But hooks take a `conn_id`, not a `Connection`, so an in-code object still has to be found by ID. The only in-process route is the private `_preset_connections` ContextVar, used by `Connection.test_connection` [S3][S4]. It **does not exist in task-sdk 1.2.2**, which `uv` picked in one venv, so the import failed [M]. Treat it as unstable. The other option is to subclass each hook and override `get_connection`.

Side effects of `import airflow` [S5][M]:

- `airflow/__init__.py` calls `settings.initialize()` unless the private `_AIRFLOW__AS_LIBRARY` env var is set. The code comment warns: "DO NOT USE THIS UNLESS YOU REALLY KNOW WHAT YOU'RE DOING ... configs, logging, the ORM, etc. will be broken" [S5].
- `initialize()` runs `configure_logging()`, `configure_otel()`, the secrets masker and `configure_orm()` (an engine for the default SQLite DB, created lazily) [S5].
- Measured: after importing the hook, a TIM-style `logging.basicConfig` stderr handler at WARNING became **Airflow's stdout handler at INFO, with structlog formatting**. Airflow also created `$AIRFLOW_HOME/logs` (default `~/airflow`) [M].
- With `_AIRFLOW__AS_LIBRARY=1`, logging was left alone, no directory was created, and env-var connections still resolved [M]. But this relies on a private, explicitly unsupported switch.

## 3. Per-request user token (OBO / External OAuth)

**AzureDataExplorerHook: no.**

- `get_conn()` supports `AAD_APP`, `AAD_APP_CERT`, `AAD_CREDS` (username/password), `AAD_DEVICE` and `AZURE_TOKEN_CRED` (DefaultAzureCredential / managed identity / workload identity) [S1][D3]. All of them are fixed credentials read from the connection.
- There is no user-token, OBO or `with_aad_user_token_authentication` path anywhere in the Azure provider [S1]. The docs don't mention delegated auth [D3].
- The client is a `cached_property` on the hook instance [S1], so a per-analyst client needs a per-request hook.
- `run_query(query, database, options)` only sets `ClientRequestProperties` options. It has **no query parameters** (bind parameters, which #65 makes the default) and wraps errors in `AirflowException` [S1].
- A subclass that overrides `get_conn()` to call `KustoConnectionStringBuilder.with_aad_user_token_authentication(conn.host, token)` works [M]. That is exactly what TIM's `api/src/tim_api/kusto/query_client.py` already does, so the hook would only add a host lookup.

**SnowflakeHook: no pass-through, only service-side token acquisition.**

- With `authenticator=oauth`, `_get_conn_params()` always **overwrites** `token` with one it fetches itself. That is either from `azure_conn_id` through `AzureBaseHook.get_token(scope)` (the Airflow connection's own identity, scope from `[snowflake] azure_oauth_scope`) or from `token_endpoint` with `grant_type` `refresh_token` or `client_credentials` (`SUPPORTED_GRANT_TYPES`) [S2].
- `__init__` has no token kwarg (it accepts `account`, `warehouse`, `database`, `region`, `role`, `schema`, `authenticator`, `session_parameters`, ...) [S2].
- The `token` extra is only read for `WORKLOAD_IDENTITY` (an OIDC ID token for WIF) [S2][D4]. The docs never describe supplying a pre-obtained user access token [D4].
- `SnowflakeSqlApiHook.get_headers()` reuses the same `_get_conn_params()` [S2].
- Measured: a connection with `authenticator=oauth` and a user `token` in the extra ignored the token and called the token endpoint [M].
- What TIM needs is plain `snowflake.connector.connect(authenticator="oauth", token=<access token>)` [D6], with the token coming from an Entra OBO exchange when Snowflake External OAuth trusts Entra. A subclass overriding the private `_get_conn_params()` and its cached `_get_static_conn_params` can inject it [M]. That couples TIM to private internals of a 1,100-line class.

## 4. Copy the pattern instead?

Yes. The parts of Airflow's design that fit TIM are small and easy to own:

- **Connection**: a named record (`conn_id`, `conn_type`, host/login/password/schema/port plus a JSON `extra`) resolved through a lookup chain (secrets backend, then env vars) [S3][D1][D2]. TIM's version: connections preconfigured per instance in TIM's settings (env or Helm values), each with an explicit auth mechanism (`obo`, `managed_identity`, `client_secret`, ...), as #65 already requires.
- **Hook**: a class with `conn_type`, `default_conn_name` and `get_conn()` that returns the backend's native client [S1][S2]. TIM's version: construct per action run with the run's identity, so OBO is part of the interface, not a subclass hack. Make it async-friendly, and use bind parameters by default (`ClientRequestProperties.set_parameter` for Kusto, connector `params` for Snowflake).
- **Discovery**: providers register through the `apache_airflow_provider` entry-point group pointing to `get_provider_info()`, which lists `connection-types` with hook class names [S6]. That is the same mechanism #65's "installable packages discovered at startup" needs: a TIM entry-point group such as `tim.actions` read with `importlib.metadata.entry_points`.
- **Licence**: Airflow is Apache-2.0, so copying small pieces is allowed with attribution. The design above needs no copied code.

Reasons not to depend on Airflow, in summary:

- Hundreds of MB and about 150 to 170 transitive packages.
- A FastAPI cap below TIM's version.
- Process-wide logging and ORM initialisation on import.
- Private APIs (`_preset_connections`, `_get_conn_params`, `_AIRFLOW__AS_LIBRARY`) that changed between minor versions.
- No user-identity auth in either hook.
- No bind parameters in the Kusto hook.

The underlying clients TIM would call anyway (`azure-kusto-data`, already a dependency, and `snowflake-connector-python`, about 43 MB and 13 packages) carry none of these costs.

## Implications for other tickets

- Packaging (map "Not yet specified"): action packages should declare a TIM entry-point group and depend on backend SDKs, not on Airflow. An action package that does import Airflow providers would bring Airflow's FastAPI cap and logging takeover into the API image. TIM may want to document or block that.
- The "Airflow-like interface" in #65 should mean the Connection/Hook/entry-point *shape*, not Airflow types. Action authors who know Airflow get familiar names (`conn_id`, `get_conn()`) without the dependency.
- Snowflake as the analyst requires Snowflake External OAuth configured to trust Entra, plus an OBO scope for the Snowflake resource. Without that, Snowflake connections can only use a service identity.
