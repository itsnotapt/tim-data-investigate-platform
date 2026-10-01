# Backend API spec (legacy .NET 6 service)

> **Archive.** This document describes the legacy system (Vue 2 + .NET 6), which was removed from the repo in P5-12. Paths and `file:line` citations refer to commit `8a2ff2e` (`git show 8a2ff2e:<path>`). Kept for reference; not maintained.

> Source: `backend/Tim.Backend/`. Paths below are relative to that folder unless absolute.
> Status: **verified by code reading** (2026-09-29). Nothing here was verified against a running backend — there is no .NET toolchain in the dev environment and there are **zero backend tests**.

The service is small: **13 endpoints / 5 controllers**, two DB-persisted entities (`QueryTemplate`, `KustoQueryRun`), three Kusto tables written via ingestion only, and Azure AD bearer auth with an On-Behalf-Of (OBO) exchange so user queries run as the user.

See also: [data-models.md](data-models.md) for every field, [../open-questions.md](../open-questions.md) for unresolved issues.

---

## Global behaviour

| Concern | Behaviour |
|---|---|
| JSON | Newtonsoft. Explicit `[JsonProperty]` names win; dictionary keys (Kusto column names) are **not** camel-cased. Enums serialize as their `EnumMember` string. |
| Validation | `[ApiController]` → automatic **400 `ValidationProblemDetails`** (`{type,title,status,traceId,errors:{field:[msg]}}`) on annotation / `IValidatableObject` failure or unparseable body. `BadRequest("...")` returns a **plain string** body. |
| Auth | `[Authorize]` = AAD JWT bearer (see [Auth](#auth)). Health, swagger, `/metrics` are anonymous. |
| Errors | No global handler → unhandled exception = 500 empty body (prod). |
| Route ids | `{uuid}`, `{queryRunId}` are `Guid`-typed → malformed = 400. |
| CORS | Any origin / header / method. |
| Custom headers | **None.** Only `Authorization: Bearer <AAD token>`. (`SwaggerRequestHeaderAttribute` is dead code.) |

---

## Endpoint catalogue

| # | Method | Path | Auth | Success | Used by frontend |
|---|---|---|---|---|---|
| 1 | POST | `/api/user/authenticate` | anon | 200 `{username, token}` | **no** (dead — token not accepted anywhere) |
| 2 | POST | `/api/kusto/schema` | AAD | 200 row list | yes (`getKustoSchema`) |
| 3 | POST | `/api/kusto/query` | AAD | 200 / 202 `KustoQueryRun` | yes (`executeQuery`) |
| 4 | GET | `/api/kusto/query/{queryRunId}` | AAD | 200 / 202 / 404 | yes (`getQueryResult`, polling) |
| 5 | GET | `/api/templates/queries?since=&includeDeleted=` | AAD | 200 `QueryTemplate[]` | yes (`includeDeleted=true`) |
| 6 | GET | `/api/templates/queries/{uuid}` | AAD | 200 / 404 | yes |
| 7 | POST | `/api/templates/queries` | AAD | **200 empty** | yes |
| 8 | PUT | `/api/templates/queries/{uuid}` | AAD | **200 empty** | yes |
| 9 | PATCH | `/api/templates/queries/{uuid}` | AAD | 204 | yes (restore: `[{op:replace,path:/isDeleted,value:false}]`) |
| 10 | DELETE | `/api/templates/queries/{uuid}` | AAD | 204 (soft delete) | yes |
| 11 | POST | `/api/taggedevents/savedEvents` | AAD | 204 | yes |
| 12 | POST | `/api/taggedevents/tags` | AAD | 204 | yes |
| 13 | POST | `/api/taggedevents/comments` | AAD | 204 | yes |
| – | GET | `/api/healthChecks/readiness`, `/liveness` | anon | 204 always | helm probes |
| – | GET | `/api/swagger`, `/metrics` | anon | | ops |

### 2. `POST /api/kusto/schema` — `Controllers/External/KustoExternalController.cs:56-68`
Body `{cluster, database}`; cluster must be absolute **https** URI (else 400).
1. Read raw incoming bearer token (`SaveToken=true`).
2. MSAL OBO → scope **hard-coded** `https://help.kusto.windows.net/.default` (regardless of cluster).
3. New Kusto client with user token; run `.show schema as json`.
4. Return rows as list of dicts. Frontend reads `data[0].ClusterSchema` and `JSON.parse`s it (a JSON string inside JSON). ⚠ the exact column name (`ClusterSchema` vs `DatabaseSchema`) is inferred — see open questions.

### 3. `POST /api/kusto/query` — `KustoExternalController.cs:76-91`
Body `KustoQuery` `{cluster, database, requestedBy, startTime?, endTime?, query}`.
- `query` required; `startTime > endTime` → 400.
- ⚠ **Bug:** cluster URL/https validation silently skipped (`Models/KustoQuery/KustoQuery.cs:46` discards `base.Validate`).

Lifecycle (`Providers/Query/DelayedQueryRunner.cs:43-62`):
```
POST /api/kusto/query
  └─ DB upsert {status: created}  (TTL 1 day requested)
  └─ fire-and-forget: run query ──ok──► {completed, resultData, executionMetrics} ─► DB upsert (no TTL)
                                 └─err─► {error, mainError, stackTrace}           ─► DB upsert (no TTL)
  └─ race vs 1s: finished → 200 (completed|error) ; else → 202 (created)
GET /api/kusto/query/{id} → 404 | 202 (created) | 200 (completed|error)
```
- Query **errors are 200 with `status:"error"`**, not 4xx/5xx.
- `timedOut` status exists but is never set. No query timeout. Pod restart / oversize result ⇒ run stuck in `created` forever.
- `startTime`/`endTime` are passed as Kusto **query parameters** `StartTime`/`EndTime` (ISO "o"); the KQL must `declare query_parameters(StartTime:datetime, EndTime:datetime);` to use them.
- No ownership check on `GET` — any authenticated user can read any run.

Kusto frame handling (`Providers/Kusto/KustoQueryClient.cs:77-204`): V2 query; all `PrimaryResult` tables' rows **concatenated** into one flat `list[dict]`; `QueryCompletionInformation` row with `LevelName=="Stats"` → `KustoQueryStats`; progressive frames → `UnexpectedFrameException` → error. No row/size cap.

Value serialization (must match for grid parity): DateTime → ISO string, TimeSpan → `"hh:mm:ss"`, dynamic → nested JSON, DBNull → null, Guid → string.

### 5–10. Query templates — `Controllers/External/QueryTemplatesExternalController.cs`
- **GET list**: loads *all* then filters in memory. Deleted are excluded **only when `includeDeleted=false` is passed explicitly** (absent ⇒ included). `since` filters `updated > since`.
- **POST**: 400 plain-string `"A template with this UUID already exists"` if uuid exists; server sets `createdBy=updatedBy=User.Identity.Name`, `updated=UtcNow`.
- **PUT**: 400 `"UUIDs don't match"` if body uuid ≠ route. Blind upsert — can create, and trusts client `createdBy`/`isDeleted`.
- **PATCH**: RFC 6902 JSON Patch. 404 if missing. Patched model **not re-validated**.
- **DELETE**: soft delete (`isDeleted=true`). ⚠ missing uuid → 500 (NullReference).

### 11–13. Tagged events — `Controllers/External/TaggedEventExternalController.cs:57-114`
Body: JSON **array** of `SavedEvent` / `EventTag` / `EventComment`. Empty array → 400. Rows ingested into Kusto (NDJSON, direct ingest, JSON mapping) under the **app identity** (not the user). `createdBy`/`dateTimeUtc` are trusted from the client. Tags/comments are **append-only**; deletes are new rows with `isDeleted:true`; readers take `arg_max(DateTimeUtc, …)`.

### 1. `POST /api/user/authenticate` — legacy
Compares to configured `AUTH_USERNAME`/`AUTH_PASSWORD`, returns HS256 JWT signed with `SIGNING_KEY`. That token is **not accepted** by any `[Authorize]` endpoint. Yet the app refuses to start without those three settings. Recommend dropping (ADR candidate).

---

## Auth

**Inbound** (`Startup/ServiceExtensions.cs:147-164`): JwtBearer, authority `https://login.microsoftonline.com/{AUTH_TENANT_ID}`, valid audience `api://{AUTH_CLIENT_ID}`, issuer/signature/lifetime validated. User name = `User.Identity.Name` (from `unique_name` — present in v1 tokens only).

Python target: validate against tenant JWKS; `aud == api://{clientId}`; issuer ∈ {`https://sts.windows.net/{tid}/`, `https://login.microsoftonline.com/{tid}`, `…/v2.0`}; name from `unique_name` → `upn` → `preferred_username`.

**Outbound OBO** (`ServiceExtensions.cs:166-179`): MSAL confidential client; credential = `AUTH_CLIENT_SECRET` if set, else client assertion from `DefaultAzureCredential` with scope `{ClientId}/.default` (unusual). New MSAL app per request (no token cache).
Python: `msal.ConfidentialClientApplication.acquire_token_on_behalf_of(...)` + `azure-kusto-data` `with_aad_user_token_authentication`.

**Frontend side** (`frontend/src/helpers/auth.js`): MSAL popup login; API token scope `api://{clientId}/user_impersonation`; also a Kusto token scope `https://help.kusto.windows.net/.default` (acquired but all Kusto traffic goes via backend).

---

## Persistence

`IDatabaseRepository<T>`: `AddOrUpdateItemAsync(entity, ttl?)`, `GetItemAsync(id)`, `GetItemsAsync()`, `DeleteItemAsync(id)` (unused). Chosen by `DATABASE_TYPE` ∈ `Couchbase|MongoDb|Redis` (fallback Couchbase). Collection / key prefix = CLR type name (`QueryTemplate`, `KustoQueryRun`).

| Backend | Storage | TTL reality | Notes |
|---|---|---|---|
| Couchbase | collections in default scope, Newtonsoft JSON; bucket auto-created 100MB | completion upsert **clears** TTL ⇒ never expires | N1QL `SELECT d.*` for list |
| Mongo/Cosmos | BSON with C# property names; `resultData` gzipped JSON blob | TTL index 1 day on `ExecuteDateTimeUtc` (or `_ts` for Cosmos) | filter on computed `Id` — unverified whether it works |
| Redis | key `"{Type}/{id}"`, JSON string | **ignored** — never expires | list uses `KEYS` on every server |

---

## Kusto tables (created at startup in `KUSTO_DATABASE_NAME`, default `Research`)

Errors during create are swallowed. JSON ingestion mappings `<Table>Mapping` map `$.camelCase` → column.

| Table | Columns |
|---|---|
| `SavedEvent` | EventId:string, EventTime:datetime, DateTimeUtc:datetime, CreatedBy:string, EventAsJson:dynamic |
| `EventTag` | EventId:string, DateTimeUtc:datetime, CreatedBy:string, Tag:string, IsDeleted:bool |
| `EventComment` | EventId:string, DateTimeUtc:datetime, CreatedBy:string, Comment:string, Determination:string, IsDeleted:bool |

The frontend reads these back directly in KQL via the `getTagEvents` Handlebars partial (`frontend/src/helpers/kustoQueries.js`) using `cluster(tagCluster).database(tagDatabase)`.

---

## Configuration

Each value: env var default, overridden by .NET config section if present.

| Env var | Section:Key | Default | Required | Used |
|---|---|---|---|---|
| `AUTH_TENANT_ID` | AuthConfiguration:ClientAuthority | – | yes | JWT + MSAL |
| `AUTH_CLIENT_ID` | AuthConfiguration:ClientId | – | yes | JWT aud + MSAL |
| `AUTH_CLIENT_SECRET` | AuthConfiguration:ClientSecret | – | no | MSAL (else assertion) |
| `SIGNING_KEY` (≥16), `AUTH_USERNAME`, `AUTH_PASSWORD` | AuthConfiguration:* | – | yes | legacy login only |
| `KUSTO_CLUSTER_URI` | KustoConfiguration:KustoClusterUri | – | yes | admin + ingest |
| `KUSTO_INGEST_URL` | KustoConfiguration:IngestKustoClusterUri | – | yes | **unused** |
| `KUSTO_DATABASE_NAME` | KustoConfiguration:KustoDatabase | `Research` | no | tag tables |
| `DATABASE_TYPE` | DatabaseConfiguration:DatabaseType | `Couchbase` | – | backend choice |
| `COUCHBASE_CONNECTION_STRING` / `_USER_NAME` / `_USER_PASSWORD` / `_DATABASE_NAME` | CouchbaseConfiguration:* | `couchbase://localhost` / `Administrator` / – / `default` | if Couchbase | |
| `MONGO_CONNECTION_STRING` / `_DATABASE_NAME` / `_WITH_COSMOSDB` | MongoConfiguration:* | – / – / false | if Mongo | |
| `REDIS_CONNECTION_STRING` | RedisConfiguration:ConnectionString | – | if Redis | |

⚠ `backend/helm` uses different env var names (`DB_CONNECT_STRING`, `REDIS_HOSTS`, `KUSTO_URL`…) and would not boot this backend.

---

## Startup & cross-cutting

- Startup: DB init (fatal on failure) → Kusto table/mapping creation (non-fatal) → listen on :80.
- Serilog console (+ `log.txt` in Development). Prometheus `/metrics` (registered twice). Swagger at `/api/swagger`.
- Polly retry policies registered but **unused** (async one has a 0s-delay bug).
- Health checks don't probe dependencies.

## Known bugs / security issues (carry into rewrite decisions)

1. `/api/kusto/query` skips cluster https validation → backend sends a user OBO token to any client-supplied URL (SSRF / token leak).
2. Query runs have no owner check; `requestedBy` is client-supplied.
3. Tagged events & template `createdBy` trusted from client; ingestion uses service identity.
4. Full .NET stack traces returned in `stackTrace`.
5. Inconsistent retention (see persistence table); runs can be stuck in `created`.
6. DELETE missing template → 500; POST/PUT return 200 empty (declared 204).
7. `includeDeleted` omitted ⇒ deleted templates included.
8. Mongo `Id` filter unverified; Redis `KEYS` scan.

## Dead code
`SwaggerRequestHeader*`, `RedisKeyGenerator`, `IEnvironmentInfo`, `TryGetHeaderValueWithDefault`, `DeleteItemAsync`, unused Polly policies, `AddHttpClient`, `KUSTO_INGEST_URL`, `QueryRunStatus.TimedOut`, `SwaggerConfiguration`, many unused NuGet refs (Autofac, FluentValidation, ServiceBus, Identity.Web, ADAL…). `Tim.Backend.Tests` contains scaffolding only — no tests.
