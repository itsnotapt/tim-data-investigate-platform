# Open questions

Process: see [RULES.md §4](RULES.md#4-handling-questions-and-decisions). IDs are permanent. Statuses: **Blocking** (needs the user before dependent work starts) · **Open** (needs an answer eventually) · **Assumed** (default chosen, user may overturn) · **Answered**.

## Blocking
| ID | Question | Why it matters | Proposed default |
|---|---|---|---|
| Q-027 | **AG Grid Enterprise licence for production**: buy one, or ship with Community + custom context menu/side bar? Blocks deployment (P5), not development | AG Grid terms require a licence for production use of Enterprise features; unlicensed builds show a watermark | Buy a licence before first production deploy; keep Enterprise-only usage isolated in `features/grid` so a Community fallback stays possible |

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
| Q-018 | Kusto `.show schema as json` column name — frontend reads `ClusterSchema`; confirm against a real cluster | Verify during backend Kusto task |
| Q-020 | **Tag ingestion identity**: keep writing tags under the app identity while recording the user from the token as `createdBy` (SEC-03 fix), or ingest with the user's OBO token? | App identity, `createdBy` from token |
| Q-021 | **Query result limits and retention values**: max rows / bytes per run, query timeout, run retention | 100 000 rows, 64 MB, 10 min timeout (poll deadline 11 min), 1 day retention |
| Q-022 | **Cluster allow-list policy** (SEC-01): explicit host allow-list required, or https + known suffix list? | https + suffix list (`.kusto.windows.net`, `.kusto.fabric.microsoft.com`), optional strict allow-list env |
| Q-024 | **Handlebars escaping semantics** (Q-006 follow-up): what happens to existing templates that use raw `{{x}}` inside KQL strings, and does `array` change output for values with quotes? | Escape only in explicit string-literal helpers; raw `{{x}}` unchanged but linted; `array` escapes quotes |

## Assumed
| ID | Assumption | Date |
|---|---|---|
| Q-100 | Screenshots captured with mocked API + stubbed auth + unlicensed AG Grid Enterprise represent the production UI closely enough for parity | 2026-09-29 |

## Answered
| ID | Question | Answer | Date |
|---|---|---|---|
| Q-000 | Target stack? | React frontend, Python backend (user, initial request) → ADR-0001 | 2026-09-29 |
| Q-001 | Persistence for templates + query runs? | **PostgreSQL** (user). Single store, JSONB where useful → [ADR-0004](decisions/0004-postgresql-persistence.md) | 2026-09-29 |
| Q-002 | AG Grid Enterprise licence available? | **Keep using the unlicensed trial for now** (user). Enterprise features used during development (watermark and console warning accepted); production licence is Q-027 → [ADR-0006](decisions/0006-ag-grid-enterprise.md) | 2026-09-29 |
| Q-003 | Auth model and login style? | **Popup is fine** (user). Keep single Entra app (SPA + API) with OBO to Kusto; keep popup login, but fix BUG-23 (initialise MSAL properly and use cached account / silent token first) → [ADR-0005](decisions/0005-auth-entra-popup-obo.md) | 2026-09-29 |
| Q-004 | Must existing data migrate? | **No** (user). No template or IndexedDB migration tooling. Export/Import (W13) stays as a feature for the new app's own data | 2026-09-29 |
| Q-019 | Monorepo layout `web/` + `api/`? | **Yes** (user) → [ADR-0003](decisions/0003-repo-layout.md) | 2026-09-29 |
| Q-023 | Reuse legacy IndexedDB names in place? | Moot after Q-004: new app uses its own IndexedDB database (`tim`), versioned from v1; no legacy read | 2026-09-29 |
| Q-025 | Hashless redirect URI for MSAL redirect login? | Moot after Q-003 (popup login kept) | 2026-09-29 |
| Q-026 | Template migration privileges? | Moot after Q-004 (no migration) | 2026-09-29 |
