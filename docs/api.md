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
| JSON | UTF-8. TIM's own property names are camelCase; unknown request properties are ignored. Names an action defines, such as its param names and their values, pass through verbatim, and in OpenAPI that content is an open JSON value. Exception: keys inside `executionMetrics` are Kusto's snake_case. |
| Timestamps | ISO 8601 UTC with `Z`, with milliseconds only when non-zero. Input with an offset is converted to UTC; input without an offset is read as UTC. |
| Status codes | `200`/`201` with a body, `202` while a newly started run or a query run is pending, `204` without a body. |
| Errors | RFC 9457 problem details (`application/problem+json`), see [Errors](#errors). |
| Trace id | Every response has `x-trace-id`. The server accepts a W3C `traceparent` or an `x-request-id` (`[A-Za-z0-9._-]`, up to 128 characters) and otherwise generates one. |
| Headers | Responses carry `x-content-type-options: nosniff` and `cache-control: no-store`. |
| CORS | Only for origins in `TIM_CORS_ALLOWED_ORIGINS`; the SPA is normally same-origin. |
| Body size | Above `TIM_MAX_REQUEST_BYTES` (default 16 MiB) gives `413`. |

## Endpoints

| Method | Path | Success | Errors | Purpose |
|---|---|---|---|---|
| GET | `/api/healthChecks/liveness` | 204 | none | Process is up. No checks; no auth. |
| GET | `/api/healthChecks/readiness` | 204 | 503 | Storage is reachable. Kusto is not checked; no auth. |
| GET | `/api/instance` | 200 | 401 | The instance's actions, connections, labels and limits. |
| POST | `/api/actions/{key}/resolve` | 200 | 400, 401, 404, 422 | Resolve an action's params from selected result rows, for a pivot. |
| POST | `/api/runs` | 200 or 202 | 400, 401, 403, 422, 502, 503 | Start a run of an action. |
| GET | `/api/runs/{runId}` | 200 | 400, 401, 404 | Read a run. |
| POST | `/api/runs/{runId}/cancel` | 200 | 400, 401, 404 | Cancel a run (idempotent). |
| GET | `/api/runs/{runId}/rows` | 200 | 400, 401, 404, 409, 410 | Read a page of a run's rows, with their annotations. |
| PATCH | `/api/annotations` | 200 | 400, 401, 422 | Change the label of `id`s. |
| GET | `/api/annotations/changes` | 200 | 400, 401 | The change feed: the `id`s changed after a version. |
| POST | `/api/connections/{name}/schema` | 200 or 204 | 400, 401, 403, 404, 502, 503 | The editor schema of a connection, from its connection type's hook. |
| POST | `/api/kusto/schema` | 200 | 400, 401, 403, 502, 503 | `.show schema as json` for a cluster database. |
| POST | `/api/kusto/query` | 200 or 202 | 400, 401, 403, 502, 503 | Start a query run. |
| GET | `/api/kusto/query/{queryRunId}` | 200 or 202 | 400, 401, 404 | Read a query run. |
| GET | `/api/templates/queries` | 200 | 400, 401 | List templates. |
| GET | `/api/templates/queries/{uuid}` | 200 | 400, 401, 404 | Get one template (soft-deleted included). |
| POST | `/api/templates/queries` | 201 | 400, 401, 409 | Create a template. `Location: /api/templates/queries/{uuid}`. |
| PUT | `/api/templates/queries/{uuid}` | 200 | 400, 401, 404 | Replace the editable fields. |
| PATCH | `/api/templates/queries/{uuid}` | 200 | 400, 401, 404 | Apply a JSON Patch (RFC 6902). |
| DELETE | `/api/templates/queries/{uuid}` | 204 | 400, 401, 404 | Soft delete (idempotent). |
| GET | `/api/presets` | 200 | 400, 401 | List your presets and the shared ones. |
| POST | `/api/presets` | 201 | 400, 401, 422 | Create a preset. |
| PUT | `/api/presets/{presetId}` | 200 | 400, 401, 403, 404, 422 | Replace a preset (owner only). |
| DELETE | `/api/presets/{presetId}` | 204 | 400, 401, 403, 404 | Delete a preset for good (owner only). |
| PUT | `/api/presets/{presetId}/hidden` | 204 | 400, 401, 404 | Hide a preset for yourself (idempotent). |
| DELETE | `/api/presets/{presetId}/hidden` | 204 | 400, 401, 404 | Unhide a preset for yourself (idempotent). |
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

`errors` appears only for validation failures: it maps a field path (JSON names, dotted; array items by index; a run's params as `params.<name>`) to messages. `detail` is a fixed, safe string and never contains stack traces, SQL, tokens or upstream bodies; clients switch on `type`.

| Status | `type` slug | Cause |
|---|---|---|
| 400 | `validation` | Invalid body, query or path; malformed JSON; NUL character in `query` or `database`; `endRow` less than `startRow`; no `ids`, or an `id` over 512 characters, in an annotations change; a negative `since`. |
| 400 | `cluster-not-allowed` | Cluster URL rejected, `errors.cluster` has the reason. |
| 401 | `unauthorized` | Missing, malformed, expired or otherwise invalid token. |
| 403 | `consent-required` | The token cannot be exchanged for a connection's scope or the cluster (sign-in or consent needed). The SPA prompts again. |
| 403 | `forbidden` | Kusto denied the user access to the cluster or database. Or a change to a preset the caller does not own. |
| 404 | `not-found` | Unknown template or action, or a run or query run that is unknown, expired or owned by someone else. An unknown preset, or someone else's private one. |
| 409 | `conflict` | A template with that `uuid` already exists (including soft-deleted). |
| 409 | `run-not-succeeded` | Rows were requested for a run that isn't `succeeded`. |
| 410 | `results-gone` | A `succeeded` run with rows has none stored any more, after a database crash or failover. Run it again. |
| 413 | `too-large` | Request body over the size limit. |
| 422 | `validation` | A well-formed run request with an unknown action (`errors.action`) or invalid params (`errors["params.<name>"]`). A resolve request the action isn't offered on (`errors["pivot.rows"]`). A preset with an unknown action (`errors.action`) or an input that is not a param of the action with `fromColumns` (`errors["inputs.<i>.name"]`). A well-formed annotations change with an unknown label (`errors.label`), more `id`s than `maxAnnotationIds` (`errors.ids`), or no change field (`errors.body`). |
| 500 | `internal` | Unhandled error; details are in the server log under the `traceId`. |
| 502 | `upstream` | Entra unreachable, token exchange failure, Kusto schema failure, or tag ingestion failure. |
| 503 | `unavailable` | Storage down, or token exchange unavailable (auth disabled, or no OBO credential configured and no connection using `obo`). |

## Instance

### GET /api/instance

What the browser needs to know about this instance, built once at startup from the installed providers and the action files ([architecture.md](architecture.md#actions-and-providers)):

```
{version, actions: [Action], connections: [Connection], labels: [Label], limits}
```

- `version`: a hash of the installed provider distributions, the content of every action file and sidecar read, the connections file, the labels file, and the rest of this body. It changes when any of them does, for example after a rolling update.
- `actions`: the catalogue: the providers' Python actions in provider order, then the actions from each provider's package data, then those from `TIM_ACTIONS_DIR`, each directory in file name order. An action is `{key, kind, name, description?, menuPath, connections, params, pivot, columns?}`:
  - `kind` is `query`.
  - `menuPath` is the action's `/`-separated `menu`, one entry per folder, `[]` at the top level.
  - `connections` names the fixed connections the action uses.
  - `params` is `[{name, title, kind, required, default?, many, choices?, connectionType?, fromColumns?, schemaFrom?, help?}]`. `default` and `choices` are values as the browser sends them.
  - `pivot` is `{rows: "row" | "rows", columns: [[alternatives]]}`, or `null` for an action that isn't offered in the grid's context menu. A row matches when it has one column from each group.
  - `columns` is `[{name, type, title?, hidden, width?, pinned?, sort?, group, calculated?}]`, the result columns the action declares ([actions.md](actions.md#columns)); it is left out when the action declares none.
- `connections`: the connections file's connections, in file order, each `{name, type, title, editor, databases?}`. `editor` is the connection type's editor (`kql`). `databases` are the suggestions a Kusto connection lists. Never its cluster, auth or scope.
- `labels`: the labels file's labels in file order, each `{key, name, colour, symbol?}` ([actions.md](actions.md#labels-file)). Without the file they are Malicious, Suspicious and Benign. `colour` is one of `red`, `amber`, `green`, `teal`, `blue`, `purple`, `pink` or `grey`. `symbol` is one of `skull`, `warning`, `check`, `flag`, `star`, `question`, `block`, `bug` or `eye`.
- `limits`: `{maxResultRows, maxResultBytes, maxPivotRows, rowsPageSize, runTimeoutSeconds, maxAnnotationIds, annotationPollSeconds}`, from `TIM_MAX_RESULT_ROWS`, `TIM_MAX_RESULT_BYTES`, `TIM_MAX_PIVOT_ROWS`, `TIM_ROWS_PAGE_SIZE`, `TIM_RUN_TIMEOUT_SECONDS`, `TIM_MAX_ANNOTATION_IDS` and `TIM_ANNOTATION_POLL_SECONDS`.

Keys marked `?` are left out when they have no value.

## Actions

### POST /api/actions/{key}/resolve

The params of a pivot into an action, resolved from result rows the analyst selected ([actions.md](actions.md#params)).

Body: `{"pivot": {"rows": [{"<column>": <value>}], "cell": {"column": "<column>", "value": <value>}}}`.

- `rows` has at least one row, each a mapping of column name to value. The browser sends only the columns the action's `pivot.columns` and its params' `fromColumns` name; the server trims the rest.
- `cell` is the right-clicked cell. It may be left out.

Response: `{params, missing, reasons}`.

- `params` maps param names to the resolved values, as the browser sends them.
- `missing` lists the names of the params it couldn't fill.
- `reasons` maps a missing param's name to why. A missing param without a reason is left out of it.

For example:

```json
{
  "params": { "users": ["alice@example.com", "bob@example.com"] },
  "missing": ["result"],
  "reasons": { "result": "The 2 selected rows have different Result values" }
}
```

Errors:

- `404` with the detail "Action not found" for an unknown `key`.
- `422` with `errors["pivot.rows"]` holding the reason:
  - "Not offered as a pivot" for an action with `pivot: none`;
  - "Takes one row" for an action with `pivot: row` and more than one row;
  - "At most 100 rows; 2,341 selected" for more rows than `TIM_MAX_PIVOT_ROWS`.

## Runs

A run is one execution of an action by the server ([architecture.md](architecture.md#runs-and-rows)). Only its owner can read or cancel it.

### POST /api/runs

Body: `{"action": "<key>", "params": {...}}`.

- `params` maps param names to values as the browser sends them. It may be left out when the action takes none.
- An unknown action or invalid params give `422` before a run exists, with every problem in `errors`.
- A `connection` param must name a connection of its type.

For example:

```json
{
  "type": "urn:tim:problem:validation",
  "title": "Validation failed",
  "status": 422,
  "detail": "One or more fields are invalid",
  "traceId": "00-4bf92f3577b34da6a3ce929d0e0e4736-00f067aa0ba902b7-01",
  "errors": {
    "params.user": ["Required"],
    "params.limit": ["Must be a number"],
    "params.colour": ["Unknown param"]
  }
}
```

Before the run exists, TIM works out its connections: the action's fixed ones, and its `connection` params' values. It gets a token for each `obo` connection. A failure answers the `POST`:

- `403 consent-required` when sign-in or consent is needed;
- `502` when Entra fails;
- `503` when OBO is unavailable.

Otherwise the response is the [Run](#run):

- `200` when it ended within about one second;
- else `202` with `status: "running"`. Poll `GET /api/runs/{runId}`.

### GET /api/runs/{runId}

Returns the run with `200`, whatever its status. Poll it until `status` is no longer `running`.

### POST /api/runs/{runId}/cancel

Cancels a `running` run and returns it with `200`. The run turns `cancelled` once the action's connections have stopped, which may be after the response; poll for it. A run that has already ended comes back unchanged. Any replica can take the request.

### GET /api/runs/{runId}/rows

Query: `startRow` (default `0`) and `endRow` (exclusive; default and maximum `startRow + rowsPageSize`). Returns the rows with `startRow <= row < endRow`:

```
{rows: [{row, id, data}], lastRow, annotations: {id: Annotations}, annotationVersion}
```

- `row` is the row number, from `0`, unique within the run.
- `id` is the row's `id` as text, or `null` when it has none. Rows can share an `id`.
- `data` is the row as the action returned it, as column-name to value; datetimes are ISO 8601 strings, and NaN and infinities are `null`.
- `lastRow` is the run's row count. A page past it is empty.
- `annotations` holds the [Annotations](#annotations) of the page's `id`s, by `id`. An `id` that was never annotated has none. An `id` whose annotations were all removed has an entry with `label: null`.
- `annotationVersion` is the change feed version the annotations are current as of. They are never older than it.

`409 run-not-succeeded` when the run isn't `succeeded`. `410 results-gone` when it succeeded with rows but they are no longer stored, after a database crash or failover; the run can be started again.

### Run

| Field | Type | Notes |
|---|---|---|
| `runId` | uuid | |
| `status` | `running` \| `succeeded` \| `error` \| `timedOut` \| `cancelled` | A run waiting for a free slot is `running`. |
| `action` | object | `{key, name}` of the action. |
| `params` | object | The params after validation, with defaults filled in. |
| `owner` | string | The token identity of the analyst who started it. |
| `startedAt` | datetime | |
| `finishedAt` | datetime | Once the run has ended. |
| `expiresAt` | datetime | |
| `details` | object | Scalars: `duration` (seconds), `rowCount` when succeeded, then the action's own, in the order reported. A `warning` holds problems with the rows' `id`s, which never fail the run: an `id` column no row carries (`Id column CorrelationId not in results`), and rows whose `id` is over 512 characters, which get no `id` (`N row(s) have an id over 512 characters and get no id`). An action's own `warning` comes first, joined with `; `. |
| `columns` | array | When succeeded: `[{name, type, declared}]`, the declared columns first and then the others in first-seen order. `type` is `string`, `number`, `boolean`, `datetime`, `timespan` or `json`. |
| `rowCount` | integer | When succeeded. |
| `error` | string | A message safe to show, when `error` or `timedOut`. |

Keys without a value (`finishedAt`, `columns`, `rowCount`, `error`) are left out.

Failure messages: the action's own message; `Result exceeds limit of N rows` or `N bytes`; `Run exceeded the time limit of N seconds` (`timedOut`); `Run interrupted by server restart`; `The run failed unexpectedly`.

### Limits

| Limit | Default | Setting |
|---|---|---|
| Rows per result | 1,000,000 | `TIM_MAX_RESULT_ROWS` |
| Result size (compact JSON per row, summed) | 512 MiB | `TIM_MAX_RESULT_BYTES` |
| Rows per page | 10,000 | `TIM_ROWS_PAGE_SIZE` |
| Execution time | 600 s | `TIM_RUN_TIMEOUT_SECONDS` |
| Run retention | 86,400 s | `TIM_RUN_RETENTION_SECONDS` |
| Concurrent runs and query runs per process | 16 | `TIM_MAX_CONCURRENT_RUNS` |
| Distinct `id`s in one annotations change | 10,000 | `TIM_MAX_ANNOTATION_IDS` |
| Request body | 16 MiB | `TIM_MAX_REQUEST_BYTES` |
| Rows in a pivot | 100 | `TIM_MAX_PIVOT_ROWS` |

A result over a row or size limit makes the run `error`; it is not truncated. A [query run](#kustoqueryrun) is capped at 100,000 rows and 64 MiB, or the two settings when they are lower; the other limits apply to it as they are.

## Annotations

An `id`'s annotations are shared by every analyst ([architecture.md](architecture.md#annotations-and-the-change-feed)). Everywhere they appear in this shape:

```json
{
  "id": "evt-1042",
  "label": { "key": "malicious", "by": "alex@example.com", "at": "2026-10-21T09:30:12Z" },
  "tags": [],
  "comments": [],
  "version": 17
}
```

- `id` is the text key the annotations belong to.
- `label` is `null` when the `id` has none. `key` is a label's `key` from [`GET /api/instance`](#get-apiinstance), `by` the analyst who set it and `at` when.
- `tags` and `comments` are arrays.
- `version` is the version of the change that last touched the `id`.

### PATCH /api/annotations

Changes the annotations of every `id` in `ids`, in one transaction under one version.

Body: `{"ids": ["evt-1042", "evt-1043"], "label": "malicious"}`.

- `ids` has 1 or more `id`s of 1 to 512 characters each. Repeats count once.
- `label` is the `key` of one of the instance's labels, which sets it. `null` clears the `id`'s label. Leaving it out keeps it.
- The author is the caller named in the token.

The answer is `200`:

```json
{
  "changes": [
    {
      "id": "evt-1042",
      "label": { "key": "malicious", "by": "alex@example.com", "at": "2026-10-21T09:30:12Z" },
      "tags": [],
      "comments": [],
      "version": 18
    }
  ],
  "version": 18
}
```

- `changes` has the `id`s that changed, as they now are, each with the change's `version`. An `id` that already had the asked-for label is left out, and clearing an `id` with no label changes nothing.
- A change that changes nothing takes no version and writes no history. It answers `changes: []` and the current `version`.
- A cleared `id` is in `changes` with `label: null`.

Problems:

- `400 validation` for a body that isn't valid: no `ids`, an `id` over 512 characters.
- `422 validation`, with `errors` keyed by field:

  | `errors` key | Cause |
  |---|---|
  | `label` | `Unknown label: <key>` for a key that isn't one of the instance's labels. |
  | `ids` | `At most 10,000 ids; 23,412 given`, for more distinct `id`s than `maxAnnotationIds`. |
  | `body` | `Give at least one change: label`, for a body with no change field. |

### GET /api/annotations/changes

The change feed. Query: `since`, a version from `0`, required.

```json
{ "changes": [ /* Annotations */ ], "next": 18, "hasMore": false }
```

- `changes` has the annotations of each `id` changed after version `since`, as the `id` now is, in version order. An `id` changed several times appears once.
- A page ends after a whole version, so it has at least 1,000 `id`s when more follow, and more when its last change touched more.
- `next` is the version of the page's last change, or `since` for an empty page. Ask again with `since=<next>` while `hasMore` is `true`.
- An `id` whose annotations were all removed is in the feed, with `label: null`.
- Versions are gapless and in commit order.

## Connections

### POST /api/connections/{name}/schema

The schema an editor completes from, for a connection and a scope.

Body: `{ "scope": { ... } }`.

- `scope` holds the values of the editor param's `schemaFrom` params by name, without its `connection` param.
- For Run KQL that is `{ "database": "..." }`.

Answer: `{ "kind": "...", "schema": ... }`, from the connection type's hook (`Hook.editor_schema(scope)`).

- `kind` says how to read `schema`.
- For the `kusto` connection type, the kind is `kql`. The schema is the parsed `.show schema as json` document of the scope's `database`, unchanged.
- The answer is `204` with no body when the hook has none for the scope, as with a Kusto scope without a `database`.

Errors:

- `404` for an unknown connection.
- The connection's `obo` token is got before the hook runs. So `403 consent-required`, `502` and `503` answer as on `POST /api/runs`.
- `502` with the hook's message when the hook fails, for example on a Kusto error or an unrecognised result.

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

Returns `202` while the run is `created`, including while it waits for a free slot, and `200` once it is `completed`, `error` or `timedOut`. Only the owner can read a run. Runs expire `TIM_RUN_RETENTION_SECONDS` (default 24 h) after their last update.

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

Failure messages:

- Kusto's own error text, with stack-trace lines removed, at most 2000 characters;
- `Result exceeds limit of N rows` or `N bytes` (see [Limits](#limits));
- `Query exceeded the execution time limit of N seconds` (`timedOut`);
- `Run interrupted by server restart`;
- `The query failed unexpectedly`.

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
- `PATCH` body is a non-empty JSON array of `{ "op", "path", "value" }`.
  - `op` is one of `add`, `replace`, `remove`, `test`. `move` and `copy` are rejected.
  - The patch is applied to the stored template's JSON. The result must be a valid `QueryTemplate`.
  - Patching `/uuid`, `/createdBy`, `/updatedBy`, `/updated` (or children) is `400`.
  - `/isDeleted` is allowed, so `[{"op":"replace","path":"/isDeleted","value":false}]` restores a deleted template.
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

## Presets

Base path `/api/presets`. A preset is an action with some params fixed and the rest filled in by the analyst or from rows ([GLOSSARY.md](../GLOSSARY.md)). A preset is private to its owner, or shared with everyone.

### GET /api/presets

Returns an array of `Preset`: the caller's own presets and the shared ones, oldest first (`createdAt`, then `presetId`). `owned` is whether the caller owns it, and `hidden` whether they hid it.

### POST, PUT, DELETE

- `POST` body is `PresetFields`. The server assigns `presetId`, `owner` (from the token), `createdAt` and `updatedAt`. It returns `201` with the `Preset`.
- `PUT` body is `PresetFields`. It replaces the whole preset. Only the owner can. `owner` and `createdAt` are kept. Last write wins.
- `DELETE` deletes the preset for good, with every analyst's hidden mark on it. Only the owner can. `204`.
- Errors:
  - `404` for an unknown preset, or someone else's private one.
  - `403` for a `PUT` or `DELETE` on a preset the caller does not own.
  - `422` for an `action` that is not in the catalogue (`errors.action`), or an input that is not a param of the action with `from_columns` (`errors["inputs.<i>.name"]`).
- Param values are not checked here. They are validated when a run starts.

### PUT, DELETE /api/presets/{presetId}/hidden

- `PUT` hides the preset for the caller only, and `DELETE` unhides it. Both are idempotent and return `204`.
- Any preset the caller can see can be hidden, their own included.
- `404` for an unknown preset, or someone else's private one.

### Preset

`PresetFields` has the writable fields below. `Preset` adds the server-set ones.

| Field | Type | Rules |
|---|---|---|
| `presetId` | uuid | Server-set. |
| `name` | string | Not blank. |
| `menuPath` | string[] | Menu folders, none blank. Default `[]`. |
| `owner` | string | Server-set, from the token. |
| `visibility` | `private` \| `shared` | Default `private`. |
| `owned` | boolean | Server-set: whether the caller owns it. |
| `hidden` | boolean | Server-set: whether the caller hid it. |
| `action` | string | An action key in the catalogue. |
| `params` | map | Param values by name. Default `{}`. Not validated until a run starts. |
| `inputs` | array of `PresetInput` | Default `[]`. |
| `createdAt`, `updatedAt` | datetime | Server-set. |

### PresetInput

An input names a param of the preset's action that declares `from_columns`, and takes its type from that param. The boolean `fixed` tells the two shapes apart: a fixed input and a From row input ([GLOSSARY.md](../GLOSSARY.md)).

| Field | Type | Rules |
|---|---|---|
| `name` | string | The param's name. Not blank. |
| `source` | `param` | |
| `fixed` | boolean | `true` for a fixed input, `false` for a From row input. |
| `value` | JSON | Fixed only: the value saved with the preset. |
| `fromColumns` | string[] | From row only: the columns to read, in order. The input takes the first one the rows have. With none, the form asks for the value. |

## Tagged events

Tag rows are ingested into the tag cluster ([Kusto tables](architecture.md#kusto-tables)) with the app identity.

- The server sets `createdBy` (from the token) and `dateTimeUtc` (server clock) on every row.
- Each body is a JSON array of 1 to 1000 items. Any invalid item fails the whole request with `400`.
- Success is `204`. An ingestion failure is `502`.

| Route | Item fields |
|---|---|
| `POST /api/taggedevents/savedEvents` | `eventId` (string, not blank), `eventTime` (datetime), `eventAsJson` (object, at most 1,000,000 bytes serialised) |
| `POST /api/taggedevents/tags` | `eventId` (not blank), `tag` (not blank), `isDeleted` (boolean, default `false`) |
| `POST /api/taggedevents/comments` | `eventId` (not blank), `determination` (not blank), `comment` (string or null), `isDeleted` (boolean, default `false`) |

Example:

```json
[{ "eventId": "e-123", "tag": "phishing", "isDeleted": false }]
```

- The tables are append-only. Removing a tag or comment writes a new row with `isDeleted: true`.
- The SPA uses `determination` values `malicious`, `suspicious` and `benign`. It uses `removed` (with `isDeleted: true`) to clear one.
- The API accepts any non-blank string.
- Writes are not transactional across the three routes.
