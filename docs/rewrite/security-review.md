# Security review (P5-09)

Review of the new stack (`api/`, `web/`, `deploy/`, `web/docker`, rewrite CI) on 2026-09-30, after the parity fixes (P5-13, P5-14). Legacy findings (SEC-01 to SEC-07) and their coverage are in the bug-regression checklist in [parity-report.md](parity-report.md#bug-regression-checklist-p5-05).

## Summary

| Area | High | Medium | Low | Info |
|---|---|---|---|---|
| API (`S-A`) | 0 | 3 (1 fixed, 2 open) | 5 (2 fixed, 2 open, 1 accepted) | 4 (3 accepted, 1 open) |
| Web + deploy (`S-W`) | 0 | 1 (fixed) | 7 (4 fixed/accepted, 3 open) | 6 |

**No High findings.**

**Threat model (Q-030):** TIM is an internal tool for trusted analysts, reached only through the organisation's Entra tenant. Findings that only matter against a malicious insider (authorisation between analysts, per-user fairness, token scope hardening) are **accepted risk** rather than fixed. Findings that protect against outside attackers or accidents (CSP, body size limit, cluster validation, header hardening) stay fixed.

Accepted on that basis (2026-09-30): S-A01 (any user manages templates, as legacy; Q-029), S-A02 (global `TIM_MAX_CONCURRENT_RUNS` only), S-A04 (`scp` not enforced), S-A07 (runs keyed on the name claim; runs are short-lived), S-W01 (MSAL cache in `localStorage`, as legacy), S-W08 (raw `{{x}}` not linted), S-W11 and S-W13 (deployment hardening left to the hosting environment).

Still open, as routine maintenance: S-W06 (bump monaco-editor / monaco-kusto to pick up the dompurify fixes), P5-16.

## API

**Scope and method.** Read all of `api/src/tim_api` (auth, kusto, query_runs, templates, tagged_events, storage, config, observability, errors, main), `api/Dockerfile`, `pyproject.toml`, migrations env. Verified the cluster validator by fuzzing 27 hostile URLs (suffix tricks, userinfo, port, IDN/fullwidth, trailing dot, backslash, IP forms, encoded slash): all rejected or normalised to a safe `https://<ascii-host>`. Ran `uvx pip-audit` on `uv export --no-dev` (network available): **no known vulnerabilities**. Fixes come with `api/tests/test_security_review.py` (IDs in test names). Gates (ruff, format, mypy, pytest 467 passed) green.

### Findings

| ID | Sev | Title | Location | Status |
|---|---|---|---|---|
| S-A01 | Medium | Any authenticated user can create/replace/patch/delete any template, incl. `isManaged` ones; no admin role | `templates/router.py:97-166` | Open -> task |
| S-A02 | Medium | No per-user limit on query runs; one user can occupy all 16 slots / flood DB with `created` runs (Q-111 is global only) | `query_runs/router.py:55-74`, `runner.py:110-130` | Open -> task |
| S-A03 | Medium | No request body size limit (batch 1000 x 1 MB events; unbounded template/tag strings) | `tagged_events/models.py:14-46`, `main.py` | Fixed |
| S-A04 | Low | `scp` (`user_impersonation`) not enforced although contract 27 says so; any token with our audience and a name claim is accepted | `auth/jwt.py:123-148` | Open -> task (Low) |
| S-A05 | Low | No security headers from the API (`nosniff`, `Cache-Control: no-store` on user data) | `observability.py` | Fixed |
| S-A06 | Low | Log forging: decoded request path written to log unescaped (`%0a`) | `observability.py` request log, `errors.py` unhandled log | Fixed |
| S-A07 | Low | Run ownership and `createdBy` key on a mutable name claim (`unique_name`/`upn`/`preferred_username`), not `oid` | `query_runs/router.py:69,84`; `auth/jwt.py:142` | Open -> task (changing needs contract/DB decision) |
| S-A08 | Low | Default suffix allow-list accepts any `*.kusto.windows.net` cluster (any Azure tenant); user OBO token and query go to whichever cluster a share link names | `kusto/validation.py:94-101`, `config.py:22` | Accepted risk by default (Q-022, parity with BUG-29); prod should set `TIM_ALLOWED_KUSTO_HOSTS` |
| S-A09 | Info | `/api/docs` and `/api/openapi.json` are anonymous in production (legacy swagger also anonymous); no secrets in schema | `main.py:55-59` | Accepted (recon only); optional: disable when `environment=production` |
| S-A10 | Info | v1 issuer hard-coded to `sts.windows.net`; sovereign clouds (other `auth_authority_host`) use different v1 issuers | `auth/jwt.py:115` | Accepted (public cloud only today) |
| S-A11 | Info | Tag ingestion is append-only under app identity: any user can tag/delete-tag any eventId (Q-020 decision; `createdBy` is from token, SEC-03 fixed) | `tagged_events/router.py` | Accepted (Q-020) |
| S-A12 | Info | Base images pinned by tag, not digest (`python:3.12-slim-bookworm`, `uv:0.12`) | `Dockerfile:4,22` | Open, low value; pin digests in release pipeline |

### Verified OK (no finding)
- **JWT**: alg pinned to RS256 (header checked, then `algorithms=`), signature via tenant JWKS, `iss`/`aud` list-checked, `exp/nbf/iat/aud/iss` required, 60 s leeway, `tid` == configured tenant, `oid` required; generic errors. JWKS: 1 h TTL, unknown `kid` refetch at most every 30 s under a lock, failures keep stale keys, RSA only. App-only tokens are rejected (no name claim).
- **Dev bypass**: `environment` defaults to `production`; `auth_disabled` and `memory://` DB rejected in production at settings load, re-checked in the dependency; loud startup warning; OBO disabled in that mode; fake tag ingest needs development.
- **Kusto validation**: runs before any token exchange in both routes (tests exist); returned URL is rebuilt from the normalised host. User queries cannot smuggle management commands (query endpoint) and run with the user's own OBO identity.
- **OBO**: one MSAL app, cache keyed by MSAL per user assertion; scope from validated cluster; tokens `SecretStr`, never logged (only exception type / error code); failures mapped to fixed messages.
- **Authorisation of runs**: `get_for_owner`, identical 404 for unknown/foreign/expired (SEC-02).
- **Tag ingestion**: identity and time server-set; client fields dropped; table/mapping names constants.
- **CORS**: empty allow-list sends no CORS headers; explicit origins only, no credentials. (No validator rejects `*`; only operator can set it.)
- **Errors**: fixed-detail problem+json, stack/SQL/upstream bodies logged only; validation errors omit input.
- **DB**: SQLAlchemy Core, parametrised; `text()` only with constants; alembic URL from env.
- **Dockerfile**: non-root uid 10001, nothing baked in (only lock, src, alembic copied), `.dockerignore` present, `--proxy-headers` restricted by `FORWARDED_ALLOW_IPS`.
- **Logging**: request log has method/path/status only; no headers/bodies.

### Details
**S-A01.** Legacy had no authorisation either, and the contract defines no role model, but the brief lists admin-only and managed read-only. Impact: any tenant user with API access can edit a KQL template that other users then run under their own tokens (template poisoning, e.g. `externaldata`/cross-cluster exfil), or mark their own as `isManaged`. Proposed task: decide the model (Entra app role `TIM.TemplateAdmin` or group claim; add to Q list), then in `validate()` expose `roles`, add `require_template_admin` dependency on POST/PUT/PATCH/DELETE, and make `isManaged=true` templates immutable except by admin; web hides Query Manager for non-admins. Needs a user decision, so not fixed here.

**S-A02.** Proposed task: per-principal cap on non-terminal runs (e.g. 4, setting `TIM_MAX_ACTIVE_RUNS_PER_USER`) returning 429 (add to contract); in-memory counter on `app.state` is enough for one replica. Also consider `Retry-After`.

**S-A03.** Fix: `BodySizeLimitMiddleware` (Content-Length check plus streamed byte count, 413 `urn:tim:problem:too-large`), `TIM_MAX_REQUEST_BYTES` default 16 MiB, documented in `api/README.md`. Note ingress/nginx should also cap (deploy/ is the other reviewer's scope). Follow-up: add `max_length` to template `query`/`name` and tag/comment strings.

**S-A04.** Proposed: require `scp` contains `user_impersonation` (contract 27); confirm the SPA requests that scope first (ADR-0005).

**S-A05/S-A06.** Fixed: `nosniff` + `no-store` added to all responses by the logging middleware; `log_safe` escapes control chars in logged paths. Tests: `test_s_a05_*`, `test_s_a06_*`.

## Web and deployment

**Scope and method.** Read the code for MSAL config, dev auth stub, Handlebars engine, share links, export/import, IndexedDB, runtime config, entrypoint, nginx template, Dockerfile, compose.prod, and the CI workflow. Verified by running things:
- Built with `VITE_AUTH_STUB=true` (prod mode) and grepped the bundle.
- Ran the entrypoint in dry-run mode with hostile env values and evaluated the produced `config.js` in a VM.
- Probed js-yaml and Handlebars with hostile input in Node.
- Served a dev-mode build of the SPA (stub allowed) from a tiny Node server that sends the new CSP header, and ran the whole Playwright e2e suite against it: 29/29 passed, no CSP violations in a Monaco + AG Grid probe. Negative control with `'unsafe-eval'` removed: template flows (w04, w05, w08, w09, w10, w11, ...) timed out, which proves the CSP is enforced and that eval is needed. Docker and nginx are unavailable on this host, so the nginx template was checked by reading, rendering, and the header unit tests, not by `nginx -t`.
- `npm audit`: `--omit=dev` and full both report the same 3 moderate advisories (dompurify via monaco-editor via @kusto/monaco-kusto); 0 high/critical.

### Findings

| ID | Sev | Title | Location | Status |
|---|---|---|---|---|
| S-W01 | Low | MSAL token cache in `localStorage` (readable by any XSS) | web/src/lib/auth/index.ts:35, msalAuth.ts:14,48 | Accepted risk (BUG-23 parity), follow-up option |
| S-W02 | Medium | No Content-Security-Policy on the web container | web/docker/nginx.conf.template | Fixed in this change |
| S-W03 | Info | config.js injection via env values: none found | web/docker/docker-entrypoint.sh:84-117 | No issue; regression test added |
| S-W04 | Info | Dev auth stub cannot be enabled in a production build; stub code still ships | web/src/lib/auth/index.ts:25-33 | Verified; optional tree-shake follow-up |
| S-W05 | Low | `X-Frame-Options: DENY` breaks MSAL silent (hidden iframe) flows | web/docker/nginx.conf.template:19 | Fixed in this change |
| S-W06 | Low | Bundled dompurify (via monaco-editor 0.55) has 18 moderate advisories | web/package.json (monaco-editor, @kusto/monaco-kusto) | Open, follow-up P5-09a |
| S-W07 | Low | CI had no dependency audit gate | .github/workflows/build-web.yml | Fixed in this change (high+ gate) |
| S-W08 | Low | Raw `{{x}}` in KQL is unescaped and Q-024's "linted" is not implemented | web/src/lib/kql-templates/engine.ts:21-28 | Open, follow-up P5-09b |
| S-W09 | Info | Share links, import, YAML, Handlebars prototype access: verified safe | see details | No issue |
| S-W10 | Low | No HSTS header | web/docker/nginx.conf.template | Fixed in this change (conditional on X-Forwarded-Proto) |
| S-W11 | Low | compose.prod publishes plain HTTP on all interfaces; secrets passed to `migrate` | deploy/compose.prod.yaml:62-63 and 37-44 | Open, follow-up P5-09c |
| S-W12 | Info | IndexedDB holds query results and tabs after sign-out (no tokens) | web/src/lib/storage/db.ts | Accepted (Q-005 client-side, legacy parity) |
| S-W13 | Info | Actions pinned by major tag, not SHA; images not pinned by digest | .github/workflows/build-web.yml, Dockerfile, compose | Open, follow-up P5-09c |
| S-W14 | Info | Web runtime user can overwrite the served docroot | web/Dockerfile:18-19 | Accepted (config.js must be written at start) |

Counts: High 0, Medium 1 (fixed), Low 7 (4 fixed or accepted, 3 open), Info 6.

### Details

**S-W01 (Low).** `createAuthClient` hardcodes `cacheLocation: 'localStorage'`, so access/refresh tokens for `api://<client>/user_impersonation` live in localStorage. Any XSS can steal them. I found no XSS sink (see S-W09) and now there is a CSP (S-W02), so exploitability is low. The choice is deliberate legacy parity (no re-login on reload, BUG-23). Recommendation: add an optional runtime config key (for example `authCacheLocation`, default `localStorage`, `sessionStorage` for high-security deployments) wired through entrypoint, zod schema and docs. Not done here (touches config contract).

**S-W02 (Medium, fixed).** nginx sent nosniff, Referrer-Policy and Permissions-Policy but no CSP, so any future XSS would run unrestricted and could exfiltrate the localStorage tokens (S-W01). Added:
`default-src 'self'; script-src 'self' 'unsafe-eval'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; font-src 'self' data:; connect-src 'self' https://login.microsoftonline.com[+ API_BASEPATH origin]; worker-src 'self' blob:; frame-src 'self' https://login.microsoftonline.com; frame-ancestors 'self'; base-uri 'self'; form-action 'self'; object-src 'none'`.
Why each relaxation exists (also commented in the template):
- `'unsafe-eval'`: Handlebars `compile` uses `Function.apply` (main chunk) and the Kusto language-service worker uses `eval`. Without it all template flows hang (verified). This weakens the CSP against injected script; accepted because no inline script is allowed, `script-src` is same-origin only, and the sinks audit is clean. Follow-up to drop it: precompile templates server-side or switch to a CSP-safe template engine (large).
- `'unsafe-inline'` in `style-src` only: emotion (MUI) and AG Grid inject style tags. A nonce would need per-request HTML rewriting.
- `worker-src 'self' blob:`: Monaco workers are same-origin Vite chunks; `blob:` is kept for fallbacks.
- `connect-src`: a cross-origin `API_BASEPATH` is validated and added by the entrypoint (junk such as `https://a.example; script-src *` is rejected). Sovereign-cloud authorities are not supported by the entrypoint (authority is always `login.microsoftonline.com`), so nothing else is needed.
Verification: e2e suite (29 tests, Monaco kusto + yaml editors, AG Grid, template flows) against a dev-mode build with this exact header, zero violations; regression tests in `web/src/lib/config/deployArtifacts.test.ts`. Note that real e2e (`npm run e2e`) uses vite dev without the header, so the CSP check above is a manual one; consider a CI job serving `dist` with the rendered header.

**S-W03 (Info).** `jq` does all JSON escaping and `sed` turns `<` into `<`. Tested with `a"b</script><script>alert(1)//\ U+2028 </ScRiPt>` in client id, licence, wiki URI and DEFAULT_CLUSTERS names: file contains no `</script`, and evaluating it yields the exact original strings. `BACKEND_URI`, `NGINX_RESOLVER` and the new API origin are regex-validated before `sed` substitution into nginx. `wikiUri`/`issueUri` are validated as http(s) by zod on the client, so `javascript:` links cannot be configured.

**S-W04 (Info).** With `VITE_AUTH_STUB=true`, `vite build` inlines `{MODE:"production", VITE_AUTH_STUB:"true"}` and the bundle throws "not allowed in a production build" (confirmed in the emitted code). The stub cannot be enabled at runtime: it is read only from the build-time `import.meta.env`, never from `config.js`. The stub code and the string `dev-stub-token` are still present in the normal prod bundle (unreachable). Optional hardening: load `devStubAuth` with a dynamic import guarded by `import.meta.env.DEV` so it is tree-shaken. `web/.dockerignore` already excludes `.env*` so a stray `.env.local` cannot be baked into the image.

**S-W05 (Low, fixed).** MSAL `ssoSilent`/iframe fallbacks load `/blank.html` in a hidden same-origin iframe; `DENY` refuses that, forcing a popup (or failing silently). Changed to `SAMEORIGIN` plus `frame-ancestors 'self'`; cross-origin clickjacking is still blocked. Could not test against real Entra (no tenant); the popup flow is unaffected.

**S-W06 (Low, open).** `npm audit` (prod and full): dompurify <=3.4.12 with 18 moderate advisories (most are IN_PLACE, SAFE_FOR_TEMPLATES, custom-element options that TIM does not use), pulled by monaco-editor 0.54-0.56, pulled by @kusto/monaco-kusto >=15. Monaco uses it for markdown hovers (Kusto docs text); no attacker-controlled HTML reaches it in TIM. Fix path is `monaco-editor@0.57` which npm marks as breaking for monaco-kusto. Follow-up: bump monaco-editor / monaco-kusto together and rerun the e2e suite; re-check before cut-over.

**S-W07 (Low, fixed).** Added `npm audit --omit=dev --audit-level=high` before lint in CI (currently exit 0).

**S-W08 (Low, open).** The engine is an isolated `Handlebars.create()` with escaping helpers `array`, `str`, `kql` (doubling quotes, tested), so SEC-06's `array` bug is fixed. Raw `{{x}}` stays unescaped by design (Q-024), and Q-024 says it is "linted", but no lint exists (grep of `templates-admin` finds none). Share-link values reach templates sanitised by name only, so a link can inject KQL into templates that use raw `{{x}}` in string context. Impact is bounded: an `execute=1` link runs at once (confirmation reverted to legacy per Q-030, Q-110), the query runs with the victim's own rights, results go to the victim only, and the API enforces cluster allow-listing. Follow-up P5-09b: Query Manager warns when a declared param is used raw inside quotes, and optionally a "strict" template flag.

**S-W09 (Info, verified).**
- XSS sinks: no `dangerouslySetInnerHTML`, `innerHTML`, `document.write`, `eval`, `window.open`, no AG Grid `cellRenderer` (default text cells), Monaco content set as model text only.
- Links: only `wikiUri`/`issueUri` (http(s)-validated, `rel="noopener noreferrer"`) and an unused snackbar link.
- YAML: `js-yaml.load` (v5) is safe by default: `!!js/function` and `!!js/regexp` are rejected; `__proto__` keys become own properties (prototype untouched).
- Handlebars: `{{constructor}}`, `{{a.constructor.name}}`, `{{lookup a "constructor"}}`, `{{__proto__}}` all render empty (4.7 default prototype-access restrictions).
- Share links: base64url JSON decoded in try/catch, only names declared by the template (own properties) are kept, `execute=1` runs immediately as in legacy (confirmation dialog reverted per Q-030, Q-110), generated links use `execute=0`; there is no redirect or URL navigation from params (hash-router navigation to `/view/<generated uuid>` only). Minor: a template that declares a param literally named `__proto__` would hit `params['__proto__']=`; template authors are trusted.
- Import: `JSON.parse` then a zod discriminated-union schema; unknown fields are kept (looseObject) and stored in IndexedDB as-is. An imported tab embeds its own `queryTemplate` (cluster, query), which the user then runs; the API's cluster allow-list (api review) is the control, and this is the same trust as pasting KQL.
- Clipboard: write-only.
- API client: bearer only to `apiEndpoint` (deployment config); server-owned identity fields are stripped.

**S-W10 (Low, fixed).** `Strict-Transport-Security: max-age=31536000` (no includeSubDomains) is now sent only when `X-Forwarded-Proto` is https (empty `add_header` value is omitted by nginx). The TLS terminator in front is still responsible for redirecting http to https.

**S-W11 (Low, open).** (a) `ports: "${WEB_PORT}:8080"` binds 0.0.0.0 with plain HTTP, tokens would be in clear if used directly; propose `${WEB_BIND:-127.0.0.1}:${WEB_PORT}:8080`. (b) `migrate` and `api` share `*api-env`, so `migrate` gets `TIM_AUTH_CLIENT_SECRET` it does not need. (c) `.env.example` has `POSTGRES_PASSWORD=change-me` (compose requires it to be set, but the placeholder is weak). (d) postgres and web lack `read_only`/`cap_drop` (web needs writable docroot/conf.d; postgres needs its entrypoint). Good: postgres is not published, api has `read_only`, `cap_drop: ALL`, `no-new-privileges`, non-root user 10001, secrets come from env (no secrets in repo), web runs as uid 101.

**S-W12 (Info).** IndexedDB `tim` stores tabs, row results, column views, query options. No tokens (MSAL uses localStorage, S-W01). Sign-out does not clear it; on a shared machine the next user of the same browser profile can read the previous user's cached rows. Legacy parity, Q-005. Follow-up option: clear `row_results` on logout.

**S-W13 (Info).** CI permissions are least-privilege (`contents: read` at workflow level), the workflow uses `pull_request` (no secrets, fork-safe), artifacts are uploaded only on failure. Third-party actions (`docker/*`, `actions/*`) use version tags rather than commit SHAs; base images use tags (`nginx-unprivileged:1.28-alpine`, `postgres:17-alpine`). Propose pinning by SHA/digest with Dependabot (P5-09c). The legacy `release-please.yml` uses `google-github-actions/release-please-action@v3` (legacy, out of scope).

**S-W14 (Info).** The nginx user owns `/usr/share/nginx/html` (needed so the entrypoint can write `config.js`). A compromised nginx worker could modify assets. Mitigation would be to make only `config.js` writable; low value given no upload or write path.

### nginx other checks (no finding)
- `server_tokens off`; `X-Content-Type-Options: nosniff`; Referrer-Policy strict-origin-when-cross-origin; Permissions-Policy set; headers are at server level and no location uses `add_header` (unit-tested), so inheritance does not drop them.
- `/api/` proxy: `proxy_pass $var` with no URI forwards the original request URI; location matching uses the normalised URI, so `..` sequences cannot reach other locations. The backend address is fixed by validated env, not by the request. Client-supplied `X-Forwarded-For` is appended to (not replaced), which matters only if the api uses client IP (api review).
- `config.js` and `index.html` are `expires -1`; `/assets/` is cached 1 year (content-hashed).

### Files changed
- web/docker/nginx.conf.template, web/docker/docker-entrypoint.sh (CSP, SAMEORIGIN, HSTS, API_BASEPATH validation)
- web/src/lib/config/deployArtifacts.test.ts (new; 6 tests named S-W02/S-W03/S-W05)
- web/README.md (one sentence)
- .github/workflows/build-web.yml (audit step)
