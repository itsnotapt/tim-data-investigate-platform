# tim-api

FastAPI backend for TIM. Python 3.12, managed with [uv](https://docs.astral.sh/uv/).

`api/` is a uv workspace with two members:

- `tim-api`, here;
- `tim-actions` ([`tim-actions/`](tim-actions/README.md)), the interface providers build against.

One `uv.lock` and one `.venv` serve both; see [development.md](../docs/development.md#the-uv-workspace).

```bash
uv sync                                         # install both members (creates .venv)
uv run uvicorn tim_api.main:app --reload --port 8080   # run
uv run pytest                                   # test (with coverage, fails under 80%)
uv run ruff check                               # lint
uv run ruff format --check                      # format check (drop --check to apply)
uv run mypy                                     # type check (strict; src + tests)
(cd tim-actions && uv run pytest && uv run mypy)  # the same for tim-actions; ruff above covers it
```

Local stack (PostgreSQL, running api and web together): see [development.md](../docs/development.md).

- **Health probes:** `GET /api/healthChecks/liveness` answers 204. `/readiness` answers 204 when `Storage.health()` passes, else 503 with a problem body.
- **OpenAPI docs** are at `/api/docs`.
- **Errors** are described in [Errors, CORS and logging](#errors-cors-and-logging).

## Configuration

Configuration comes from `TIM_*` environment variables, optionally loaded from a `.env` file (see `src/tim_api/config.py`).

- Copy `.env.example` to `.env` for local development. It lists every variable, with comments.
- Required: `TIM_AUTH_TENANT_ID`, `TIM_AUTH_CLIENT_ID` and `TIM_DATABASE_URL`.
- Startup fails with a message naming any missing or invalid variable. Values are never printed.
- `TIM_AUTH_DISABLED` and `TIM_DEV_ACTIONS` (the development actions) are rejected when `TIM_ENVIRONMENT=production`, the default.
- An empty `TIM_AUTH_CLIENT_SECRET` counts as unset.

Production deployment and `/api` routing are in [docs/deployment.md](../docs/deployment.md). Environment variables are in [docs/configuration.md](../docs/configuration.md).

## Storage

`tim_api.storage` defines the persistence ports, bundled as `Storage` with `presets`, `runs`, `column_views` and `annotations`:

- `PresetStore`, for presets and each analyst's hidden marks;
- `RunStore`, for runs and their rows;
- `ColumnViewStore`, for column views (`column_views`) and each analyst's hidden marks (`column_view_hidden`);
- `AnnotationStore`, for labels and the change feed (ADR-0020, [architecture.md](../docs/architecture.md#annotations-and-the-change-feed)). Every change takes its version first from `annotation_clock`, so versions are gapless and in commit order.

There are two implementations:

- `PostgresStorage`: SQLAlchemy 2 async with asyncpg (ADR-0004);
- an in-memory store (`TIM_DATABASE_URL=memory://`): development only, rejected in production.

Endpoints get stores through `tim_api.deps.get_preset_store`, `get_run_store` and `get_column_view_store`.

**Migrations (Alembic).** The schema lives in `migrations/`. `tim_api.storage.postgres.metadata` is the model definition.

- The app does **not** migrate at startup. Schema changes stay an explicit deploy step, and several replicas never race.
- Run the migrations before starting a new version:

  ```bash
  uv run alembic upgrade head        # TIM_DATABASE_URL must be set (only that variable is read)
  uv run alembic downgrade base      # drop everything (dev)
  ```

- The api image contains `alembic.ini` and `migrations/`. So a compose or Kubernetes job can run `alembic upgrade head` with the same image.

**Retention.** Every run has `expires_at`.

- Reads treat an expired run as missing.
- A background task, started in the lifespan, deletes expired runs every `TIM_RUN_RETENTION_SWEEP_SECONDS` (default 300).
  - It deletes runs ten at a time (`RUNS_PER_BATCH`), each with its rows.
  - It skips runs that another replica's sweep has locked.

**Tests.** `tests/storage_contract.py` runs against both stores, through the `storage` fixture in `tests/conftest.py`.

- Postgres tests use a real server:
  - `TIM_TEST_DATABASE_URL` (`postgresql+asyncpg://...`), used in CI with a `postgres:17` service. Tables are truncated per test.
  - When it is unset, a temporary server from the `pgserver` dev dependency. It bundles PostgreSQL binaries, so no Docker is needed.
- The tests apply the migrations themselves.
- If neither server is available, the tests skip.

## Auth

`get_current_principal` (`src/tim_api/auth/`) reads `Authorization: Bearer <token>` and validates it (`auth/jwt.py`, ADR-0005):

- RS256 only.
- The signature is checked against the tenant JWKS, from `{TIM_AUTH_AUTHORITY_HOST}/{tenant}/discovery/v2.0/keys`.
  - The keys are cached for 1 h.
  - An unknown `kid` triggers one rate-limited refetch (30 s).
- `aud` is `api://{clientId}` or `{clientId}`.
- `iss` is `https://sts.windows.net/{tid}/` or `{authority}/{tid}/v2.0`.
- `tid` must equal the configured tenant.
- `exp`, `nbf` and `iat` are required, with 60 s leeway.

The principal:

- `Principal.name` comes from `unique_name`, then `upn`, then `preferred_username`.
- A token with none of them, or without `oid`, is rejected.
- The raw token is kept as a `SecretStr`, for OBO.

Any failure returns 401, with `WWW-Authenticate: Bearer` and a generic message. Token contents are never echoed or logged.

Tests override the `get_token_validator` dependency with a `TokenValidator` built on a fake JWKS fetcher.

### OBO (`auth/obo.py`)

`OboTokenProvider.token_for(principal, scope)` exchanges the caller's token for a token for `scope`. Inject it with `Depends(get_obo_provider)`.

- It blocks, so call it from a worker thread.
- Runs use it for each `obo` connection's scope. Hooks get it as a `token_for(scope)` callable, never the user's token.
- There is one `msal.ConfidentialClientApplication`, built lazily and once, with MSAL's shared in-memory token cache.

The credential is `TIM_AUTH_CLIENT_SECRET`, else a client assertion re-read from `AZURE_FEDERATED_TOKEN_FILE`.

- With neither, startup fails (`OboConfigError`) when a connection uses `obo`.
- Otherwise, OBO answers 503 when it is used.

Errors for endpoints to map:

| Error | Answer |
|---|---|
| `OboAuthError` (`invalid_grant`, `interaction_required`) | 403 `consent-required` |
| `OboUpstreamError` | 502 |
| `OboUnavailableError` (auth disabled, or no token) | 503 |

With `TIM_AUTH_DISABLED=true`, the provider always raises `OboUnavailableError`. So runs on `obo` connections need real auth, even in dev.

For local work and tests, set `TIM_ENVIRONMENT=development` and `TIM_AUTH_DISABLED=true`.

- The dependency returns the analyst a stub token (`Bearer dev:<upn>`) names, or a fixed dev `Principal` (`DEV_PRINCIPAL`) without one.
- Startup logs a loud warning, once.
- `TIM_AUTH_DISABLED=true` with `TIM_ENVIRONMENT=production` (the default environment) fails settings load and app startup.

Routes use it with `principal: Principal = Depends(get_current_principal)`. There is no debug endpoint.

## Actions and providers

At startup, the lifespan discovers providers through the `tim.actions` entry-point group (`actions/registry.py`, `discover_providers`). Each entry point names a callable that returns a `tim_actions.Provider`.

`build_registry` checks the providers against each other, and indexes their actions, action types and hooks. Any problem raises `InstanceConfigError` ("Invalid instance:"), which lists every problem and stops startup:

- an entry point that fails to load, raises, or returns something other than a `Provider`;
- an action that fails validation again from its fields. So one built with `model_construct` is caught;
- a key with the `tim.` prefix, from any distribution other than `tim-actions`;
- a duplicate action key, action type `type_name` or connection type;
- a problem in an action file, from a provider's package data (`Provider(action_files=...)`) or from `TIM_ACTIONS_DIR`. The loader is `tim_actions.files.load_action_files`. Each problem names the file, line and field;
- a problem in the connections file (`TIM_CONNECTIONS_FILE`). The loader is `tim_actions.connections_file.load_connections_file`. Each problem names the file, line and field;
- a problem in the labels file (`TIM_LABELS_FILE`). The loader is `tim_actions.labels_file.load_labels_file`. Each problem names the file, line and field;
- an action's fixed connection that is missing, or of another type. `Action.connections()` maps each name to its connection type.

An action with a `connection` param is left out, with an info log line, when no connection has the param's type.

The `tim-api` command (`cli.py`), described in [actions.md](../docs/actions.md#checking-files):

- `tim-api check [--actions <dir>] [--connections <file>] [--labels <file>]` runs the same validation, without a database or settings.
- `tim-api schema actions|connections|labels` prints the JSON Schema of the action files, the connections file or the labels file.

Other pieces:

- `create_app(providers=[...])` skips discovery, and uses the given providers. None of them is built-in.
- `tests/app_factory.create_test_app` passes no providers, unless a test gives some.
- `actions/instance.py` builds the `GET /api/instance` body once, at startup (see [api.md](../docs/api.md#instance)).
- The interface itself, param validation included, is in `tim-actions`.

## Docker image

```bash
docker build -t tim-api api/
docker run --rm -p 8080:8080 --env-file .env tim-api
```

The build is multi-stage, on `python:3.12-slim-trixie` (Debian 13, from `mirror.gcr.io`).

- The `ghcr.io/astral-sh/uv` image runs `uv sync --locked --no-dev` into `/app/.venv`. Bytecode is compiled, and both workspace members are installed non-editable.
- The runtime stage copies only the venv, and runs as non-root uid 10001.
- It serves `uvicorn tim_api.main:app` on port 8080, with `--proxy-headers` and one worker.
- `HEALTHCHECK` calls `/api/healthChecks/liveness` with the Python standard library.
- The image takes the same `TIM_*` variables as above. Nothing is baked in.
- `uvicorn` trusts `X-Forwarded-*` only from `FORWARDED_ALLOW_IPS` (default `127.0.0.1`). Set it to the proxy address in deployment.

## Models

Pydantic v2 models mirror the schemas in [api.md](../docs/api.md).

- They use camelCase aliases, ignore unknown input fields, and serialise by alias.
- They are in `actions/models.py`, `presets/models.py`, `runs/models.py` and `annotations/models.py`.
- The shared base and UTC datetime type are in `models_common.py`.

Rules:

- **Request and response models are separate:** `PresetFields` (POST and PUT), `StoredPreset` (stored) and `Preset` (returned).
  - Server-owned fields are not fields on request models, so client values are dropped on parse. They are `presetId`, `owner`, `createdAt`, `updatedAt` and `requestedBy`.
- **Datetimes:** input without an offset is UTC, and offsets are converted. Output is `...Z`, with milliseconds only when the value has a sub-second part.

## Runs

`/api/runs` (`runs/router.py`) runs any catalogued action.

`POST`:

1. looks the action up in `app.state.actions`. An unknown action gives 422, keyed `action`;
2. validates the params with the action's `check_params` (by default `tim_actions.validate_params`). An invalid param gives 422, keyed `params.<name>`, before a run exists;
3. calls `Runner.start` (`runs/runner.py`), which stores the run as `running` and starts a tracked asyncio task;
4. waits 1 s (`RACE_SECONDS`): 200 with the ended run, else 202.

`GET /{runId}` and `POST /{runId}/cancel` always answer 200. Unknown, expired or foreign runs are 404.

The task:

- waits for a slot of the semaphore (`Runner`'s `slots`, sized by `max_concurrent_runs`);
- runs the action's synchronous `run(params, ctx)` in a daemon thread named `tim-run-<runId>`.

`ctx` (`_Context`) implements `tim_actions.RunContext`.

- `hook(connection)` gets one hook per connection per run, from `app.state.connections`. That is a `runs.connections.Connections`, or `NoConnections`, which has none.
- It refuses connections the action doesn't declare.

The thread feeds each row to `ResultBuilder` (`runs/results.py`), which handles caps, `id`, NUL replacement and inferred columns. It writes batches of 1000 rows or 8 MiB through the event loop (`run_coroutine_threadsafe`).

Outcomes:

| Outcome | Status |
|---|---|
| `run` returns | `succeeded`, with `columns`, `rowCount`, and any `id` warnings in `details["warning"]` |
| `tim_actions.RunError` or `ResultLimitError` | `error`, with its message |
| Any other exception | `error` "The run failed unexpectedly". The traceback is logged with the trace id |
| `TIM_RUN_TIMEOUT_SECONDS` after the slot | `timedOut` |
| A cancel request | `cancelled` |

A timeout and a cancel both:

1. stop row writes;
2. call each hook's `cancel()`, in another thread;
3. end the run once it returns or the thread exits, or after `CANCEL_GRACE_SECONDS` (10).

Ending and cancelling:

- `RunStore.finish` writes the final state, and deletes the rows unless the run succeeded. It leaves a run that has already ended unchanged.
- Cancel sets `cancel_requested` on the run, so a replica that doesn't execute it can take the request. `Runner.start_watching` polls `RunStore.cancel_requested` for this process's runs every second (`CANCEL_POLL_SECONDS`).
- At startup, `Runner.mark_stale` marks runs `running` for longer than the timeout as `error` "Run interrupted by server restart".
- `Runner.aclose`, at shutdown, does the same for runs in flight.

Rows are in the `UNLOGGED` table `run_rows`. `GET /{runId}/rows` answers:

- 410 when a succeeded run with rows has none stored;
- 409 for a run that hasn't succeeded.

Tests:

- `tests/test_runs_api.py` drives the endpoints through `create_app(providers=...)`, with the scripted action types in `tests/scripted_actions.py`, against both stores.
- The built-ins' action tests live in `api/tim-actions/tests`, on `tim_actions.testing` ([actions.md](../docs/actions.md#testing)).
- `tests/test_run_kql.py` covers Run KQL. Its live test needs `TIM_TEST_KUSTO_CLUSTER` (see [development.md](../docs/development.md)).

### Limits

| Setting | Default | Behaviour when exceeded |
|---|---|---|
| `TIM_MAX_RESULT_ROWS` | 1 000 000 | the run ends `error`, "Result exceeds limit of N rows". Never truncated. |
| `TIM_MAX_RESULT_BYTES` | 512 MiB | the same, "... N bytes" (size of the compact JSON of all rows) |
| `TIM_RUN_TIMEOUT_SECONDS` | 600 | `timedOut` |
| `TIM_RUN_RETENTION_SECONDS` | 86 400 | run 404 after expiry |
| `TIM_MAX_CONCURRENT_RUNS` | 16 | per process; extra runs wait as `running` (the timeout starts when execution starts) |
| `TIM_MAX_REQUEST_BYTES` | 67108864 | hard cap on any request body; larger requests get 413 `urn:tim:problem:too-large` |

## Errors, CORS and logging

**`errors.py`:** every non-2xx is `application/problem+json`, with `type`, `title`, `status`, `detail`, `traceId` and `errors?`.

| Handler | Answer |
|---|---|
| `HTTPException` | Its status, with headers kept, so `WWW-Authenticate` survives. Unknown statuses get `urn:tim:problem:http-<status>` |
| `RequestValidationError` | 422 `validation`, with `errors` keyed by camelCase JSON path. Malformed JSON (a `json_invalid` error) gives 400 `bad-request` with `{"body": ["Malformed JSON"]}` |
| `NotFoundError` | 404 |
| `AlreadyExistsError` | 409 |
| `StorageUnavailableError` | 503 |
| `OboAuthError` | 403 `consent-required` (see [docs/api.md](../docs/api.md)) |
| `OboUpstreamError` | 502 |
| `OboUnavailableError` | 503 |
| Any other exception | 500, with detail `Internal error`. The stack is logged with the traceId, never returned |

Details are fixed strings. Exception messages are never echoed.

**`observability.py`:**

- `RequestLoggingMiddleware` (pure ASGI) logs `METHOD path -> status ms traceId=...`. It logs no query string, headers or bodies.
- The traceId is a valid W3C `traceparent` from the request, else a sane `x-request-id`, else generated in `traceparent` format. It is returned in the body and in the `x-trace-id` response header.
- `LazyCORSMiddleware` reads `TIM_CORS_ALLOWED_ORIGINS` on the first request. When it is empty, there are no CORS headers at all. Otherwise:
  - methods GET, POST, PUT, PATCH, DELETE and OPTIONS;
  - request headers `Authorization`, `Content-Type`, `traceparent` and `x-request-id`;
  - exposed header `x-trace-id`;
  - no credentials.
- `TIM_LOG_LEVEL` configures the `tim_api` logger at startup.

## Preset endpoints

`presets/router.py` implements `/api/presets`: list, POST 201, PUT (whole replace), DELETE 204, PUT and DELETE `/{presetId}/hidden`, and GET `/{presetId}/actionFile`. [api.md](../docs/api.md#presets) has the rules.

- The server assigns `presetId` and the timestamps (truncated to milliseconds), and takes `owner` from the principal.
- `_check` requires `action` in the catalogue, each param input to be a param of it with `from_columns`, and each query parameter input to be on an action that takes them (`Action.takes_query_parameters`), with a unique name that matches `PARAM_NAME`. Failures are `422` with `errors` keys `action`, `inputs.<i>.name` and `inputs.<i>.source`.
- `presets/action_file.py` builds the actionFile response with the action's `preset_file`. `NoActionFileError` is `409` `no-action-file`; it also answers a Run KQL preset without a connection, database or query, for which `RunKql.preset_file` returns `None`. The file pivots on `rows` when the preset has From row query parameters and every one of them has columns, else `none`.
- `_visible` answers `404` for an unknown preset or someone else's private one. `_owned` adds `403` for a change by a non-owner.

## OpenAPI export and contract test

`tim_api/openapi_meta.py` post-processes the generated spec:

- operation IDs;
- problem-details error responses, instead of FastAPI's 422;
- Bearer security.

`tests/test_openapi_contract.py` checks the spec against:

- a snapshot (`tests/snapshots/openapi.json`);
- the committed web copy;
- a table of every contract endpoint, with its status codes.

```bash
uv run python -m tim_api.openapi_export [--out PATH]   # writes web/src/lib/api/openapi.json (no env or DB needed)
UPDATE_SNAPSHOTS=1 uv run pytest tests/test_openapi_contract.py   # refresh the snapshot
```

After an API change, run both, then `npm run gen:api` in `web/`.
