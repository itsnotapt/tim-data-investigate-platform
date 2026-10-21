# Operations

Runbook for a running TIM deployment: health, logs, routine tasks and failure diagnosis. Variable details are in [configuration.md](configuration.md); deploying is covered in [deployment.md](deployment.md).

## Health checks

| Component | Endpoint                             | Response                | Meaning                                                                                              |
| --------- | ------------------------------------ | ----------------------- | ---------------------------------------------------------------------------------------------------- |
| api       | `GET /api/healthChecks/liveness`     | `204`                   | The process answers. No dependencies are checked.                                                    |
| api       | `GET /api/healthChecks/readiness`    | `204` or `503`          | `503` when the storage (PostgreSQL) health check fails or raises. Kusto reachability is not checked. |
| web       | `GET /healthz`                       | `200` body `ok`         | nginx is serving. Not logged in the access log. Does not check the api.                              |

Container health checks (every 30 s, timeout 5 s, 3 retries):

- api image: Python `urlopen` against `http://127.0.0.1:8080/api/healthChecks/liveness` (start period 15 s).
- web image: `wget` against `http://127.0.0.1:8080/healthz` (start period 5 s).

On Kubernetes the chart's probes use these same paths: api liveness `/api/healthChecks/liveness` and readiness `/api/healthChecks/readiness`, web liveness and readiness `/healthz` (the image `HEALTHCHECK`s are not used by Kubernetes). A pod that fails readiness is removed from the Service endpoints; `helm test <release> --logs` checks `/healthz`, `/config.js` and the api readiness through web.

Use readiness, not liveness, to decide whether the api can take traffic. Through the web container, the api endpoints are also reachable under `/api/healthChecks/...`.

## Logs

