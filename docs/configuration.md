# Configuration

TIM is configured entirely through environment variables.

- The api reads `TIM_*` variables.
- The web container reads unprefixed variables, and renders them into `/config.js`.

This page lists every variable.

- Production values and secrets handling are in [deployment.md](deployment.md).
- The local setup is in [development.md](development.md).

## API

Settings are read by pydantic-settings from two places:

- the process environment;
- a `.env` file in the working directory: `api/.env` when run from `api/`, with the template `api/.env.example`.

How values are read:

- List values are comma-separated.
- Empty strings for `TIM_AUTH_CLIENT_SECRET`, `TIM_ACTIONS_DIR`, `TIM_CONNECTIONS_FILE` and `TIM_LABELS_FILE` count as unset.
- Unknown `TIM_*` variables are ignored.
- Invalid or missing settings stop the api at startup, with an error naming each variable (see [operations.md](operations.md#common-failures)).

### Mode and logging

| Variable          | Default      | Required | Description                                                                                                |
| ----------------- | ------------ | -------- | ---------------------------------------------------------------------------------------------------------- |
| `TIM_ENVIRONMENT` | `production` | no       | `development` or `production`. Production refuses `TIM_AUTH_DISABLED=true`, `TIM_DEV_ACTIONS=true`, a `memory://` database URL and a connection with `auth: none`. |
| `TIM_LOG_LEVEL`   | `INFO`       | no       | `CRITICAL`, `ERROR`, `WARNING`, `INFO` or `DEBUG`. Applies to the `tim_api` logger.                        |

### Authentication

See [ADR-0005](adr/0005-auth-entra-popup-obo.md) for the design.

| Variable                  | Default                             | Required | Description                                                                                                                                                                                          |
| ------------------------- | ----------------------------------- | -------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `TIM_AUTH_TENANT_ID`      | none                                | yes      | Entra tenant (GUID or domain) that issues and validates tokens.                                                                                                                                      |
| `TIM_AUTH_CLIENT_ID`      | none                                | yes      | Client id of the API app registration. The API audience is `api://<client id>`.                                                                                                                      |
| `TIM_AUTH_CLIENT_SECRET`  | unset                               | see note | Client secret for the on-behalf-of (OBO) exchange. When unset, a workload-identity token file is used (`AZURE_FEDERATED_TOKEN_FILE`, below).                                                         |
| `TIM_AUTH_AUTHORITY_HOST` | `https://login.microsoftonline.com` | no       | Authority host, override for sovereign clouds. Must be https.                                                                                                                                        |
| `TIM_AUTH_DISABLED`       | `false`                             | no       | Development only. Skips token validation; every request runs as the analyst its stub token (`Authorization: Bearer dev:<upn>`) names, or as a fixed dev user (`dev.user@example.com`) without one. A stub token with a blank upn gets 401. Connections that use `obo` then return 503 because there is no user token to exchange. Refused when `TIM_ENVIRONMENT=production`. |

Note: an api whose connections file has a connection that uses `obo` needs an OBO credential at startup, unless `TIM_AUTH_DISABLED=true`.

- The credential is either `TIM_AUTH_CLIENT_SECRET`, or `AZURE_FEDERATED_TOKEN_FILE` pointing to a readable file.
- Without one, the api fails to start.
- An instance with no `obo` connection starts without one. OBO then answers 503 when something uses it.

### Connections

| Variable               | Default | Description |
| ---------------------- | ------- | ----------- |
| `TIM_CONNECTIONS_FILE` | none    | The connections file ([actions.md](actions.md#connections-file)), read once at startup. Empty means none. A path that doesn't exist stops startup with `no file <path>`. |

The file is a YAML list of the instance's connections. Each entry has:

| Field   | Required | Description |
| ------- | -------- | ----------- |
| `name`  | yes | Lowercase letters, digits and `-`, unique in the file. Actions and the browser refer to the connection by it. |
| `title` | yes | What analysts see. |
| `type`  | yes | A connection type installed in the image; `tim-api schema connections` lists them. |
| `auth`  | yes | `obo`: runs as the analyst, through an on-behalf-of token. `workload_identity`: runs as TIM. `none`: sends no token, for a local Kusto emulator in development ([ADR-0026](adr/0026-a-demo-instance-needs-no-accounts.md)); the api refuses to start with one when `TIM_ENVIRONMENT=production`. The `kusto` type supports `obo` and `none`; the `snowflake` type supports `obo` and `workload_identity`. |
| `scope` | for `obo` | The scope an `obo` token is requested for; the type may default it (`kusto` does, `snowflake` doesn't). Any other `auth` refuses it ("scope is only for auth obo"). |

The `kusto` connection type adds `cluster` (required), `databases` (optional) and `scope`:

| Field       | Description |
| ----------- | ----------- |
| `cluster`   | An absolute URL of a plain DNS host with no credentials, path, query or fragment, and not an IP address. With `obo` it is `https` on port 443 only, and is normalised to `https://<host>` at startup. With `none` it may be `http` or `https` and keeps its port, normalised to `<scheme>://<host>[:<port>]`. |
| `databases` | Database names the browser suggests for Run KQL's `database` param. Not a restriction. |
| `scope`     | The OBO scope. Defaults to `{cluster}/.default`. `none` refuses it. |

A `cluster` is checked when the file is read. A rejected value stops startup with the reason.

- It is an absolute URL, with no whitespace or control characters. With `obo` the scheme is `https`; with `none` it is `http` or `https`.
- It has no credentials, query, fragment or path (a trailing `/` is accepted), and no IP address literal.
- With `obo`, its port is omitted or `443`. With `none`, any port is kept.
- Its host is a valid domain name; an internationalised name is converted to punycode.

The `snowflake` connection type adds `account`, `warehouse`, `role` (optional) and `scope`:

| Field       | Description |
| ----------- | ----------- |
| `account`   | The account identifier, such as `myorg-myaccount`. A URL or host name stops startup. |
| `warehouse` | The warehouse that runs the queries. Required. |
| `role`      | The role to use. Optional. |
| `scope`     | The OBO scope, such as `api://<app id>/session:role-any`. Required for `obo`, with no default. `workload_identity` refuses it. |

```yaml
- name: samples
  title: Samples (help cluster)
  type: kusto
  auth: obo
  cluster: https://help.kusto.windows.net
  databases: [Samples]
```

- A problem in the file stops startup. It is reported as `<file>:<line>: <field>: <message>` ([operations.md](operations.md#startup-failures-from-the-files)).
- Check a file before deploying it with `tim-api check --connections <file>` ([operations.md](operations.md#tim-api-check)).
- The api's OBO credential is needed when a connection uses `obo` ([Authentication](#authentication)).
- `GET /api/instance` lists each connection's name, type, title, editor and databases. It never lists the cluster, account, auth or scope.

### Actions

| Variable          | Default | Description                                                                                                                                                                                                  |
| ----------------- | ------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `TIM_DEV_ACTIONS` | `false` | Development only. Registers the actions `tim.dev_json` and `tim.dev_run_kql`, the `dev_rows` and `dev_sink` action types and the `dev_kql` connection type ([development.md](development.md#development-actions)). Refused when `TIM_ENVIRONMENT=production`. |
| `TIM_ACTIONS_DIR` | none    | One flat directory of action files ([actions.md](actions.md#action-files)), read once at startup: `*.yaml` and `*.yml`, not recursing, dot-entries skipped. Empty means none. A path that isn't a directory stops startup. |

A problem in any action file stops startup too ([operations.md](operations.md#startup-failures-from-the-files)). Check a directory before deploying it with `tim-api check --actions <dir>` ([operations.md](operations.md#tim-api-check)). Under Compose, the directory sits in `TIM_CONFIG_DIR`, mounted at `/etc/tim` ([deployment.md](deployment.md#instance-files)).

### Labels and annotations

See [ADR-0020](adr/0020-annotations-in-postgres.md).

| Variable                      | Default | Description |
| ----------------------------- | ------- | ----------- |
| `TIM_LABELS_FILE`             | none    | The labels file ([actions.md](actions.md#labels-file)), read once at startup. Empty means none, and the instance has the default labels. A path that doesn't exist stops startup with `no file <path>`. |
| `TIM_MAX_ANNOTATION_IDS`      | `10000` | Most distinct `id`s one `PATCH /api/annotations` may change; more get 422. The browser disables labelling a selection over it. Must be greater than 0. |
| `TIM_ANNOTATION_POLL_SECONDS` | `30`    | How often each browser reads the change feed ([operations.md](operations.md#the-change-feed)). Sent to browsers in `GET /api/instance`. Must be greater than 0. |

The labels file is a YAML list of the instance's labels. Each entry has:

| Field    | Required | Description |
| -------- | -------- | ----------- |
| `key`    | yes | What annotations store: 1 to 64 characters, no whitespace, unique in the file. |
| `name`   | yes | What analysts see, 1 to 100 characters. |
| `colour` | yes | One of `red`, `amber`, `green`, `teal`, `blue`, `purple`, `pink` or `grey`. |
| `symbol` | no  | One of `skull`, `warning`, `check`, `flag`, `star`, `question`, `block`, `bug` or `eye`. |

```yaml
- {key: malicious, name: Malicious, colour: red, symbol: skull}
- {key: escalated, name: Escalated, colour: blue, symbol: flag}
- {key: benign, name: Benign, colour: green, symbol: check}
```

- Labels are listed in file order, and the first nine take the keys 1 to 9.
- A problem in the file stops startup. It is reported as `<file>:<line>: <field>: <message>` ([operations.md](operations.md#startup-failures-from-the-files)).
- Check a file before deploying it with `tim-api check --labels <file>` ([operations.md](operations.md#tim-api-check)).
- `GET /api/instance` lists the labels and the two limits.

### Storage

See [ADR-0004](adr/0004-postgresql-persistence.md).

| Variable                          | Default | Required | Description                                                                                                            |
| --------------------------------- | ------- | -------- | ---------------------------------------------------------------------------------------------------------------------- |
| `TIM_DATABASE_URL`                | none    | yes      | `postgresql+asyncpg://user:password@host:5432/db`. `memory://` (data lost on restart) is accepted only in development. |
| `TIM_RUN_RETENTION_SWEEP_SECONDS` | `300`   | no       | Interval of the sweep that deletes expired runs. Must be greater than 0.                                |

### HTTP and run limits

All numeric values must be greater than 0. See [ADR-0012](adr/0012-query-run-limits-and-lifecycle.md).

| Variable                    | Default               | Description                                                                                                                                         |
| --------------------------- | --------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------- |
| `TIM_CORS_ALLOWED_ORIGINS`  | empty                 | Allowed origins. With none, no CORS headers are sent (the web container proxies `/api`, so none are needed).                                        |
| `TIM_MAX_REQUEST_BYTES`     | `67108864` (64 MiB)   | Largest accepted request body, including the input of a sink; larger requests get 413.                                                              |
| `TIM_MAX_RESULT_ROWS`       | `1000000`             | Row cap for a run's result.                                         |
| `TIM_MAX_RESULT_BYTES`      | `536870912` (512 MiB) | Size cap for a run's result, as compact JSON per row, summed.                                  |
| `TIM_RUN_TIMEOUT_SECONDS`   | `600`                 | Execution time limit of a run, counted once it has a concurrency slot.                                                                 |
| `TIM_RUN_RETENTION_SECONDS` | `86400` (24 h)        | How long a run stays readable after it last changed.                                                                                   |
| `TIM_MAX_PIVOT_ROWS`        | `100`                 | Most selected rows a pivot into an action accepts (`POST /api/actions/{key}/resolve`); more gets 422.                                               |
| `TIM_MAX_CONCURRENT_RUNS`   | `16`                  | Runs executing at once per api process; further runs wait as `running`.                          |
| `TIM_ROWS_PAGE_SIZE`        | `10000`               | Most rows per page of `GET /api/runs/{runId}/rows`.                                                                                                 |

The web container's nginx allows request bodies up to 64 MB and waits up to 620 s for the api, so keep `TIM_RUN_TIMEOUT_SECONDS` at or below 600 unless `web/docker/nginx.conf.template` is changed.

### Variables outside `TIM_*`

| Variable                                                    | Read by                                     | Description                                                                                                                                                                                                                         |
| ----------------------------------------------------------- | ------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `AZURE_FEDERATED_TOKEN_FILE`                                | OBO exchange                                | Path to a workload-identity token file, used as the client assertion when `TIM_AUTH_CLIENT_SECRET` is unset. Re-read on each exchange. Needed at startup when a connection uses `obo` and there is no client secret.                                                                                              |
| `FORWARDED_ALLOW_IPS`                                       | uvicorn                                     | Addresses from which `X-Forwarded-*` headers are trusted (default `127.0.0.1`). Set to the proxy address. `compose.yaml` uses `*`, `deploy/compose.prod.yaml` the compose subnet (`TIM_SUBNET`), the chart `api.forwardedAllowIps`. |

### Test-only variables

| Variable                                                                       | Used by           | Description                                                                                            |
| ------------------------------------------------------------------------------ | ----------------- | ------------------------------------------------------------------------------------------------------ |
| `TIM_TEST_DATABASE_URL`                                                        | `pytest`, Playwright | Postgres server for storage tests, and the e2e api's database, which Playwright empties at the start of each run; falls back to `pgserver`. |
| `TIM_TEST_KUSTO_CLUSTER`, `TIM_TEST_KUSTO_QUERY_DATABASE` | `pytest -m kusto` | A real cluster for the live tests `test_run_kql_on_a_real_cluster` and `test_kql_query_binds_params_on_a_real_cluster` (database default `Research`). It authenticates through `DefaultAzureCredential`, for example with your Azure CLI login, see [development.md](development.md#live-kusto-tests). |
| `TIM_TEST_SNOWFLAKE_ACCOUNT`, `TIM_TEST_SNOWFLAKE_WAREHOUSE`, `TIM_TEST_SNOWFLAKE_SCOPE` | `pytest -m snowflake` | A real account for the live tests `test_run_sql_on_a_real_account` and `test_run_sql_on_a_real_account_through_tims_obo_exchange`; they skip unless the account is set. The analyst's token comes from `DefaultAzureCredential`, for example your Azure CLI login, see [development.md](development.md#things-that-arent-obvious). |
| `TIM_TEST_AUTH_TENANT_ID`, `TIM_TEST_AUTH_CLIENT_ID`, `TIM_TEST_AUTH_CLIENT_SECRET` | `pytest -m snowflake` | The API app registration that `test_run_sql_on_a_real_account_through_tims_obo_exchange` validates tokens for and makes the on-behalf-of exchange as; it skips without the client ID. |
| `UPDATE_SNAPSHOTS=1`                                                           | `pytest`          | Rewrites OpenAPI snapshots, see [development.md](development.md#api-types).                            |
| `E2E_PORT`                                                                     | Playwright        | Vite's port for e2e runs. Default `5180`, a whole number from 1 to 65534. The api takes the next port. |
| `E2E_SHOTS=1`                                                                  | Playwright        | Writes e2e screenshots to `web/e2e/.screenshots` (git-ignored); without it the helpers do nothing.     |
| `TIM_API_PROXY_TARGET`                                                         | Vite dev server   | Where `/api` is proxied (default `http://localhost:8080`); Playwright points it at its own api.        |

## Web container

The image (`web/Dockerfile`, nginx on port 8080) renders its configuration at start. `docker-entrypoint.sh`:

1. validates these variables;
2. writes `/tmp/tim/config.js` (`window.appConfig = {...}`), served as `/config.js` and never cached;
3. writes the nginx configuration `/tmp/tim/nginx.conf`;
4. starts nginx.

The root filesystem can be read-only. Only `/tmp` must be writable. A validation failure prints `tim-web: ...` to stderr, and the container exits.

| Variable           | Required | Default                                                   | `window.appConfig` key | Description                                                                                              |
| ------------------ | -------- | --------------------------------------------------------- | ---------------------- | -------------------------------------------------------------------------------------------------------- |
| `BACKEND_URI`      | yes      | none                                                      | none (nginx only)      | Where nginx forwards `/api/`: `http(s)://host[:port]`, no path. Trailing slashes are removed.            |
| `STUB_SIGN_IN`     | no       | `false`                                                   | `stubSignIn`           | Development only. `true` or `false`. `true` shows a "Who are you?" screen instead of Entra sign-in and sends the stub token `dev:<upn>`; pair it with `TIM_AUTH_DISABLED=true` on the api. The value must be exactly `true` or `false`. The container exits unless `TIM_ENVIRONMENT=development`. The three Entra variables below are then not required and not rendered. |
| `REDIRECT_URI`     | yes, unless `STUB_SIGN_IN=true` | none                                       | `redirectUri`          | MSAL popup redirect target, `https://<web host>/blank.html`. Register it as a SPA redirect URI in Entra. |
| `AUTH_CLIENT_ID`   | yes, unless `STUB_SIGN_IN=true` | none                                       | `auth.clientId`        | Client id of the app registration the SPA signs in with.                                                 |
| `AUTH_TENANT_ID`   | yes, unless `STUB_SIGN_IN=true` | none                                       | `auth.authority`       | Tenant GUID or domain; the authority becomes `https://login.microsoftonline.com/<tenant>`.               |
| `API_BASEPATH`     | no       | empty (same origin)                                       | `apiEndpoint`          | Prefix for API calls. A cross-origin `http(s)://host[:port]` is added to the CSP `connect-src`.          |
| `AGGRID_LICENSE`   | no       | empty                                                     | `agGridLicenseKey`     | AG Grid Enterprise licence key, see [below](#ag-grid-enterprise-licence).                                |
| `HELP_WIKI_URI`    | no       | project wiki (built in)                                   | `wikiUri`              | Target of the help link.                                                                                 |
| `HELP_ISSUE_URI`   | no       | project issue tracker (built in)                          | `issueUri`             | Target of the issue link.                                                                                |
| `TIM_ENVIRONMENT`  | no       | `production`                                              | none                   | Must be `development` or `production`. `STUB_SIGN_IN=true` is accepted only with `development`.           |
| `NGINX_RESOLVER`   | no       | first nameserver in `/etc/resolv.conf`, else `127.0.0.11` | none                   | DNS resolver nginx uses to resolve `BACKEND_URI`.                                                        |

Empty optional values are left out of `config.js` so the app defaults apply; `agGridLicenseKey` is always written (empty means trial).

The entrypoint also honours three variables that exist for tests:

- `TIM_RUNTIME_DIR`: the output directory, default `/tmp/tim`;
- `TIM_NGINX_TEMPLATE`;
- `TIM_ENTRYPOINT_DRY_RUN=1`: render the files and exit.

The image serves `/config.js` from `/tmp/tim`, and includes `nginx.conf` from there. So a different `TIM_RUNTIME_DIR` is only useful when nginx is not started.

### Web (Vite development)

`npm run dev` has no entrypoint. The SPA reads `window.appConfig` from `web/public/config.js` (placeholder values for local use) and falls back to `VITE_*` variables from `web/.env.local` (template `web/.env.example`) for any key `config.js` leaves empty.

| Variable                  | Equivalent `appConfig` key / container variable                                                                             |
| ------------------------- | --------------------------------------------------------------------------------------------------------------------------- |
| `VITE_AUTH_CLIENT_ID`     | `auth.clientId` / `AUTH_CLIENT_ID`                                                                                          |
| `VITE_AUTH_AUTHORITY`     | `auth.authority` (full URL; the container takes `AUTH_TENANT_ID`)                                                           |
| `VITE_AUTH_REDIRECT`      | `redirectUri` / `REDIRECT_URI`                                                                                              |
| `VITE_API_ENDPOINT`       | `apiEndpoint` / `API_BASEPATH`                                                                                              |
| `VITE_AGGRID_LICENSE_KEY` | `agGridLicenseKey` / `AGGRID_LICENSE`                                                                                       |
| `VITE_HELP_WIKI_URI`      | `wikiUri` / `HELP_WIKI_URI`                                                                                                 |
| `VITE_HELP_ISSUE_URI`     | `issueUri` / `HELP_ISSUE_URI`                                                                                               |
| `VITE_AUTH_STUB`          | `true` signs in a fake account without Entra and sends its stub token (`dev:<upn>`). The account is `dev.user@example.com`, or the upn in the `localStorage` key `tim.devStubUpn`. A production build refuses it and shows the configuration error screen. This stub has no "Who are you?" screen, and its Sign out keeps the stored upn. `stubSignIn: true` in `config.js` (container `STUB_SIGN_IN`) picks a different stub: it shows "Who are you?" until an analyst is chosen, and its Sign out forgets the upn. |

### How the SPA merges and validates configuration

1. Each key comes from `window.appConfig`, else from the matching `VITE_*` variable.
2. Empty strings and unsubstituted placeholders such as `$VAR` or `${VAR}` count as missing.
3. The result is validated: `auth.clientId`, `auth.authority` and `redirectUri` are required unless `stubSignIn` is `true` (URLs must be http(s)); `apiEndpoint` defaults to same origin (trailing slashes are stripped).
4. On any problem the app renders a configuration error screen listing every missing or invalid key instead of starting.

### AG Grid Enterprise licence

Result grids use AG Grid Enterprise; there is no Community build ([ADR-0006](adr/0006-ag-grid-enterprise.md)). The licence key is optional.

- Container: `AGGRID_LICENSE` (Compose `.env`, or the Helm Secret key of the same name) becomes `agGridLicenseKey` in `/config.js`. Development: `VITE_AGGRID_LICENSE_KEY`, or `agGridLicenseKey` in `web/public/config.js`.
- When a key is set, the SPA applies it at startup with `LicenseManager.setLicenseKey`.
- When no key is set, the grid runs in AG Grid's trial mode: a watermark over the grid and a licence notice in the browser console. The entrypoint logs `tim-web: AGGRID_LICENSE not set, AG Grid Enterprise runs in trial mode` once at start.
- The key is served in `config.js`, so every user of the SPA can read it. Changing it needs a container restart.

## Compose `.env`

### Development stack

`docker compose` reads `.env` at the repo root (template `.env.example`, git-ignored). Every variable has a default inside `compose.yaml`, so the file is optional. The template lists every variable below.

| Variable                                              | Default                                                    | Used for                                                                                    |
| ----------------------------------------------------- | ---------------------------------------------------------- | ------------------------------------------------------------------------------------------- |
| `POSTGRES_USER`, `POSTGRES_PASSWORD`, `POSTGRES_DB`   | `tim`, `tim`, `tim`                                        | PostgreSQL container; the api's `TIM_DATABASE_URL` is built from them.                      |
| `POSTGRES_PORT`                                       | `5432`                                                     | Host port, bound to `127.0.0.1`.                                                            |
| `API_PORT`                                            | `8080`                                                     | Host port of `api`.                                                                         |
| `WEB_PORT`                                            | `8081`                                                     | Host port of `web`.                                                                         |
| `TIM_AUTH_DISABLED`                                   | `true`                                                     | Passed to `migrate` and `api`. Also sets the `web` container's `STUB_SIGN_IN`. `true` shows "Who are you?". `false` signs in with Entra. Must be exactly `true` or `false`. |
| `TIM_LOG_LEVEL`                                       | `INFO`                                                     | Passed to `migrate` and `api`.                                                              |
| `TIM_AUTH_TENANT_ID`, `TIM_AUTH_CLIENT_ID`            | all-zero GUID                                              | Passed to the api and, as `AUTH_TENANT_ID` / `AUTH_CLIENT_ID`, to `web`. `web` uses them only with `TIM_AUTH_DISABLED=false`. |
| `REDIRECT_URI`                                        | `http://localhost:8081/blank.html`                         | Passed to `web`. Must match `WEB_PORT`. Used only with `TIM_AUTH_DISABLED=false`.           |
| `AGGRID_LICENSE`                                      | empty                                                      | Passed to `web`.                                                                            |
| `TIM_AUTH_CLIENT_SECRET`                              | empty                                                      | Passed to `migrate` and `api`. Needed only with `TIM_AUTH_DISABLED=false` (OBO credential). |
| `HELP_WIKI_URI`, `HELP_ISSUE_URI` | empty                                                      | Passed to `web`.                                                                            |
| `TIM_CONFIG_DIR`                                      | `./deploy/config`                                          | Host directory mounted read-only at `/etc/tim` in the api.                                  |
| `TIM_ACTIONS_DIR`, `TIM_CONNECTIONS_FILE`, `TIM_LABELS_FILE` | empty                                               | Passed to the api: container paths under `/etc/tim`. Empty means none.                      |
| `TIM_DEV_ACTIONS`                                     | `false`                                                    | Passed to the api. Registers the development actions ([development.md](development.md#development-actions)). |

Compose sets `TIM_ENVIRONMENT=development` for all services, `BACKEND_URI=http://api:8080` for `web` and `FORWARDED_ALLOW_IPS=*` for the api; these do not come from `.env`. `TIM_CORS_ALLOWED_ORIGINS` is not passed by the dev stack.

### Production stack

`deploy/compose.prod.yaml` reads `deploy/.env` (template `deploy/.env.example`, passed with `--env-file`). Variables marked required stop `docker compose` with the message `set <NAME>` when unset. The procedure is in [deployment.md](deployment.md#docker-compose).

| Variable                                              | Required | Default                       | Used for                                                                                       |
| ----------------------------------------------------- | -------- | ----------------------------- | ---------------------------------------------------------------------------------------------- |
| `PUBLIC_URL`                                          | yes      | none                          | Public origin without trailing slash; `web` gets `REDIRECT_URI=${PUBLIC_URL}/blank.html`.      |
| `POSTGRES_PASSWORD`                                   | yes      | none                          | PostgreSQL container and the api's `TIM_DATABASE_URL`.                                         |
| `POSTGRES_USER`, `POSTGRES_DB`                        | no       | `tim`, `tim`                  | Same.                                                                                          |
| `TIM_AUTH_TENANT_ID`, `TIM_AUTH_CLIENT_ID`            | yes      | none                          | Passed to the api and, as `AUTH_TENANT_ID` / `AUTH_CLIENT_ID`, to `web`.                       |
| `TIM_AUTH_CLIENT_SECRET`                              | see note | empty                         | Passed to `migrate` and `api`. See the note below.                                             |
| `TIM_CORS_ALLOWED_ORIGINS` | no       | empty                         | Passed to `migrate` and `api`.                                                                 |
| `TIM_LOG_LEVEL`                                       | no       | `INFO`                        | Passed to `migrate` and `api`.                                                                 |
| `TIM_CONFIG_DIR`                                      | no       | `./config`                    | Host directory mounted read-only at `/etc/tim` in the api; a relative path is from `deploy/`.  |
| `TIM_ACTIONS_DIR`, `TIM_CONNECTIONS_FILE`, `TIM_LABELS_FILE` | no | empty                       | Passed to the api: container paths under `/etc/tim`. Empty means none. See [Instance files](deployment.md#instance-files). |
| `AGGRID_LICENSE`                                      | no       | empty                         | Passed to `web`. Empty runs AG Grid Enterprise in trial mode.                                  |
| `HELP_WIKI_URI`, `HELP_ISSUE_URI` | no       | empty                         | Passed to `web`.                                                                               |
| `WEB_PORT`                                            | no       | `8080`                        | Host port of `web`, the only published port.                                                   |
| `TIM_SUBNET`                                          | no       | `10.89.0.0/24`                | Subnet of the compose network.                                                                 |
| `FORWARDED_ALLOW_IPS`                                 | no       | `TIM_SUBNET`                  | Addresses from which the api trusts `X-Forwarded-*`.                                           |
| `TIM_API_IMAGE`, `TIM_API_IMAGE_TAG`, `TIM_WEB_IMAGE`, `TIM_WEB_IMAGE_TAG` | no | `tim-api`, `local`, `tim-web`, `local` | Image names and tags. The defaults are the local build names; set them to run published images. |

`TIM_ENVIRONMENT=production`, `BACKEND_URI=http://api:8080` and the other fixed values are set in the compose file.

`TIM_AUTH_CLIENT_SECRET` is required when a connection uses `obo`.

- The api does not start without an OBO credential then: either `TIM_AUTH_CLIENT_SECRET` or a readable `AZURE_FEDERATED_TOKEN_FILE`.
- Compose provides no token file, so under compose the credential is the client secret.
- An instance with no `obo` connection leaves it empty.

### Demo instance

`examples/demo/compose.yaml` reads `.env` from its own directory. Every variable has a default, so the file is optional.

| Variable        | Default | Used for                                                                 |
| --------------- | ------- | ------------------------------------------------------------------------ |
| `TIM_DEMO_PORT` | `8081`  | Host port of `web`, bound to `127.0.0.1`. The demo's sign-in address uses it. |

## Helm

The chart in `deploy/helm/tim` sets the same variable names; the install procedure, the full values reference and workload identity are in [deployment.md](deployment.md#kubernetes-helm).

- **Non-secret variables** come from two ConfigMaps (api and web), rendered from values:
  - `config.environment` (`TIM_ENVIRONMENT`);
  - `config.auth.tenantId` / `clientId`;
  - `api.logLevel` (`TIM_LOG_LEVEL`);
  - `api.corsAllowedOrigins`;
  - `api.forwardedAllowIps` (`FORWARDED_ALLOW_IPS`);
  - `web.helpWikiUri`, `web.helpIssueUri`;
  - `web.apiBasePath` (`API_BASEPATH`).
- `REDIRECT_URI` is `config.publicUrl` (default `https://<ingress.host>`) plus `/blank.html`.
- `BACKEND_URI` is the api Service address.
- **Sensitive variables** come from one Secret whose keys are the variable names:
  - `TIM_DATABASE_URL` (required);
  - `TIM_AUTH_CLIENT_SECRET` (optional);
  - `AGGRID_LICENSE` (optional);
  - `POSTGRES_PASSWORD`, with the in-cluster PostgreSQL.
- **Where the Secret comes from:** either the chart creates it from `secrets.databaseUrl`, `secrets.authClientSecret` and `secrets.agGridLicense`, or `secrets.existingSecret` names a Secret you manage. In the second case the chart creates none.
- **Optional keys:** the api reads `TIM_AUTH_CLIENT_SECRET`, and the web container reads `AGGRID_LICENSE`, as optional keys. When a key is absent, the variable is not set.
- **Any other variable:** api variables (`TIM_MAX_RESULT_ROWS`, `TIM_RUN_TIMEOUT_SECONDS`, ...) are set through `api.extraEnv` / `api.extraEnvFrom`. Web variables are set through `web.extraEnv` / `web.extraEnvFrom`.
- **Instance files:** the chart sets the api's file variables when the matching value is given, not through `api.extraEnv`. See [Instance files under Helm](deployment.md#instance-files-under-helm).
  - `actions.files` or `actions.existingConfigMap` sets `TIM_ACTIONS_DIR=/etc/tim/actions`.
  - `connections` sets `TIM_CONNECTIONS_FILE=/etc/tim/connections.yaml`.
  - `labels` sets `TIM_LABELS_FILE=/etc/tim/labels.yaml`.
- **OBO credential:** the chart requires one only when a connection uses `obo`.
  - In production mode with a connection in `connections` that uses `obo`, rendering fails unless a client secret is supplied (`secrets.authClientSecret` or an existing Secret), or Entra workload identity is enabled (`api.podLabels` `azure.workload.identity/use: "true"`).
  - Without such a connection, no credential is required.
  - With workload identity, the webhook injects `AZURE_FEDERATED_TOKEN_FILE` into the api pod. The api uses it when `TIM_AUTH_CLIENT_SECRET` is unset.
