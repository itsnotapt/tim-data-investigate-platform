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
| JSON | UTF-8. TIM's own property names are camelCase; unknown request properties are ignored. Names an action defines, such as its param names and their values, pass through verbatim, and in OpenAPI that content is an open JSON value. |
| Timestamps | ISO 8601 UTC with `Z`, with milliseconds only when non-zero. Input with an offset is converted to UTC; input without an offset is read as UTC. |
| Status codes | `200`/`201` with a body, `202` while a newly started run is pending, `204` without a body. |
| Errors | RFC 9457 problem details (`application/problem+json`), see [Errors](#errors). |
| Trace id | Every response has `x-trace-id`. The server accepts a W3C `traceparent` or an `x-request-id` (`[A-Za-z0-9._-]`, up to 128 characters) and otherwise generates one. |
| Headers | Responses carry `x-content-type-options: nosniff` and `cache-control: no-store`. |
| CORS | Only for origins in `TIM_CORS_ALLOWED_ORIGINS`; the SPA is normally same-origin. |
| Body size | Above `TIM_MAX_REQUEST_BYTES` (default 64 MiB) gives `413`. |

## Endpoints

| Method | Path | Success | Errors | Purpose |
|---|---|---|---|---|
| GET | `/api/healthChecks/liveness` | 204 | none | Process is up. No checks; no auth. |
| GET | `/api/healthChecks/readiness` | 204 | 503 | Storage is reachable. Kusto is not checked; no auth. |
| GET | `/api/instance` | 200 | 401 | The instance's actions, connections, labels and limits. |
| POST | `/api/actions/{key}/resolve` | 200 | 400, 401, 404, 422 | Resolve an action's params from selected result rows, for a pivot. |
| POST | `/api/runs` | 200 or 202 | 400, 401, 403, 422, 502, 503 | Start a run of an action. |
| GET | `/api/runs/{runId}` | 200 | 401, 404, 422 | Read a run (any signed-in analyst with the `runId`). |
| POST | `/api/runs/{runId}/cancel` | 200 | 401, 404, 422 | Cancel a run (owner only; idempotent). |
| GET | `/api/runs/{runId}/rows` | 200 | 401, 404, 409, 410, 422 | Read a page of a run's rows, with their annotations (any signed-in analyst with the `runId`). |
| PATCH | `/api/annotations` | 200 | 400, 401, 422 | Change the label, tags and the caller's comment on `id`s. |
| GET | `/api/annotations/changes` | 200 | 401, 422 | The change feed: the `id`s changed after a version. |
| GET | `/api/annotations/history` | 200 | 401, 422 | The history of an `id`: its label changes and each author's current comment, newest first. |
| GET | `/api/tags/suggestions` | 200 | 401, 422 | Tags that start with a prefix: the caller's recent ones, then the most used. |
| POST | `/api/connections/{name}/schema` | 200 or 204 | 400, 401, 403, 404, 422, 502, 503 | The editor schema of a connection, from its connection type's hook. |
| GET | `/api/presets` | 200 | 401 | List your presets and the shared ones. |
| GET | `/api/presets/{presetId}/actionFile` | 200 | 401, 404, 409, 422 | A preset as an action file, in YAML. |
| POST | `/api/presets` | 201 | 400, 401, 422 | Create a preset. |
| PUT | `/api/presets/{presetId}` | 200 | 400, 401, 403, 404, 422 | Replace a preset (owner only). |
| DELETE | `/api/presets/{presetId}` | 204 | 401, 403, 404, 422 | Delete a preset for good (owner only). |
| PUT | `/api/presets/{presetId}/hidden` | 204 | 401, 404, 422 | Hide a preset for yourself (idempotent). |
| DELETE | `/api/presets/{presetId}/hidden` | 204 | 401, 404, 422 | Unhide a preset for yourself (idempotent). |
| GET | `/api/columnViews` | 200 | 401 | List your column views and the shared ones. |
| POST | `/api/columnViews` | 201 | 400, 401, 422 | Create a column view. |
| PUT | `/api/columnViews/{viewId}` | 200 | 400, 401, 403, 404, 422 | Replace a column view (owner only). |
| DELETE | `/api/columnViews/{viewId}` | 204 | 401, 403, 404, 422 | Delete a column view for good (owner only). |
| PUT | `/api/columnViews/{viewId}/hidden` | 204 | 401, 404, 422 | Hide a column view for yourself (idempotent). |
| DELETE | `/api/columnViews/{viewId}/hidden` | 204 | 401, 404, 422 | Unhide a column view for yourself (idempotent). |

Every authenticated route can also return `500`. A malformed path parameter (for example a non-UUID) is a `422` validation error.

## Errors

Every non-2xx response has this body:

```json
{
  "type": "urn:tim:problem:validation",
  "title": "Validation failed",
  "status": 422,
  "detail": "One or more fields are invalid",
  "traceId": "00-4bf92f3577b34da6a3ce929d0e0e4736-00f067aa0ba902b7-01",
  "errors": { "database": ["must not be blank"] }
}
```

`errors` appears only for validation failures: it maps a field path (JSON names, dotted; array items by index; a run's params as `params.<name>`) to messages. `detail` is a fixed, safe string and never contains stack traces, SQL, tokens or upstream bodies; clients switch on `type`.

| Status | `type` slug | Cause |
|---|---|---|
| 400 | `bad-request` | Malformed JSON (`errors.body`). |
| 401 | `unauthorized` | Missing, malformed, expired or otherwise invalid token. |
| 403 | `consent-required` | The token cannot be exchanged for a connection's scope (sign-in or consent needed). The SPA prompts again. |
| 403 | `forbidden` | Kusto denied the user access to the cluster or database. Or a change to a preset or column view the caller does not own. |
| 404 | `not-found` | Unknown action, or a run that is unknown or expired, or a cancel of someone else's run. An unknown preset or column view, or someone else's private one. |
| 409 | `run-not-succeeded` | Rows were requested for a run that isn't `succeeded`. |
| 409 | `no-action-file` | An action file was requested for a preset whose action has none. A Run KQL preset without a connection, database or query has none either. |
| 410 | `results-gone` | A `succeeded` run with rows has none stored any more, after a database crash or failover. Run it again. |
| 413 | `too-large` | Request body over the size limit. |
| 422 | `validation` | Invalid body, query or path (a column view without a name, or whose `state` is not a JSON object, included); `endRow` less than `startRow`; no `ids`, or an `id` over 512 characters, in an annotations change; a negative `since`; a missing, empty or over-512-character `id` in an annotations history read (`errors.id`). A well-formed run request with an unknown action (`errors.action`) or invalid params (`errors["params.<name>"]`). A sink run with missing, unsuitable or too many rows (`errors.input`, `errors["input.rows"]`, `errors["input.columns"]`). A resolve request the action isn't offered on (`errors["pivot.rows"]`). A preset with an unknown action or a sink (`errors.action`). A preset with an input that is not a param of the action with `fromColumns` (`errors["inputs.<i>.name"]`). A preset with a query parameter on an action that takes none (`errors["inputs.<i>.source"]`). A run of Run KQL with a bad `parameters` value (`errors["params.parameters"]`, or `errors["params.parameters.<name>"]` for one query parameter's value). A well-formed annotations change with an unknown label (`errors.label`), more `id`s than `maxAnnotationIds` (`errors.ids`), no change field (`errors.body`), or an invalid tag or comment (`errors.addTags`, `errors.removeTags`, `errors.setTags`, `errors.comment`). |
| 500 | `internal` | Unhandled error; details are in the server log under the `traceId`. |
| 502 | `upstream` | Entra unreachable, token exchange failure, or editor schema failure. |
| 503 | `unavailable` | Storage down, or token exchange unavailable (auth disabled, or no OBO credential configured and no connection using `obo`). |

## Instance

### GET /api/instance

What the browser needs to know about this instance, built once at startup from the installed providers and the action files ([architecture.md](architecture.md#actions-and-providers)):

```
{version, actions: [Action], connections: [Connection], labels: [Label], limits}
```

- `version`: a hash of the installed provider distributions, the content of every action file and sidecar read, the connections file, the labels file, and the rest of this body. It changes when any of them does, for example after a rolling update.
- `actions`: the catalogue: the providers' Python actions in provider order, then the actions from each provider's package data, then those from `TIM_ACTIONS_DIR`, each directory in file name order. An action is `{key, kind, name, description?, menuPath, connections, params, pivot, columns?, actionFile}`:
  - `kind` is `query`, or `sink` for an action that writes rows it is given ([Runs](#post-apiruns)). A sink has `params: []`, `pivot: {rows: "rows", columns: []}` and `actionFile: false`.
  - `menuPath` is the action's `/`-separated `menu`, one entry per folder, `[]` at the top level.
  - `connections` names the fixed connections the action uses.
  - `params` is `[{name, title, kind, required, default?, many, choices?, connectionType?, fromColumns?, schemaFrom?, help?}]`. `default` and `choices` are values as the browser sends them.
  - `pivot` is `{rows: "row" | "rows", columns: [[alternatives]]}`, or `null` for an action that isn't offered in the grid's context menu. A row matches when it has one column from each group.
  - `columns` is `[{name, type, title?, hidden, width?, pinned?, sort?, group, calculated?}]`, the columns the action declares, including settings for TIM's own `tim:` columns ([actions.md](actions.md#columns)); it is left out when the action declares none.
  - `actionFile` is whether a preset of the action can be copied as an action file ([GET /api/presets/{presetId}/actionFile](#get-apipresetspresetidactionfile)).
- `connections`: the connections file's connections, in file order, each `{name, type, title, editor, databases?}`. `editor` is the connection type's editor (`kql` for Kusto, `sql` for Snowflake). `databases` are the suggestions a Kusto or `dev_kql` connection lists. Never its cluster, auth or scope.
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

A run is one execution of an action by the server ([architecture.md](architecture.md#runs-and-rows)). Any signed-in analyst who holds its `runId` can read it and its rows. Only its owner can cancel it.

### POST /api/runs

Body: `{"action": "<key>", "params": {...}, "input": {...}}`.

- `params` maps param names to values as the browser sends them. It may be left out when the action takes none.
- An unknown action or invalid params give `422` before a run exists, with every problem in `errors`.
- A `connection` param must name a connection of its type.
- `input` is for a sink only: `{"columns": [{"name", "type"}], "rows": [{"<column>": <value>}]}`. The sink writes the rows. Nothing is stored, so the run has no `columns` or `rowCount`.
  - A query action with `input` gives `422` with `errors.input` ("Only a sink takes input"). A sink without it gives `422` with `errors.input` ("A sink needs the rows to write").
  - More than `maxAnnotationIds` rows give `422` with `errors["input.rows"]`, and repeated column names `errors["input.columns"]`.
  - A sink has no params, so any `params` are `Unknown param`.
  - The input counts toward `TIM_MAX_REQUEST_BYTES`.
  - `POST /api/actions/{key}/resolve` gives `404` for a sink.

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

Returns the run with `200`, whatever its status. Poll it until `status` is no longer `running`. `404` means the run is unknown or expired.

### POST /api/runs/{runId}/cancel

Only the owner can cancel; anyone else gets the same `404` as for an unknown run. Cancels a `running` run and returns it with `200`. The run turns `cancelled` once the action's connections have stopped, which may be after the response; poll for it. A run that has already ended comes back unchanged. Any replica can take the request.

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
| `details` | object | Scalars: `duration` (seconds), `inputRowCount` for a sink, `rowCount` when a query action succeeded, then the action's own, in the order reported. A `warning` holds problems with the rows' `id`s, which never fail the run: an `id` column no row carries (`Id column CorrelationId not in results`), and rows whose `id` is over 512 characters, which get no `id` (`N row(s) have an id over 512 characters and get no id`). An action's own `warning` comes first, joined with `; `. |
| `columns` | array | When succeeded: `[{name, type, declared}]`, the declared columns first, without TIM's own `tim:` columns, and then the others in first-seen order. `type` is `string`, `number`, `boolean`, `datetime`, `timespan`, `json` or `bigint`; only an action file declares `bigint`, and its whole-number values are served as strings of digits. |
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
| Concurrent runs per process | 16 | `TIM_MAX_CONCURRENT_RUNS` |
| Distinct `id`s in one annotations change | 10,000 | `TIM_MAX_ANNOTATION_IDS` |
| Request body | 64 MiB | `TIM_MAX_REQUEST_BYTES` |
| Rows in a pivot | 100 | `TIM_MAX_PIVOT_ROWS` |

A result over a row or size limit makes the run `error`; it is not truncated.

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
- `tags` and `comments` are arrays. `comments` has each author's current comment, oldest `at` first.
- `version` is the version of the change that last touched the `id`.

### PATCH /api/annotations

Changes the annotations of every `id` in `ids`, in one transaction under one version.

Body: `{"ids": ["evt-1042", "evt-1043"], "label": "malicious", "addTags": ["phishing"], "comment": "Seen on the VPN"}`.

- `ids` has 1 or more `id`s of 1 to 512 characters each. Repeats count once.
- `label` is the `key` of one of the instance's labels, which sets it. `null` clears the `id`'s label. Leaving it out keeps it.
- `addTags` and `removeTags` are arrays of tags to add to, and remove from, every `id`.
- `setTags` replaces every `id`'s tags with its array. `[]` clears them. It can't be combined with `addTags` or `removeTags`.
- A tag is trimmed, and is 1 to 100 characters. A tag can't be in both `addTags` and `removeTags`. A removed tag is deleted.
- `comment` sets the caller's comment on every `id`, replacing the caller's current one. It is trimmed, can't be blank and has no length limit.
  - `null` clears the caller's comment.
  - Leaving it out keeps the comment.
  - Setting the text the caller's comment already has, or clearing a comment the caller doesn't have, changes nothing.
- The author of a label, tag or comment is the caller named in the token.

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

- `changes` has the `id`s that changed, as they now are, each with the change's `version`. An `id` that already had the asked-for label and tags is left out, and clearing an `id` with no label changes nothing.
- A comment changes the `id`s where the caller's comment differs from the one asked for.
- A change that changes nothing takes no version and writes no history. It answers `changes: []` and the current `version`.
- A cleared `id` is in `changes` with `label: null`.

Problems:

- `422 validation` for a body that isn't valid: no `ids`, an `id` over 512 characters.
- `422 validation`, with `errors` keyed by field:

  | `errors` key | Cause |
  |---|---|
  | `label` | `Unknown label: <key>` for a key that isn't one of the instance's labels. |
  | `ids` | `At most 10,000 ids; 23,412 given`, for more distinct `id`s than `maxAnnotationIds`. |
  | `body` | `Give at least one change: label, addTags, removeTags, setTags or comment`, for a body with no change field. |
  | `setTags` | `setTags can't be combined with addTags or removeTags`. |
  | `removeTags` | `Both added and removed: <tags>`, for a tag in `addTags` and `removeTags`. |
  | `addTags`, `removeTags`, `setTags` | `A tag can't be blank`, or `At most 100 characters: <tag>`. |
  | `comment` | `A comment can't be blank`. |

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

### GET /api/annotations/history

The history of one `id`. Query: `id`, required, 1 to 512 characters.

```json
{
  "entries": [
    { "kind": "comment", "author": "sam@example.com", "at": "2026-10-21T09:31:40Z", "text": "Seen on two hosts." },
    { "kind": "label", "label": "malicious", "by": "alex@example.com", "at": "2026-10-21T09:30:12Z" }
  ]
}
```

- `entries` has the label changes and each author's current comment on the `id`, newest first. There is no paging.
- A label entry has the `label` key it set, or `null` when the change cleared it, with who (`by`) and when (`at`).
- A comment entry has its `author`, `at` (when it was last saved) and `text`. An author's earlier comments and cleared comments are not in the history.
- Within one change, the label entry comes before the comment.
- Tags are not in the history.
- An `id` that was never changed answers `200` with `entries: []`.

Problems:

- `422 validation` with `errors.id` for a missing, empty or over-512-character `id`.
- `401` without a signed-in analyst.

### GET /api/tags/suggestions

Tags that start with a prefix, for the tag editor. Query: `prefix`, optional; it is trimmed and matched ignoring case. Without it, every tag matches.

```json
{ "recent": ["phishing"], "mostUsed": ["vpn", "lateral-movement"] }
```

- `recent` has the caller's own tags, the most recently added first.
- `mostUsed` has the tags of the whole instance, on the most `id`s first. The caller's own tags are left out.
- Each list has at most 10 tags.

## Connections

### POST /api/connections/{name}/schema

The schema an editor completes from, for a connection and a scope.

Body: `{ "scope": { ... } }`.

- `scope` holds the values of the editor param's `schemaFrom` params by name, without its `connection` param.
- For Run KQL that is `{ "database": "..." }`.

Answer: `{ "kind": "...", "schema": ... }`, from the connection type's hook (`Hook.editor_schema(scope)`).

- `kind` says how to read `schema`.
- For the `kusto` connection type, the kind is `kql`. The schema is the parsed `.show schema as json` document of the scope's `database`, unchanged.
- For the `snowflake` connection type, the kind is `sql`. The schema is `{ "databases": [{ "name", "schemas": [{ "name", "tables": [{ "name", "columns": [{ "name", "type" }] }] }] }] }`.
  - It comes from `SHOW TERSE DATABASES` and each database's `INFORMATION_SCHEMA.COLUMNS`. A database the login can't read is left out.
  - It takes no scope values.
- The answer is `204` with no body when the hook has none for the scope, as with a Kusto scope without a `database`.

Errors:

- `404` for an unknown connection.
- The connection's `obo` token is got before the hook runs. So `403 consent-required`, `502` and `503` answer as on `POST /api/runs`.
- `502` with the hook's message when the hook fails, for example on a Kusto or Snowflake error or an unrecognised result.

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
  - `422` for an `action` that is not in the catalogue (`errors.action`), an input that is not a param of the action with `from_columns` (`errors["inputs.<i>.name"]`), a query parameter input on an action that takes no query parameters (`errors["inputs.<i>.source"]`), a query parameter name that is not a Kusto identifier, or a name used by two inputs (`errors["inputs.<i>.name"]`).
- Param and query parameter values are not checked here. They are validated when a run starts.

### GET /api/presets/{presetId}/actionFile

Returns the preset as an action file ([actions.md](actions.md#action-files)): the YAML of an action that runs what the preset runs, as `application/yaml`. An operator adds it to the instance's action files, and `tim-api check` accepts it.

- Only presets of Run KQL and Run SQL have one, as a `kql_query` or `snowflake_query` action. `409` with the slug `no-action-file` for the others.
  - A Run KQL preset that lacks a connection, database or query answers it too, and so does a Run SQL preset that lacks a connection or SQL, or has a `timespan` query parameter. The problem message is "This preset has no action file".
- `404` for an unknown preset, or someone else's private one.
- The file is built from the preset:
  - `key` is a slug of the preset's name, and `menu` is its `menuPath` joined with `/`.
  - `pivot` is `rows` when the preset has From row query parameters and every one of them has columns, as a preset is a pivot. Otherwise it is `none`.
  - `kql` is the query with the `declare query_parameters(...)` statement in front, and `id` comes from `idColumn`. For Run SQL, `sql` is the query as it is.
  - Each query parameter is a param of the file, in the preset's order. A fixed one has its value as `default`, a From row one has `from_columns`. A `dynamic` one is `many`. In a `snowflake_query`, the order sets the position each is bound to, `:1` the first.

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

An input is a param of the preset's action that declares `from_columns` (`source: "param"`), taking its type from that param, or a query parameter (`source: "queryParameter"`). The boolean `fixed` tells a fixed input from a From row input ([GLOSSARY.md](../GLOSSARY.md)).

| Field | Type | Rules |
|---|---|---|
| `name` | string | The param's name, or the query parameter's: an identifier, starting with a letter or `_`, unique among the inputs. |
| `source` | `param` \| `queryParameter` | A query parameter is allowed only on an action that takes them: one with a `json` param named `parameters`, as Run KQL and Run SQL have. |
| `type` | `string` \| `long` \| `real` \| `bool` \| `datetime` \| `timespan` \| `dynamic` | Query parameter only: the type it is declared with. |
| `fixed` | boolean | `true` for a fixed input, `false` for a From row input. |
| `value` | JSON | Fixed only: the value saved with the preset. |
| `fromColumns` | string[] | From row only: the columns to read, in order. The input takes the first one the rows have. With none, the form asks for the value. |

## Column views

Base path `/api/columnViews`. A column view is a named, saved set of the results grid's columns and filters ([GLOSSARY.md](../GLOSSARY.md)). It is private to its owner, or shared with everyone. The routes mirror [presets](#presets).

### GET /api/columnViews

Returns an array of `ColumnView`: the caller's own column views and the shared ones, oldest first (`createdAt`, then `viewId`). `owned` is whether the caller owns it, and `hidden` whether they hid it.

### POST, PUT, DELETE

- `POST` body is `NewColumnView`: the `ColumnViewFields` and `savedFrom`. The server assigns `viewId`, `owner` (from the token), `createdAt` and `updatedAt`. It returns `201` with the `ColumnView`.
- `PUT` body is `ColumnViewFields`. It replaces the whole column view. Only the owner can. `owner`, `savedFrom` and `createdAt` are kept. Last write wins.
- `DELETE` deletes the column view for good, with every analyst's hidden mark on it. Only the owner can. `204`.
- Errors:
  - `404` for an unknown column view, or someone else's private one.
  - `403` for a `PUT` or `DELETE` on a column view the caller does not own.
  - `422` for a missing or blank `name`, or a `state` that is not a JSON object.
- Names are not unique.
- The server does not look inside `state` ([ADR-0022](adr/0022-column-views-store-grid-state.md)).

### PUT, DELETE /api/columnViews/{viewId}/hidden

- `PUT` hides the column view for the caller only, and `DELETE` unhides it. Both are idempotent and return `204`.
- Any column view the caller can see can be hidden, their own included.
- `404` for an unknown column view, or someone else's private one.

### ColumnView

`ColumnViewFields` has the writable fields below. `NewColumnView` adds `savedFrom`. `ColumnView` adds the server-set ones.

| Field | Type | Rules |
|---|---|---|
| `viewId` | uuid | Server-set. |
| `name` | string | Not blank. |
| `owner` | string | Server-set, from the token. |
| `visibility` | `private` \| `shared` | Default `private`. |
| `owned` | boolean | Server-set: whether the caller owns it. |
| `hidden` | boolean | Server-set: whether the caller hid it. |
| `savedFrom` | `{action, presetId?}` | The action, and the preset when there is one, of the tab it was saved from. Set by `POST`, then fixed. `action` is not blank. |
| `state` | object | A partial AG Grid `GridState`: `columnOrder`, `columnSizing`, `columnVisibility`, `columnPinning`, `columnHeaderName`, `userColumns`, `sort`, `rowGroup`, `aggregation`, `pivot` and `filter`, with `partialColumnState: true` and the AG Grid `version`. Its keys are the browser's to decide. |
| `createdAt`, `updatedAt` | datetime | Server-set. |
