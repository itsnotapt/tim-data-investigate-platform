# TIM web (React)

React + TypeScript + Vite rewrite of the legacy Vue frontend (`../frontend/`). See [ADR-0003](../docs/decisions/0003-repo-layout.md) and [target-architecture.md](../docs/rewrite/target-architecture.md) (section 3).

Requires **Node 24** (`engines.node >= 24`) and npm.

```bash
npm install       # install dependencies (commit package-lock.json)
npm run dev       # dev server at http://localhost:5173
npm run build     # type-check (tsc) + production build into dist/
npm run preview   # serve the production build locally
npm run lint          # ESLint (flat config, type-aware typescript-eslint)
npm run format        # Prettier write
npm run format:check  # Prettier check (CI)
npm run typecheck     # tsc --noEmit
npm test              # Vitest (jsdom + Testing Library), single run
npm run test:watch    # Vitest watch mode
```

Tooling: TypeScript is pinned to 6.0.x because typescript-eslint (8.71) does not yet support TS 7 (peer `<6.1.0`); revisit when it does. Tests live next to code as `*.test.tsx`; setup in `src/test-setup.ts`, config in `vite.config.ts`.

Local stack (PostgreSQL, api, `docker compose`): see [local-dev.md](../docs/rewrite/local-dev.md). `npm run dev` proxies `/api` to `http://localhost:8080`.

Stack: React 19, React Router (hash router), MUI + Emotion. TypeScript is `strict` with `noUncheckedIndexedAccess`.

## Layout

`src/app` (shell, routes + lazy pages, router, theme), `src/features/*`, `src/lib/*`, `src/components`. Rules: `features/*` import `lib/*` and `components/*`, never each other's internals.

## Routes (hash, same as legacy)

`#/`, `#/queries`, `#/view/:uuid`, `#/share/:uuid`, `#/exportimport`. All are placeholders for now.

## Browser storage

`src/lib/storage` owns the IndexedDB database `tim` (v1; stores `display_components`, `row_results`, `column_views`, `query_options`). Use the DAOs (`displayComponentsDao`, `rowResultsDao`, `columnViewsDao`, `queryOptionsDao`); `rowResultsDao.get` returns `[]` when missing (BUG-27). It never opens the legacy `localforage` DB (Q-004). Tests reset the singleton with `resetTimDb()`.

## Time ranges

`src/lib/time-range` is pure logic (no UI yet). `TimeRange` is JSON data: `absolute` (ISO start/end) or `relative` (start/end "ago" offsets, end `null` = now). `resolveTimeRange(range, now?)` gives UTC `{start, end}` and must be called at execution time. `TIME_RANGE_PRESETS` / `DEFAULT_TIME_RANGE` (Last 15 minutes) mirror legacy; labels keep the legacy wording, including "Last 1 hours". `parseCustomPeriod` rejects NaN, empty, zero and negative amounts and start >= end (BUG-39); `parseCustomDateRange` takes UTC `YYYY-MM-DD` + `HH:MM[Z]`.

## Runtime config

`index.html` loads `/config.js` (plain script) before the app; it sets `window.appConfig`. `public/config.js` holds placeholder dev values; in production the container renders it from env vars. `src/lib/config/runtimeConfig.ts` merges `window.appConfig` over `VITE_*` env fallbacks per key (see `.env.example`), validates with zod and exposes `getConfig()`. Empty strings and unsubstituted `$VAR` placeholders count as missing. If validation fails, `main.tsx` shows an error screen listing every missing or invalid key.

| Key (`window.appConfig`)          | Fallback env                                 | Notes                                                       |
| --------------------------------- | -------------------------------------------- | ----------------------------------------------------------- |
| `auth.clientId`, `auth.authority` | `VITE_AUTH_CLIENT_ID`, `VITE_AUTH_AUTHORITY` | required; authority is a full URL                           |
| `redirectUri`                     | `VITE_AUTH_REDIRECT`                         | required                                                    |
| `apiEndpoint`                     | `VITE_API_ENDPOINT`                          | optional, default `''` (same origin), trailing `/` stripped |
| `agGridLicenseKey`                | `VITE_AGGRID_LICENSE_KEY`                    | optional in dev, required in production (ADR-0006)          |
| `wikiUri`, `issueUri`             | `VITE_HELP_WIKI_URI`, `VITE_HELP_ISSUE_URI`  | default GitHub URLs                                         |
| `tagCluster`, `tagDatabase`       | `VITE_TAG_CLUSTER`, `VITE_TAG_DATABASE`      | cluster required; database defaults to `Research`           |
| `defaultClusters`                 | `VITE_DEFAULT_CLUSTERS` (JSON)               | default: help.kusto.windows.net sample                      |

## Auth

`src/lib/auth/` is the single auth module (ADR-0005). `createAuthClient()` returns either the dev stub or the MSAL client; all code uses the `AuthClient` interface (`getAccount`, `acquireToken`, `login`, `logout`).

