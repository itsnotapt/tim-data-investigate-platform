# tim-api

FastAPI backend for TIM. Python 3.12, managed with [uv](https://docs.astral.sh/uv/).

```bash
uv sync                                         # install (creates .venv)
uv run uvicorn tim_api.main:app --reload --port 8080   # run
uv run pytest                                   # test (with coverage, fails under 80%)
uv run ruff check                               # lint
uv run ruff format --check                      # format check (drop --check to apply)
uv run mypy                                     # type check (strict; src + tests)
```

Local stack (PostgreSQL, running api and web together): see [development.md](../docs/development.md).

Health probes: `GET /api/healthChecks/liveness` (204) and `/readiness` (204 when `Storage.health()` passes, else 503 problem body). OpenAPI docs at `/api/docs`. See "Errors, CORS and logging".

## Configuration

Configuration is via `TIM_*` environment variables, optionally loaded from a `.env` file (see
`src/tim_api/config.py`). Copy `.env.example` to `.env` for local development; it lists every
variable with comments. Required: `TIM_AUTH_TENANT_ID`, `TIM_AUTH_CLIENT_ID`,
`TIM_TAG_CLUSTER_URI`, `TIM_DATABASE_URL`. Startup fails with a message naming any missing or
invalid variable (values are never printed). `TIM_AUTH_DISABLED` is rejected when
`TIM_ENVIRONMENT=production` (the default). The Kusto app identity uses the standard `AZURE_*`
variables read by `azure-identity`.

## Storage

`tim_api.storage` defines the persistence ports (`TemplateStore`, `QueryRunStore`, bundled as
`Storage`) with two implementations: `PostgresStorage` (SQLAlchemy 2 async + asyncpg, ADR-0004) and
an in-memory store (`TIM_DATABASE_URL=memory://`, development only, rejected in production).
Endpoints get stores through `tim_api.deps.get_template_store` / `get_run_store`.

**Migrations (Alembic).** Schema lives in `migrations/`; `tim_api.storage.postgres.metadata` is the
model definition. The app does **not** migrate at startup (schema changes stay an explicit deploy
step, and several replicas never race). Run before starting a new version:

```bash
uv run alembic upgrade head        # TIM_DATABASE_URL must be set (only that variable is read)
uv run alembic downgrade base      # drop everything (dev)
```

The api image contains `alembic.ini` and `migrations/`, so a compose/Kubernetes job can run
`alembic upgrade head` with the same image. Production deployment and `/api` routing: [docs/deployment.md](../docs/deployment.md);
environment variables: [docs/configuration.md](../docs/configuration.md). Empty `TIM_AUTH_CLIENT_SECRET` / `TIM_TAG_INGEST_URL` count as unset.

**Retention.** Every run has `expires_at`; reads treat an expired run as missing, and a
background task started in the lifespan deletes expired rows every
`TIM_RUN_RETENTION_SWEEP_SECONDS` (default 300) for every run alike.

**Tests.** `tests/storage_contract.py` runs against both stores (the `storage` fixture in
`tests/conftest.py`). Postgres tests use a real server: `TIM_TEST_DATABASE_URL`
(`postgresql+asyncpg://...`, used in CI, a `postgres:17` service; tables are truncated per test) or,
when unset, a temporary server from the `pgserver` dev dependency (bundled PostgreSQL binaries, no
Docker needed). The tests apply the migrations themselves; if neither is available they skip.

## Auth

`get_current_principal` (`src/tim_api/auth/`) reads `Authorization: Bearer <token>` and validates
it (`auth/jwt.py`, ADR-0005): RS256 only, signature from the tenant JWKS
(`{TIM_AUTH_AUTHORITY_HOST}/{tenant}/discovery/v2.0/keys`, cached 1 h, one rate-limited refetch
(30 s) on an unknown `kid`), `aud` = `api://{clientId}` or `{clientId}`, `iss` =
`https://sts.windows.net/{tid}/` or `{authority}/{tid}/v2.0`, `tid` must equal the configured
tenant, `exp`/`nbf`/`iat` required with 60 s leeway. `Principal.name` comes from `unique_name`,
then `upn`, then `preferred_username` (a token with none of them, or without `oid`, is
rejected); the raw token is kept as a `SecretStr` for OBO. Any failure returns 401 with
`WWW-Authenticate: Bearer` and a generic message; token contents are never echoed or logged.

### OBO (`auth/obo.py`)

`OboTokenProvider.get_token(principal, cluster_url)` exchanges the caller's token for a Kusto token
(inject with `Depends(get_obo_provider)`; pass the cluster already normalised by
`validate_cluster_url`). One `msal.ConfidentialClientApplication` (built lazily, once) with MSAL's
shared in-memory token cache; blocking calls run via `asyncio.to_thread`. Scope is
`TIM_KUSTO_OBO_SCOPE` with `{cluster}` substituted. Credential: `TIM_AUTH_CLIENT_SECRET`, else a
client assertion re-read from `AZURE_FEDERATED_TOKEN_FILE`; with neither, startup fails
(`OboConfigError`). Errors for endpoints to map: `OboAuthError` (`invalid_grant` /
`interaction_required`) -> 403 `consent-required`, `OboUpstreamError` -> 502, `OboUnavailableError` (auth disabled or
no token) -> 503. With `TIM_AUTH_DISABLED=true` the provider always raises `OboUnavailableError`,
so Kusto calls need real auth even in dev.
Tests override the `get_token_validator` dependency with a `TokenValidator` built on a fake JWKS
fetcher.

For local work and tests set `TIM_ENVIRONMENT=development` and `TIM_AUTH_DISABLED=true`: the
dependency returns a fixed dev `Principal` (`DEV_PRINCIPAL`) and startup logs a loud warning
once. `TIM_AUTH_DISABLED=true` with `TIM_ENVIRONMENT=production` (the default environment) fails
settings load and app startup. Routes use it with
`principal: Principal = Depends(get_current_principal)`; there is no debug endpoint.

## Docker image

```bash
docker build -t tim-api api/
docker run --rm -p 8080:8080 --env-file .env tim-api
```

Multi-stage on `python:3.12-slim-trixie` (Debian 13): the `ghcr.io/astral-sh/uv` image runs `uv sync --locked --no-dev` into `/app/.venv` (bytecode compiled, project installed non-editable); the runtime stage copies only the venv and runs as non-root uid 10001. It serves `uvicorn tim_api.main:app` on port 8080 with `--proxy-headers` and one worker. `HEALTHCHECK` calls `/api/healthChecks/liveness` with the Python standard library. The image takes the same `TIM_*` variables as above (nothing is baked in); `uvicorn` trusts `X-Forwarded-*` only from `FORWARDED_ALLOW_IPS` (default `127.0.0.1`), so set it to the proxy address in deployment.

## Models

Pydantic v2 models mirror the schemas in [api.md](../docs/api.md) (camelCase aliases, unknown
input fields ignored, serialised by alias): `templates/models.py`, `query_runs/models.py`,
`tagged_events/models.py`, `kusto/models.py`; shared base and UTC datetime type in
`models_common.py`.

- Request and response models are separate: `QueryTemplateCreate` (POST), `QueryTemplateReplace`
  (PUT), `QueryTemplate` (stored/returned; also validates PATCH results). Server-owned fields
  (`createdBy`, `updatedBy`, `updated`, `requestedBy`, tagged-event `createdBy`/`dateTimeUtc`)
  are not fields on request models, so client values are dropped on parse.
- Datetimes: input without an offset is UTC, offsets are converted; output is `...Z`, with
  milliseconds only when the value has a sub-second part.
- Validation error locs use Python attribute names when a value is missing and defaulted:
  `QueryField.from` appears as `from_`. The error handler (400 problem envelope) must map it back
  to `from`. Batch types (`SavedEventBatch`, ...) enforce 1 to 1000 items.
- Cluster policy is not in the models; it lives in `kusto/validation.py` (`validate_cluster_url`, raises `InvalidClusterError`; https only, no userinfo/port/path/query/IP literal, host patterns from `TIM_ALLOWED_KUSTO_HOSTS`, default `DEFAULT_ALLOWED_KUSTO_HOSTS`); `KustoQueryStats` allows extra Kusto keys.

## Kusto query client

`kusto/query_client.py`: `KustoQueryClient` protocol (`execute(cluster_url, database, query, token, start, end, limits) -> QueryResult`), `get_kusto_client` dependency and `AzureKustoQueryClient` (sync `azure-kusto-data` client in `asyncio.to_thread`; the aio client needs the extra `aiohttp` dependency). Parsing is a pure function, `parse_v2_frames`, over raw V2 frames (fixtures in `tests/fixtures/kusto/`). `StartTime`/`EndTime` are sent as ISO-8601 query parameters (the KQL must declare them) and `servertimeout` comes from `TIM_QUERY_TIMEOUT_SECONDS`. Exceeding `TIM_MAX_RESULT_ROWS`/`TIM_MAX_RESULT_BYTES` raises `KustoResultLimitError` (no truncation, see [docs/api.md](../docs/api.md)); Kusto failures raise `KustoQueryError` with a sanitised message; progressive frames raise `KustoUnexpectedFrameError`. Cancelling the awaiting task does not stop the worker thread; the server timeout bounds it.

## Kusto schema

`POST /api/kusto/schema` validates the cluster (400 `cluster-not-allowed`, before any token exchange), gets an OBO token for the normalised cluster, and calls `KustoQueryClient.show_schema` (management command `.show schema as json`, database as context). The JSON column (`ClusterSchema`, `DatabaseSchema` or the single column) is parsed and returned as `{schema: <object>}`. Kusto 403 -> 403 `forbidden`; other Kusto errors or an unrecognised result -> 502 `upstream` (fixed detail).

## Query runs

`POST /api/kusto/query` validates the cluster (400 before any token use) and the body (`startTime <= endTime`; NUL in `query`/`database` is 400), gets the OBO token synchronously (so 401/403/502/503 are real HTTP errors), stores the run as `created` (owner = token name, client `requestedBy` ignored; `expiresAt` = now + `TIM_RUN_RETENTION_SECONDS`) and starts a tracked asyncio task (`query_runs/runner.py`, `RunManager`). The handler waits 1 s (`RACE_SECONDS`): finished -> 200, else 202 with the `created` run (no `Location` header; clients poll `GET /api/kusto/query/{queryRunId}`, which returns 202 while `created` and 200 once terminal). Malformed guid -> 400; unknown, expired or foreign run -> 404 (`get_for_owner`).

Outcomes are persisted before anything can observe them, and `expiresAt` is refreshed: success -> `completed`; `KustoQueryError` -> `error` with the sanitised message; `KustoResultLimitError` -> `error` ("Result exceeds limit of ..."); `TIM_QUERY_TIMEOUT_SECONDS` exceeded (`asyncio.timeout`) -> `timedOut` with a `mainError`; anything else -> `error` "The query failed unexpectedly" (traceback logged with the trace id). Tasks are referenced from `app.state.run_tasks` and cancelled on shutdown (a cancelled run is marked `error` "Run interrupted by server restart"). At startup `mark_stale_runs` marks runs still `created` for longer than the query timeout as `error` with the same message; younger runs (other replicas) are left alone.

PostgreSQL JSONB/TEXT cannot store U+0000, so NUL characters in result data (keys and values) and in `mainError` are replaced with U+FFFD before persisting (`sanitise_nul`); this applies to both stores for identical behaviour. Tests run the flow against memory and PostgreSQL (`storage` fixture).

### Limits

| Setting | Default | Behaviour when exceeded |
|---|---|---|
| `TIM_MAX_RESULT_ROWS` | 100 000 | run ends `error`, `resultData: null`, `mainError` "Result exceeds limit of N rows". Never truncated. |
| `TIM_MAX_RESULT_BYTES` | 64 MB | same, "... N bytes" (size of the compact JSON of all rows) |
| `TIM_QUERY_TIMEOUT_SECONDS` | 600 | `timedOut` |
| `TIM_RUN_RETENTION_SECONDS` | 86 400 | run 404 after expiry |
| `TIM_MAX_CONCURRENT_RUNS` | 16 | per process; extra runs wait in `created` (the timeout starts when execution starts), so a `created` run may outlive 11 min only under sustained overload |
| `TIM_MAX_REQUEST_BYTES` | 16777216 | hard cap on any request body; larger requests get 413 `urn:tim:problem:too-large` |

The row cap is checked per result table before any row is converted, the byte cap while rows are
converted (conversion stops at the first row that crosses it), and `GET` returns at most the
byte cap of rows, so the response is bounded. The synchronous Azure SDK materialises the raw
response before parsing, which the caps cannot prevent (server-side `set truncationmaxrecords`
/ `truncationmaxsize` could; not applied). Memory budget, checked by
`tests/test_query_runs_load.py`: converting and sanitising a result peaks below 3x its
serialised size on top of the raw frames (measured about 2.3x for 100 000 rows x 10 columns
incl. dynamic, 37 MB payload); `sanitise_nul` returns clean data without copying it. The 100k
case is marked `slow` and skipped by default: `uv run pytest -m slow`.

## Tagged events

`POST /api/taggedevents/{savedEvents,tags,comments}` validate the batch, set `createdBy` (token) and `dateTimeUtc` (server clock), and make one `TagIngestClient.ingest(table, "<Table>Mapping", rows)` call (rows keyed by the camelCase mapping paths). Ingest failures raise `TagIngestError` (502). `get_tag_ingest_client` returns the cached `AzureTagIngestClient` (`ManagedStreamingIngestClient` from `azure-kusto-ingest`: streaming, falling back to queued; NDJSON + JSON mapping reference, `DefaultAzureCredential` from `AZURE_*`, SDK run in a thread) whenever the tag cluster is configured. The ingest URL is `TIM_TAG_INGEST_URL` or `https://ingest-<cluster host>`. The in-memory `FakeTagIngestClient` is used only with `TIM_ENVIRONMENT=development` and `TIM_TAG_INGEST_FAKE=true`. SDK failures become `TagIngestError` (502, no row contents logged). Streaming gives read-your-writes; the tag tables need the streaming ingestion policy (enabled by the table creation CLI below). Optional integration test: set `TIM_TEST_KUSTO_INGEST_URL` (and `TIM_TEST_KUSTO_DATABASE`, `TIM_TEST_KUSTO_TABLE`) and run `pytest -m kusto`.

## Tag table creation CLI

`python -m tim_api.tagged_events.cli create-tables [--dry-run] [--cluster-uri URI] [--database DB]` creates the `SavedEvent`, `EventTag` and `EventComment` tables, their `<Table>Mapping` JSON ingestion mappings and enables the streaming ingestion policy on each (`.create-merge table`, `.create-or-alter ... ingestion json mapping`, `.alter table ... policy streamingingestion enable`; safe to re-run). Definitions live in `tagged_events/kusto_schema.py` (shared with the ingest endpoints). Cluster/database default to `TIM_TAG_CLUSTER_URI` / `TIM_TAG_DATABASE` (`Research`); no other settings are needed. It authenticates with `DefaultAzureCredential` (`AZURE_*` or `az login`), so the identity needs database admin rights. `--dry-run` prints the commands without connecting. The first failing command stops the run, is printed to stderr and exits 1. Table creation is a deploy step, not app startup.

## Errors, CORS and logging

- `errors.py`: every non-2xx is `application/problem+json` (`type`, `title`, `status`, `detail`, `traceId`, `errors?`). Handlers: `HTTPException` (headers kept, so `WWW-Authenticate` survives), `RequestValidationError` (400, `errors` keyed by camelCase JSON path with `from_` mapped to `from`; unparseable JSON gives `{"body": ["Malformed JSON"]}`), `NotFoundError` 404, `AlreadyExistsError` 409, `StorageUnavailableError` 503, `OboAuthError` 403 `consent-required` (see [docs/api.md](../docs/api.md)), `OboUpstreamError` 502, `OboUnavailableError` 503, and any other exception 500 with detail `Internal error` (stack logged with the traceId, never returned). Details are fixed strings; exception messages are never echoed. Unknown `HTTPException` statuses get `urn:tim:problem:http-<status>`.
- `observability.py`: `RequestLoggingMiddleware` (pure ASGI) logs `METHOD path -> status ms traceId=...` (no query string, headers or bodies). The traceId is a valid W3C `traceparent` from the request, else a sane `x-request-id`, else generated (`traceparent` format); it is returned in the body and the `x-trace-id` response header. `LazyCORSMiddleware` reads `TIM_CORS_ALLOWED_ORIGINS` on first request (no CORS headers at all when empty); methods GET/POST/PUT/PATCH/DELETE/OPTIONS, request headers `Authorization`, `Content-Type`, `traceparent`, `x-request-id`, exposed `x-trace-id`, no credentials. `TIM_LOG_LEVEL` configures the `tim_api` logger at startup.

## Template endpoints

`templates/router.py` implements `/api/templates/queries` (list, get, POST 201, PUT update-only,
PATCH, soft DELETE 204). Audit fields come from the principal and the clock (truncated to
milliseconds so `since=<updated>` round-trips). PATCH uses the `jsonpatch` library on the stored
JSON form; `/uuid`, `/createdBy`, `/updatedBy`, `/updated` are protected, `move`/`copy` and empty
patches are rejected, and the result is re-validated with `QueryTemplate` (all 400s use the
`errors` envelope). Restore is `replace /isDeleted false`.

## OpenAPI export and contract test

`tim_api/openapi_meta.py` post-processes the generated spec (operation IDs, problem-details error responses instead of FastAPI's 422, Bearer security). `tests/test_openapi_contract.py` checks it against a snapshot (`tests/snapshots/openapi.json`), the committed web copy, and a table of every contract endpoint with its status codes.

```bash
uv run python -m tim_api.openapi_export [--out PATH]   # writes web/src/lib/api/openapi.json (no env or DB needed)
UPDATE_SNAPSHOTS=1 uv run pytest tests/test_openapi_contract.py   # refresh the snapshot
```

After an API change run both, then `npm run gen:api` in `web/`.
