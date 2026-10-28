# Operations

Runbook for a running TIM deployment: health, logs, routine tasks and failure diagnosis.

- Variable details are in [configuration.md](configuration.md).
- Deploying is covered in [deployment.md](deployment.md).

## Health checks

| Component | Endpoint                             | Response                | Meaning                                                                                              |
| --------- | ------------------------------------ | ----------------------- | ---------------------------------------------------------------------------------------------------- |
| api       | `GET /api/healthChecks/liveness`     | `204`                   | The process answers. No dependencies are checked.                                                    |
| api       | `GET /api/healthChecks/readiness`    | `204` or `503`          | `503` when the storage (PostgreSQL) health check fails or raises. Kusto reachability is not checked. |
| web       | `GET /healthz`                       | `200` body `ok`         | nginx is serving. Not logged in the access log. Does not check the api.                              |

Container health checks (every 30 s, timeout 5 s, 3 retries):

- api image: Python `urlopen` against `http://127.0.0.1:8080/api/healthChecks/liveness` (start period 15 s).
- web image: `wget` against `http://127.0.0.1:8080/healthz` (start period 5 s).

On Kubernetes, the chart's probes use the same paths. Kubernetes doesn't use the image `HEALTHCHECK`s.

- api liveness: `/api/healthChecks/liveness`.
- api readiness: `/api/healthChecks/readiness`.
- web liveness and readiness: `/healthz`.

A pod that fails readiness is removed from the Service endpoints. `helm test <release> --logs` checks `/healthz`, `/config.js` and the api readiness, through web.

Use readiness, not liveness, to decide whether the api can take traffic. Through the web container, the api endpoints are also reachable under `/api/healthChecks/...`.

## Logs

All services log to stdout and stderr. Collect them with the container runtime.

On Kubernetes:

