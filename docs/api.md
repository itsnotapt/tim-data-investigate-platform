# HTTP API

Reference for the TIM API (`api/`). System context: [architecture.md](architecture.md). Settings that affect the API: [configuration.md](configuration.md).

- Live OpenAPI: `/api/docs` (Swagger UI) and `/api/openapi.json`.
- Snapshot: `web/src/lib/api/openapi.json`, regenerated from `api/` with `uv run python -m tim_api.openapi_export`.
- Web types: `npm run gen:api` in `web/` generates `web/src/lib/api/schema.d.ts` from the snapshot.

## Conventions

| Topic | Rule |
|---|---|
| Base path | All routes start with `/api`. nginx forwards `/api/` unchanged. |
| Authentication | `Authorization: Bearer <Entra access token>` for the audience `api://<clientId>` on every route except the health checks. A missing or invalid token gives `401` with `WWW-Authenticate: Bearer`. |
| Identity | The caller's name comes from the token. Identity fields in request bodies (`requestedBy`, `createdBy`, `updatedBy`, `updated`, `dateTimeUtc`) are ignored. |
| JSON | UTF-8. Property names are camelCase; unknown request properties are ignored. Exception: keys inside `executionMetrics` are Kusto's snake_case. |
| Timestamps | ISO 8601 UTC with `Z`, with milliseconds only when non-zero. Input with an offset is converted to UTC; input without an offset is read as UTC. |
| Status codes | `200`/`201` with a body, `202` while a query run is pending, `204` without a body. |
| Errors | `application/problem+json`, see [Errors](#errors). |
| Trace id | Every response has `x-trace-id`. The server accepts a W3C `traceparent` or an `x-request-id` (`[A-Za-z0-9._-]`, up to 128 characters) and otherwise generates one. |
| Headers | Responses carry `x-content-type-options: nosniff` and `cache-control: no-store`. |
| CORS | Only for origins in `TIM_CORS_ALLOWED_ORIGINS`; the SPA is normally same-origin. |
| Body size | Above `TIM_MAX_REQUEST_BYTES` (default 16 MiB) gives `413`. |

## Endpoints

| Method | Path | Success | Errors | Purpose |
|---|---|---|---|---|
| GET | `/api/healthChecks/liveness` | 204 | none | Process is up. No checks; no auth. |
| GET | `/api/healthChecks/readiness` | 204 | 503 | Storage is reachable. Kusto is not checked; no auth. |
| POST | `/api/kusto/schema` | 200 | 400, 401, 403, 502, 503 | `.show schema as json` for a cluster database. |
| POST | `/api/kusto/query` | 200 or 202 | 400, 401, 403, 502, 503 | Start a query run. |
| GET | `/api/kusto/query/{queryRunId}` | 200 or 202 | 400, 401, 404 | Read a query run. |
| GET | `/api/templates/queries` | 200 | 400, 401 | List templates. |
| GET | `/api/templates/queries/{uuid}` | 200 | 400, 401, 404 | Get one template (soft-deleted included). |
| POST | `/api/templates/queries` | 201 | 400, 401, 409 | Create a template. `Location: /api/templates/queries/{uuid}`. |
| PUT | `/api/templates/queries/{uuid}` | 200 | 400, 401, 404 | Replace the editable fields. |
| PATCH | `/api/templates/queries/{uuid}` | 200 | 400, 401, 404 | Apply a JSON Patch (RFC 6902). |
| DELETE | `/api/templates/queries/{uuid}` | 204 | 400, 401, 404 | Soft delete (idempotent). |
| POST | `/api/taggedevents/savedEvents` | 204 | 400, 401, 502 | Save events (rows) to `SavedEvent`. |
| POST | `/api/taggedevents/tags` | 204 | 400, 401, 502 | Add or remove tags in `EventTag`. |
| POST | `/api/taggedevents/comments` | 204 | 400, 401, 502 | Add or remove comments in `EventComment`. |

Every authenticated route can also return `500`. A malformed path parameter (for example a non-UUID) is a `400` validation error.

## Errors

Every non-2xx response has this body:

```json
{
  "type": "urn:tim:problem:validation",
  "title": "Validation failed",
  "status": 400,
  "detail": "One or more fields are invalid",
  "traceId": "00-4bf92f3577b34da6a3ce929d0e0e4736-00f067aa0ba902b7-01",
  "errors": { "database": ["must not be blank"] }
}
```

`errors` appears only for validation failures: it maps a field path (JSON names, dotted; array items by index) to messages. `detail` is a fixed, safe string and never contains stack traces, SQL, tokens or upstream bodies; clients switch on `type`.

| Status | `type` slug | Cause |
|---|---|---|
| 400 | `validation` | Invalid body, query or path; malformed JSON; NUL character in `query` or `database`. |
| 400 | `cluster-not-allowed` | Cluster URL rejected, `errors.cluster` has the reason. |
| 401 | `unauthorized` | Missing, malformed, expired or otherwise invalid token. |
| 403 | `consent-required` | The token cannot be exchanged for the cluster (sign-in or consent needed). The SPA prompts again. |
| 403 | `forbidden` | Kusto denied the user access to the cluster or database. |
| 404 | `not-found` | Unknown template, or a query run that is unknown, expired or owned by someone else. |
| 409 | `conflict` | A template with that `uuid` already exists (including soft-deleted). |
| 413 | `too-large` | Request body over the size limit. |
| 500 | `internal` | Unhandled error; details are in the server log under the `traceId`. |
| 502 | `upstream` | Entra unreachable, Kusto schema failure, or tag ingestion failure. |
| 503 | `unavailable` | Storage down, or token exchange unavailable (auth disabled). |

## Kusto

### POST /api/kusto/schema

Body: `{ "cluster": "https://...", "database": "..." }`. Validates the cluster, exchanges the token, runs `.show schema as json` and returns `{ "schema": { ... } }` with the parsed schema document unchanged. `403` when Kusto denies access, `502` when Kusto fails or returns an unrecognised result.

### POST /api/kusto/query

Request (`KustoQueryRequest`):

| Field | Type | Rules |
|---|---|---|
| `cluster` | string | Required; see [Cluster validation](#cluster-validation). |
| `database` | string | Required, 1 to 256 characters. |
| `query` | string | Required, not blank, at most 100,000 characters. |
| `startTime`, `endTime` | datetime | Optional; `endTime` must not be earlier than `startTime`. Passed to Kusto as the query parameters `StartTime` and `EndTime`. |

Token errors (`401`, `403`, `502`, `503`) are returned before a run exists. Otherwise the response is the run: `200` if it finished within about one second, else `202` with `status: "created"`; poll the GET route.

### GET /api/kusto/query/{queryRunId}

Returns `202` while the run is `created` and `200` once it is `completed`, `error` or `timedOut`. Only the owner can read a run. Runs expire `TIM_RUN_RETENTION_SECONDS` (default 24 h) after their last update.

### KustoQueryRun

| Field | Type | Notes |
|---|---|---|
| `queryRunId` | uuid | |
| `status` | `created` \| `completed` \| `error` \| `timedOut` | |
| `kustoQuery` | object | Echo of the request: `cluster` (normalised), `database`, `query`, `startTime`, `endTime`, and `requestedBy` (the token identity). |
| `executeDateTimeUtc` | datetime | When the run was created. |
| `expiresAt` | datetime | |
| `resultData` | array of objects \| null | Rows as column-name to value objects; only when `completed`. Kusto `datetime` values are ISO strings with `Z`, `timespan` is `[-][d.]hh:mm:ss[.fffffff]`, `dynamic` is parsed JSON, `guid` is a string, `decimal` is a number when exact else a string. |
| `executionMetrics` | object \| null | Kusto `QueryCompletionInformation` stats: `execution_time`, `resource_usage`, `input_dataset_statistics`, `dataset_statistics`, plus other keys Kusto sends. |
| `mainError` | string \| null | User-safe message when `error` or `timedOut`. |

Failure messages: Kusto's own error text (stack-trace lines removed, at most 2000 characters); `Result exceeds limit of N rows` or `N bytes`; `Query exceeded the execution time limit of N seconds` (`timedOut`); `Run interrupted by server restart`; `The query failed unexpectedly`.

### Limits

| Limit | Default | Setting |
|---|---|---|
| Rows per result | 100,000 | `TIM_MAX_RESULT_ROWS` |
| Result size (serialised) | 64 MiB | `TIM_MAX_RESULT_BYTES` |
| Execution time | 600 s | `TIM_QUERY_TIMEOUT_SECONDS` |
| Run retention | 86,400 s | `TIM_RUN_RETENTION_SECONDS` |
| Concurrent runs per process | 16 | `TIM_MAX_CONCURRENT_RUNS` |
| Request body | 16 MiB | `TIM_MAX_REQUEST_BYTES` |

A result over a row or size limit makes the run `error`; it is not truncated. Runs waiting for a free slot stay `created`.

### Cluster validation

Applied to `cluster` before any token exchange. On success the value is normalised to `https://<lowercase ascii host>`; otherwise `400 cluster-not-allowed`.

- Absolute `https://` URL, no whitespace or control characters.
- No credentials, query, fragment or path (a trailing `/` is accepted); no IP address literals.
- Port omitted or `443`.
- Host is a valid domain name (internationalised names are converted to punycode).
- The host must match a pattern in `TIM_ALLOWED_KUSTO_HOSTS` (exact host, `*.domain` or `**.domain`; default `**.kusto.windows.net`; see [configuration](configuration.md#cluster-allow-list)). Otherwise the reason is `Invalid cluster URL: host is not in the allowed cluster list.`

## Templates

Base path `/api/templates/queries`. Templates are shared by all users.

### GET /api/templates/queries

Query parameters: `since` (datetime; only templates with `updated` strictly after it) and `includeDeleted` (boolean, default `false`). Ordered by `updated`, then `uuid`. Returns an array of `QueryTemplate`.

### POST, PUT, PATCH, DELETE

- `POST` body is `QueryTemplateCreate`: the editable fields plus `uuid` (client-generated); `isDeleted` must be absent or `false`. `409` if the `uuid` exists. The server sets `createdBy`, `updatedBy` and `updated`.
- `PUT` body is `QueryTemplateReplace`: the editable fields plus `uuid`, which must equal the path (else `400`). Never creates (`404` if missing). `createdBy` and `isDeleted` are preserved.
- `PATCH` body is a non-empty JSON array of `{ "op", "path", "value" }` with `op` one of `add`, `replace`, `remove`, `test` (`move` and `copy` are rejected). The patch is applied to the stored template's JSON, and the result must be a valid `QueryTemplate`. Patching `/uuid`, `/createdBy`, `/updatedBy`, `/updated` (or children) is `400`; `/isDeleted` is allowed, so `[{"op":"replace","path":"/isDeleted","value":false}]` restores a deleted template.
- `DELETE` sets `isDeleted` and is idempotent. Soft-deleted templates stay readable by `GET /{uuid}`.

### QueryTemplate

| Field | Type | Rules |
|---|---|---|
| `uuid` | uuid | |
| `name`, `menu`, `summary`, `database`, `query` | string | Not blank. Handlebars sources for `summary`, `cluster`, `database` and `query` are rendered in the browser. |
| `isManaged` | boolean | Default `false`. |
| `queryType` | `view` \| `query` | |
| `path` | string[] | Menu path. |
| `cluster` | string | May be empty or a Handlebars expression; not validated as a cluster URL here. |
| `columnId` | string \| null | Row identity column. |
| `params` | map of `QueryParam` \| null | `{type, default?, optional?, multiple?, hint?, values?}`; `values` is required and non-empty when `type` is `array`. |
| `fields` | map of `QueryField` \| null | `{type, from?, regex?}`; required and non-empty when `queryType` is `query`. `from` is required for `type: multiple`; `regex` is required and must compile for `type: match`. |
| `columns` | map \| null | AG Grid column definition overrides by column name; `default` applies to all other columns. |
| `isDeleted` | boolean | Read-only except through PATCH. |
| `updated` | datetime | Server-set, millisecond precision. |
| `createdBy`, `updatedBy` | string | Server-set. |

## Tagged events

Tag rows are ingested into the tag cluster ([Kusto tables](architecture.md#kusto-tables)) with the app identity. The server sets `createdBy` (from the token) and `dateTimeUtc` (server clock) on every row. Each body is a JSON array of 1 to 1000 items; any invalid item fails the whole request with `400`. Success is `204`; an ingestion failure is `502`.

| Route | Item fields |
|---|---|
| `POST /api/taggedevents/savedEvents` | `eventId` (string, not blank), `eventTime` (datetime), `eventAsJson` (object, at most 1,000,000 bytes serialised) |
| `POST /api/taggedevents/tags` | `eventId` (not blank), `tag` (not blank), `isDeleted` (boolean, default `false`) |
| `POST /api/taggedevents/comments` | `eventId` (not blank), `determination` (not blank), `comment` (string or null), `isDeleted` (boolean, default `false`) |

Example:

```json
[{ "eventId": "e-123", "tag": "phishing", "isDeleted": false }]
```

The tables are append-only: removing a tag or comment writes a new row with `isDeleted: true`. The SPA uses `determination` values `malicious`, `suspicious`, `benign`, and `removed` (with `isDeleted: true`) to clear one; the API accepts any non-blank string. Writes are not transactional across the three routes.
