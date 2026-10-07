# Deployment

TIM ships as two container images and runs on Docker Compose or Kubernetes (Helm). Both use the same container environment variables; [configuration.md](configuration.md) describes each variable, and [operations.md](operations.md) covers running a deployment.

| Image     | Source                         | Base image | Published as                                                      |
| --------- | ------------------------------ | ---------- | ----------------------------------------------------------------- |
| `tim-api` | `api/Dockerfile` (context `api/`) | `python:3.12-slim-trixie` (Debian 13) | `ghcr.io/<owner>/<repo>/tim-api:<version>` (also `<major>.<minor>`, `<major>`, `sha-<sha>`) |
| `tim-web` | `web/Dockerfile` (context `web/`) | `nginxinc/nginx-unprivileged:1.30-alpine`, built on `node:24-alpine3.24` | `ghcr.io/<owner>/<repo>/tim-web:<version>` (same tag set)         |

Images are built and pushed by `.github/workflows/release-please.yml` when release-please cuts a release. `web`, `api` and the Helm chart share one release version ([ADR-0016](decisions/0016-linked-release-version.md)).

## Topology

```
client ── TLS proxy / Ingress ──> web (nginx :8080) ──/api/──> api (uvicorn :8080) ──> PostgreSQL
                                   └─ SPA, /config.js, /healthz
```

- Everything enters through `web`. Its nginx serves the SPA and proxies `/api/` to `BACKEND_URI` with the path unchanged; the api serves all routes under `/api`. A proxy or ingress in front of web must not strip or rewrite `/api`.
- nginx allows request bodies up to 25 MB and waits up to 620 s for the api (long Kusto runs). A proxy in front of web needs at least the same limits.
- `web` is the only public port. The api and PostgreSQL stay on the internal network.
- Schema migrations (`alembic upgrade head`, api image) run before the api starts or is upgraded. The api never migrates on its own.
- Both containers run as non-root (api uid 10001, web uid 101) and drop all capabilities. Both root filesystems are read-only. web writes `config.js` and its nginx conf to `/tmp/tim` at start, and nginx keeps its pid and temp files in `/tmp`, so web needs a writable `/tmp` (an `emptyDir` in the chart, `tmpfs` in the compose files).

## Configuration contract

| Concern                 | api variable                                | web variable                     |
| ----------------------- | ------------------------------------------- | -------------------------------- |
| Mode                    | `TIM_ENVIRONMENT`                           | `TIM_ENVIRONMENT`                |
| Entra tenant / client   | `TIM_AUTH_TENANT_ID`, `TIM_AUTH_CLIENT_ID`  | `AUTH_TENANT_ID`, `AUTH_CLIENT_ID` |
| Tag cluster / database  | `TIM_TAG_CLUSTER_URI`, `TIM_TAG_DATABASE`   | `TAG_CLUSTER`, `TAG_DATABASE`    |
| Database (secret)       | `TIM_DATABASE_URL`                          | -                                |
| OBO credential (secret) | `TIM_AUTH_CLIENT_SECRET` or workload identity (`AZURE_FEDERATED_TOKEN_FILE`) | -  |
| AG Grid licence (secret)| -                                           | `AGGRID_LICENSE`                 |
| Redirect URI            | -                                           | `REDIRECT_URI` (`<public URL>/blank.html`) |
| api address             | -                                           | `BACKEND_URI`                    |
| Proxy trust             | `FORWARDED_ALLOW_IPS`                       | -                                |
| Help links, cluster list| -                                           | `HELP_WIKI_URI`, `HELP_ISSUE_URI`, `DEFAULT_CLUSTERS` |

Compose fills these from `deploy/.env`; Helm fills them from values and one Secret whose keys are the variable names. Health endpoints are the same everywhere: api `/api/healthChecks/liveness` and `/api/healthChecks/readiness`, web `/healthz`.

### AG Grid Enterprise licence

