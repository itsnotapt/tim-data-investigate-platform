---
status: accepted
date: 2026-09-29
---

# Auth: single Entra app, popup login, OBO to Kusto

TIM uses one Entra app registration for both the SPA and the API, with an MSAL popup sign-in and an On-Behalf-Of (OBO) token exchange so queries run as the user. The app registration serves `api://<clientId>/user_impersonation`; the backend exchanges the user's token for a Kusto token.

- **Single app registration and OBO.** User queries and schema calls run with the user's delegated Kusto token. Tag ingestion runs under the app identity, with `createdBy` taken from the token.
- **Popup login** (`@azure/msal-browser` + `@azure/msal-react`):
  - initialise MSAL and handle any pending response on load
  - restore the cached account and try `acquireTokenSilent` / `ssoSilent` before any popup, so there's no prompt on every load
  - a single in-flight interactive request
  - sign-in failure is retryable
- Backend:
  - validate v1 and v2 tokens against the tenant JWKS, with `aud` = `api://{clientId}` (or the bare client id)
  - take the user name from `unique_name` → `upn` → `preferred_username`
  - OBO via `msal.ConfidentialClientApplication` with a **shared token cache**
  - scope derived per cluster, configurable for sovereign clouds (`TIM_KUSTO_OBO_SCOPE`)
- Identity always comes from the token, never the body. There is no endpoint that takes user credentials or secrets.
- A development-only "auth disabled" mode (`TIM_AUTH_DISABLED`) with a fixed fake user exists for local work and tests. It refuses to run in production ([ADR-0011](0011-development-only-modes.md)).

Decided by the user ("popup is fine").

## Consequences

Hash routes need no special redirect handling. Browsers must allow popups; the sign-in error text tells the user to allow pop-up windows.
