# Deploying TIM (P5-08)

Decision (Q-016, Assumed): **two images + Docker Compose**. A Helm chart is a follow-up (see below).
Images: `tim-api` (`api/Dockerfile`, build context `api/`) and `tim-web` (`web/Dockerfile`, context `web/`).

## Quick start (fresh host)

```bash
cp deploy/.env.example deploy/.env      # edit: Entra ids, Kusto cluster, AGGRID_LICENSE, POSTGRES_PASSWORD, PUBLIC_URL
docker compose -f deploy/compose.prod.yaml --env-file deploy/.env up -d --build
curl -i http://localhost:8080/api/healthChecks/readiness      # 204 when postgres is reachable
curl -s http://localhost:8080/config.js                        # contains agGridLicenseKey
```

Start order is enforced by compose: `postgres` healthy -> `migrate` (one-shot `alembic upgrade head`,
re-run on every `up`; the api never migrates at startup) -> `api` healthy -> `web`.
Only `web` publishes a port. Put TLS termination in front of it and set `PUBLIC_URL` to the public
origin; register `${PUBLIC_URL}/blank.html` as a SPA redirect URI in the Entra app registration.

## Routing `/api` (BUG-10)

The web container's nginx proxies `/api/` to `BACKEND_URI` **without rewriting the path** (the
client already calls `/api/...`). `BACKEND_URI` must be `http(s)://host[:port]` with no path; the
entrypoint rejects anything else. If you use an external ingress instead, route `/api` to the api
service and `/` to web, and **do not strip or rewrite the `/api` prefix**. Do not expose `/metrics`.
Web also serves `/healthz`. `config.js` and `index.html` are `no-cache`; `/assets/` is cached 1 year.

When the api sits behind a proxy, set `FORWARDED_ALLOW_IPS` to the proxy address(es) (compose pins the
network to 172.29.0.0/16 so the default works).

## Environment variables

Compose input names (`deploy/.env`) are the same as the dev stack; the mapping to container variables is in `compose.prod.yaml`.

### api (`TIM_*`, see `api/src/tim_api/config.py`)

| Variable | Required | Default | Notes |
|---|---|---|---|
| `TIM_ENVIRONMENT` | no | `production` | compose pins `production`; `TIM_AUTH_DISABLED` and `memory://` DB are rejected |
| `TIM_DATABASE_URL` | yes | - | `postgresql+asyncpg://user:pass@host/db`; built by compose from `POSTGRES_*` |
| `TIM_AUTH_TENANT_ID`, `TIM_AUTH_CLIENT_ID` | yes | - | Entra app; API audience `api://{client id}` |
| `TIM_AUTH_CLIENT_SECRET` | no | unset | OBO secret; empty = unset (federated / workload identity) |
| `TIM_TAG_CLUSTER_URI` | yes | - | https Kusto cluster for tags |
| `TIM_TAG_DATABASE` | no | `Research` | |
| `TIM_ALLOWED_KUSTO_SUFFIXES` / `TIM_ALLOWED_KUSTO_HOSTS` | no | `.kusto.windows.net`, `.kusto.fabric.microsoft.com` / none | SEC-01 allow-list, comma separated |
| `TIM_CORS_ALLOWED_ORIGINS` | no | none | not needed behind the web proxy |
| `TIM_LOG_LEVEL` | no | `INFO` | |
| `TIM_MAX_RESULT_ROWS`, `TIM_MAX_RESULT_BYTES`, `TIM_QUERY_TIMEOUT_SECONDS`, `TIM_RUN_RETENTION_SECONDS`, `TIM_MAX_CONCURRENT_RUNS` | no | see config.py | query-run limits; nginx read timeout (620 s) assumes the default 600 s timeout |
| `FORWARDED_ALLOW_IPS` | no | `127.0.0.1` | uvicorn proxy trust |
| `AZURE_*` | no | - | standard azure-identity variables for the app identity |

### web (`web/docker/docker-entrypoint.sh`, rendered into `/config.js` at start)

| Variable | Required | Default | config.js key |
|---|---|---|---|
| `TIM_ENVIRONMENT` | no | `production` | - |
| `BACKEND_URI` | yes | - | - (nginx upstream, no path) |
| `REDIRECT_URI` | yes | - | `redirectUri` |
| `AUTH_CLIENT_ID` | yes | - | `auth.clientId` |
| `AUTH_TENANT_ID` | yes | - | `auth.authority` |
| `TAG_CLUSTER` / `TAG_DATABASE` | yes / no | - / `Research` | `tagCluster` / `tagDatabase` |
| **`AGGRID_LICENSE`** | **yes in production** | - | **`agGridLicenseKey`** (Q-027, ADR-0006); the container exits without it |
| `API_BASEPATH` | no | empty | `apiEndpoint` (client prefixes `/api` itself; leave empty) |
| `HELP_WIKI_URI`, `HELP_ISSUE_URI`, `DEFAULT_CLUSTERS` (JSON array) | no | - | `wikiUri`, `issueUri`, `defaultClusters` |
| `NGINX_RESOLVER` | no | first nameserver in resolv.conf | runtime DNS for `BACKEND_URI` |

## Upgrades

`docker compose ... up -d --build` rebuilds, re-runs `migrate`, then restarts `api`/`web`. Data lives
in the `postgres-data` volume (back it up; `down -v` deletes it).

## Helm (follow-up)

Not included. Legacy charts in `helm/` are read-only reference and carry BUG-10 (env names, stripped
`/api`). A new chart must use the variable tables above, run `alembic upgrade head` as a pre-install/upgrade
Job, and route `/api` without a rewrite.

## Verification status

Validated without a container runtime (the agent's shell had no Docker socket access): `docker compose config`
renders, `docker-entrypoint.sh` dry-run renders `config.js` (with `agGridLicenseKey`) and the nginx conf and
fails without `AGGRID_LICENSE`. **Still to do on a Docker host:** image builds, `up`, readiness, proxy check through `WEB_PORT`.