All services log to stdout and stderr; collect them with the container runtime. On Kubernetes use `kubectl -n <namespace> logs deploy/<release>-tim-api` (and `deploy/<release>-tim-web`), or `kubectl logs -l app.kubernetes.io/component=api --tail=200` to read across replicas. Add `--previous` for a crashed container. Resource names are `<release>-tim-...` unless the release name already contains `tim` or `fullnameOverride` is set; see [deployment.md](deployment.md#kubernetes-helm).

### api

Logger `tim_api` (child loggers such as `tim_api.retention`), level from `TIM_LOG_LEVEL`, one line format:

```
2026-10-06 09:30:12,345 INFO tim_api GET /api/healthChecks/readiness -> 204 1.2ms traceId=00-4bf92f3577b34da6a3ce929d0e0e4736-00f067aa0ba902b7-01
```

- Every request logs one line `METHOD path -> status duration traceId=<id>`. The path has no query string; headers and bodies are never logged. Control characters in paths are escaped.
- The trace id is the request's W3C `traceparent` if valid, else a valid `x-request-id` header (letters, digits, `.`, `_`, `-`, up to 128 characters), else a generated `traceparent`-shaped value.
- The id is returned in the `x-trace-id` response header, and error bodies (`application/problem+json`) carry it as `traceId`. To investigate a user-reported error, take the `traceId` from the error response or the browser network tab and search the api log for it. Unhandled exceptions log `Unhandled exception traceId=... method=... path=...` with a stack trace.
- Other notable lines: `AUTHENTICATION IS DISABLED` warning at startup (must never appear in production), `Retention sweep deleted N expired query run(s)`, `Marked N interrupted query run(s) as error`, `OBO exchange failed (...)` / `OBO exchange rejected: error=... scope=...` (token exchange problems).

### web

nginx writes its standard access and error logs to the container's stdout and stderr. The entrypoint prints `tim-web: ...` messages before nginx starts: a note when `AGGRID_LICENSE` is unset, or the reason it refuses to start.

### Metrics

There is no metrics endpoint. Use the request log lines and health endpoints.

## Common tasks

### Run database migrations

The api never creates or changes tables on its own; a new or upgraded database must be migrated before the api can serve requests that use it.

- Compose: the one-shot `migrate` service runs `alembic upgrade head`; `api` starts after it succeeds. Rerun with `docker compose up migrate`.
- Kubernetes (Helm): the chart runs the migrations as a Job, `<release>-tim-migrate` (`<fullname>-migrate`), using the api image and only `TIM_DATABASE_URL` from the release Secret. It is a Helm hook with weight 0 and delete policy `before-hook-creation`, and Helm waits for it to finish before the install or upgrade completes:
  - external database: `pre-install,pre-upgrade`, so the schema is current before the api Deployment is created or rolled out;
  - in-cluster PostgreSQL (`postgresql.enabled`): `post-install,pre-upgrade`, because the database does not exist before an install. An init container waits until PostgreSQL accepts connections. On a first install the api pods start alongside PostgreSQL and pass readiness before the schema exists; until the database is up and migrated they log non-fatal `Stale query-run sweep failed`, `Stale run sweep failed` and `Retention sweep failed` tracebacks (database unavailable), and requests that use the database fail.
  - `migrations.enabled: false` omits the Job; migrate by other means then.
- Elsewhere: run the api image with the command `alembic upgrade head` (`alembic.ini` and `migrations/` are in `/app`) and `TIM_DATABASE_URL` set. Alembic reads only `TIM_DATABASE_URL` from the process environment.
- From a checkout: `cd api && uv run alembic upgrade head`. Check the current revision with `alembic current`.

On Kubernetes the Job retries a failed pod up to `migrations.backoffLimit` times (default 3) and is stopped after `migrations.activeDeadlineSeconds` (default 600). When it fails, the hook fails, so `helm install` or `helm upgrade` reports an error and the api is not rolled out (on upgrade the running pods keep the previous version). Read the output with:

```bash
kubectl -n <namespace> logs job/<release>-tim-migrate
kubectl -n <namespace> get pods -l app.kubernetes.io/component=migrate
```

Fix the cause (usually an unreachable or wrong `TIM_DATABASE_URL`) and run `helm upgrade` again: the Job is recreated by the next hook run. The Job object is removed `migrations.ttlSecondsAfterFinished` seconds (default 3600) after it finishes, so read its logs before then. To migrate without a chart upgrade, run `alembic upgrade head` in a pod of the api image (for example `kubectl exec deploy/<release>-tim-api -- alembic upgrade head`).

### Create the Kusto tag tables

Tagged events are stored in Kusto tables in `TIM_TAG_DATABASE` on `TIM_TAG_CLUSTER_URI`. Create them once per database (idempotent, safe to repeat):

```bash
cd api
python -m tim_api.tagged_events.cli create-tables --dry-run     # print the commands only
python -m tim_api.tagged_events.cli create-tables               # apply
# options: --cluster-uri <https://...> (default TIM_TAG_CLUSTER_URI), --database <name> (default TIM_TAG_DATABASE or Research)
```

In the api image use `python -m tim_api.tagged_events.cli create-tables` with the api's environment. From a checkout prefix with `uv run`.

The command runs `.create-merge table`, `.create-or-alter table ... ingestion json mapping` and `.alter table ... policy streamingingestion enable` for each tag table. It authenticates with `DefaultAzureCredential` (`AZURE_CLIENT_ID` / `AZURE_TENANT_ID` / `AZURE_CLIENT_SECRET`, workload or managed identity, or an Azure CLI login). The identity needs permission to run these management commands on the database, which in Kusto means database admin (or table admin on the tag tables). At runtime tag writes use the same credential chain and need ingest rights on the tag tables. On failure the command prints the failing command and error and exits non-zero (`2` when no cluster URI is given).

### `tim-api check`

The api image runs the startup validation of its providers and an action files directory without a database, credentials or other settings:

```bash
docker run --rm -v "$PWD/actions:/actions:ro" <api image> tim-api check --actions /actions
docker run --rm <api image> tim-api schema actions > action-file.schema.json
```

`check` prints `OK: <n> actions` and exits 0, or prints `Invalid actions:` and the same problems startup would report, one per line, and exits 1. A `--actions` path that isn't a directory exits 2. Without `--actions` it checks the installed providers and their package data only. From a checkout, run `uv run tim-api check --actions <dir>` in `api/`. Use the image you deploy: the action types a file may name are the ones installed in it. Writing files and the schema: [actions.md](actions.md#checking-files).

### Query run retention and cleanup

These apply to runs (`/api/runs`) and query runs (`/api/kusto/query`) alike.

- Each run has an expiry (`TIM_RUN_RETENTION_SECONDS`, default 24 h), refreshed when it finishes. An expired run is treated as not found immediately.
- A background task deletes expired runs every `TIM_RUN_RETENTION_SWEEP_SECONDS` (default 300 s) and logs the count. Runs, with their rows, go ten at a time, so no single delete holds locks for long; then the expired query runs go. A failed sweep is logged with a stack trace and retried at the next interval.
- At api startup, runs still `running` (query runs still `created`) that started more than `TIM_RUN_TIMEOUT_SECONDS` ago, left behind by a restart or crash, are set to `error` with the message `Run interrupted by server restart`, and a warning logs the count.
- At shutdown, runs in flight are stopped and set to `error` the same way. A run's action keeps running in its thread until the process exits, but its rows are no longer stored.
- A run that doesn't succeed has its rows deleted when it ends, so only succeeded runs hold rows.

### Rows lost after a crash

A run's rows are in the `UNLOGGED` table `run_rows`, which isn't written to the WAL. After PostgreSQL crashes or fails over to a replica, `run_rows` is empty while `runs` is intact. Rows of succeeded runs then answer `410 results-gone`, and the analyst runs the action again. Nothing needs repairing: the runs expire as usual. A clean PostgreSQL shutdown and restart keeps the rows. Physical backups (`pg_basebackup`) and streaming replicas don't hold them either.

### Tune limits

Change the `TIM_MAX_*`, `TIM_RUN_TIMEOUT_SECONDS`, `TIM_ROWS_PAGE_SIZE` and `TIM_RUN_RETENTION_*` variables on the api and restart it (see [configuration.md](configuration.md#http-and-run-limits)).

| Symptom                                      | Variable                                  |
| -------------------------------------------- | ----------------------------------------- |
| Runs fail with `Result exceeds limit of …`   | `TIM_MAX_RESULT_ROWS`, `TIM_MAX_RESULT_BYTES`. Query runs (`/api/kusto/query`) stay capped at 100,000 rows and 64 MiB whatever these say. Bigger results need more database space and more memory in the browser |
| Runs stopped at the time limit               | `TIM_RUN_TIMEOUT_SECONDS` (nginx waits 620 s; raising it above 600 also needs a change to `web/docker/nginx.conf.template`) |
| Runs stay `running` (query runs `created`) under heavy use | `TIM_MAX_CONCURRENT_RUNS` (per api process, shared by runs and query runs) |
| Row pages are slow or large                  | `TIM_ROWS_PAGE_SIZE`                      |
| `413` on requests                            | `TIM_MAX_REQUEST_BYTES` (nginx caps bodies at 25 MB) |

### Rotate secrets and keys

All configuration is read at process start, so each change needs a restart of the container. On Kubernetes, pods restart on their own when the chart's ConfigMaps or chart-created Secret change at `helm upgrade`; a Secret you manage (`secrets.existingSecret`) is not watched, so run `kubectl -n <namespace> rollout restart deploy/<release>-tim-api` (or `-web`) after changing it.

| Item                          | Where                                                  | Restart |
| ----------------------------- | ------------------------------------------------------ | ------- |
| OBO client secret             | `TIM_AUTH_CLIENT_SECRET` on the api                    | api     |
| Workload-identity token       | `AZURE_FEDERATED_TOKEN_FILE` content is re-read on each exchange | none, unless the path changes |
| Database password             | `TIM_DATABASE_URL` on the api (and the database)       | api     |
| AG Grid licence key           | `AGGRID_LICENSE` on the web container                  | web     |
| Any other web setting         | web container variables                                | web     |

Browsers fetch `/config.js` uncached, so users receive web changes on their next page load.

## Startup failures from the files

The api reads the action files once, at startup: its providers' package data and `TIM_ACTIONS_DIR`. Any problem stops it before it serves, so in a rolling update the new pods never become ready and the old ones keep serving. The api exits with `Invalid actions:` and one line per problem, every problem at once:

```
Invalid actions:
  - /srv/tim/actions/identity.yaml:7: type: unknown action type 'kql_querry' (installed action types: rows)
  - /srv/tim/actions/identity.yaml:14: params[0].from_column: Unexpected keyword argument
  - /srv/tim/actions/sign-ins.yaml:3: key: duplicate action key acme.users, also in /srv/tim/actions/identity.yaml:2
```

Each line names the file, the line and the field. Fix the file, check it with [`tim-api check`](#tim-api-check) against the image you deploy, and roll out again.

| Problem | Cause and fix |
| ------- | ------------- |
| `unknown action type` | The `type` is misspelt, or the provider that adds it isn't installed in this image. The message lists the installed types. |
| `Unexpected keyword argument`, `Extra inputs are not permitted` | A misspelt or unknown field. `tim-api schema actions` lists the fields each type takes. |
| `no file <name> next to the action file` | A `<field>_file:` sidecar is missing. It must be a file name in the same directory as the action file. |
| `duplicate action key` | Two actions share a key, in two files or a file and an installed provider. Keys are unique across the instance. |
| `not valid YAML` | The file doesn't parse; the line is where the parser stopped, which can be after the mistake. |
| `TIM_ACTIONS_DIR: invalid (Value error, no directory ...)` | `TIM_ACTIONS_DIR` names a path that isn't a directory. The api exits with `Invalid configuration:`. |

## Common failures

| Symptom                                                  | Cause and fix                                                                                                                                                         |
| -------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| api exits at startup with `Invalid configuration:` and lines like `- TIM_AUTH_TENANT_ID: missing (...)` | A required `TIM_*` variable is missing or invalid; the message names each one (never the value). Common: `TIM_DATABASE_URL` not `postgresql+asyncpg://`, a non-https `TIM_TAG_CLUSTER_URI`, `TIM_AUTH_DISABLED=true` with `TIM_ENVIRONMENT=production`. |
| api exits at startup with `Invalid actions:`             | A provider or an action file has a problem; see [Startup failures from the files](#startup-failures-from-the-files). |
| api exits at startup about the OBO credential            | Neither `TIM_AUTH_CLIENT_SECRET` nor a readable `AZURE_FEDERATED_TOKEN_FILE` is set (the message says which).                                                          |
| api starts but requests fail with database errors; `/api/healthChecks/readiness` returns `503`; problem responses say "Service unavailable" | PostgreSQL is down or unreachable (or the schema is not migrated; run the migrations). The connection pool checks connections before use, so the api serves again once the database is back.                 |
| Every API call returns 401                               | Token rejected: wrong `TIM_AUTH_TENANT_ID` / `TIM_AUTH_CLIENT_ID` (audience `api://<client id>`), or an expired token.                                                |
| Kusto calls return `403` with title "Consent or sign-in is required for the downstream service" (`consent-required`) | The OBO exchange was refused (`invalid_grant` / `interaction_required`): the user or tenant has not consented to the API's Kusto permission, or MFA or conditional access needs interaction. The SPA prompts the user to sign in again; if it persists, grant admin consent on the API app registration. |
| Kusto calls return `403` "Access to the Kusto database was denied" | The signed-in user has no rights on that cluster or database.                                                                                              |
| Kusto calls return `502` "identity provider could not be reached" | The OBO exchange failed for another reason (network to Entra, misconfigured secret). The api log has `OBO exchange failed` or `OBO exchange rejected: error=...`.   |
| Kusto calls return `503` "Token exchange is not available" | The api runs with `TIM_AUTH_DISABLED=true`.                                                                                                                         |
| Tag writes return `502` "Tag ingestion failed"           | Ingest endpoint unreachable, tables missing (run `create-tables`), or the app identity lacks ingest rights.                                                            |
| Query rejected with `400` "The cluster is not allowed"   | Cluster is not https, or its host matches no pattern in `TIM_ALLOWED_KUSTO_HOSTS`. Regional clusters (`<name>.<region>.kusto.windows.net`) need a `**.` pattern; Fabric needs `**.kusto.fabric.microsoft.com`.                                                                    |
| Web container exits immediately: `tim-web: missing required environment variable(s): ...` | Set `BACKEND_URI`, `REDIRECT_URI`, `AUTH_CLIENT_ID`, `AUTH_TENANT_ID`, `TAG_CLUSTER`. Other `tim-web:` messages name an invalid value (`BACKEND_URI` with a path, bad `DEFAULT_CLUSTERS` JSON, bad `API_BASEPATH`, and so on). |
| Browser shows the configuration error screen             | `/config.js` has missing or invalid keys; the screen lists each one. Check the web container variables and that `/config.js` is not served from a stale cache or proxy.  |
| Sign-in popup fails with a redirect error                | `REDIRECT_URI` (`https://<host>/blank.html`) is not registered as a SPA redirect URI on the app registration.                                                          |
| `502` from `/api/...` on the web host                    | nginx cannot reach `BACKEND_URI` (name does not resolve, api down). Check the api container and `NGINX_RESOLVER`.                                                      |
| Grid shows a watermark                                   | No `AGGRID_LICENSE` set or the key is invalid; see [AG Grid Enterprise licence](configuration.md#ag-grid-enterprise-licence).                                          |
