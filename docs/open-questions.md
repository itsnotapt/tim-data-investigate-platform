# Open questions

Process: see [RULES.md §4](RULES.md#4-handling-questions-and-decisions). IDs are permanent. Statuses: **Blocking** (needs the user before dependent work starts) · **Open** (needs an answer eventually) · **Assumed** (default chosen, user may overturn) · **Answered**.

## Blocking
| ID | Question | Why it matters | Proposed default |
|---|---|---|---|
| – | None | | |

## Open
| ID | Question | Proposed default |
|---|---|---|
| Q-005 | Keep investigations (tabs, row results, column views) **browser-only** (IndexedDB), or move server-side for sharing/multi-device? | Browser-only for parity phase |
| Q-006 | Keep **Handlebars** template syntax (partials, `array` helper)? Changing breaks existing templates | Keep Handlebars on the frontend for parity; add escaping (SEC-06) |
| Q-007 | Keep **202 + polling** execution model (same backoff), or SSE/WebSocket? Durable worker vs in-process task? | Keep 202+poll contract; in-process asyncio task + explicit timeout + retention |
| Q-008 | Fix legacy API quirks (200-vs-204, `includeDeleted` default, query errors as 200 `status:error`, schema JSON-in-string) or keep for compatibility? | Fix where frontend is rewritten anyway; document in `rewrite/api-contract.md` |
| Q-009 | Should **template queries receive the time range** (legacy: only ad-hoc queries)? | Parity first (no), revisit |
| Q-010 | **Suppressions** feature (dead stub) in scope? | Drop |
| Q-011 | Legacy `/api/user/authenticate` — any external client using it? | Drop (SEC-07) |
| Q-012 | UI library: MUI (closest to Vuetify/Material look) vs other (shadcn/Tailwind, Fluent UI) | MUI for visual parity |
| Q-013 | OBO scope: hard-coded `help.kusto.windows.net` → derive from cluster / configurable for sovereign clouds? | Configurable, default `https://kusto.kusto.windows.net/.default`-style per cluster |
| Q-014 | Which Entra token version does the SPA get (v1 vs v2)? Affects `aud` and username claim | Accept both; name from `unique_name`→`upn`→`preferred_username` |
| Q-015 | Keep startup creation of Kusto tag tables/mappings, or move to IaC/migration script? | Separate CLI/migration command |
| Q-016 | Deployment target: keep Docker Compose + Helm? Single container (API serves SPA) or two? | Two images + compose; helm later |
| Q-017 | Is `suggest.enabled:false` on the Kusto editor intentional (disables IntelliSense popup)? | Enable suggestions |
| Q-018 | Kusto `.show schema as json` column name — frontend reads `ClusterSchema`; confirm against a real cluster | Verify during backend Kusto task. **Still open (P2-06):** endpoint implemented tolerantly, not verified against a real cluster: runs `.show schema as json` with the database as context, accepts `ClusterSchema`, `DatabaseSchema` or a single unknown column, parses a JSON string (or an already parsed object), else 502. Once confirmed, narrow `SCHEMA_COLUMNS` in `kusto/router.py` |
| Q-020 | **Tag ingestion identity**: keep writing tags under the app identity while recording the user from the token as `createdBy` (SEC-03 fix), or ingest with the user's OBO token? | App identity, `createdBy` from token |
| Q-021 | **Query result limits and retention values**: max rows / bytes per run, query timeout, run retention | 100 000 rows, 64 MB, 10 min timeout (poll deadline 11 min), 1 day retention |
| Q-022 | **Cluster allow-list policy** (SEC-01): explicit host allow-list required, or https + known suffix list? | https + suffix list (`.kusto.windows.net`, `.kusto.fabric.microsoft.com`), optional strict allow-list env |
| Q-024 | **Handlebars escaping semantics** (Q-006 follow-up): what happens to existing templates that use raw `{{x}}` inside KQL strings, and does `array` change output for values with quotes? | Escape only in explicit string-literal helpers; raw `{{x}}` unchanged but linted; `array` escapes quotes |
| Q-028 | **Schema response shape** (`POST /api/kusto/schema`): return `{schema: <parsed object>}` (contract default, Q-008 fix) or keep legacy row list with JSON-in-string for Monaco loader parity (target-architecture section 5 said keep)? Depends on Q-018 (source column) | `{schema: <object>}`; the React client is new, so no parity constraint. See [api-contract.md](rewrite/api-contract.md) 3.2 |

## Assumed
| ID | Assumption | Date |
|---|---|---|
| Q-101 | Tagged-event requests are capped at 1000 items per call and 1 MB per `eventAsJson`, validated all-or-nothing (see [api-contract.md](rewrite/api-contract.md) 3.11-3.13) | 2026-09-29 |
| Q-102 | Error envelope is RFC 7807-style `{type,title,status,detail,traceId,errors?}` (`application/problem+json`), replacing the `{error, detail, traceId}` sketch in target-architecture section 5; validation is always 400, not 422 (see [api-contract.md](rewrite/api-contract.md) section 1) | 2026-09-29 |
| Q-103 | Kusto `decimal` values are serialised as a JSON number when lossless as a float, otherwise as the exact string (legacy Newtonsoft output of `SqlDecimal` was an object and is not ported). Also: legacy read stats `execution_time` but Kusto sends `ExecutionTime`, so legacy always returned 0; the new client maps `ExecutionTime` (see `kusto/query_client.py`) | 2026-09-29 |
| Q-104 | `OboAuthError` (OBO `invalid_grant` / `interaction_required` / `consent_required`) maps to 403 `urn:tim:problem:consent-required` as api-contract §1 lists; the SPA re-prompts interactively. Responses also carry an `x-trace-id` header matching the body `traceId` | 2026-09-29 |
| Q-105 | Tag ingestion uses ManagedStreamingIngestClient (streaming, falling back to queued) to keep legacy read-your-writes; tag tables need the streaming ingestion policy enabled (P2-14 CLI does this) | 2026-09-30 |
| Q-106 | Query-run ownership is keyed on the principal **name** (`unique_name`/`upn`/`preferred_username`, stored as `requestedBy`), matching legacy, not on `oid`. A reassigned UPN could read a previous owner's run; risk bounded by the 1-day run retention (Q-021). Switch to an `owner_oid` column if stricter isolation is wanted | 2026-09-30 |
| Q-100 | Screenshots captured with mocked API + stubbed auth + unlicensed AG Grid Enterprise represent the production UI closely enough for parity | 2026-09-29 |

## Answered
| ID | Question | Answer | Date |
|---|---|---|---|
| Q-000 | Target stack? | React frontend, Python backend (user, initial request) → ADR-0001 | 2026-09-29 |
| Q-001 | Persistence for templates + query runs? | **PostgreSQL** (user). Single store, JSONB where useful → [ADR-0004](decisions/0004-postgresql-persistence.md) | 2026-09-29 |
| Q-002 | AG Grid Enterprise licence available? | **Keep using the unlicensed trial for now** (user). Enterprise features used during development (watermark and console warning accepted); production licence is Q-027 → [ADR-0006](decisions/0006-ag-grid-enterprise.md) | 2026-09-29 |
| Q-003 | Auth model and login style? | **Popup is fine** (user). Keep single Entra app (SPA + API) with OBO to Kusto; keep popup login, but fix BUG-23 (initialise MSAL properly and use cached account / silent token first) → [ADR-0005](decisions/0005-auth-entra-popup-obo.md) | 2026-09-29 |
| Q-004 | Must existing data migrate? | **No** (user). No template or IndexedDB migration tooling. Export/Import (W13) stays as a feature for the new app's own data | 2026-09-29 |
| Q-027 | AG Grid Enterprise licence for production? | **A licence will be obtained; use the trial until then; don't support Community** (user). Single Enterprise build; licence key supplied via runtime config (`agGridLicenseKey`) and required for production deploys; no Community fallback is built or maintained → [ADR-0006](decisions/0006-ag-grid-enterprise.md) | 2026-09-29 |
| Q-019 | Monorepo layout `web/` + `api/`? | **Yes** (user) → [ADR-0003](decisions/0003-repo-layout.md) | 2026-09-29 |
| Q-023 | Reuse legacy IndexedDB names in place? | Moot after Q-004: new app uses its own IndexedDB database (`tim`), versioned from v1; no legacy read | 2026-09-29 |
| Q-025 | Hashless redirect URI for MSAL redirect login? | Moot after Q-003 (popup login kept) | 2026-09-29 |
| Q-026 | Template migration privileges? | Moot after Q-004 (no migration) | 2026-09-29 |