- `kubectl -n <namespace> logs deploy/<release>-tim-api` reads the api, and `deploy/<release>-tim-web` the web container.
- `kubectl logs -l app.kubernetes.io/component=api --tail=200` reads across replicas.
- Add `--previous` for a crashed container.
- Resource names are `<release>-tim-...`, unless the release name already contains `tim` or `fullnameOverride` is set; see [deployment.md](deployment.md#kubernetes-helm).

### api

The logger is `tim_api`, with child loggers such as `tim_api.retention`. Its level comes from `TIM_LOG_LEVEL`. Every line has one format:

```
2026-10-06 09:30:12,345 INFO tim_api GET /api/healthChecks/readiness -> 204 1.2ms traceId=00-4bf92f3577b34da6a3ce929d0e0e4736-00f067aa0ba902b7-01
```

- **Requests:** every request logs one line, `METHOD path -> status duration traceId=<id>`.
  - The path has no query string. Headers and bodies are never logged.
  - Control characters in paths are escaped.
- **Trace id:** the request's W3C `traceparent` if valid, else a valid `x-request-id` header (letters, digits, `.`, `_`, `-`, up to 128 characters), else a generated `traceparent`-shaped value.
  - The id is returned in the `x-trace-id` response header.
  - Error bodies (`application/problem+json`) carry it as `traceId`.
  - To investigate a user-reported error, take the `traceId` from the error response or the browser network tab, and search the api log for it.
- **Unhandled exceptions** log `Unhandled exception traceId=... method=... path=...`, with a stack trace.
- **Other notable lines:**
  - `AUTHENTICATION IS DISABLED`: a warning at startup. It must never appear in production;
  - `Retention sweep deleted N expired run(s)`;
  - `Marked N interrupted run(s) as error`;
  - `OBO exchange failed (...)` and `OBO exchange rejected: error=... scope=...`: token exchange problems;
  - `Action <key> left out: ...`: an info line at startup, for each action that has no connection to run on.

### web

nginx writes its standard access and error logs to the container's stdout and stderr.

The entrypoint prints `tim-web: ...` messages before nginx starts:

- a note when `AGGRID_LICENSE` is unset;
- or the reason it refuses to start.

### Metrics

There is no metrics endpoint. Use the request log lines and health endpoints.

## Common tasks

### Run database migrations

The api never creates or changes tables on its own. A new or upgraded database must be migrated before the api can serve requests that use it.

- **Compose:** the one-shot `migrate` service runs `alembic upgrade head`. `api` starts after it succeeds. Rerun it with `docker compose up migrate`.
- **Kubernetes (Helm):** the chart runs the migrations as a Job, `<release>-tim-migrate` (`<fullname>-migrate`).
  - It uses the api image, and only `TIM_DATABASE_URL` from the release Secret.
  - It is a Helm hook, with weight 0 and delete policy `before-hook-creation`.
  - Helm waits for it to finish before the install or upgrade completes.
  - With an external database, it runs `pre-install,pre-upgrade`. So the schema is current before the api Deployment is created or rolled out.
  - With in-cluster PostgreSQL (`postgresql.enabled`), it runs `post-install,pre-upgrade`, because the database does not exist before an install. An init container waits until PostgreSQL accepts connections.
  - `migrations.enabled: false` omits the Job. Migrate by other means then.
- **Elsewhere:** run the api image with the command `alembic upgrade head`, and `TIM_DATABASE_URL` set.
  - `alembic.ini` and `migrations/` are in `/app`.
  - Alembic reads only `TIM_DATABASE_URL` from the process environment.
- **From a checkout:** `cd api && uv run alembic upgrade head`. Check the current revision with `alembic current`.

On a first install with in-cluster PostgreSQL, the api pods start alongside PostgreSQL, and pass readiness before the schema exists. Until the database is up and migrated:

- they log non-fatal `Stale run sweep failed` and `Retention sweep failed` tracebacks (database unavailable);
- requests that use the database fail.

On Kubernetes, the Job retries a failed pod up to `migrations.backoffLimit` times (default 3). It is stopped after `migrations.activeDeadlineSeconds` (default 600).

- When it fails, the hook fails. So `helm install` or `helm upgrade` reports an error, and the api is not rolled out.
- On upgrade, the running pods keep the previous version.

Read the output with:

```bash
kubectl -n <namespace> logs job/<release>-tim-migrate
kubectl -n <namespace> get pods -l app.kubernetes.io/component=migrate
```

Then:

- Fix the cause, usually an unreachable or wrong `TIM_DATABASE_URL`.
- Run `helm upgrade` again. The next hook run recreates the Job.
- The Job object is removed `migrations.ttlSecondsAfterFinished` seconds (default 3600) after it finishes. Read its logs before then.

To migrate without a chart upgrade, run `alembic upgrade head` in a pod of the api image. For example: `kubectl exec deploy/<release>-tim-api -- alembic upgrade head`.

### `tim-api check`

The api image runs the startup validation of its providers, an action files directory, a connections file and a labels file. It needs no database, credentials or other settings:

```bash
docker run --rm -v "$PWD/actions:/actions:ro" <api image> tim-api check --actions /actions
docker run --rm -v "$PWD/connections.yaml:/connections.yaml:ro" <api image> tim-api check --connections /connections.yaml
docker run --rm -v "$PWD/labels.yaml:/labels.yaml:ro" <api image> tim-api check --labels /labels.yaml
docker run --rm <api image> tim-api schema actions > action-file.schema.json
docker run --rm <api image> tim-api schema connections > connections.schema.json
docker run --rm <api image> tim-api schema labels > labels.schema.json
```

`check` ends in one of three ways:

- **Valid:** it prints one line for each action left out of the catalogue, such as `Action tim.run_kql left out: no kusto connection for its connection param`. Then it prints `OK: <n> actions, <m> connections, <k> labels`, and exits 0.
- **Invalid:** it prints `Invalid instance:` and the same problems startup would report, one per line, and exits 1.
- **Bad path:** a `--actions` path that isn't a directory, or a `--connections` or `--labels` path that isn't a file, exits 2.

Options and use:

- Without `--actions`, it checks only the installed providers and their package data.
- Without `--connections`, the instance has no connections.
- Without `--labels`, the instance has the default labels.
- From a checkout, run `uv run tim-api check --actions <dir>` in `api/`.
- Use the image you deploy. The action types a file may name are the ones installed in it.

Writing files and the schema: [actions.md](actions.md#checking-files).

### The change feed

The change feed carries annotations ([architecture.md](architecture.md#annotations-and-the-change-feed)) to every open browser, so a label set by one analyst shows in the others.

- **What it is.** `GET /api/annotations/changes?since=V` returns the `id`s changed after version `V`, as they now are, 1,000 or more at a time.
- **Versions.** Each change to annotations takes the next number from a one-row counter, `annotation_clock`, so the versions are gapless and in commit order. Writers queue on that row, which is fine for changes made by analysts.
- **Polling cost.**
  - Each browser reads the feed every `TIM_ANNOTATION_POLL_SECONDS` (30), when its window gets focus, and soon after the analyst's own change.
  - A read with nothing new is one indexed query and a body of a few bytes.
  - Many tabs of one browser cost one poller: the tab holding a Web Lock reads, and tells the others.
  - So the load is one request per open browser per interval. Raise the interval to lower it. Labels then reach other analysts later.
- **Tombstones.** An `id` whose annotations are all removed keeps its row in `id_state`, with no label, so the removal reaches other browsers. Rows are never deleted, and nothing needs cleaning up.
- **History.** `label_changes` keeps every label change with who made it and when. `comments` keeps each analyst's current comment on an `id`, with its author and time; a replaced comment, a cleared comment and removed tags are deleted.
- **Cursors.** A browser keeps its place in its own IndexedDB. A new browser, or one with its site data cleared, reads the whole feed once.
- **The labels file.** Check a file with `tim-api check --labels <file>`, and print its JSON Schema with `tim-api schema labels` ([`tim-api check`](#tim-api-check)). Stored labels keep the `key` they were set with. A key that is later taken out of the file shows grey in the grid, and can still be cleared or replaced.

### Run retention and cleanup

- **Expiry:** each run has an expiry (`TIM_RUN_RETENTION_SECONDS`, default 24 h), refreshed when it finishes. An expired run is treated as not found immediately.
- **Sweep:** a background task deletes expired runs every `TIM_RUN_RETENTION_SWEEP_SECONDS` (default 300 s), and logs the count.
  - Runs, with their rows, go ten at a time, so no single delete holds locks for long.
  - A failed sweep is logged with a stack trace, and retried at the next interval.
- **Stale run sweep:** a restart or crash leaves runs behind. Each process refreshes the heartbeat of the runs it executes every second.
  - Runs still `running` with a heartbeat older than 15 s are set to `error`, with the message `Run interrupted by server restart`, and their rows are deleted.
  - Every process sweeps at startup and then every 30 s.
  - A warning logs the count.
  - A failed sweep is logged with a stack trace, and retried at the next interval.
- **Shutdown:** runs in flight are stopped, and set to `error` the same way. A run's action keeps running in its thread until the process exits, but its rows are no longer stored.
- A run that doesn't succeed has its rows deleted when it ends, so only succeeded runs hold rows.

### Rows lost after a crash

A run's rows are in the `UNLOGGED` table `run_rows`, which isn't written to the WAL.

- After PostgreSQL crashes or fails over to a replica, `run_rows` is empty, while `runs` is intact.
- Rows of succeeded runs then answer `410 results-gone`, and the analyst runs the action again.
- Nothing needs repairing. The runs expire as usual.
- A clean PostgreSQL shutdown and restart keeps the rows.
- Physical backups (`pg_basebackup`) and streaming replicas don't hold them either.

### Tune limits

Change the `TIM_MAX_*`, `TIM_RUN_TIMEOUT_SECONDS`, `TIM_ROWS_PAGE_SIZE` and `TIM_RUN_RETENTION_*` variables on the api, and restart it (see [configuration.md](configuration.md#http-and-run-limits)).

| Symptom                                      | Variable                                  |
| -------------------------------------------- | ----------------------------------------- |
| Runs fail with `Result exceeds limit of …`   | `TIM_MAX_RESULT_ROWS`, `TIM_MAX_RESULT_BYTES`. Bigger results need more database space and more memory in the browser |
| Runs stopped at the time limit               | `TIM_RUN_TIMEOUT_SECONDS` (nginx waits 620 s; raising it above 600 also needs a change to `web/docker/nginx.conf.template`) |
| Runs stay `running` under heavy use | `TIM_MAX_CONCURRENT_RUNS` (per api process) |
| Row pages are slow or large                  | `TIM_ROWS_PAGE_SIZE`                      |
| Labelling a big selection is refused         | `TIM_MAX_ANNOTATION_IDS`                  |
| Labels reach other analysts late, or the feed is busy | `TIM_ANNOTATION_POLL_SECONDS`    |
| A pivot is refused with "At most N rows"      | `TIM_MAX_PIVOT_ROWS`                      |
| `413` on requests                            | `TIM_MAX_REQUEST_BYTES` (nginx caps bodies at 64 MB) |

### Rotate secrets and keys

All configuration is read at process start, so each change needs a restart of the container.

On Kubernetes:

- Pods restart on their own when the chart's ConfigMaps or chart-created Secret change at `helm upgrade`.
- A Secret you manage (`secrets.existingSecret`) is not watched. After changing it, run `kubectl -n <namespace> rollout restart deploy/<release>-tim-api` (or `-web`).
- A ConfigMap you manage (`actions.existingConfigMap`) is not watched either. After changing it, run `kubectl -n <namespace> rollout restart deploy/<release>-tim-api`.

| Item                          | Where                                                  | Restart |
| ----------------------------- | ------------------------------------------------------ | ------- |
| OBO client secret             | `TIM_AUTH_CLIENT_SECRET` on the api                    | api     |
| Workload-identity token       | `AZURE_FEDERATED_TOKEN_FILE` content is re-read on each exchange | none, unless the path changes |
| Database password             | `TIM_DATABASE_URL` on the api (and the database)       | api     |
| AG Grid licence key           | `AGGRID_LICENSE` on the web container                  | web     |
| Any other web setting         | web container variables                                | web     |

Browsers fetch `/config.js` uncached, so users receive web changes on their next page load.

## Startup failures from the files

The api reads the action files, the connections file and the labels file once, at startup: its providers' package data, `TIM_ACTIONS_DIR`, `TIM_CONNECTIONS_FILE` and `TIM_LABELS_FILE`.

- Any problem stops it before it serves.
- So in a rolling update, the new pods never become ready, and the old ones keep serving.

The api exits with `Invalid instance:` and one line per problem, every problem at once:

```
Invalid instance:
  - /srv/tim/actions/identity.yaml:7: type: unknown action type 'kql_querry' (installed action types: rows)
  - /srv/tim/actions/identity.yaml:14: params[0].from_column: Unexpected keyword argument
  - /srv/tim/actions/sign-ins.yaml:3: key: duplicate action key acme.users, also in /srv/tim/actions/identity.yaml:2
```

Each line names the file, the line and the field.

1. Fix the file.
2. Check it with [`tim-api check`](#tim-api-check), against the image you deploy.
3. Roll out again.

| Problem | Cause and fix |
| ------- | ------------- |
| `unknown action type` | The `type` is misspelt, or the provider that adds it isn't installed in this image. The message lists the installed types. |
| `Unexpected keyword argument`, `Extra inputs are not permitted` | A misspelt or unknown field. `tim-api schema actions` lists the fields each type takes. |
| `no file <name> next to the action file` | A `<field>_file:` sidecar is missing. It must be a file name in the same directory as the action file. |
| `duplicate action key` | Two actions share a key, in two files or a file and an installed provider. Keys are unique across the instance. |
| `not valid YAML` | The file doesn't parse; the line is where the parser stopped, which can be after the mistake. |
| `unknown connection type` | A connection's `type` is misspelt, or the provider that adds the type isn't installed in this image. The message lists the installed connection types. |
| `duplicate connection name` | Two connections share a `name`. |
| `scope is required for auth obo` | The connection type has no default scope, so the connection must give one. |
| `no connection named <name>`, `connection <name> is <type>, not <type>` | An action's fixed connection isn't in the connections file, or is of another connection type. |
| `TIM_ACTIONS_DIR: invalid (Value error, no directory ...)` | `TIM_ACTIONS_DIR` names a path that isn't a directory. The api exits with `Invalid configuration:`. |
| `TIM_CONNECTIONS_FILE: invalid (Value error, no file ...)` | `TIM_CONNECTIONS_FILE` names a path that isn't a file. The api exits with `Invalid configuration:`. |
| `duplicate label key` | Two labels share a `key`. |
| `Input should be 'red', 'amber', ...` on a label's `colour` or `symbol` | The name isn't in the palette. `tim-api schema labels` lists the colours and symbols. |
| `give the labels in one YAML document` | The file has no YAML document (a zero-byte file) or more than one. Put the labels in one document. |
| `the labels file lists at least one label` | The file's document is an empty list. Add a label, or leave `TIM_LABELS_FILE` unset to get the default labels. |
| `TIM_LABELS_FILE: invalid (Value error, no file ...)` | `TIM_LABELS_FILE` names a path that isn't a file. The api exits with `Invalid configuration:`. |

## Common failures

| Symptom                                                  | Cause and fix                                                                                                                                                         |
| -------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| api exits at startup with `Invalid configuration:` and lines like `- TIM_AUTH_TENANT_ID: missing (...)` | A required `TIM_*` variable is missing or invalid; the message names each one (never the value). Common: `TIM_DATABASE_URL` not `postgresql+asyncpg://`, `TIM_AUTH_DISABLED=true` with `TIM_ENVIRONMENT=production`. |
| api exits at startup with `Invalid instance:`            | A provider, an action file, the connections file or the labels file has a problem; see [Startup failures from the files](#startup-failures-from-the-files). |
| api exits at startup about the OBO credential            | A connection uses `obo`, and neither `TIM_AUTH_CLIENT_SECRET` nor a readable `AZURE_FEDERATED_TOKEN_FILE` is set (the message says which).                                                          |
| api starts but requests fail with database errors; `/api/healthChecks/readiness` returns `503`; problem responses say "Service unavailable" | PostgreSQL is down or unreachable (or the schema is not migrated; run the migrations). The connection pool checks connections before use, so the api serves again once the database is back.                 |
| Every API call returns 401                               | Token rejected: wrong `TIM_AUTH_TENANT_ID` / `TIM_AUTH_CLIENT_ID` (audience `api://<client id>`), or an expired token.                                                |
| Kusto and Snowflake `obo` calls return `403` with title "Consent or sign-in is required for the downstream service" (`consent-required`) | The OBO exchange was refused (`invalid_grant` / `interaction_required`): the user or tenant has not consented to the API's permission for the downstream service, or MFA or conditional access needs interaction. The SPA prompts the user to sign in again; if it persists, grant admin consent on the API app registration. |
| Kusto calls return `403` "Access to the Kusto database was denied" | The signed-in user has no rights on that cluster or database.                                                                                              |
| Kusto and Snowflake `obo` calls return `502` "identity provider could not be reached" | The OBO exchange failed for another reason (network to Entra, misconfigured secret). The api log has `OBO exchange failed` or `OBO exchange rejected: error=...`.   |
| Kusto and Snowflake `obo` calls return `503` "Token exchange is not available" | The api runs with `TIM_AUTH_DISABLED=true`, or the api has no OBO credential, which startup allows only when no connection uses `obo`, so only runs on `obo` connections are affected.                                                                                                                         |
| Web container exits immediately: `tim-web: missing required environment variable(s): ...` | Set `BACKEND_URI`, `REDIRECT_URI`, `AUTH_CLIENT_ID`, `AUTH_TENANT_ID`. Other `tim-web:` messages name an invalid value (`BACKEND_URI` with a path, bad `API_BASEPATH`, and so on). |
| Browser shows the configuration error screen             | `/config.js` has missing or invalid keys; the screen lists each one. Check the web container variables and that `/config.js` is not served from a stale cache or proxy.  |
| Sign-in popup fails with a redirect error                | `REDIRECT_URI` (`https://<host>/blank.html`) is not registered as a SPA redirect URI on the app registration.                                                          |
| `502` from `/api/...` on the web host                    | nginx cannot reach `BACKEND_URI` (name does not resolve, api down). Check the api container and `NGINX_RESOLVER`.                                                      |
| Grid shows a watermark                                   | No `AGGRID_LICENSE` set or the key is invalid; see [AG Grid Enterprise licence](configuration.md#ag-grid-enterprise-licence).                                          |