The result grids use AG Grid Enterprise only ([ADR-0006](decisions/0006-ag-grid-enterprise.md)). The licence key is optional and is passed to web as `AGGRID_LICENSE` (Compose: `deploy/.env`; Helm: `secrets.agGridLicense` or the `AGGRID_LICENSE` key of `secrets.existingSecret`). Without a key the grid runs in AG Grid's trial mode: a watermark over the grid and a console notice. `/config.js` always contains `agGridLicenseKey` (empty in trial mode).

### Entra app registration

Register `<public URL>/blank.html` as a SPA redirect URI. The api needs an OBO credential at startup: a client secret (`TIM_AUTH_CLIENT_SECRET`) or, on Kubernetes, Entra workload identity.

## Docker Compose

Files: `deploy/compose.prod.yaml`, `deploy/.env.example`. The stack runs `postgres`, a one-shot `migrate`, `api` and `web`; only `web` publishes a port (`WEB_PORT`, default 8080). Start order: postgres healthy, `migrate` succeeded, api healthy, web.

```bash
cp deploy/.env.example deploy/.env      # edit: Entra ids, client secret, Kusto cluster, POSTGRES_PASSWORD, PUBLIC_URL
docker compose -f deploy/compose.prod.yaml --env-file deploy/.env up -d --build
curl -i http://localhost:8080/api/healthChecks/readiness      # 204 when postgres is reachable
curl -s http://localhost:8080/config.js                        # contains agGridLicenseKey
```

To run published images instead of building, set in `deploy/.env`:

```bash
TIM_API_IMAGE=ghcr.io/<owner>/<repo>/tim-api
TIM_WEB_IMAGE=ghcr.io/<owner>/<repo>/tim-web
TIM_IMAGE_TAG=0.1.0
```

and run `docker compose ... pull` followed by `docker compose ... up -d --no-build`.

`deploy/.env` variables:

| Variable | Required | Default | Notes |
| --- | --- | --- | --- |
| `PUBLIC_URL` | yes | - | Public origin, no trailing slash; `REDIRECT_URI` is `${PUBLIC_URL}/blank.html` |
| `POSTGRES_PASSWORD` | yes | - | `POSTGRES_USER` / `POSTGRES_DB` default `tim` |
| `TIM_AUTH_TENANT_ID`, `TIM_AUTH_CLIENT_ID` | yes | - | Also passed to web |
| `TIM_AUTH_CLIENT_SECRET` | yes | - | OBO client secret |
| `TIM_TAG_CLUSTER_URI` | yes | - | https; `TIM_TAG_DATABASE` defaults to `Research` |
| `TIM_ALLOWED_KUSTO_HOSTS`, `TIM_CORS_ALLOWED_ORIGINS` | no | empty | Comma separated; empty hosts uses the api default `**.kusto.windows.net` |
| `TIM_LOG_LEVEL` | no | `INFO` | |
| `AGGRID_LICENSE` | no | empty | Empty = AG Grid Enterprise trial mode |
| `HELP_WIKI_URI`, `HELP_ISSUE_URI`, `DEFAULT_CLUSTERS` | no | empty | |
| `WEB_PORT` | no | `8080` | Host port of web |
| `TIM_SUBNET` | no | `10.89.0.0/24` | Compose network; change if it overlaps a host or VPN range |
| `FORWARDED_ALLOW_IPS` | no | `TIM_SUBNET` | Addresses the api trusts for `X-Forwarded-*` |
| `TIM_API_IMAGE`, `TIM_WEB_IMAGE`, `TIM_IMAGE_TAG` | no | `tim-api`, `tim-web`, `local` | Image references |

Put a TLS-terminating proxy in front of `web` and forward `X-Forwarded-Proto`; web then sends HSTS on https requests. Data lives in the `postgres-data` volume; back it up (`down -v` deletes it).

The dev stack (`compose.yaml`, root `.env`) is described in [development.md](development.md).

## Kubernetes (Helm)

Chart: `deploy/helm/tim` (Kubernetes 1.34 or newer, `kubeVersion: >=1.34.0-0`; Helm 3). CI validates the chart against Kubernetes 1.34 to 1.37. It deploys:

