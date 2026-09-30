# API contract (Python / FastAPI rewrite)

> Status: draft for review, 2026-09-29 (task P0-16). Source of truth for P2 backend tests (pytest, contract tests) and P3 frontend client types (`web/src/lib/api`).
> Baseline: [../current-system/backend-api.md](../current-system/backend-api.md) (legacy behaviour) and [../current-system/data-models.md](../current-system/data-models.md) (field-level legacy models). Every difference from legacy is listed in [Deviations summary](#deviations-summary). Design context: [target-architecture.md](target-architecture.md) sections 4-5, [ADR-0004](../decisions/0004-postgresql-persistence.md), [ADR-0005](../decisions/0005-auth-entra-popup-obo.md).

## Contents
1. [Conventions](#1-conventions)
2. [Endpoint catalogue](#2-endpoint-catalogue)
3. [Endpoints](#3-endpoints)
4. [Shared schemas](#4-shared-schemas)
5. [Deviations summary](#deviations-summary)
6. [Test checklist](#test-checklist)

## 1. Conventions

The React frontend is new, so **compatibility with the legacy Vue client is not required** (Q-008 default applied). Paths and JSON field names are kept anyway so Export/Import, shared logic and legacy examples stay valid.

| Topic | Rule |
|---|---|
| Base path | All routes under `/api`. No path rewriting by ingress (BUG-10). |
| Content type | Requests and responses `application/json; charset=utf-8`, except 204 (no body). |
| JSON field names | camelCase, **identical to legacy** (`data-models.md`). Exceptions listed in the deviations table. Unknown request fields are ignored (not rejected), except where a section says "ignored" explicitly for a security-relevant field. |
| Dictionary keys | Kusto column names in `resultData` rows and keys of `params` / `fields` / `columns` are data, never re-cased. |
| Enums | String values exactly as legacy: `queryType` in `view`, `query`; `status` in `created`, `completed`, `error`, `timedOut`. |
| Datetime | ISO 8601, UTC, `Z` suffix, millisecond precision where the source has it (e.g. `2026-03-14T09:31:02.114Z`). Input with an offset is converted to UTC; input **without** an offset is treated as UTC. Query-string datetimes follow the same rule. |
| Guid | Lower-case hyphenated string. Malformed path/body guid gives 400 (same as legacy). |
| Auth | `Authorization: Bearer <Entra access token>` on every route except health checks. Token: audience `api://{clientId}` (or bare client id), v1 or v2 issuer of the configured tenant, scope `user_impersonation` (ADR-0005, Q-014). No other custom headers. |
| Identity | The caller's identity is **always taken from the token** (SEC-03): `oid` as stable id, name from `unique_name`, then `upn`, then `preferred_username`. Identity-like body fields are ignored. |
| CORS | Configurable origin allow-list (`TIM_CORS_ALLOWED_ORIGINS`), default none (same-origin via web proxy) (SEC-05). |
| Success codes | 200 with body, 201 with body on create, 202 for a run that is still executing, 204 for success with no body. Never 200 with empty body (BUG-04). |
| Validation errors | **400** (not FastAPI's default 422) for any body/query/path validation failure, including unparseable JSON. |
| Trace header | Every response carries `x-trace-id` (equal to the error body `traceId`). The request may supply a W3C `traceparent` or `x-request-id`, which is reused. CORS exposes it; allowed request headers: `Authorization`, `Content-Type`, `traceparent`, `x-request-id`. |
| Error body | Every non-2xx response, including 401, 404, 405, 500, uses one envelope, `application/problem+json` (RFC 7807 style). See below. |
| Query-run failures | A run that executed and failed is **not** an HTTP error: the run resource is returned with `status: "error"` (see endpoint 3). |
| Limits | Query-run limits from Q-021 (defaults): 100 000 rows, 64 MB serialised result, 10 min execution timeout, 1 day retention. Configurable via env. |
| Idempotency / concurrency | No ETags in phase 1. Last write wins on templates. |

### Error body (all endpoints)

```json
{
  "type": "urn:tim:problem:validation",
  "title": "Validation failed",
  "status": 400,
  "detail": "queryType 'query' requires a non-empty 'fields'",
  "traceId": "00-4bf92f3577b34da6a3ce929d0e0e4736-00f067aa0ba902b7-01",
  "errors": { "fields": ["required when queryType is 'query'"] }
}
```

| Field | Type | Always | Notes |
|---|---|---|---|
| `type` | string | yes | Stable identifier from the table below. Clients switch on this, not on `title`. |
| `title` | string | yes | Short, fixed per `type`. |
| `status` | int | yes | Equals the HTTP status. |
| `detail` | string | yes | Human-readable, safe to display. Never contains stack traces, file paths, SQL, tokens or upstream response bodies (SEC-04). |
| `traceId` | string | yes | Correlates with server logs where the full exception is logged. |
| `errors` | object `{field: string[]}` | validation only | Same shape as legacy `ValidationProblemDetails.errors`; keys are JSON field paths (`params.status.values`). |

| `type` | Status | Used for |
|---|---|---|
| `urn:tim:problem:validation` | 400 | Body/query/path validation, JSON Patch invalid, empty array, UUID mismatch. |
| `urn:tim:problem:cluster-not-allowed` | 400 | Cluster fails URL/host policy (SEC-01, Q-022). |
| `urn:tim:problem:unauthorized` | 401 | Missing/invalid/expired token. Response carries `WWW-Authenticate: Bearer`. |
| `urn:tim:problem:consent-required` | 403 | OBO exchange refused (`interaction_required` / `consent_required`). SPA re-prompts. |
| `urn:tim:problem:forbidden` | 403 | Kusto refused the user (no access to cluster/database). |
| `urn:tim:problem:not-found` | 404 | Unknown template uuid; unknown **or not owned** query run (SEC-02). |
| `urn:tim:problem:conflict` | 409 | Template uuid already exists on POST. |
| `urn:tim:problem:upstream` | 502 | Kusto / ingestion / Entra failure not attributable to the user's input. |
| `urn:tim:problem:unavailable` | 503 | Readiness failure (store unreachable). |
| `urn:tim:problem:internal` | 500 | Unhandled exception. `detail` is generic ("Internal error"). |

## 2. Endpoint catalogue

| # | Method | Path | Auth | Success | Legacy # |
|---|---|---|---|---|---|
| 1 | POST | `/api/user/authenticate` | - | **Removed** (404) | 1 |
| 2 | POST | `/api/kusto/schema` | Bearer | 200 `SchemaResponse` | 2 |
| 3 | POST | `/api/kusto/query` | Bearer | 200 / 202 `KustoQueryRun` | 3 |
| 4 | GET | `/api/kusto/query/{queryRunId}` | Bearer | 200 / 202 `KustoQueryRun` | 4 |
| 5 | GET | `/api/templates/queries` | Bearer | 200 `QueryTemplate[]` | 5 |
| 6 | GET | `/api/templates/queries/{uuid}` | Bearer | 200 `QueryTemplate` | 6 |
| 7 | POST | `/api/templates/queries` | Bearer | 201 `QueryTemplate` | 7 |
| 8 | PUT | `/api/templates/queries/{uuid}` | Bearer | 200 `QueryTemplate` | 8 |
| 9 | PATCH | `/api/templates/queries/{uuid}` | Bearer | 200 `QueryTemplate` | 9 |
| 10 | DELETE | `/api/templates/queries/{uuid}` | Bearer | 204 | 10 |
| 11 | POST | `/api/taggedevents/savedEvents` | Bearer | 204 | 11 |
| 12 | POST | `/api/taggedevents/tags` | Bearer | 204 | 12 |
| 13 | POST | `/api/taggedevents/comments` | Bearer | 204 | 13 |
| H1 | GET | `/api/healthChecks/liveness` | none | 204 | - |
| H2 | GET | `/api/healthChecks/readiness` | none | 204 / 503 | - |

Twelve live endpoints plus one removed (13 legacy endpoints, all accounted for) and two health checks. Not part of the contract (ops only): OpenAPI at `/api/openapi.json`, Swagger UI at `/api/docs`, Prometheus `/metrics`; none exposed via ingress.

The spec is checked against this catalogue by `api/tests/test_openapi_contract.py` (P2-16). Regenerate: `cd api && uv run python -m tim_api.openapi_export && UPDATE_SNAPSHOTS=1 uv run pytest tests/test_openapi_contract.py`, then `cd web && npm run gen:api`.

All Bearer endpoints can also return 401 (`unauthorized`) and 500 (`internal`); these are not repeated per endpoint.

## 3. Endpoints

### 3.1 `POST /api/user/authenticate` (removed)

- **Auth:** none (legacy anonymous).
- **New behaviour:** route does not exist (404 `not-found`). No `SIGNING_KEY`, `AUTH_USERNAME`, `AUTH_PASSWORD` settings; app boots without them. Test: route absent from OpenAPI, request returns 404.
- **Deviation from legacy:** removed. Legacy issued an HS256 JWT that no `[Authorize]` endpoint accepted (`backend/Tim.Backend/Controllers/External/AuthenticateExternalController.cs`). SEC-07, Q-011 (default: drop; no known external users).

### 3.2 `POST /api/kusto/schema`

Fetch the database schema for the Monaco editor, using the caller's delegated Kusto token.

- **Auth:** Bearer. Kusto access is via OBO with the caller's token; scope derived from the cluster (Q-013, BUG-09).
- **Request body** (`KustoClusterDatabase`):

| Field | Type | Required | Rules |
|---|---|---|---|
| `cluster` | string | yes | Cluster policy (see [Cluster validation](#cluster-validation)). |
| `database` | string | yes | Non-empty, max 256 chars. |

- **Responses**

| Status | Type | When |
|---|---|---|
| 200 | `SchemaResponse` | Schema fetched. |
| 400 | `validation` / `cluster-not-allowed` | Missing field, bad cluster. Checked **before** any token exchange. |
| 403 | `consent-required` / `forbidden` | OBO refused / Kusto denies the user. |
| 502 | `upstream` | Kusto or Entra failure. |

```json
{ "schema": { "Databases": { "SecurityLogs": { "Name": "SecurityLogs", "Tables": { "SignInLogs": { "Name": "SignInLogs", "OrderedColumns": [ { "Name": "ReportGuid", "Type": "System.Guid", "CslType": "guid" } ] } } } } } }
```

- **Behaviour:** runs `.show schema as json` and returns the parsed JSON document under `schema`. The exact source column (`ClusterSchema` vs `DatabaseSchema`) and document shape are verified against a real cluster during the Kusto task (Q-018); the contract only guarantees `schema` is the parsed JSON object. Not cached server-side.
- **Deviation from legacy:** response is `{schema: <object>}`; legacy returned a list of row dicts and the client did `JSON.parse(data[0].ClusterSchema)` (JSON string inside JSON, `JSON.parse(undefined)` when absent, BUG-28). Cluster validation now enforced on this route (SEC-01, Q-022). OBO scope per cluster instead of fixed `help.kusto.windows.net` (BUG-09, Q-013). Wrapper shape is new: Q-028.

### 3.3 `POST /api/kusto/query`

Start a Kusto query run. Returns the run if it finishes within 1 s, otherwise 202 and the client polls endpoint 4.

- **Auth:** Bearer. The run is owned by the caller (`oid`); query executes with the caller's OBO token.
- **Request body** (`KustoQueryRequest`):

| Field | Type | Required | Rules |
|---|---|---|---|
| `cluster` | string | yes | Cluster policy ([Cluster validation](#cluster-validation)). |
| `database` | string | yes | Non-empty, max 256 chars. |
| `query` | string | yes | Non-blank, max 100 000 chars. |
| `startTime` | datetime | no | Passed to Kusto as query parameter `StartTime` (ISO 8601). |
| `endTime` | datetime | no | Passed as `EndTime`. Rule: if both set, `startTime <= endTime`, else 400 (`errors.endTime`). |
| `requestedBy` | string | no | **Ignored** if sent. Owner is the token identity (SEC-03). |

- **Responses**

| Status | Body | When |
|---|---|---|
| 200 | `KustoQueryRun` with `status` `completed` or `error` or `timedOut` | Finished within 1 s. |
| 202 | `KustoQueryRun` with `status: "created"` (no `resultData`) | Still running. |
| 400 | problem | Validation, cluster policy. |
| 403/502/503 | problem | Token exchange (OBO) runs before the run is created, so its failures return synchronously: 403 `consent-required`, 502 `upstream`, 503 `unavailable`. Kusto execution errors occur inside the run and surface as `status: "error"` (`mainError`). |

```json
{
  "kustoQuery": { "cluster": "https://contoso.westus2.kusto.windows.net", "database": "SecurityLogs", "requestedBy": "alice@contoso.com", "startTime": "2026-03-13T00:00:00Z", "endTime": "2026-03-14T00:00:00Z", "query": "SignInLogs | take 2" },
  "executeDateTimeUtc": "2026-03-14T09:31:02.114Z",
  "queryRunId": "c1b7f1f6-9a34-4a52-8c1e-5f2e0f7b2a90",
  "status": "created",
  "resultData": null, "executionMetrics": null, "mainError": null,
  "expiresAt": "2026-03-15T09:31:02.114Z"
}
```

- **Behaviour**
  - Lifecycle: persist run `created` (owner, `expiresAt = now + retention`), start a tracked in-process task, wait up to 1 s, respond 200 or 202.
  - Execution: V2 response; rows of all `PrimaryResult` tables concatenated into one flat list of dicts; `QueryCompletionInformation` Stats row becomes `executionMetrics`; progressive frames give `status: "error"`.
  - Value serialisation (grid parity, unchanged): datetime to ISO string, timespan to `"hh:mm:ss"`, dynamic to nested JSON, null to `null`, guid to string.
  - Limits (Q-021): more than `MAX_RESULT_ROWS` rows or `MAX_RESULT_BYTES` serialised gives `status: "error"`, `resultData: null`, `mainError` "Result exceeds limit of ..." (no truncation). Execution beyond `QUERY_TIMEOUT_SECONDS` gives `status: "timedOut"` with a `mainError` message.
  - NUL characters (U+0000) in `resultData` strings/keys and `mainError` are replaced with U+FFFD (PostgreSQL JSONB cannot store them); `query`/`database` containing NUL are rejected with 400. No `Location` header on 202. Unexpected server failures give `status: "error"` with `mainError` "The query failed unexpectedly".
  - `mainError` is the outermost Kusto error message (safe text); stack trace is logged with `traceId`, never returned.
  - Startup recovery: runs left `created` after a restart are marked `error` with `mainError: "Run interrupted by server restart"`.
  - Terminal state is persisted before the response or the next poll can observe it. `expiresAt` is refreshed on completion, so every run expires the same way.
- **Deviation from legacy:** (a) cluster validation enforced (SEC-01, Q-022); (b) `requestedBy` ignored, owner from token (SEC-03); (c) `stackTrace` removed (SEC-04); (d) row/size/time limits and `timedOut` now set (BUG-02, Q-021); (e) uniform retention, new `expiresAt` field (BUG-01, Q-021); (f) errors use the problem envelope with 400 for all validation (Q-008). Kept: 200/202 split and execution errors as 200 `status:"error"` (the run is a resource; failure is a valid final state) - Q-007, Q-008.

### 3.4 `GET /api/kusto/query/{queryRunId}`

Poll a run.

- **Auth:** Bearer; caller must own the run.
- **Path:** `queryRunId` guid.
- **Responses**

| Status | Body | When |
|---|---|---|
| 200 | `KustoQueryRun` (`completed`, `error`, `timedOut`) | Run finished. |
| 202 | `KustoQueryRun` (`created`) | Still running. |
| 400 | problem | Malformed guid. |
| 404 | `not-found` | No such run, run expired, **or owned by someone else** (identical response, no existence leak, SEC-02). |

- **Behaviour:** read-only, safe to poll; clients back off 500 ms doubling every 3 polls, cap 30 s, give up after 11 min (server timeout 10 min + margin, Q-021). A run whose `expiresAt` has passed is 404 even if the cleanup task has not yet deleted it.
- **Deviation from legacy:** ownership enforced (SEC-02); `timedOut` reachable (BUG-02); no `stackTrace` (SEC-04); 404 uses problem envelope.

### 3.5 `GET /api/templates/queries`

List templates.

- **Auth:** Bearer. All authenticated users see all templates (legacy parity; templates are shared, Q-020 only affects attribution).
- **Query parameters**

| Name | Type | Default | Rules |
|---|---|---|---|
| `since` | datetime | none | Returns templates with `updated > since` (strict). |
| `includeDeleted` | bool | **`false`** | `true` includes soft-deleted templates. |

- **Responses:** 200 `QueryTemplate[]` ordered by `updated` ascending, then `uuid` (`[]` when none); 400 for unparseable `since` / `includeDeleted`.

```json
[ { "uuid": "3f0c2a52-6d0e-4a1b-9a57-0d2d6b8f1c11", "name": "Sign-ins by user", "isDeleted": false, "queryType": "query", "updated": "2026-03-14T09:30:00Z", "...": "see QueryTemplate" } ]
```

- **Behaviour:** filtering and ordering done in the store query. Full template bodies returned (no paging in phase 1). The SPA passes `includeDeleted=true` explicitly for the Query Manager.
- **Deviation from legacy:** `includeDeleted` absent now excludes deleted (BUG-05, Q-008); deterministic ordering (legacy unspecified).

### 3.6 `GET /api/templates/queries/{uuid}`

- **Auth:** Bearer. **Path:** `uuid` guid.
- **Responses:** 200 `QueryTemplate` (soft-deleted templates are returned with `isDeleted: true`, as legacy); 400 malformed guid; 404 `not-found`.
- **Deviation from legacy:** none (404 body now problem envelope).

### 3.7 `POST /api/templates/queries`

Create a template.

- **Auth:** Bearer.
- **Request body:** `QueryTemplate` (see [schema](#querytemplate)). Client supplies `uuid` (the SPA generates it; Import uses it). Server-owned fields (`createdBy`, `updatedBy`, `updated`) are **ignored** if sent. `isDeleted` must be absent or `false`.
- **Responses**

| Status | Body | When |
|---|---|---|
| 201 | stored `QueryTemplate`; `Location: /api/templates/queries/{uuid}` | Created. |
| 400 | `validation` | Schema/rule failure (rules listed under `QueryTemplate`), `isDeleted: true`. |
| 409 | `conflict` | A template with this uuid exists (deleted or not). |

- **Behaviour:** `createdBy = updatedBy` = caller name from token, `updated = now (UTC)`.
- **Deviation from legacy:** 201 with body instead of 200 empty (BUG-04, Q-008); duplicate is 409 instead of 400 plain string; `createdBy`/`updatedBy` from token (SEC-03, Q-020).

### 3.8 `PUT /api/templates/queries/{uuid}`

Replace the mutable fields of an existing template.

- **Auth:** Bearer. **Path:** `uuid` guid.
- **Request body:** `QueryTemplate`; body `uuid` must equal the path uuid.
- **Responses:** 200 stored `QueryTemplate`; 400 (`validation`, including "UUIDs don't match" as `errors.uuid`); 404 `not-found` (PUT never creates).
- **Behaviour:** replaces `name`, `isManaged`, `queryType`, `menu`, `summary`, `path`, `cluster`, `database`, `columnId`, `params`, `fields`, `columns`, `query`. **Preserved from the stored record:** `uuid`, `createdBy`, `isDeleted` (client values ignored; delete/restore via endpoints 10 and 9). Server sets `updatedBy` (token) and `updated` (now UTC). Full re-validation.
- **Deviation from legacy:** PUT is update-only, no upsert (BUG-06); `createdBy`/`isDeleted` no longer client-controlled (BUG-06, SEC-03, Q-020); 200 with body instead of empty (BUG-04).

### 3.9 `PATCH /api/templates/queries/{uuid}`

Partial update, RFC 6902 JSON Patch (used for restore: `[{"op":"replace","path":"/isDeleted","value":false}]`).

- **Auth:** Bearer. **Path:** `uuid` guid.
- **Request body:** JSON array of patch operations (`Content-Type: application/json-patch+json` or `application/json`). Supported ops: `add`, `replace`, `remove`, `test`. `move`/`copy` rejected (400). Paths are JSON pointers into the `QueryTemplate` JSON (camelCase).
- **Responses:** 200 stored `QueryTemplate`; 400 (`validation`: empty/missing patch, invalid op or path, patch touches a protected path, result invalid); 404 `not-found`.
- **Behaviour:** load, apply patch, **re-validate the result with the same rules as POST**, persist atomically. Protected paths (400 if targeted): `/uuid`, `/createdBy`, `/updatedBy`, `/updated`. `/isDeleted` is allowed (restore). Server sets `updatedBy`/`updated`.
- **Deviation from legacy:** result re-validated (BUG-06); protected paths; 200 with body instead of 204 (Q-008: the SPA's restore flow can refresh from the response). Legacy actually returned 400 plain string on model-state errors but did not run the `IValidatableObject` rules.

### 3.10 `DELETE /api/templates/queries/{uuid}`

Soft delete.

- **Auth:** Bearer. **Path:** `uuid` guid.
- **Responses:** 204; 400 malformed guid; 404 `not-found`.
- **Behaviour:** sets `isDeleted = true`, `updatedBy`, `updated`. Idempotent: deleting an already-deleted template returns 204 without writing. Hard delete does not exist.
- **Deviation from legacy:** missing uuid gives 404 instead of 500 NullReference (BUG-03).

### 3.11-3.13 Tagged events

| # | Route | Body item |
|---|---|---|
| 11 | `POST /api/taggedevents/savedEvents` | `SavedEvent` |
| 12 | `POST /api/taggedevents/tags` | `EventTag` |
| 13 | `POST /api/taggedevents/comments` | `EventComment` |

Common to all three: append rows to the Kusto tag tables `SavedEvent`, `EventTag`, `EventComment` (database `KUSTO_DATABASE_NAME`, default `Research`).

- **Auth:** Bearer. Ingestion runs under the **app identity** (Q-020 default); the user is recorded via `createdBy`.
- **Request body:** non-empty JSON **array** (1 to 1000 items, Q-101) of `SavedEvent` / `EventTag` / `EventComment` respectively (see [schemas](#tagged-event-bodies)).
- **Responses**

| Status | When |
|---|---|
| 204 | All rows accepted for ingestion. |
| 400 `validation` | Empty array, more than 1000 items, any item invalid (`errors` keys are `[index].field`). Nothing is ingested if any item is invalid. |
| 502 `upstream` | Ingestion failed. |

- **Behaviour:** for every item the server **overwrites** `createdBy` (caller name from token) and `dateTimeUtc` (server clock, one timestamp per request) (SEC-03). Rows are NDJSON with the `<Table>Mapping` JSON mapping (`$.camelCase` to column). Tables are append-only; deletes are new rows with `isDeleted: true`; readers use `arg_max(DateTimeUtc, ...)`. Items in one request are ingested together (single ingest call), not transactional across requests. Table creation is not done by the API (`init-kusto` CLI, Q-015).
- **Deviation from legacy:** client `createdBy` and `dateTimeUtc` ignored and server-set; `createdBy` no longer required in the request (SEC-03, Q-020); item cap and all-or-nothing validation (Q-101); 400 uses the problem envelope. 204 and empty-array-400 kept.

### 3.14 Health checks

| Path | Auth | Success | Failure |
|---|---|---|---|
| `GET /api/healthChecks/liveness` | none | 204 (process is up; no dependency checks) | - |
| `GET /api/healthChecks/readiness` | none | 204 when the PostgreSQL store answers a trivial query | 503 `unavailable` (no detail about the dependency) |

Kusto reachability is **not** part of readiness (a Kusto outage should not restart or unroute the pod); it is logged as a warning at startup.

- **Deviation from legacy:** readiness probes the store; legacy always returned 204 (`Controllers/Internal/HealthChecksController.cs`). Paths kept.

## 4. Shared schemas

Types: `string`, `bool`, `int`, `number`, `datetime` (ISO 8601 UTC), `guid`, `object` (free-form JSON), `T[]`, `{string: T}` (dictionary), `T?` (nullable/optional). "In" = accepted in requests; "Out" = returned. Server-owned = ignored on input.

### Cluster validation

Applies to `cluster` in endpoints 2 and 3 (Q-022), before any token is acquired or sent (SEC-01). Failure: 400 `cluster-not-allowed`, `errors.cluster`.

1. Absolute URL, scheme `https`, no userinfo, no fragment; port absent or 443.
2. Host must be in `TIM_ALLOWED_KUSTO_HOSTS` if that is set; otherwise host must end in one of `TIM_KUSTO_HOST_SUFFIXES` (default `.kusto.windows.net`, `.kusto.fabric.microsoft.com`).
3. The stored/echoed value is the URL as sent (scheme + host, trailing slash stripped). Bare names (`contoso.westus2`) are **not** accepted by the API; the client expands them (BUG-29).

Templates store `cluster` without policy validation (legacy parity); the policy is enforced when a query using it is run.

### QueryTemplate

Endpoints 5-9. Legacy source: `backend/Tim.Backend/Models/Templates/QueryTemplate.cs:37`.

| Field | Type | In | Out | Rules / notes |
|---|---|---|---|---|
| `uuid` | guid | required (POST); must match path (PUT) | yes | Immutable. |
| `name` | string | required | yes | Non-blank. |
| `isDeleted` | bool | POST: absent/false; PUT: ignored; PATCH: allowed | yes | Default `false`. Soft delete. |
| `isManaged` | bool | optional | yes | Default `false`. |
| `updated` | datetime | server-owned | yes | Set to now (UTC) on every write. |
| `createdBy` | string | server-owned | yes | Token name at creation; immutable. |
| `updatedBy` | string | server-owned | yes | Token name at last write. |
| `queryType` | `"view"` \| `"query"` | required | yes | When `query`, `fields` must be non-empty. |
| `menu` | string | required | yes | Non-blank. |
| `summary` | string | required | yes | Non-blank. |
| `path` | string[] | required | yes | Menu path segments; required, non-null (legacy parity). |
| `cluster` | string | required | yes | Not policy-validated at save. |
| `database` | string | required | yes | Non-blank. |
| `columnId` | string? | optional | yes | |
| `params` | {string: QueryParam}? | optional | yes | Keyed by param name. |
| `fields` | {string: QueryField}? | conditional | yes | Required and non-empty when `queryType == "query"`. |
| `columns` | {string: object}? | optional | yes | Free-form column definitions, stored as JSONB, returned unchanged. |
| `query` | string | required | yes | Non-blank query text (Handlebars source; rendered client-side). |

Validation messages (one per failing rule, all reported, unlike legacy's if/else chain which yielded one): `fields` required when `queryType` is `query`; `QueryParam.values` required and non-empty when `type == "array"`; `QueryField.from` required when `type == "multiple"`; `QueryField.regex` required when `type == "match"`.

`QueryParam` (`Models/Templates/QueryParam.cs:15`): `type` string required; `default` object? ; `optional` bool?; `multiple` bool?; `hint` string?; `values` string[]? (required non-empty when `type == "array"`).

`QueryField` (`Models/Templates/QueryField.cs:14`): `type` string required (`multiple` \| `match` known; other values accepted); `from` string? (required when `multiple`); `regex` string? (required when `match`; must compile as a regular expression).

Example: see `data-models.md` "Server examples / QueryTemplate"; valid unchanged.

### SchemaResponse

| Field | Type | Out | Notes |
|---|---|---|---|
| `schema` | object | yes | Parsed Kusto `.show schema as json` document; passed through untouched (Q-018, Q-028). |

### KustoQueryRequest

Request body of endpoint 3; fields in [3.3](#33-post-apikustoquery). `KustoClusterDatabase` (endpoint 2) is the `cluster` + `database` subset.

### KustoQueryRun

Response of endpoints 3 and 4. Legacy source: `Models/KustoQuery/KustoQueryRun.cs:49`.

| Field | Type | Out | Notes |
|---|---|---|---|
| `queryRunId` | guid | always | Server-generated. |
| `status` | `"created"` \| `"completed"` \| `"error"` \| `"timedOut"` | always | `created` = running (HTTP 202); others are final (HTTP 200). |
| `kustoQuery` | `KustoQueryEcho` | always | Echo of the request. |
| `executeDateTimeUtc` | datetime | always | Run creation time (server). |
| `expiresAt` | datetime | always | **New.** After this instant the run is 404. |
| `resultData` | `{string: any}[]`? | `completed` only, else `null` | Rows keyed by raw Kusto column names; values per serialisation rules in 3.3. |
| `executionMetrics` | `KustoQueryStats`? | `completed` when Kusto returned Stats, else `null` | Snake_case keys as Kusto returns them. |
| `mainError` | string? | `error` / `timedOut`, else `null` | Safe message; no stack trace. |

`KustoQueryEcho`: `cluster`, `database`, `query` (string), `startTime`, `endTime` (datetime?), `requestedBy` (string, the token identity; kept for parity, read-only).

`KustoQueryStats` (`Models/KustoQuery/KustoQueryStats.cs:12`): `execution_time` number (seconds); `resource_usage` object?; `input_dataset_statistics` object?; `dataset_statistics` object[]?. Inner shapes are Kusto's; clients must not assume fixed keys.

Removed vs legacy: `stackTrace`.

Examples: completed run as in `data-models.md` "KustoQueryRun (completed)" plus `expiresAt` and without `stackTrace`. Error and timeout:

```json
{ "queryRunId": "0a4d6a1e-3b7c-4f0e-b1d2-77c9e8a5d411", "status": "error", "resultData": null, "executionMetrics": null,
  "mainError": "Semantic error: 'where' operator: Failed to resolve scalar expression named 'NoSuchColumn'",
  "kustoQuery": { "cluster": "https://contoso.westus2.kusto.windows.net", "database": "SecurityLogs", "requestedBy": "alice@contoso.com", "startTime": null, "endTime": null, "query": "SignInLogs | where NoSuchColumn == 1" },
  "executeDateTimeUtc": "2026-03-14T09:35:47.902Z", "expiresAt": "2026-03-15T09:35:48.610Z" }
```

### Tagged event bodies

Request bodies are arrays of the items below. Legacy sources: `Models/TaggedEvents/*.cs`.

**SavedEvent** (endpoint 11)

| Field | Type | Required | Notes |
|---|---|---|---|
| `eventId` | string | yes | Non-blank, e.g. ReportGuid. |
| `eventTime` | datetime | yes | Source event time (e.g. ReportTime). |
| `eventAsJson` | {string: any} | yes | Raw event, stored as Kusto `dynamic`. Serialised size cap 1 MB per item (Q-101). |
| `createdBy` | string | no, ignored | Server-set from token. |
| `dateTimeUtc` | datetime | no, ignored | Server-set. |

**EventTag** (endpoint 12)

| Field | Type | Required | Notes |
|---|---|---|---|
| `eventId` | string | yes | Links to `SavedEvent.eventId`. |
| `tag` | string | yes | Non-blank. |
| `isDeleted` | bool | no | Default `false`. `true` appends a deletion row. |
| `createdBy` / `dateTimeUtc` | | no, ignored | Server-set. |

**EventComment** (endpoint 13)

| Field | Type | Required | Notes |
|---|---|---|---|
| `eventId` | string | yes | |
| `determination` | string | yes | Free string (e.g. `malicious`, `suspicious`); non-blank. |
| `comment` | string? | no | |
| `isDeleted` | bool | no | Default `false`. |
| `createdBy` / `dateTimeUtc` | | no, ignored | Server-set. |

Ingested column mapping unchanged from legacy (`backend-api.md` "Kusto tables").

### Problem

See [Error body](#error-body-all-endpoints).

## Deviations summary

Reference: Q-008 (fix quirks; the React client is new). "Kept" items that were considered are listed at the end.

| # | Endpoint | Legacy behaviour | New behaviour | Reason |
|---|---|---|---|---|
| D1 | 1 `/api/user/authenticate` | Issues an HS256 token no endpoint accepts; app needs its secrets to boot | Removed; secrets not required | SEC-07, Q-011 |
| D2 | 2, 3 | Cluster validation absent on query (`KustoQuery.cs:46` discards result); user OBO token sent to any URL | https + host suffix/allow-list checked before any token use, on both routes | SEC-01, Q-022 |
| D3 | 3 | `requestedBy` accepted from body | Ignored; owner and echoed `requestedBy` from token | SEC-03 |
| D4 | 4 | Any user can read any run | 404 unless caller owns the run (same as not found) | SEC-02 |
| D5 | 3, 4 | `stackTrace` returned | Field removed; only safe `mainError`; trace logged with `traceId` | SEC-04 |
| D6 | 3, 4 | No timeout/size cap; runs stuck in `created`; `timedOut` never set | Limits (100k rows, 64 MB, 10 min); `timedOut` set; restart sweep marks stuck runs `error` | BUG-02, Q-021 |
| D7 | 3, 4 | Retention depends on store (TTL cleared, ignored, or index) | `expiresAt` field, uniform expiry, expired = 404 | BUG-01, Q-021, ADR-0004 |
| D8 | 2 | Row list; client parses `data[0].ClusterSchema` string | `{schema: <object>}` | Q-008, BUG-28, Q-018, Q-028 |
| D9 | 2, 3 | OBO scope fixed `help.kusto.windows.net`; MSAL app per request | Scope per cluster (configurable), shared token cache | BUG-09, Q-013 |
| D10 | 5 | `includeDeleted` absent includes deleted; in-memory filter; unordered | Absent excludes; store-side filter; ordered by `updated`, `uuid` | BUG-05, Q-008 |
| D11 | 7 | 200 empty; duplicate is 400 plain string | 201 + body + `Location`; duplicate 409 | BUG-04, Q-008 |
| D12 | 7, 8, 9, 10 | `createdBy`/`updatedBy` from client or `User.Identity.Name` (null-prone) | Always token identity; `createdBy` immutable; server-owned `updated` | SEC-03, Q-020 |
| D13 | 8 | Blind upsert; trusts `createdBy`/`isDeleted`; 200 empty | Update-only (404 if missing); protected fields preserved; 200 + body | BUG-06, BUG-04 |
| D14 | 9 | Patched result not validated by rules; 204 | Re-validated; protected paths; 200 + body | BUG-06, Q-008 |
| D15 | 10 | Missing uuid gives 500 | 404 | BUG-03 |
| D16 | 11-13 | `createdBy`, `dateTimeUtc` trusted from client | Server-set; ignored in body; item cap 1000; all-or-nothing validation | SEC-03, Q-020, Q-101 |
| D17 | all | 400 as `ValidationProblemDetails` or plain string; 500 empty body; 404 empty | One RFC 7807-style envelope with `type`, `traceId`, optional `errors`; validation always 400 | Q-008, SEC-04, BUG-40, Q-102 |
| D18 | all | CORS any origin | Configurable allow-list, default none | SEC-05 |
| D19 | H2 | Readiness always 204 | 204 only if store reachable, else 503 | Q-008 |
| D20 | 5-9 | Template validation reports one error (if/else chain) | Reports all failing rules | Q-008 |

Considered and **kept**: paths and JSON field names; 200/202 split and execution errors as 200 `status:"error"` on the run resource (Q-007, Q-008); soft delete via DELETE; JSON Patch for PATCH; 204 for tagged events; Kusto rows concatenated across `PrimaryResult` tables; Kusto parameters `StartTime`/`EndTime`; app-identity ingestion (Q-020).

## Test checklist

For P2 (each item is at least one pytest case; RULES section 6 requires happy path + main error per endpoint).

| Area | Cases |
|---|---|
| Auth | No/invalid/expired token gives 401 problem; v1 and v2 tokens accepted; wrong `aud` rejected; name claim fallback order; `/api/user/authenticate` is 404. |
| Errors | Every error response matches the envelope; 500 contains no trace or paths; malformed guid and body are 400 not 422. |
| Cluster (D2) | `http://`, userinfo, unknown suffix, allow-list on/off; no token acquisition on rejection (fake `TokenProvider` asserts not called). |
| Runs | Fast run 200; slow run 202 then poll to 200; execution error is 200 `status:"error"` without `stackTrace`; row cap, byte cap, timeout; other user gets 404; expired gets 404; restart sweep. |
| Templates | List defaults (`includeDeleted`, `since`, ordering); POST 201/409/400 and ignored server-owned fields; PUT 404 on missing and preserved protected fields; PATCH restore, protected path, invalid result; DELETE 204/404/idempotent. |
| Tagged events | Server overwrites `createdBy`/`dateTimeUtc` (fake `IngestGateway` inspects rows); empty array 400; >1000 items 400; one invalid item ingests nothing. |
| Health | Liveness 204; readiness 503 with a failing repository fake. |
| Contract | Field names and example payloads in this file validate against the Pydantic models. |
