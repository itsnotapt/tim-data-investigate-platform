# Data models (legacy)

Every entity that the legacy app stores or sends over the wire. The rewrite keeps these **JSON field names** (RULES §6) unless [`rewrite/api-contract.md`](../rewrite/api-contract.md) records a change.

- **Server entities** are the .NET models in `backend/Tim.Backend/Models/**`. They are persisted in Couchbase, Mongo or Redis, or ingested into the Kusto tag tables.
- **Browser entities** are kept only in the SPA (IndexedDB, URLs, `window.appConfig`).
- Glossary: [overview.md](overview.md#glossary). Endpoints: [backend-api.md](backend-api.md).

Cross-cutting notes:
- `QueryParam.type`, `QueryField.type` and `EventComment.determination` are **free strings** with no enum on the server. The UI recognises param/field types `array`, `match`, `multiple` and `boolean`; anything else renders as a text field. Determinations are stored lowercase.
- Template `columns` is passed straight through as **AG Grid `ColDef` overrides** keyed by column name; the key `default` applies to every other column (`frontend/src/components/grids/KustoPivot.vue:557-594`). The new grid must accept the same keys, or templates must be migrated.
- Tab ids are `componentUuid`; template and column-view ids are `uuid`.

## Server entities

All paths are relative to the repo root. JSON is serialised with Newtonsoft.Json (`[JsonProperty]`). Entities implementing `IJsonEntity` expose a `[JsonIgnore] string Id` (`backend/Tim.Backend/Models/IJsonEntity.cs:17`) that is derived from the GUID key. Enums use `StringEnumConverter` with `[EnumMember]` values.

Storage shims: properties marked `[BsonIgnore]` are not stored natively. Each has a `[JsonIgnore]` `*AsString` twin that serialises it for stores without rich-type support. The twins are `ColumnsAsString`, `ResultDataAsString` (byte[]) and `ExecutionMetricsAsString`. They never appear in API JSON.

### QueryTemplate

Source: `backend/Tim.Backend/Models/Templates/QueryTemplate.cs:37` (class), `:19` (enum). Implements `IValidatableObject` and `IJsonEntity`.

| JSON name | C# type | Required | Default | Notes/validation |
|---|---|---|---|---|
| `uuid` | `Guid` | yes | empty Guid | `[BsonId]`. `Id` is `Uuid.ToString()`. |
| `name` | `string` | yes | null | |
| `isDeleted` | `bool` | no | false | Soft delete. |
| `isManaged` | `bool` | no | false | |
| `updated` | `DateTime` | no | `DateTime.UtcNow` | |
| `createdBy` | `string` | no | null | |
| `updatedBy` | `string` | no | null | |
| `queryType` | `QueryType` | yes | `view` (enum 0) | Serialised as a string. Rule: when `query`, `fields` must be non-null and non-empty ("'fields' field is required if query type is 'query'"). |
| `menu` | `string` | yes | null | Where the template appears in the menu. |
| `summary` | `string` | yes | null | |
| `path` | `IEnumerable<string>` | yes | null | Menu path segments. |
| `cluster` | `string` | yes | null | Not URL-validated here. |
| `database` | `string` | yes | null | |
| `columnId` | `string` | no | null | |
| `params` | `Dictionary<string, QueryParam>` | no | null | Keyed by param name. |
| `fields` | `Dictionary<string, QueryField>` | no | null | Keyed by field name. Required for `queryType=query`. |
| `columns` | `Dictionary<string, object>` | no | null | `[BsonIgnore]`, stored via `ColumnsAsString`. Free-form column definitions. |
| `query` | `string` | yes | null | Query text. |

`QueryType` enum (`:19`): `view` (`View`), `query` (`Query`).

### QueryParam

Source: `backend/Tim.Backend/Models/Templates/QueryParam.cs:15`. Implements `IValidatableObject`.

| JSON name | C# type | Required | Default | Notes/validation |
|---|---|---|---|---|
| `default` | `object` | no | null | |
| `type` | `string` | yes | null | Free string. `array` triggers the `values` rule. |
| `optional` | `bool?` | no | null | |
| `multiple` | `bool?` | no | null | |
| `hint` | `string` | no | null | |
| `values` | `IEnumerable<string>` | conditional | null | Rule: required and non-empty when `type == "array"` ("'values' field is required if type is 'array'"). |

### QueryField

Source: `backend/Tim.Backend/Models/Templates/QueryField.cs:14`. Implements `IValidatableObject`.

| JSON name | C# type | Required | Default | Notes/validation |
|---|---|---|---|---|
| `type` | `string` | yes | null | Values seen in validation: `multiple`, `match`. |
| `from` | `string` | conditional | null | Rule: required (non-whitespace) when `type == "multiple"`. |
| `regex` | `string` | conditional | null | Rule: required (non-whitespace) when `type == "match"`. |

The checks are an if / else-if chain, so at most one error is yielded.

### KustoClusterDatabase

Source: `backend/Tim.Backend/Models/KustoQuery/KustoClusterDatabase.cs:16`. Implements `IValidatableObject` with a `virtual Validate`.

| JSON name | C# type | Required | Default | Notes/validation |
|---|---|---|---|---|
| `cluster` | `string` | no attribute | null | Validate: must be an absolute well-formed URI ("Cluster needs to be a URL."), then the scheme must be https ("Cluster URL must use https."). Null fails the first check. |
| `database` | `string` | no attribute | null | |

### KustoQuery

Source: `backend/Tim.Backend/Models/KustoQuery/KustoQuery.cs:16`. Sealed. Extends `KustoClusterDatabase`, so it also carries `cluster` and `database`.

| JSON name | C# type | Required | Default | Notes/validation |
|---|---|---|---|---|
| `requestedBy` | `string` | no | null | Set server-side from the authenticated user. |
| `startTime` | `DateTime?` | no | null | Sent to Kusto as the `StartTime` request property (ISO 8601 "o" format). |
| `endTime` | `DateTime?` | no | null | Sent as `EndTime`. |
| `query` | `string` (`QueryText`) | yes | null | JSON name is `query`, C# name is `QueryText`. |

Validate rules: `EndTime must be greater than StartTime.` is raised when `StartTime > EndTime`. With a null on either side the comparison is false, so nothing is raised.

**Bug SEC-01** (`KustoQuery.cs:46`): the override calls `base.Validate(validationContext);` and discards the result. The lazy iterator is never enumerated, so the absolute-https-URL check on `cluster` never runs for `KustoQuery`. Only the time-range rule is enforced.

### KustoQueryRun

Source: `backend/Tim.Backend/Models/KustoQuery/KustoQueryRun.cs:49` (class), `:19` (enum). Implements `IJsonEntity`.

| JSON name | C# type | Required | Default | Notes/validation |
|---|---|---|---|---|
| `kustoQuery` | `KustoQuery` | no | ctor arg | |
| `executeDateTimeUtc` | `DateTime` | no | `UtcNow` (ctor) | The parameterless ctor leaves it at `default`. |
| `queryRunId` | `Guid` | yes | `Guid.NewGuid()` (ctor) | `[BsonId]`. `Id` is `QueryRunId.ToString()`. |
| `status` | `QueryRunStatus` | no | `created` (ctor) | String enum. |
| `resultData` | `IEnumerable<IDictionary<string, object>>` | no | null | `[BsonIgnore]`, stored via `ResultDataAsString` (byte[] via `ObjectToByteArray`). A list of row dicts keyed by the raw Kusto column names, one entry per column from `IDataReader.GetName(i)` and value from `GetValue(i)`. There is no renaming and no schema. Value types are whatever the Kusto reader yields (string, long, double, bool, DateTime, Guid, TimeSpan, DBNull, etc.). `KustoQueryClient.cs:151-167`. |
| `executionMetrics` | `KustoQueryStats` | no | null | `[BsonIgnore]`, stored via `ExecutionMetricsAsString`. |
| `stackTrace` | `string` | no | null | Set on error. |
| `mainError` | `string` | no | null | Outermost error message when errors are nested. |

`QueryRunStatus` enum (`:19`): `created`, `completed`, `error`, `timedOut` (C# `TimedOut`).

Note: `ResultDataAsString`'s getter does not null-guard `ResultData`. `ResultData.ObjectToByteArray()` is called directly, so behaviour on null depends on that extension method.

### KustoQueryStats

Source: `backend/Tim.Backend/Models/KustoQuery/KustoQueryStats.cs:12`. It is a `partial` class. The other part(s) were not reviewed here.

Populated by deserialising the `Payload` column of the `QueryCompletionInformation` table row where `LevelName == "Stats"` (`KustoQueryClient.cs:169-204`). It is null if no such row exists. The keys are snake_case as produced by Kusto.

| JSON name | C# type | Required | Default | Notes/validation |
|---|---|---|---|---|
| `execution_time` | `double` | no | 0 | Seconds. |
| `resource_usage` | `dynamic` | no | null | Kusto sub-object (`cache`, `cpu`, `memory`, `network`, ...). Its shape is not typed. |
| `input_dataset_statistics` | `dynamic` | no | null | Sub-object (`extents`, `rows`, `rowstores`, ...). Shape not typed. |
| `dataset_statistics` | `dynamic` | no | null | Array of objects, e.g. `table_row_count`, `table_size`. Shape not typed. |

The `dynamic` members deserialise to `JObject`/`JArray`, and the shapes are whatever the Kusto service returns. Clients must not assume fixed keys.

### SavedEvent

Source: `backend/Tim.Backend/Models/TaggedEvents/SavedEvent.cs:15`. Implements `IKustoEvent`, a marker interface. Persisted to Kusto (see the tag tables below).

| JSON name | C# type | Required | Default | Notes/validation |
|---|---|---|---|---|
| `eventId` | `string` | yes | null | Event-specific primary id, e.g. ReportGuid. |
| `eventTime` | `DateTime?` | yes | null | e.g. ReportTime. |
| `dateTimeUtc` | `DateTime?` | no | `UtcNow` | Creation time. |
| `createdBy` | `string` | yes | null | |
| `eventAsJson` | `Dictionary<string, object>` | yes | null | Raw event data, stored as Kusto `dynamic`. |

### EventTag

Source: `backend/Tim.Backend/Models/TaggedEvents/EventTag.cs:14`. Implements `IKustoEvent`.

| JSON name | C# type | Required | Default | Notes/validation |
|---|---|---|---|---|
| `eventId` | `string` | yes | null | Links to `SavedEvent.eventId`. |
| `dateTimeUtc` | `DateTime?` | no | null | Created or modified time. Not defaulted in the model. |
| `createdBy` | `string` | yes | null | |
| `tag` | `string` | yes | null | |
| `isDeleted` | `bool` | no | false | Soft delete. |

### EventComment

Source: `backend/Tim.Backend/Models/TaggedEvents/EventComment.cs:14`. Implements `IKustoEvent`.

| JSON name | C# type | Required | Default | Notes/validation |
|---|---|---|---|---|
| `eventId` | `string` | yes | null | Links to `SavedEvent.eventId`. |
| `dateTimeUtc` | `DateTime?` | no | null | Created or modified time. |
| `createdBy` | `string` | yes | null | |
| `comment` | `string` | no | null | |
| `determination` | `string` | yes | null | Free string, e.g. malicious or suspicious. No enum. |
| `isDeleted` | `bool` | no | false | Soft delete. |

## Kusto tag tables

Each class implements `IKustoTable` (`backend/Tim.Backend/Models/TaggedEvents/Tables/IKustoTable.cs`). It exposes `TableName`, `TableMappingName`, `TableSchema` (name and .NET type pairs), `ColumnMappings` (JSON ingestion mapping) and a settable `DatabaseName`. Every mapping entry uses a JSONPath `$.<jsonName>`.

### SavedEventTable

Source: `backend/Tim.Backend/Models/TaggedEvents/Tables/SavedEventTable.cs:14`. Table `SavedEvent`, mapping `SavedEventMapping`.

| Column | Kusto type | Schema .NET type | Mapping path |
|---|---|---|---|
| EventId | string | System.String | `$.eventId` |
| EventTime | datetime | System.DateTime | `$.eventTime` |
| DateTimeUtc | datetime | System.DateTime | `$.dateTimeUtc` |
| CreatedBy | string | System.String | `$.createdBy` |
| EventAsJson | dynamic | System.Object | `$.eventAsJson` |

### EventTagTable

Source: `backend/Tim.Backend/Models/TaggedEvents/Tables/EventTagTable.cs:14`. Table `EventTag`, mapping `EventTagMapping`.

| Column | Kusto type | Schema .NET type | Mapping path |
|---|---|---|---|
| EventId | string | System.String | `$.eventId` |
| DateTimeUtc | datetime | System.DateTime | `$.dateTimeUtc` |
| CreatedBy | string | System.String | `$.createdBy` |
| Tag | string | System.String | `$.tag` |
| IsDeleted | bool | System.Boolean | `$.isDeleted` |

### EventCommentTable

Source: `backend/Tim.Backend/Models/TaggedEvents/Tables/EventCommentTable.cs:14`. Table `EventComment`, mapping `EventCommentMapping`.

| Column | Kusto type | Schema .NET type | Mapping path |
|---|---|---|---|
| EventId | string | System.String | `$.eventId` |
| DateTimeUtc | datetime | System.DateTime | `$.dateTimeUtc` |
| CreatedBy | string | System.String | `$.createdBy` |
| Comment | string | System.String | `$.comment` |
| Determination | string | System.String | `$.determination` |
| IsDeleted | bool | System.Boolean | `$.isDeleted` |

Note: `SavedEventTable` has no `IsDeleted` column, matching the model, so saved events cannot be soft-deleted. Tags and comments are append-only rows, and the latest row per event wins by convention (not enforced in these models).

## Server examples

### QueryTemplate

The `columns` value is free-form (`Dictionary<string, object>`). The shape below is illustrative.

```json
{
  "uuid": "3f0c2a52-6d0e-4a1b-9a57-0d2d6b8f1c11",
  "name": "Sign-ins by user",
  "isDeleted": false,
  "isManaged": true,
  "updated": "2026-03-14T09:30:00Z",
  "createdBy": "alice@contoso.com",
  "updatedBy": "bob@contoso.com",
  "queryType": "query",
  "menu": "Identity",
  "summary": "Sign-in events for a user, filtered by result.",
  "path": ["Identity", "Sign-ins"],
  "cluster": "https://contoso.westus2.kusto.windows.net",
  "database": "SecurityLogs",
  "columnId": "ReportGuid",
  "params": {
    "user": { "type": "string", "hint": "User principal name", "optional": false },
    "status": {
      "type": "array",
      "values": ["Success", "Failure", "Interrupted"],
      "multiple": true,
      "optional": true,
      "default": "Failure"
    }
  },
  "fields": {
    "deviceId": { "type": "multiple", "from": "DeviceList" },
    "ipAddress": { "type": "match", "regex": "^\\d{1,3}(\\.\\d{1,3}){3}$" }
  },
  "columns": {
    "ReportGuid": { "visible": false },
    "ReportTime": { "type": "datetime", "width": 180 },
    "UserPrincipalName": { "type": "string" }
  },
  "query": "SignInLogs | where TimeGenerated between (datetime({StartTime}) .. datetime({EndTime})) | where UserPrincipalName == '{user}'"
}
```

### KustoQueryRun (completed)

```json
{
  "kustoQuery": {
    "cluster": "https://contoso.westus2.kusto.windows.net",
    "database": "SecurityLogs",
    "requestedBy": "alice@contoso.com",
    "startTime": "2026-03-13T00:00:00Z",
    "endTime": "2026-03-14T00:00:00Z",
    "query": "SignInLogs | take 2"
  },
  "executeDateTimeUtc": "2026-03-14T09:31:02.114Z",
  "queryRunId": "c1b7f1f6-9a34-4a52-8c1e-5f2e0f7b2a90",
  "status": "completed",
  "resultData": [
    { "ReportGuid": "8e0a...c4", "ReportTime": "2026-03-13T22:10:05Z", "UserPrincipalName": "alice@contoso.com", "ResultType": 0 },
    { "ReportGuid": "1d9b...7a", "ReportTime": "2026-03-13T22:15:41Z", "UserPrincipalName": "alice@contoso.com", "ResultType": 50126 }
  ],
  "executionMetrics": {
    "execution_time": 0.0312,
    "resource_usage": {
      "cache": { "shards": { "hot": { "hitbytes": 1024, "missbytes": 0, "retrievebytes": 0 } } },
      "cpu": { "user": "00:00:00.0156250", "kernel": "00:00:00", "total cpu": "00:00:00.0156250" },
      "memory": { "peak_per_node": 524384 }
    },
    "input_dataset_statistics": {
      "extents": { "total": 3, "scanned": 1 },
      "rows": { "total": 120000, "scanned": 2 }
    },
    "dataset_statistics": [ { "table_row_count": 2, "table_size": 310 } ]
  },
  "stackTrace": null,
  "mainError": null
}
```

### KustoQueryRun (error)

```json
{
  "kustoQuery": {
    "cluster": "https://contoso.westus2.kusto.windows.net",
    "database": "SecurityLogs",
    "requestedBy": "alice@contoso.com",
    "startTime": "2026-03-13T00:00:00Z",
    "endTime": "2026-03-14T00:00:00Z",
    "query": "SignInLogs | where NoSuchColumn == 1"
  },
  "executeDateTimeUtc": "2026-03-14T09:35:47.902Z",
  "queryRunId": "0a4d6a1e-3b7c-4f0e-b1d2-77c9e8a5d411",
  "status": "error",
  "resultData": null,
  "executionMetrics": null,
  "stackTrace": "Kusto.Data.Exceptions.KustoBadRequestException: ...\n   at Kusto.Data.Net.Client.KustoClientBase...",
  "mainError": "Semantic error: 'where' operator: Failed to resolve scalar expression named 'NoSuchColumn'"
}
```

## Browser entities

### DisplayComponent
Persisted in IndexedDB store `display_components` (key = `componentUuid`). Source: `frontend/src/store/modules/displayComponent.js:64-89` (create), `:107-111` (save), `:174-196` (in-memory add), `:221-225` (module state).

Common fields:

| name | type | notes |
|---|---|---|
| componentUuid | string (uuidv4) | Key. Generated by `generateUuidv4`. |
| componentName | `'KustoQueryResult'` \| `'TemplateQueryResult'` | Discriminator. Can flip from Template to Kusto via `convertDisplayComponent` (`:91-102`); `uuid` is kept. |
| title | string | Editable. Template components default to `queryTemplate.buildSummary(params)`. |
| parentUuid | string \| null | null = root. Missing parent at load time makes it a root (`:188-191`). |
| params | object | Shape depends on `componentName` (below). |
| state | object | Shape depends on `componentName` (below). |
| rowDataTrigger | number \| null | `Date.now()` set by `triggerComponentRowData` (`:103-106`). The grid watches it to reload rows. |
| displayComponentIndex | number | Load-order counter (`:180`). Assigned at add time, so it is renumbered on every load and re-saved. Load sorts by it so parents come before children (`:123-126`). |
| children | array | In-memory only. Deleted before save (`:109`). |

Not stored: `componentUuid` is the only id. Rows are in `row_results`, not here.

KustoQueryResult (`frontend/src/helpers/displayComponent.js:31-51`):

| name | type | notes |
|---|---|---|
| params.query | string | Raw KQL. Default is `declare query_parameters(StartTime:datetime, EndTime:datetime); DeviceProcessEvents ...` (`:24-29`). |
| params.cluster | string | Cluster URL, may be `''`. |
| params.database | string | May be `''`. |
| state.isVisited | boolean | false on create and on each run start. |
| state.error | any \| null | Error object or null. Stored as-is, not serialised to a string. |
| state.rowCount | number \| null | |
| state.isExecuting | boolean | |
| state.executionTime | any | Set after run from `queryInfo.execution_time`. |
| state.cpuUsage | any | From `queryInfo.resource_usage.cpu['total cpu']`. |
| state.memoryUsage | any | From `queryInfo.resource_usage.memory.peak_per_node`. |

`state` is merged (spread) on every update (`store/modules/displayComponent.js:35-45`). Keys are added lazily and are never removed.

TemplateQueryResult (`frontend/src/helpers/displayComponent.js:143-177`):

| name | type | notes |
|---|---|---|
| params.inParams | object | Deep clone (`JSON.parse(JSON.stringify)`) of the user-entered template parameters. Keys are the template's `params` and `fields` names. |
| params.queryTemplate | QueryTemplate snapshot | Full copy of the template at creation time (fields below). It is not a reference by uuid. Rehydrated with `new QueryTemplate(...)` on load (`store/modules/displayComponent.js:128-135`). |
| state.isVisited, error, rowCount, isExecuting | as Kusto | |
| state.editQuery | boolean | `!autoExecute \|\| !isDataComplete`. When true the parameter form is shown. |
| state.executionTime, cpuUsage, memoryUsage | as Kusto | |

QueryTemplate snapshot fields (`frontend/src/helpers/kustoQueries.js:44-58`):

| name | type | notes |
|---|---|---|
| uuid | string | Template id. |
| menu | string | |
| summary | string | Handlebars template, `noEscape`. |
| queryType | `'query'` \| `'view'` | |
| path | string[] | Menu tree path. |
| cluster | string | Handlebars template. |
| database | string | Plain string, not templated (`displayComponent.js:9`). |
| params | object | name -> `{default, ...}`. Default `{}`. |
| fields | object | name -> `{type: 'multiple'\|'match'\|other, from?, regex?}`. Default `{}`. |
| query | string | Handlebars KQL. Partial `{{> getTagEvents}}` is registered globally (`:40`). Helper `array` renders `@'a',@'b'` (`:41`). |
| columns | array | Default `[]`. |
| columnId | string \| null | Row-id column override. See RowResult. |

Rendering happens at run time (`buildCluster`, `buildQuery` in `runTemplateQuery`, `displayComponent.js:99-107`). Converting to custom (`:8-29`) renders once and replaces params with `{query, cluster, database}`.

### RowResult
Stored in IndexedDB store `row_results`, key = display component uuid, value = array of raw row objects (`frontend/src/helpers/localStorage.js:3-14`). An empty result is saved as `[]`. An error deletes the key. The `_id` is not stored (see below).

| name | type | notes |
|---|---|---|
| (each Kusto column) | any | Raw column name -> value. |
| EventId | string | Required by the tag-event join and the default row id. |
| EventTime, Cluster | any | Convention in the default query only, not enforced. |
| TagEvent | object \| absent | See TagEvent. |
| _id | string | Client-only. Added at load in `frontend/src/components/grids/KustoPivot.vue:363-384`. Used as `getRowId` (`:254`). Excluded from columns (`:562`). |

`_id` derivation (`KustoPivot.vue:369-380`), per row in order:
1. `colId = queryTemplate?.columnId || 'EventId'` (`:139-141`). Custom Kusto queries have no template, so they use `EventId`.
2. `id = row[colId]`.
3. If `id` is `''`, `undefined`, `null`, or already seen in this load, use `` `row-index-${index}` `` (index = position in the array, 0-based).

Loading throws `'Failed to load data store.'` if the key is missing (falsy).

### ColumnView
IndexedDB store `column_views`, key = `uuid` (`frontend/src/store/modules/columnViews.js:9-14,19-27`).

| name | type | notes |
|---|---|---|
| uuid | string (uuidv4) | Also the key. |
| name | string | Trimmed on add (`KustoPivot.vue:297`). Lists are sorted by name. |
| columnState | array | Raw ag-Grid `columnApi.getColumnState()` output (`KustoPivot.vue:291-298`). Coupled to ag-Grid column ids, including `TagEvent.Tags`, `TagEvent.Comment`, `TagEvent.Determination`. |

Global (not per display component). `selectedColumnViewUuid` is component-local and not persisted.

### QueryOption
IndexedDB store `query_options`, key = template uuid (`frontend/src/store/modules/queries.js:6-10,40-44,60-65`).

| name | type | notes |
|---|---|---|
| hide | boolean | Only key seen in the read files (`KustoPivot.vue:393`: `getQueryOption(uuid).hide !== true`). |
| (other) | any | `updateQueryOption` shallow-merges any keys. Getter returns `{}` if none. |

Templates themselves are not persisted here. They come from the API (`queryRetrieve()`), with `isDeleted === true` filtered out (`:340-342`).

### IndexedDB stores
All created with `localforage.createInstance({driver: INDEXEDDB, storeName})` and no `name`, so they all live in localforage's default database (`localforage`). Sources: `store/modules/displayComponent.js:7-10`, `columnViews.js:5-8`, `queries.js:6-9`, `helpers/localStorage.js:3-6`.

| store | key | value |
|---|---|---|
| display_components | componentUuid | DisplayComponent (without `children`) |
| row_results | display component uuid | array of RowResult (raw, no `_id`) |
| column_views | ColumnView.uuid | ColumnView |
| query_options | template uuid | QueryOption |

### TagEvent
Dynamic object column, produced by the `getTagEvents` KQL partial (`frontend/src/helpers/kustoQueries.js:4-39`). It is built with `extend TagEvent=pack_all()` over the joined tag tables, then projected as `EventId, TagEvent` and joined back onto the input rows (inner join on `EventId`). Tables are read from `cluster(tagCluster).database(tagDatabase)`: `SavedEvent`, `EventTag`, `EventComment`.

| name | type | notes |
|---|---|---|
| IsSaved | `true` \| absent | From `SavedEvent` (latest by `DateTimeUtc`). Absent (not false) when never saved. |
| Tags | string[] \| absent | `make_set(Tag)` of tags whose latest row has `IsDeleted` false. |
| Determination | string \| absent | From the latest `EventComment`. The grid compares lowercase `malicious`, `benign`, `suspicious` (`KustoPivot.vue:183-185`). |
| Comment | string \| absent | Latest comment text. |
| Comments | array \| absent | `make_list(pack(...))` in descending `DateTimeUtc` order. Item: `{CreatedBy, Comment, Determination, DateTimeUtc}`. |

- Absent fields are omitted by `pack_all()` (null columns dropped), so use optional chaining.
- Comment data is dropped when the latest comment row is deleted (`where not(IsDeleted)` after the summarize). The event then has no Comment, Determination, or Comments.
- The client patches `TagEvent` locally after saves. Quick-save comment sets `Comment` (`KustoPivot.vue:301-355`). Bulk determination sets `Determination` (lowercased) and `IsSaved: true` (`:501-505`).

### Share link
`frontend/src/views/ShareQuery.vue:31-59`. The router route param is `uuid` (the route path is not in the files read).

| part | value |
|---|---|
| path | Route with `:uuid` = QueryTemplate uuid (route name for ShareQuery not read; path is outside scope). |
| `p` | `btoa(JSON.stringify(params))`, decoded with `JSON.parse(atob(p))`. Standard base64 with no URL-encoding step in the decoder. Params are merged over `queryTemplate.getDefaultParams()`. |
| `execute` | `'1'` means auto-execute. Any other value or absent means do not run. |

Errors shown: `'This query was not found.'` (unknown template uuid), `'Parameters are missing.'` (no `p`). The link creates a root TemplateQueryResult (`parentUuid=null`, `makeActive=true`) titled `buildSummary(params)`. Template must already be loaded from the API, and the link does not embed the template.

### Export/Import JSON
`frontend/src/views/ExportImport.vue:60-70`, `store/modules/displayComponent.js:142-155`.

- Export: `JSON.stringify(array of every record in display_components)`, copied to the clipboard and shown in a textarea. Each item is a DisplayComponent as persisted, including `displayComponentIndex` and the full `queryTemplate` snapshot for template components.
- Import: `JSON.parse` the textarea, then `setItem(c.componentUuid, c)` for each item, overwriting matching keys. The user must refresh the browser to see it. No validation or merge, and existing components not in the file stay.
- Not included: `row_results` (imported components have no data until re-run, and load would throw `Failed to load data store.`), `column_views`, `query_options`, and the server-side query templates.
- Not exported: `children` (never persisted).

### Runtime config `window.appConfig`
`frontend/src/helpers/runtimeConfig.js`. A frozen object: build-time `import.meta.env` values first, then `...window.appConfig` spread on top (shallow, so any key can be overridden, and nested objects are replaced whole).

| key | type | default / source |
|---|---|---|
| auth.clientId | string | `VITE_AUTH_CLIENT_ID` |
| auth.authority | string | `https://login.microsoftonline.com/${VITE_AUTH_TENANT_ID}` |
| redirectUri | string | `VITE_AUTH_REDIRECT` |
| apiEndpoint | string | `VITE_API_ENDPOINT` |
| agGridLicenseKey | string | `VITE_AGGRID_LICENSE_KEY` |
| wikiUri | string | `VITE_HELP_WIKI_URI` or `https://github.com/microsoft/tim-data-investigate-platform/wiki` |
| issueUri | string | `VITE_HELP_ISSUE_URI` or `https://github.com/microsoft/tim-data-investigate-platform/issues/new?template=issue_template.md` |
| nodeEnv | string | `NODE_ENV` or `'production'` |
| tagCluster | string | `import.meta.env.TAG_CLUSTER`, no `VITE_` prefix |
| tagDatabase | string | `TAG_DATABASE` or `'Research'`, no `VITE_` prefix |
| defaultClusters | `{name, clusters: string[], databases: string[]}[]` | `[{name:'Example', clusters:['https://help.kusto.windows.net'], databases:['Samples']}]` |

`tagCluster` and `tagDatabase` are interpolated into the `getTagEvents` string at module load (`kustoQueries.js:9`), so they must be set before that module is imported.

## Browser examples

KustoQueryResult:
```json
{
  "componentUuid": "3f6c1c2e-8a41-4b9e-9d0a-1c6a7f0e2b11",
  "componentName": "KustoQueryResult",
  "title": "Process events",
  "parentUuid": null,
  "params": {
    "query": "declare query_parameters(StartTime:datetime, EndTime:datetime);\nDeviceProcessEvents\n| where Timestamp between (StartTime .. EndTime)\n| take 1\n| extend EventTime=Timestamp, Cluster=current_cluster_endpoint(), EventId=strcat(DeviceId, ReportIndex)",
    "cluster": "https://help.kusto.windows.net",
    "database": "Samples"
  },
  "state": {
    "isVisited": false,
    "error": null,
    "rowCount": 1,
    "isExecuting": false,
    "executionTime": 0.42,
    "cpuUsage": "00:00:00.0156250",
    "memoryUsage": 1048576
  },
  "rowDataTrigger": 1767225600000,
  "displayComponentIndex": 0
}
```

TemplateQueryResult:
```json
{
  "componentUuid": "b7d2a9f4-55c0-4e1a-8e3d-92f0c4a7d6e2",
  "componentName": "TemplateQueryResult",
  "title": "Logons for alice",
  "parentUuid": "3f6c1c2e-8a41-4b9e-9d0a-1c6a7f0e2b11",
  "params": {
    "inParams": { "StartTime": "ago(1d)", "Users": ["alice"] },
    "queryTemplate": {
      "uuid": "0d9e6d3c-2b7a-4f57-a1c3-6e8f9b0a4c21",
      "menu": "Logons by user",
      "summary": "Logons for {{Users.[0]}}",
      "queryType": "query",
      "path": ["Identity", "Logons"],
      "cluster": "https://help.kusto.windows.net",
      "database": "Samples",
      "params": { "StartTime": { "default": "ago(1d)" } },
      "fields": { "Users": { "type": "multiple", "from": "AccountName" } },
      "query": "let T = Logons | where AccountName in ({{array Users}}) | extend EventId=strcat(AccountName, tostring(Timestamp));\n{{> getTagEvents}}\ngetTagEvents(T)",
      "columns": [],
      "columnId": null
    }
  },
  "state": {
    "isVisited": true,
    "error": null,
    "rowCount": 1,
    "isExecuting": false,
    "editQuery": false,
    "executionTime": 1.1
  },
  "rowDataTrigger": 1767225700000,
  "displayComponentIndex": 1
}
```

Row with TagEvent (as stored in `row_results`; `_id` is added at load and shown here as the client sees it):
```json
{
  "EventId": "dev-01-42",
  "AccountName": "alice",
  "Timestamp": "2026-01-01T00:00:00Z",
  "TagEvent": {
    "IsSaved": true,
    "Tags": ["lateral-movement", "vip"],
    "Determination": "suspicious",
    "Comment": "Odd source host",
    "Comments": [
      { "CreatedBy": "bob@contoso.com", "Comment": "Odd source host", "Determination": "suspicious", "DateTimeUtc": "2026-01-01T10:00:00Z" },
      { "CreatedBy": "carol@contoso.com", "Comment": "Looking", "Determination": "benign", "DateTimeUtc": "2026-01-01T09:00:00Z" }
    ]
  },
  "_id": "dev-01-42"
}
```

## Notes for the rewrite

- Keep IndexedDB compatibility if existing user data must survive: default localforage database `localforage`, stores `display_components`, `row_results`, `column_views`, `query_options`. Store names and key shapes above are the contract. Keep `componentUuid` (not `uuid`) in DisplayComponent, but `uuid` in ColumnView and QueryTemplate.
- `TemplateQueryResult.params.queryTemplate` is a full snapshot, not a reference. Old exports contain the whole template and reload it via the `QueryTemplate` constructor, so accept the full shape (defaults: `params {}`, `fields {}`, `columns []`, `columnId null`). Tolerate a missing `state.editQuery` and missing metric keys.
- Row `_id` is computed, not stored, and must stay `row[columnId || 'EventId']`, falling back to `row-index-${i}` on empty or duplicate values. Selection and row updates key off it.
- `TagEvent` is a nested dynamic object whose absent keys mean "unset" (`IsSaved` is `true` or absent, never `false`). Grid column ids use dotted paths (`TagEvent.Tags`, `TagEvent.Comment`, `TagEvent.Determination`), so saved `columnState` in ColumnViews depends on these. Determination values are lowercase.
- Share link: `?p=` is `btoa(JSON.stringify(params))` (standard base64, not URL-safe) and `execute=1` is the only truthy value. `btoa` fails on non-Latin1 characters, so decide whether to keep or harden it. Keep decoding old links.
- Export/Import is the raw array of `display_components` records. It excludes results, column views, and query options. Import overwrites by `componentUuid` and requires a reload. Keep the format, and consider warning about missing row data. `window.appConfig` overrides are shallow, and `TAG_CLUSTER` and `TAG_DATABASE` lack the `VITE_` prefix.
