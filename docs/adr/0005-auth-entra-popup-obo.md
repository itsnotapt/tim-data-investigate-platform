---
status: accepted
date: 2026-09-29
---

# Auth: single Entra app, popup login, OBO to Kusto

Legacy uses one Entra app registration for both the SPA and the API, with an MSAL popup sign-in and an On-Behalf-Of (OBO) token exchange so queries run as the user. The rewrite keeps the single app registration, OBO and popup login, and fixes the legacy defects.

Legacy details: the app registration serves `api://<clientId>/user_impersonation`; the SPA signs in with an MSAL popup; the backend exchanges the user's token On-Behalf-Of for a Kusto token. See `docs/current-system/backend-api.md` § Auth and `docs/current-system/frontend-architecture.md` § Auth (preserved at git tag `migration-complete`).

- **Keep the single app registration and OBO.** User queries and schema calls run with the user's delegated Kusto token. Tag ingestion stays under the app identity, with `createdBy` taken from the token (Q-020 default).
- **Keep popup login** (`@azure/msal-browser` + `@azure/msal-react`), but fix the legacy defects:
  - initialise MSAL and handle any pending response on load
  - restore the cached account and try `acquireTokenSilent` / `ssoSilent` before any popup, so there's no prompt on every load (BUG-23)
  - a single in-flight interactive request (BUG-23)
  - sign-in failure is retryable (BUG-22)
- Backend:
  - validate v1 and v2 tokens against the tenant JWKS, with `aud` = `api://{clientId}` (or the bare client id)
  - take the user name from `unique_name` → `upn` → `preferred_username` (Q-014)
  - OBO via `msal.ConfidentialClientApplication` with a **shared token cache** (BUG-09)
  - scope derived per cluster, configurable for sovereign clouds (Q-013)
- Identity always comes from the token, never the body (SEC-03). `/api/user/authenticate` and its secrets are dropped (SEC-07, Q-011).
- A dev-only "auth disabled" mode with a fixed fake user exists for local work and tests. It refuses to start unless explicitly enabled.

Decided by the user (Q-003: "popup is fine"). Related: Q-003, Q-011, Q-013, Q-014, Q-025 (moot), SEC-03, SEC-07, BUG-09, BUG-22, BUG-23.

## Consequences

Hash routes need no special redirect handling (Q-025 moot). Browsers must allow popups; the sign-in error text keeps the legacy hint.
