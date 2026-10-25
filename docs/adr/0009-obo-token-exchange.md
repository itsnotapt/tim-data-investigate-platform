---
status: accepted
date: 2026-10-06
---

# OBO token exchange: one shared MSAL app, scope per connection

[0005](0005-auth-entra-popup-obo.md) chose On-Behalf-Of (OBO) so queries run as the user, which left open how the exchange is built. The scope comes from the connection, one lazily built MSAL app per process is shared, the credential is resolved at startup, and failures map to fixed responses.

The open questions were which scope, how many MSAL apps, which credential, and how failures reach the client. The code is `api/src/tim_api/auth/obo.py`, with error mapping in `api/src/tim_api/errors.py`.

- **Scope comes from the connection.** Each `obo` connection has a `scope` ([0018](0018-fixed-connections.md)). Kusto's defaults to `{cluster}/.default` with the connection's normalised cluster URL. Hooks get tokens through `token_for(scope)`. Sovereign clouds change the scope and `TIM_AUTH_AUTHORITY_HOST`.
- **One `msal.ConfidentialClientApplication` per process**, built lazily on first use under a lock. All calls share MSAL's in-memory token cache, so repeat calls for the same user and cluster are served from cache. MSAL is blocking, so each call runs in a worker thread.
- **Credential, resolved at startup:**
  1. `TIM_AUTH_CLIENT_SECRET` if set.
  2. Otherwise a client assertion read from the file named by `AZURE_FEDERATED_TOKEN_FILE` (workload identity). The file is re-read on every call because the token rotates.
  3. With neither, the app refuses to start when any connection uses `obo` (`OboConfigError`); otherwise the exchange answers 503 when used. Auth-disabled mode skips the exchange entirely.
- **Failures map to fixed responses.** Tokens are never logged or put in messages.

| Cause | Exception | Response |
|---|---|---|
| Entra returns `invalid_grant` or `interaction_required` | `OboAuthError` | 403, `consent-required` |
| Any other Entra error, or the call raises | `OboUpstreamError` | 502 |
| No user token, auth disabled, or no credential and no `obo` connection | `OboUnavailableError` | 503 |

The exchange happens before a run is created, so these errors come back on the `POST` itself.

Decided by the user. Related: [0005](0005-auth-entra-popup-obo.md), [configuration](../configuration.md), [api](../api.md).

## Considered Options

| Option | Pros | Cons |
|---|---|---|
| One MSAL app per request | Simple | Discovers the authority each time and loses the token cache |
| Fixed scope per connection type | Simple | Breaks sovereign clouds and any cluster that needs a different resource |
| Client secret only | One path | Forces a long-lived secret where workload identity is available |

## Consequences

- Misconfigured credentials fail at startup when a connection uses `obo`, not on the first query.
- The token cache is per process and lost on restart. Replicas do not share it.
- The client can tell "sign in again" (403) apart from "Entra is down" (502).
