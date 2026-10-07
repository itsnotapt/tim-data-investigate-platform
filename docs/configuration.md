# Configuration

TIM is configured entirely through environment variables: the api reads `TIM_*` variables, the web container reads unprefixed variables and renders them into `/config.js`. This page lists every variable. Production values and secrets handling are in [deployment.md](deployment.md); the local setup is in [development.md](development.md).

## API

Settings are read by pydantic-settings from the process environment and from a `.env` file in the working directory (`api/.env` when run from `api/`; template `api/.env.example`). List values are comma-separated. Empty strings for `TIM_AUTH_CLIENT_SECRET` and `TIM_TAG_INGEST_URL` count as unset. Unknown `TIM_*` variables are ignored. Invalid or missing settings stop the api at startup with an error naming each variable (see [operations.md](operations.md#common-failures)).

### Mode and logging

| Variable          | Default      | Required | Description                                                                                                |
| ----------------- | ------------ | -------- | ---------------------------------------------------------------------------------------------------------- |
| `TIM_ENVIRONMENT` | `production` | no       | `development` or `production`. Production refuses `TIM_AUTH_DISABLED=true` and a `memory://` database URL. |
| `TIM_LOG_LEVEL`   | `INFO`       | no       | `CRITICAL`, `ERROR`, `WARNING`, `INFO` or `DEBUG`. Applies to the `tim_api` logger.                        |

### Authentication

See [ADR-0005](decisions/0005-auth-entra-popup-obo.md) for the design.

| Variable                  | Default                             | Required | Description                                                                                                                                                                                          |
| ------------------------- | ----------------------------------- | -------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `TIM_AUTH_TENANT_ID`      | none                                | yes      | Entra tenant (GUID or domain) that issues and validates tokens.                                                                                                                                      |
| `TIM_AUTH_CLIENT_ID`      | none                                | yes      | Client id of the API app registration. The API audience is `api://<client id>`.                                                                                                                      |
| `TIM_AUTH_CLIENT_SECRET`  | unset                               | see note | Client secret for the on-behalf-of (OBO) exchange. When unset, a workload-identity token file is used (`AZURE_FEDERATED_TOKEN_FILE`, below).                                                         |
| `TIM_AUTH_AUTHORITY_HOST` | `https://login.microsoftonline.com` | no       | Authority host, override for sovereign clouds. Must be https.                                                                                                                                        |
| `TIM_AUTH_DISABLED`       | `false`                             | no       | Development only. Skips token validation; every request runs as a fixed dev user. Kusto calls then return 503 because there is no user token to exchange. Refused when `TIM_ENVIRONMENT=production`. |

Note: unless `TIM_AUTH_DISABLED=true`, the api needs an OBO credential at startup: either `TIM_AUTH_CLIENT_SECRET` or `AZURE_FEDERATED_TOKEN_FILE` pointing to a readable file. Without one it fails to start.

### Kusto

| Variable                     | Default                                          | Required | Description                                                                                                                           |
| ---------------------------- | ------------------------------------------------ | -------- | ------------------------------------------------------------------------------------------------------------------------------------- |
| `TIM_KUSTO_OBO_SCOPE`        | `{cluster}/.default`                             | no       | OBO scope template. `{cluster}` is replaced by the cluster base URI.                                                                  |
| `TIM_TAG_CLUSTER_URI`        | none                                             | yes      | https URI of the Kusto cluster that stores tagged events.                                                                             |
| `TIM_TAG_DATABASE`           | `Research`                                       | no       | Database on the tag cluster.                                                                                                          |
| `TIM_TAG_INGEST_URL`         | derived from `TIM_TAG_CLUSTER_URI`               | no       | https ingestion endpoint for tag writes.                                                                                              |
| `TIM_TAG_INGEST_FAKE`        | `false`                                          | no       | Development only. Uses an in-memory fake instead of Kusto ingestion. Ignored unless `TIM_ENVIRONMENT=development`.                    |
| `TIM_ALLOWED_KUSTO_HOSTS` | `**.kusto.windows.net` | no | Comma separated patterns for the Kusto clusters users may query; see [Cluster allow-list](#cluster-allow-list). Unset or blank uses the default. Clusters must be https. Invalid patterns stop the api at startup. |

### Cluster allow-list

`TIM_ALLOWED_KUSTO_HOSTS` is one list of patterns. A cluster host is allowed when it matches any pattern. Patterns are trimmed, lowercased and converted to punycode; one trailing dot is ignored. Matching is on whole labels.

| Pattern kind | Matches | Does not match |
|---|---|---|
| `help.kusto.windows.net` (exact host) | that host only | `a.help.kusto.windows.net` |
| `*.kusto.windows.net` | exactly one label before the domain | `kusto.windows.net`, `a.b.kusto.windows.net` |
| `**.kusto.windows.net` | one or more labels before the domain | `kusto.windows.net` |

| Pattern | Host | Result |
|---|---|---|
| `**.kusto.windows.net` | `help.kusto.windows.net` | match |
| `**.kusto.windows.net` | `contoso.westus2.kusto.windows.net` | match |
| `**.kusto.windows.net` | `kusto.windows.net` | no match (bare domain) |
| `**.kusto.windows.net` | `evilkusto.windows.net` | no match (not a label boundary) |
| `**.kusto.windows.net` | `x.kusto.fabric.microsoft.com` | no match |
| `*.kusto.windows.net` | `help.kusto.windows.net` | match |
| `*.kusto.windows.net` | `contoso.westus2.kusto.windows.net` | no match (two labels) |
| `help.kusto.windows.net` | `help.kusto.windows.net` | match |

A wildcard is allowed only as the whole first label (`*` or `**`) followed by a domain. Bare wildcards, wildcards elsewhere, empty labels, IP addresses, schemes, ports and paths are rejected at startup.

Examples:

```
# Default: public Azure, including regional clusters (<name>.<region>.kusto.windows.net)
TIM_ALLOWED_KUSTO_HOSTS=**.kusto.windows.net
# Public Azure plus Microsoft Fabric
TIM_ALLOWED_KUSTO_HOSTS=**.kusto.windows.net,**.kusto.fabric.microsoft.com
# Locked down: two exact clusters
TIM_ALLOWED_KUSTO_HOSTS=help.kusto.windows.net,contoso.westeurope.kusto.windows.net
```

A set value replaces the default rather than adding to it, so keep `**.kusto.windows.net` in the list when adding other domains. Fabric and sovereign clouds are not in the default; list them explicitly. A host that matches no pattern gives `400 cluster-not-allowed`.

### Storage

See [ADR-0004](decisions/0004-postgresql-persistence.md).

| Variable                          | Default | Required | Description                                                                                                            |
| --------------------------------- | ------- | -------- | ---------------------------------------------------------------------------------------------------------------------- |
| `TIM_DATABASE_URL`                | none    | yes      | `postgresql+asyncpg://user:password@host:5432/db`. `memory://` (data lost on restart) is accepted only in development. |
| `TIM_RUN_RETENTION_SWEEP_SECONDS` | `300`   | no       | Interval of the sweep that deletes expired query runs. Must be greater than 0.                                         |

### HTTP and query-run limits

All numeric values must be greater than 0.

| Variable                    | Default             | Description                                                                                                  |
| --------------------------- | ------------------- | ------------------------------------------------------------------------------------------------------------ |
| `TIM_CORS_ALLOWED_ORIGINS`  | empty               | Allowed origins. With none, no CORS headers are sent (the web container proxies `/api`, so none are needed). |
| `TIM_MAX_REQUEST_BYTES`     | `16777216` (16 MiB) | Largest accepted request body; larger requests get 413.                                                      |
| `TIM_MAX_RESULT_ROWS`       | `100000`            | Row cap for a query result.                                                                                  |
| `TIM_MAX_RESULT_BYTES`      | `67108864` (64 MiB) | Size cap for a query result.                                                                                 |
| `TIM_QUERY_TIMEOUT_SECONDS` | `600`               | Execution time limit of a query run.                                                                         |
| `TIM_RUN_RETENTION_SECONDS` | `86400` (24 h)      | How long a run stays readable.                                                                               |
| `TIM_MAX_CONCURRENT_RUNS`   | `16`                | Runs executing at once per api process; further runs wait in state `created`.                                |

The web container's nginx allows request bodies up to 25 MB and waits up to 620 s for the api, so keep `TIM_QUERY_TIMEOUT_SECONDS` at or below 600 unless `web/docker/nginx.conf.template` is changed.

### Variables outside `TIM_*`

| Variable                                                    | Read by                                     | Description                                                                                                                                                                                                                         |
| ----------------------------------------------------------- | ------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `AZURE_CLIENT_ID`, `AZURE_TENANT_ID`, `AZURE_CLIENT_SECRET` | `azure-identity` (`DefaultAzureCredential`) | App identity for tag ingestion and the `create-tables` command. Other credentials `DefaultAzureCredential` supports (managed or workload identity, Azure CLI login) also work.                                                      |
| `AZURE_FEDERATED_TOKEN_FILE`                                | OBO exchange                                | Path to a workload-identity token file, used as the client assertion when `TIM_AUTH_CLIENT_SECRET` is unset. Re-read on each exchange.                                                                                              |
| `FORWARDED_ALLOW_IPS`                                       | uvicorn                                     | Addresses from which `X-Forwarded-*` headers are trusted (default `127.0.0.1`). Set to the proxy address. `compose.yaml` uses `*`, `deploy/compose.prod.yaml` the compose subnet (`TIM_SUBNET`), the chart `api.forwardedAllowIps`. |

### Test-only variables

| Variable                                                                       | Used by           | Description                                                                                            |
| ------------------------------------------------------------------------------ | ----------------- | ------------------------------------------------------------------------------------------------------ |
| `TIM_TEST_DATABASE_URL`                                                        | `pytest`          | Postgres server for storage tests; falls back to `pgserver`.                                           |
| `TIM_TEST_KUSTO_INGEST_URL`, `TIM_TEST_KUSTO_DATABASE`, `TIM_TEST_KUSTO_TABLE` | `pytest -m kusto` | Real ingest endpoint for the integration test (database default `Research`, table default `EventTag`). |
| `UPDATE_SNAPSHOTS=1`                                                           | `pytest`          | Rewrites OpenAPI snapshots, see [development.md](development.md#api-types).                            |

## Web container

The image (`web/Dockerfile`, nginx on port 8080) renders its configuration at start. `docker-entrypoint.sh` validates these variables, writes `/tmp/tim/config.js` (`window.appConfig = {...}`, served as `/config.js`, never cached) and the nginx configuration `/tmp/tim/nginx.conf`, then starts nginx. The root filesystem can be read-only; only `/tmp` must be writable. A validation failure prints `tim-web: ...` to stderr and the container exits.

| Variable           | Required | Default                                                   | `window.appConfig` key | Description                                                                                              |
| ------------------ | -------- | --------------------------------------------------------- | ---------------------- | -------------------------------------------------------------------------------------------------------- |
| `BACKEND_URI`      | yes      | none                                                      | none (nginx only)      | Where nginx forwards `/api/`: `http(s)://host[:port]`, no path. Trailing slashes are removed.            |
| `REDIRECT_URI`     | yes      | none                                                      | `redirectUri`          | MSAL popup redirect target, `https://<web host>/blank.html`. Register it as a SPA redirect URI in Entra. |
| `AUTH_CLIENT_ID`   | yes      | none                                                      | `auth.clientId`        | Client id of the app registration the SPA signs in with.                                                 |
| `AUTH_TENANT_ID`   | yes      | none                                                      | `auth.authority`       | Tenant GUID or domain; the authority becomes `https://login.microsoftonline.com/<tenant>`.               |
| `TAG_CLUSTER`      | yes      | none                                                      | `tagCluster`           | http(s) URI of the tag cluster.                                                                          |
| `TAG_DATABASE`     | no       | `Research`                                                | `tagDatabase`          | Tag database.                                                                                            |
| `API_BASEPATH`     | no       | empty (same origin)                                       | `apiEndpoint`          | Prefix for API calls. A cross-origin `http(s)://host[:port]` is added to the CSP `connect-src`.          |
| `AGGRID_LICENSE`   | no       | empty                                                     | `agGridLicenseKey`     | AG Grid Enterprise licence key, see [below](#ag-grid-enterprise-licence).                                |
| `HELP_WIKI_URI`    | no       | project wiki (built in)                                   | `wikiUri`              | Target of the help link.                                                                                 |
| `HELP_ISSUE_URI`   | no       | project issue tracker (built in)                          | `issueUri`             | Target of the issue link.                                                                                |
| `DEFAULT_CLUSTERS` | no       | one group `Cluster` from `TAG_CLUSTER` and `TAG_DATABASE` | `defaultClusters`      | JSON array of `{"name": "...", "clusters": ["https://..."], "databases": ["..."]}`.                      |
| `TIM_ENVIRONMENT`  | no       | `production`                                              | none                   | Only validated: must be `development` or `production`.                                                   |
| `NGINX_RESOLVER`   | no       | first nameserver in `/etc/resolv.conf`, else `127.0.0.11` | none                   | DNS resolver nginx uses to resolve `BACKEND_URI`.                                                        |

Empty optional values are left out of `config.js` so the app defaults apply; `agGridLicenseKey` is always written (empty means trial).

The entrypoint also honours `TIM_RUNTIME_DIR` (output directory, default `/tmp/tim`), `TIM_NGINX_TEMPLATE` and `TIM_ENTRYPOINT_DRY_RUN=1` (render the files and exit). They exist for tests: the image serves `/config.js` from and includes `nginx.conf` from `/tmp/tim`, so a different `TIM_RUNTIME_DIR` is only useful when nginx is not started.

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
| `VITE_TAG_CLUSTER`        | `tagCluster` / `TAG_CLUSTER`                                                                                                |
| `VITE_TAG_DATABASE`       | `tagDatabase` / `TAG_DATABASE` (default `Research`)                                                                         |
| `VITE_DEFAULT_CLUSTERS`   | `defaultClusters` / `DEFAULT_CLUSTERS` (JSON)                                                                               |
| `VITE_AUTH_STUB`          | `true` signs in a fixed fake account without Entra. A production build refuses it and shows the configuration error screen. |

### How the SPA merges and validates configuration

1. Each key comes from `window.appConfig`, else from the matching `VITE_*` variable.
2. Empty strings and unsubstituted placeholders such as `$VAR` or `${VAR}` count as missing.
3. The result is validated: `auth.clientId`, `auth.authority`, `redirectUri` and `tagCluster` are required (URLs must be http(s)); `tagDatabase` defaults to `Research`, `apiEndpoint` to same origin (trailing slashes are stripped).
4. On any problem the app renders a configuration error screen listing every missing or invalid key instead of starting.

### AG Grid Enterprise licence

Result grids use AG Grid Enterprise; there is no Community build ([ADR-0006](decisions/0006-ag-grid-enterprise.md)). The licence key is optional.

- Container: `AGGRID_LICENSE` (Compose `.env`, or the Helm Secret key of the same name) becomes `agGridLicenseKey` in `/config.js`. Development: `VITE_AGGRID_LICENSE_KEY`, or `agGridLicenseKey` in `web/public/config.js`.
- When a key is set, the SPA applies it at startup with `LicenseManager.setLicenseKey`.
- When no key is set, the grid runs in AG Grid's trial mode: a watermark over the grid and a licence notice in the browser console. The entrypoint logs `tim-web: AGGRID_LICENSE not set, AG Grid Enterprise runs in trial mode` once at start.
- The key is served in `config.js`, so every user of the SPA can read it. Changing it needs a container restart.

## Compose `.env`

### Development stack

`docker compose` reads `.env` at the repo root (template `.env.example`, git-ignored). Every variable has a default inside `compose.yaml`, so the file is optional. The template lists only the first group below; the pass-throughs in the second group can be added to `.env` when needed.

| Variable                                            | Default                                                    | Used for                                                                 |
| --------------------------------------------------- | ---------------------------------------------------------- | ------------------------------------------------------------------------ |
| `POSTGRES_USER`, `POSTGRES_PASSWORD`, `POSTGRES_DB` | `tim`, `tim`, `tim`                                        | PostgreSQL container; the api's `TIM_DATABASE_URL` is built from them.   |
| `POSTGRES_PORT`                                     | `5432`                                                     | Host port, bound to `127.0.0.1`.                                         |
| `API_PORT`                                          | `8080`                                                     | Host port of `api`.                                                      |
| `WEB_PORT`                                          | `8081`                                                     | Host port of `web`.                                                      |
| `TIM_AUTH_DISABLED`                                 | `true`                                                     | Passed to `migrate` and `api`.                                           |
| `TIM_LOG_LEVEL`                                     | `INFO`                                                     | Passed to `migrate` and `api`.                                           |
| `TIM_AUTH_TENANT_ID`, `TIM_AUTH_CLIENT_ID`          | all-zero GUID                                              | Passed to the api and, as `AUTH_TENANT_ID` / `AUTH_CLIENT_ID`, to `web`. |
| `TIM_TAG_CLUSTER_URI`, `TIM_TAG_DATABASE`           | `https://example.westeurope.kusto.windows.net`, `Research` | Passed to the api and, as `TAG_CLUSTER` / `TAG_DATABASE`, to `web`.      |
| `REDIRECT_URI`                                      | `http://localhost:8081/blank.html`                         | Passed to `web`. Must match `WEB_PORT`.                                  |
| `AGGRID_LICENSE`                                    | empty                                                      | Passed to `web`.                                                         |

Further pass-throughs, not in `.env.example`:

| Variable                                              | Default | Used for                                                                                    |
| ----------------------------------------------------- | ------- | ------------------------------------------------------------------------------------------- |
| `TIM_AUTH_CLIENT_SECRET`                              | empty   | Passed to `migrate` and `api`. Needed only with `TIM_AUTH_DISABLED=false` (OBO credential). |
| `TIM_ALLOWED_KUSTO_HOSTS`                             | empty   | Passed to `migrate` and `api`. Empty uses the api default.                                  |
| `HELP_WIKI_URI`, `HELP_ISSUE_URI`, `DEFAULT_CLUSTERS` | empty   | Passed to `web`.                                                                            |

Compose sets `TIM_ENVIRONMENT=development` for all services, `BACKEND_URI=http://api:8080` for `web` and `FORWARDED_ALLOW_IPS=*` for the api; these do not come from `.env`. `TIM_CORS_ALLOWED_ORIGINS` is not passed by the dev stack.

### Production stack

`deploy/compose.prod.yaml` reads `deploy/.env` (template `deploy/.env.example`, passed with `--env-file`). Variables marked required stop `docker compose` with the message `set <NAME>` when unset. The procedure is in [deployment.md](deployment.md#docker-compose).

| Variable                                              | Required | Default                       | Used for                                                                                       |
| ----------------------------------------------------- | -------- | ----------------------------- | ---------------------------------------------------------------------------------------------- |
| `PUBLIC_URL`                                          | yes      | none                          | Public origin without trailing slash; `web` gets `REDIRECT_URI=${PUBLIC_URL}/blank.html`.      |
| `POSTGRES_PASSWORD`                                   | yes      | none                          | PostgreSQL container and the api's `TIM_DATABASE_URL`.                                         |
| `POSTGRES_USER`, `POSTGRES_DB`                        | no       | `tim`, `tim`                  | Same.                                                                                          |
| `TIM_AUTH_TENANT_ID`, `TIM_AUTH_CLIENT_ID`            | yes      | none                          | Passed to the api and, as `AUTH_TENANT_ID` / `AUTH_CLIENT_ID`, to `web`.                       |
| `TIM_AUTH_CLIENT_SECRET`                              | yes      | none                          | Passed to `migrate` and `api`. See the note below.                                             |
| `TIM_TAG_CLUSTER_URI`                                 | yes      | none                          | Passed to the api and, as `TAG_CLUSTER`, to `web`.                                             |
| `TIM_TAG_DATABASE`                                    | no       | `Research`                    | Passed to the api and, as `TAG_DATABASE`, to `web`.                                            |
| `TIM_ALLOWED_KUSTO_HOSTS`, `TIM_CORS_ALLOWED_ORIGINS` | no       | empty                         | Passed to `migrate` and `api`.                                                                 |
| `TIM_LOG_LEVEL`                                       | no       | `INFO`                        | Passed to `migrate` and `api`.                                                                 |
| `AGGRID_LICENSE`                                      | no       | empty                         | Passed to `web`. Empty runs AG Grid Enterprise in trial mode.                                  |
| `HELP_WIKI_URI`, `HELP_ISSUE_URI`, `DEFAULT_CLUSTERS` | no       | empty                         | Passed to `web`.                                                                               |
| `WEB_PORT`                                            | no       | `8080`                        | Host port of `web`, the only published port.                                                   |
| `TIM_SUBNET`                                          | no       | `10.89.0.0/24`                | Subnet of the compose network.                                                                 |
| `FORWARDED_ALLOW_IPS`                                 | no       | `TIM_SUBNET`                  | Addresses from which the api trusts `X-Forwarded-*`.                                           |
| `TIM_API_IMAGE`, `TIM_WEB_IMAGE`, `TIM_IMAGE_TAG`     | no       | `tim-api`, `tim-web`, `local` | Image names and tag. The defaults are the local build names; set them to run published images. |

`TIM_ENVIRONMENT=production`, `BACKEND_URI=http://api:8080` and the other fixed values are set in the compose file.

`TIM_AUTH_CLIENT_SECRET` is required by the production compose file because the api does not start without an OBO credential: either `TIM_AUTH_CLIENT_SECRET` or a readable `AZURE_FEDERATED_TOKEN_FILE`, and compose provides no token file.

## Helm

The chart in `deploy/helm/tim` sets the same variable names; the install procedure, the full values reference and workload identity are in [deployment.md](deployment.md#kubernetes-helm).

- Non-secret variables come from two ConfigMaps (api and web), rendered from values: `config.environment` (`TIM_ENVIRONMENT`), `config.auth.tenantId` / `clientId`, `config.tags.clusterUri` / `database`, `api.logLevel` (`TIM_LOG_LEVEL`), `api.allowedKustoHosts` (`TIM_ALLOWED_KUSTO_HOSTS`; an empty list gives the api default), `api.corsAllowedOrigins`, `api.forwardedAllowIps` (`FORWARDED_ALLOW_IPS`), `web.helpWikiUri`, `web.helpIssueUri`, `web.defaultClusters` (rendered as JSON) and `web.apiBasePath` (`API_BASEPATH`). `REDIRECT_URI` is `config.publicUrl` (default `https://<ingress.host>`) plus `/blank.html`, and `BACKEND_URI` is the api Service address.
- Sensitive variables come from one Secret whose keys are the variable names: `TIM_DATABASE_URL` (required), `TIM_AUTH_CLIENT_SECRET` (optional) and `AGGRID_LICENSE` (optional), plus `POSTGRES_PASSWORD` with the in-cluster PostgreSQL. Either the chart creates it from `secrets.databaseUrl`, `secrets.authClientSecret` and `secrets.agGridLicense`, or `secrets.existingSecret` names a Secret you manage (then the chart creates none). The api reads `TIM_AUTH_CLIENT_SECRET` and the web container reads `AGGRID_LICENSE` as optional keys; when a key is absent the variable is not set.
- Any other api variable (`TIM_MAX_RESULT_ROWS`, `TIM_QUERY_TIMEOUT_SECONDS`, `AZURE_CLIENT_ID`, ...) is set through `api.extraEnv` / `api.extraEnvFrom`, and web variables through `web.extraEnv` / `web.extraEnvFrom`.
- OBO credential: the chart does not require `TIM_AUTH_CLIENT_SECRET` the way production compose does. In production mode rendering fails unless a client secret is supplied (`secrets.authClientSecret` or an existing Secret) or Entra workload identity is enabled (`api.podLabels` `azure.workload.identity/use: "true"`). With workload identity, the webhook injects `AZURE_FEDERATED_TOKEN_FILE` into the api pod and the api uses it when `TIM_AUTH_CLIENT_SECRET` is unset.