- `<release>-tim-api` and `<release>-tim-web` Deployments and ClusterIP Services (port 8080), with liveness/readiness probes, resource requests/limits, non-root security contexts, optional HPAs and PodDisruptionBudgets.
- ConfigMaps `<release>-tim-api` / `<release>-tim-web` with the non-secret variables, and a Secret `<release>-tim` (unless `secrets.existingSecret` is set).
- An Ingress for `ingress.host` with TLS, routing `/` to web (web proxies `/api/`).
- A migrations Job (`<release>-tim-migrate`, Helm hook) running `alembic upgrade head` with the api image.
- Optionally a single-pod PostgreSQL StatefulSet (`postgresql.enabled`).
- A `helm test` pod that checks `/healthz`, `/config.js` and `/api/healthChecks/readiness` through web.

Pods restart automatically when the chart's ConfigMaps or Secret change (checksum annotations).

### Chart distribution

The chart is published as an OCI artifact to GitHub Container Registry at `oci://ghcr.io/itsnotapt/tim-data-investigate-platform/charts/tim`. Chart releases are tagged `chart-vX.Y.Z` and share their version with the web and api releases. The chart's `appVersion` is the default image tag, so `--version X.Y.Z` deploys the images tagged `X.Y.Z` without any tag settings. `api.image.tag`, `web.image.tag` and `digest` are optional overrides.

```bash
helm show values oci://ghcr.io/itsnotapt/tim-data-investigate-platform/charts/tim --version X.Y.Z > tim-values.yaml
helm upgrade --install tim oci://ghcr.io/itsnotapt/tim-data-investigate-platform/charts/tim --version X.Y.Z -n tim -f tim-values.yaml --wait
```

### Install

The commands below install from a checkout; replace `deploy/helm/tim` with the OCI reference and `--version` to install a published chart.

```bash
kubectl create namespace tim
kubectl -n tim create secret generic tim-secrets \
  --from-literal=TIM_DATABASE_URL='postgresql+asyncpg://tim:<password>@<host>:5432/tim' \
  --from-literal=TIM_AUTH_CLIENT_SECRET='<client secret>' \
  --from-literal=AGGRID_LICENSE='<licence key>'          # optional

cat > tim-values.yaml <<'EOF'
config:
  auth:
    tenantId: <tenant id>
    clientId: <client id>
  tags:
    clusterUri: https://<cluster>.<region>.kusto.windows.net
secrets:
  existingSecret: tim-secrets
ingress:
  className: nginx
  host: tim.example.com
  annotations:
    cert-manager.io/cluster-issuer: <issuer>
    nginx.ingress.kubernetes.io/proxy-body-size: 25m
    nginx.ingress.kubernetes.io/proxy-read-timeout: "620"
    nginx.ingress.kubernetes.io/proxy-send-timeout: "620"
EOF

helm upgrade --install tim deploy/helm/tim -n tim -f tim-values.yaml --wait
helm test tim -n tim
```

`deploy/helm/tim/ci/*.yaml` are further examples (minimal, all features, existing Secret). Rendering fails with a message when a required value is missing; image tags default to the chart's `appVersion`; `values.schema.json` rejects unknown keys and malformed values.

### Secrets

One Secret holds every sensitive variable; its keys are the variable names.

| Key | Required | Notes |
| --- | --- | --- |
| `TIM_DATABASE_URL` | yes | `postgresql+asyncpg://user:password@host:5432/db` |
| `TIM_AUTH_CLIENT_SECRET` | unless workload identity | OBO client secret |
| `AGGRID_LICENSE` | no | Absent = AG Grid Enterprise trial mode |
| `POSTGRES_PASSWORD` | with `postgresql.enabled` | Must match the password in `TIM_DATABASE_URL` |

Either create it yourself and set `secrets.existingSecret` (recommended; works with external secret operators), or let the chart create it from `secrets.databaseUrl`, `secrets.authClientSecret` and `secrets.agGridLicense`. The chart-created Secret is a pre-install/pre-upgrade hook so it exists before the migrations Job; `helm uninstall` leaves it in place (`kubectl delete secret <release>-tim`).

