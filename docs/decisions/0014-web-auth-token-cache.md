# 0014. Web sign-in: token cache in localStorage

- **Status:** Accepted
- **Date:** 2026-10-06
- **Deciders:** the user
- **Related:** [0005](0005-auth-entra-popup-obo.md), [0009](0009-obo-token-exchange.md), [architecture](../architecture.md)

## Context
[0005](0005-auth-entra-popup-obo.md) chose one Entra app registration for the SPA and the API, with popup login. It did not say where MSAL keeps its tokens. MSAL supports `localStorage` and `sessionStorage`, and the choice decides whether a reload or a new tab prompts the user again. Code: `web/src/lib/auth/msalAuth.ts`, `web/src/lib/auth/index.ts`, `web/src/lib/auth/redirectBridge.ts`.

## Decision
- **MSAL caches tokens in `localStorage`.** `msalAuth.ts` fixes `cacheLocation` to `'localStorage'`; the config type has no cache option. A reload, or a second tab, finds the cached account and does not prompt.
- **One registration for web and API.** The SPA signs in with its own client id and requests the scope `api://<clientId>/user_impersonation` (`apiScopes`). The API then exchanges that token On-Behalf-Of ([0009](0009-obo-token-exchange.md)).
- **Popup login.** `loginPopup` and `acquireTokenPopup` use the redirect URI `/blank.html`. That page loads only `redirectBridge.ts`, which hands the response to the main window. The SPA is not loaded in the popup.
- **Silent before interactive.** On start, MSAL is initialised, any pending response is handled, and the cached account is made active. A token request then tries `acquireTokenSilent`. With no account it tries `ssoSilent`. A popup opens only when the silent attempt fails (for the cached-account path, only on `InteractionRequiredAuthError`).
- **One interactive request at a time.** Requests with the same key share one promise. A request with a different key waits for the one in flight, then retries. The slot is cleared when the request settles, so a failed or closed popup can be retried.

## Alternatives considered
| Option | Pros | Cons |
|---|---|---|
| `localStorage` (chosen) | No prompt on reload or in a new tab | Any script running on the origin can read the tokens |
| `sessionStorage` | Cleared when the tab closes. Not shared between tabs | Every new tab signs in again. The config type does not offer it |
| In-memory only | Not readable after the page unloads | Every reload prompts. Not offered by the current config type |

## Consequences
- An XSS bug on the web origin would expose cached tokens. The nginx Content-Security-Policy in `web/docker/nginx.conf.template` limits what can load and where requests can go: scripts are same-origin only, `connect-src` is this origin, Entra ID and the configured API origin, and `object-src` is `none`. It is not a full defence, because `script-src` includes `'unsafe-eval'` (Handlebars compiles templates with `new Function`, see [0015](0015-kql-templating.md)).
- The cached access token is for the TIM API scope only. Kusto tokens are obtained by the API via OBO and never reach the browser.
- Sign-out uses `logoutPopup` and clears the active account.
- Browsers must allow popups. The CSP allows `frame-src` to Entra ID for the hidden iframe used by `ssoSilent`.
