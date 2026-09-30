# Infrastructure, build & deployment (legacy)

## Frontend image (`frontend/Dockerfile`)
- `ARG BUILD_VERSION=community`. Stage `dependency`: node:16-alpine + python3/make/g++, `yarn install` (Yarn 1 runs `prepublish` → copies Monaco assets to `public/monaco-editor`).
- `build-community`: `yarn build`. `build-enterprise`: `yarn add ag-grid-enterprise@29.0.0` + `sed` uncomments `/* LICENSE */` lines in `main.js` + `yarn build`.
- Final: `nginx:stable-alpine`, `/dist` → `/usr/share/nginx/html`, port 80.
- `.docker/docker-entrypoint.sh` **requires** `BACKEND_URI, REDIRECT_URI, AUTH_CLIENT_ID, AUTH_TENANT_ID, KUSTO_CLUSTER_URI, KUSTO_DATABASE_NAME` (exit 1 otherwise); `envsubst` generates `config.js` and `nginx.conf`.
- `config.js.envsubst` → `window.appConfig = { auth:{clientId, authority}, redirectUri, apiEndpoint: '$API_BASEPATH', agGridLicenseKey: '$AGGRID_LICENSE', wikiUri, issueUri ('ttps://' typo), tagCluster: '$KUSTO_CLUSTER_URI', tagDatabase: '$KUSTO_DATABASE_NAME', defaultClusters: [{name:'Cluster', clusters:['$KUSTO_CLUSTER_URI'], databases:['$KUSTO_DATABASE_NAME']}] }`.
- nginx: 1 worker; static files; `location /api/` → `proxy_pass $BACKEND_URI` (keeps `/api` path), `proxy_ssl_server_name on`, X-Forwarded-* headers, no Host header. No gzip/cache/security headers; no SPA fallback (hash routing).

## Backend image (`backend/Dockerfile`)
sdk:6.0 build → aspnet:6.0 runtime, `dotnet Tim.Backend.dll`, port 80. `backend/compose.yaml` = dev couchbase + redis only.

## Compose (`.docker/compose.yaml`)
| Service | Ports | Env |
|---|---|---|
| frontend (`ghcr.io/microsoft/tim-data-investigate-platform/frontend`) | 80:80 | `AUTH_CLIENT_ID, AUTH_TENANT_ID, REDIRECT_URI, API_BASEPATH` (**trailing /**), `BACKEND_URI` (**no trailing /**), `AGGRID_LICENSE, KUSTO_CLUSTER_URI, KUSTO_DATABASE_NAME` |
| backend (`…/backend`) | 8080:80 | `SIGNING_KEY, AUTH_USERNAME, AUTH_PASSWORD` (legacy/unused), `AUTH_TENANT_ID, AUTH_CLIENT_ID, AUTH_CLIENT_SECRET`, `AZURE_CLIENT_ID/TENANT_ID/CLIENT_SECRET` (DefaultAzureCredential for ingest/admin), `COUCHBASE_*`, `KUSTO_INGEST_URL, KUSTO_CLUSTER_URI, KUSTO_DATABASE_NAME`, `REDIS_CONNECTION_STRING`, `MONGO_*`, `DATABASE_TYPE` |
| couchbase (`couchbase:community`) | 8091-8096, 11210-11211 | bind mount `./db_data/couchbase_data`, 6 GB limit |
No Redis/Mongo services despite `DATABASE_TYPE` options. `.docker/README.md` documents `COUCHBASE_CONNECT_STRING` (wrong name).

## Helm
- `helm/tim` umbrella (v0.0.2): deps frontend, backend, bitnami redis, couchbase-operator. `Chart.lock` stale. Ingress (nginx): backend path `/api(?:/|$)(.*)` with `rewrite-target: /$1` (**strips /api**, but backend routes include `api/`), frontend `/(.*)`; TLS secret `tim-backend-ssc`.
- `frontend/helm` (v1.5.6): deployment passes **no env** → entrypoint fails. HPA `autoscaling/v2beta1` (deprecated).
- `backend/helm`: env names don't match code (see backend-api.md). **Neither chart works as shipped.**

## CI (`.github/workflows`)
- `build-frontend.yml` (PRs touching `frontend/**`): eslint (Node 16) + docker build (no push). No tests.
- `build-backend.yml`: `dotnet test` (no tests exist) + docker build.
- `release-please.yml` (push to main): release-please v3 manifest mode; on release pushes `ghcr.io/<repo>/frontend`, `frontend-enterprise`, `backend` tagged `{version}`, `{major}.{minor}`, `{major}`, `sha`.
- `release-please-config.json`: packages `.` (core), `frontend`, `backend` (`release-type: simple`; bump helm `Chart.yaml`). Manifest: core 3.0.7, frontend 1.5.6, backend 3.0.4.

## Azure dependencies
- Entra ID app registration: exposes `api://<clientId>/user_impersonation`; SPA redirect URI; client secret or federated credential for OBO.
- Azure Data Explorer (Kusto): user-queried clusters (via OBO) + one "tag" cluster/database (default DB `Research`) holding `SavedEvent`, `EventTag`, `EventComment` tables; the service identity needs admin (table creation) + ingest rights there.