With `config.environment: production` the chart refuses to render without an OBO credential: `secrets.authClientSecret`, `secrets.existingSecret` (expected to hold `TIM_AUTH_CLIENT_SECRET`), or workload identity.

### Entra workload identity

Instead of a client secret, federate the app registration with the release ServiceAccount (`system:serviceaccount:<namespace>:<release>-tim`) and set:

```yaml
serviceAccount:
  annotations:
    azure.workload.identity/client-id: <client id>
api:
  podLabels:
    azure.workload.identity/use: "true"
```

The workload identity webhook then injects `AZURE_FEDERATED_TOKEN_FILE` (used for OBO when `TIM_AUTH_CLIENT_SECRET` is unset) together with `AZURE_CLIENT_ID` / `AZURE_TENANT_ID`, which `DefaultAzureCredential` uses for tag ingest. Without workload identity, pass `AZURE_CLIENT_ID`, `AZURE_TENANT_ID` and `AZURE_CLIENT_SECRET` through `api.extraEnv` / `api.extraEnvFrom` (Compose: not wired; add them to the api environment if tag ingest needs a separate app identity).

Other api limits (`TIM_MAX_REQUEST_BYTES`, `TIM_MAX_RESULT_ROWS`, `TIM_MAX_RESULT_BYTES`, `TIM_QUERY_TIMEOUT_SECONDS`, `TIM_MAX_CONCURRENT_RUNS`, `TIM_RUN_RETENTION_SECONDS`, `TIM_RUN_RETENTION_SWEEP_SECONDS`, `TIM_AUTH_AUTHORITY_HOST`, `TIM_KUSTO_OBO_SCOPE`, `TIM_TAG_INGEST_URL`) keep their defaults unless set through `api.extraEnv`; see [configuration.md](configuration.md).

### Database

Production uses an external (managed) PostgreSQL via `TIM_DATABASE_URL`. For evaluation, `postgresql.enabled: true` runs a single-pod `postgres:17-alpine` StatefulSet with an 8 Gi PVC (no HA, no backups); the chart builds `TIM_DATABASE_URL` from `postgresql.auth` (use a URL-safe password). Its PVC (`data-<release>-tim-postgresql-0`) survives `helm uninstall`; delete it before reinstalling with a different password, because an existing data directory keeps its original password.

The migrations Job runs as a `pre-install,pre-upgrade` hook with an external database, and as `post-install,pre-upgrade` with the in-cluster PostgreSQL (it waits for PostgreSQL to accept connections). A failed migration fails the install or upgrade and the api is not rolled out. Logs: `kubectl logs job/<release>-tim-migrate` (kept for `migrations.ttlSecondsAfterFinished`).

### Values reference