- **MSAL client** (`createMsalAuthClient`): `PublicClientApplication` from runtime config (`auth.clientId`, `auth.authority`, `redirectUri`), cache in `localStorage`. On first use it runs `initialize()` and `handleRedirectPromise()` and restores the cached account, so there is no prompt on every load (BUG-23). `acquireToken(scopes)` tries `acquireTokenSilent` for the active account, or `ssoSilent` when there is none, and opens a popup only on `InteractionRequiredAuthError` or when SSO fails. Only one interactive request is in flight at a time and concurrent callers share it (BUG-23). Failures reject with `AuthClientError` (`code`: `interaction_in_progress`, `popup_blocked`, `cancelled`, `unknown`) and leave nothing stuck, so sign-in can be retried (BUG-22). `logout` uses `logoutPopup`. API scope: `api://<clientId>/user_impersonation` (`apiScopes()`).
- **Popup redirect page**: `@azure/msal-browser` v5 popups return to `redirectUri`, which must serve `blank.html` (built from `web/blank.html` and `src/lib/auth/redirectBridge.ts`) so the response reaches the main window. Register `https://<host>/blank.html` in Entra.
- **React**: `<AuthProvider client={getAuthClient()}>` (wraps `MsalProvider` for MSAL clients) and `useAuth()` returning `{ account, status: 'loading' | 'signedOut' | 'signedIn' | 'error', error, login, logout, getToken }`. Mounted in `App` (`authClient` prop overrides the client in tests; `main.tsx` passes `getAuthClient()`).
- **Dev stub**: set `VITE_AUTH_STUB=true` (e.g. in `.env.local`, or in the environment for Playwright) for a fixed account (`dev.user@example.com`) and fake token, no Entra sign-in. `createAuthClient()` throws if the stub is requested in a production build. Pair it with the API's `TIM_AUTH_DISABLED=true` (see `api/README.md`).

## Docker image

```bash
docker build -t tim-web web/
docker run --rm -p 8080:8080 \
  -e BACKEND_URI=http://api:8080 -e REDIRECT_URI=https://tim.example.com/blank.html \
  -e AUTH_CLIENT_ID=<app-id> -e AUTH_TENANT_ID=<tenant> \
  -e TAG_CLUSTER=https://<cluster>.kusto.windows.net -e AGGRID_LICENSE=<key> tim-web
```

Multi-stage: `node:24-alpine` builds, `nginxinc/nginx-unprivileged:stable-alpine` serves on port 8080 as uid 101. `docker/docker-entrypoint.sh` validates the env (exit 1 listing every missing variable), writes `/usr/share/nginx/html/config.js` (values JSON-escaped with `jq`), renders the nginx conf from `docker/nginx.conf.template` and execs nginx. nginx proxies `/api/` to `BACKEND_URI` keeping the `/api` path (do not strip it in an ingress), resolves the backend at request time, sends gzip and security headers, and serves `config.js` and `index.html` with `no-cache`. `GET /healthz` returns 200.

| Env var                            | Required                                 | Maps to / notes                                                                  |
| ---------------------------------- | ---------------------------------------- | -------------------------------------------------------------------------------- |
| `BACKEND_URI`                      | yes                                      | nginx upstream, `http(s)://host[:port]`, no path (trailing `/` stripped)         |
| `REDIRECT_URI`                     | yes                                      | `redirectUri`; must be registered in Entra                                       |
| `AUTH_CLIENT_ID`, `AUTH_TENANT_ID` | yes                                      | `auth.clientId`; `auth.authority` = `https://login.microsoftonline.com/<tenant>` |
| `TAG_CLUSTER`                      | yes                                      | `tagCluster` (also the default cluster)                                          |
| `AGGRID_LICENSE`                   | yes unless `TIM_ENVIRONMENT=development` | `agGridLicenseKey` (ADR-0006, Q-027)                                             |
| `TIM_ENVIRONMENT`                  | no                                       | `production` (default) or `development`; only relaxes `AGGRID_LICENSE`           |
| `TAG_DATABASE`                     | no                                       | default `Research`                                                               |
| `API_BASEPATH`                     | no                                       | `apiEndpoint`, default `/api`                                                    |
| `HELP_WIKI_URI`, `HELP_ISSUE_URI`  | no                                       | omitted when empty (app defaults apply)                                          |
| `DEFAULT_CLUSTERS`                 | no                                       | JSON array; default is one group from `TAG_CLUSTER`/`TAG_DATABASE`               |
| `NGINX_RESOLVER`                   | no                                       | DNS server for backend lookups; default first nameserver in `/etc/resolv.conf`   |

The entrypoint also honours `TIM_HTML_DIR`, `TIM_NGINX_TEMPLATE`, `TIM_NGINX_CONF` and `TIM_ENTRYPOINT_DRY_RUN=1` (render files and exit) for testing without Docker.

Docs: [RULES.md](../docs/RULES.md), [docs/README.md](../docs/README.md), [work-breakdown.md](../docs/rewrite/work-breakdown.md).

### Shared components and helpers (P3-06, P3-10)

- `lib/uuid` (`generateUuid`, `crypto.randomUUID`), `lib/isEmpty` (legacy `isEmptyValue` plus empty array/object, BUG-41).
- `app/AppShell` (white dense toolbar: menu > Query Manager, TIM link, Help > Wiki Page / Report a bug from config in a new tab, Settings > Export / Import, Account > Sign in / Sign out with the legacy logout snackbar) wraps the routes in `app/AuthGate` (signed out: "You must sign-in first."; loading: progress; error: message + Retry, BUG-22). The placeholder side drawer was removed; the query tree arrives with P4.
- `components/SnackbarHost` + `useNotify()`: FIFO, one at a time, default 5000 ms, 200 ms pause between messages, optional link button, Dismiss. Mounted in `App`.
- `components/DraggableDialog`: MUI Dialog dragged by title via pointer events, clamped to the viewport, re-clamped on window resize; no polling (BUG-37), no extra dependency.

## API types

`src/lib/api/openapi.json` is exported by the API (`cd api && uv run python -m tim_api.openapi_export`). `npm run gen:api` turns it into `src/lib/api/schema.d.ts` (openapi-typescript; committed, excluded from lint and prettier). Regenerate both after any API change.