| Value | Default | Sets / meaning |
| --- | --- | --- |
| `config.environment` | `production` | `TIM_ENVIRONMENT` (api, web) |
| `config.publicUrl` | `https://<ingress.host>` | `REDIRECT_URI` = `<publicUrl>/blank.html` |
| `config.auth.tenantId` / `clientId` | required | `TIM_AUTH_TENANT_ID` / `TIM_AUTH_CLIENT_ID`, `AUTH_TENANT_ID` / `AUTH_CLIENT_ID` |
| `config.tags.clusterUri` / `database` | required / `Research` | `TIM_TAG_CLUSTER_URI` / `TIM_TAG_DATABASE`, `TAG_CLUSTER` / `TAG_DATABASE` |
| `secrets.existingSecret` | empty | Use this Secret instead of creating one |
| `secrets.databaseUrl` / `authClientSecret` / `agGridLicense` | empty | `TIM_DATABASE_URL` / `TIM_AUTH_CLIENT_SECRET` / `AGGRID_LICENSE` |
| `api.image.repository` / `tag` / `digest` | `ghcr.io/itsnotapt/tim-data-investigate-platform/tim-api` / empty / empty | Empty `tag` uses the chart `appVersion`; `digest` wins over `tag` |
| `web.image.*` | same, `tim-web` | |
| `api.replicaCount`, `web.replicaCount` | `2` | Ignored when autoscaling is enabled |
| `<component>.autoscaling.*` | disabled, 2 to 6 (api) / 2 to 4 (web), CPU 75 % | HPA (`autoscaling/v2`) |
| `<component>.podDisruptionBudget` | enabled, `minAvailable: 1` | Rendered only with more than one replica |
| `<component>.resources` | api 100m / 256Mi request, 1Gi limit; web 25m / 32Mi, 128Mi | |
| `<component>.livenessProbe` / `readinessProbe` | health endpoints above | |
| `<component>.podSecurityContext` / `securityContext` | non-root, seccomp `RuntimeDefault`, no privilege escalation, all capabilities dropped, read-only root filesystem | web mounts an `emptyDir` at `/tmp` |
| `<component>.extraEnv` / `extraEnvFrom` | empty | Further variables, e.g. `TIM_QUERY_TIMEOUT_SECONDS` |
| `<component>.podLabels`, `podAnnotations`, `nodeSelector`, `tolerations`, `affinity`, `topologySpreadConstraints` | empty | Scheduling and metadata |
| `api.logLevel` | `INFO` | `TIM_LOG_LEVEL` |
| `api.allowedKustoHosts` | empty (api default `**.kusto.windows.net`) | `TIM_ALLOWED_KUSTO_HOSTS` |
| `api.corsAllowedOrigins` | empty | `TIM_CORS_ALLOWED_ORIGINS` |
| `api.forwardedAllowIps` | `*` | `FORWARDED_ALLOW_IPS`; the api Service is cluster-internal, narrow to the pod CIDR if needed |
| `web.helpWikiUri` / `helpIssueUri` | empty | `HELP_WIKI_URI` / `HELP_ISSUE_URI` |
| `web.defaultClusters` | empty | `DEFAULT_CLUSTERS` (list, rendered as JSON) |
| `web.apiBasePath` | empty | `API_BASEPATH`; leave empty |
| `clusterDomain` | `cluster.local` | `BACKEND_URI` = `http://<release>-tim-api.<namespace>.svc.<clusterDomain>:8080` |
| `serviceAccount.create` / `name` / `annotations` | `true` / `<release>-tim` / empty | Shared by api and web; token not mounted |
| `imagePullSecrets` | empty | For private registries |
| `migrations.enabled` | `true` | Migrations Job hook |
| `ingress.enabled` / `className` / `host` / `annotations` | `true` / empty / required / empty | |
| `ingress.tls.enabled` / `secretName` | `true` / `<release>-tim-tls` | TLS Secret for `host` (e.g. from cert-manager) |
| `postgresql.enabled` | `false` | In-cluster PostgreSQL; `postgresql.auth.*`, `persistence.*`, `resources` |

Ingress controllers have their own body-size and timeout defaults (ingress-nginx: 1 MB, 60 s). Set them to at least 25 MB and 620 s, as in the install example.

## Upgrades

- Compose: update the checkout (or `TIM_IMAGE_TAG`), then `docker compose -f deploy/compose.prod.yaml --env-file deploy/.env up -d --build` (or `pull` + `up -d --no-build`). `migrate` re-runs (a no-op when the schema is current), then api and web are recreated.
- Helm: run `helm upgrade` with the new chart `--version`; the images follow it (set `api.image.tag` / `web.image.tag` only to override). The migrations Job runs first; the Deployments then roll with `maxUnavailable` 25 %, gated on readiness. Migrations are forward-only: `helm rollback` restores the previous images but not the previous schema, so back up the database before upgrading.
- The api holds running Kusto queries in-process. Pods stopped during a rollout end their running queries; clients see those runs as failed and can rerun them.
- Back up PostgreSQL before every upgrade (`pg_dump`, or your managed service's snapshots).
