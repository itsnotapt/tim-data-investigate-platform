# Deployment

TIM ships as two container images. It runs on Docker Compose or Kubernetes (Helm), and both use the same container environment variables.

- [configuration.md](configuration.md) describes each variable.
- [operations.md](operations.md) covers running a deployment.

| Local build name | Source                         | Base image | Published as                                                      |
| ---------------- | ------------------------------ | ---------- | ----------------------------------------------------------------- |
| `tim-api`        | `api/Dockerfile` (context `api/`) | `python:3.12-slim-trixie` (Debian 13, from `mirror.gcr.io`) | `ghcr.io/<owner>/<repo>/backend:<version>` (also `<major>.<minor>`, `<major>`, `sha-<sha>`) |
| `tim-web`        | `web/Dockerfile` (context `web/`) | `ghcr.io/nginx/nginx-unprivileged:1.30-alpine`, built on `node:24-alpine3.24` (from `mirror.gcr.io`) | `ghcr.io/<owner>/<repo>/frontend:<version>` (same tag set) |

Images are built and pushed by `.github/workflows/release-please.yml` when release-please cuts a release.

- The frontend (`web/`), the backend (`api/`) and the Helm chart are versioned independently.
- The chart pins one frontend and one backend version ([ADR-0016](adr/0016-release-versions.md)).

## Topology

```
client ── TLS proxy / Ingress ──> web (nginx :8080) ──/api/──> api (uvicorn :8080) ──> PostgreSQL
                                   └─ SPA, /config.js, /healthz
```

- Everything enters through `web`.
  - Its nginx serves the SPA, and proxies `/api/` to `BACKEND_URI` with the path unchanged.
  - The api serves all routes under `/api`.
  - A proxy or ingress in front of web must keep `/api` as it is, with no stripping or rewriting.
- nginx allows request bodies up to 25 MB, and waits up to 620 s for the api (long Kusto runs). A proxy in front of web needs at least the same limits.
- `web` is the only public port. The api and PostgreSQL stay on the internal network.
- Schema migrations (`alembic upgrade head`, api image) run before the api starts or is upgraded. The api never migrates on its own.
- Both containers run as non-root (api uid 10001, web uid 101), and drop all capabilities.
- Both root filesystems are read-only.
- web needs a writable `/tmp`: an `emptyDir` in the chart, `tmpfs` in the compose files.
  - web writes `config.js` and its nginx conf to `/tmp/tim` at start.
  - nginx keeps its pid and temp files in `/tmp`.

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

- Compose fills these from `deploy/.env`.
- Helm fills them from values, and from one Secret whose keys are the variable names.

Health endpoints are the same everywhere: api `/api/healthChecks/liveness` and `/api/healthChecks/readiness`, web `/healthz`.

### AG Grid Enterprise licence

The result grids use AG Grid Enterprise only ([ADR-0006](adr/0006-ag-grid-enterprise.md)).

- The licence key is optional. It is passed to web as `AGGRID_LICENSE`.
  - Compose: in `deploy/.env`.
  - Helm: `secrets.agGridLicense`, or the `AGGRID_LICENSE` key of `secrets.existingSecret`.
- Without a key, the grid runs in AG Grid's trial mode: a watermark over the grid, and a console notice.
- `/config.js` always contains `agGridLicenseKey`. It is empty in trial mode.

### Entra app registration

- Register `<public URL>/blank.html` as a SPA redirect URI.
- When a connection in the connections file uses `obo`, the api needs an OBO credential at startup: a client secret (`TIM_AUTH_CLIENT_SECRET`) or, on Kubernetes, Entra workload identity.

## Docker Compose

Files: `deploy/compose.prod.yaml`, `deploy/.env.example`.

- The stack runs `postgres`, a one-shot `migrate`, `api` and `web`.
- Only `web` publishes a port (`WEB_PORT`, default 8080).
- Start order: postgres healthy, `migrate` succeeded, api healthy, web.

```bash
cp deploy/.env.example deploy/.env      # edit: Entra ids, client secret, Kusto cluster, POSTGRES_PASSWORD, PUBLIC_URL
docker compose -f deploy/compose.prod.yaml --env-file deploy/.env up -d --build
curl -i http://localhost:8080/api/healthChecks/readiness      # 204 when postgres is reachable
curl -s http://localhost:8080/config.js                        # contains agGridLicenseKey
```

To run published images instead of building, set in `deploy/.env`:

```bash
TIM_API_IMAGE=ghcr.io/<owner>/<repo>/backend
TIM_API_IMAGE_TAG=4.0.0
TIM_WEB_IMAGE=ghcr.io/<owner>/<repo>/frontend
TIM_WEB_IMAGE_TAG=1.6.0
```

Use a matching pair, for example the versions a chart release pins in `deploy/helm/tim/image-tags.yaml`. Then run `docker compose ... pull`, followed by `docker compose ... up -d --no-build`.

To run providers, set `TIM_API_IMAGE` and `TIM_API_IMAGE_TAG` to a [derived image](#derived-images).

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
| `TIM_CONFIG_DIR` | no | `./config` | Host directory mounted read-only at `/etc/tim` in the api |
| `TIM_ACTIONS_DIR`, `TIM_CONNECTIONS_FILE`, `TIM_LABELS_FILE` | no | empty | Container paths under `/etc/tim` of the action files, connections file and labels file; empty = none |
| `TIM_API_IMAGE`, `TIM_API_IMAGE_TAG` | no | `tim-api`, `local` | Api image and tag |
| `TIM_WEB_IMAGE`, `TIM_WEB_IMAGE_TAG` | no | `tim-web`, `local` | Web image and tag |

- Put a TLS-terminating proxy in front of `web`, and forward `X-Forwarded-Proto`. web then sends HSTS on https requests.
- Data lives in the `postgres-data` volume. Back it up. `down -v` deletes it.

The dev stack (`compose.yaml`, root `.env`) is described in [development.md](development.md).

### Instance files

The api reads its action files, connections file and labels file from `/etc/tim`.

- **Mount.** `deploy/compose.prod.yaml` binds `TIM_CONFIG_DIR` read-only at `/etc/tim`. The default is `deploy/config`, and a relative path is from `deploy/`.
- **Paths.** Three variables in `deploy/.env` name what the api reads. Empty means none.
  - `TIM_ACTIONS_DIR`, for example `/etc/tim/actions`.
  - `TIM_CONNECTIONS_FILE`, for example `/etc/tim/connections.yaml`.
  - `TIM_LABELS_FILE`, for example `/etc/tim/labels.yaml`.
- **As shipped.** `deploy/config` holds commented examples and the default labels. With the variables empty, the api reads none of them.
- **Startup only.** The api reads the files once, at startup. A change takes a restart of `api` (`docker compose -f deploy/compose.prod.yaml --env-file deploy/.env restart api`).
- **Errors stop startup.** Any problem in a file keeps the api from starting ([operations.md](operations.md#startup-failures-from-the-files)). Check the files first with `tim-api check` ([actions.md](actions.md#checking-files)).

The formats are in [actions.md](actions.md). `deploy/config/README.md` lists the files.

## Derived images

An instance that uses providers runs a derived image: TIM's backend image with the providers installed. Both Compose and Helm use it.

The backend image ships `uv` and `/app/constraints.txt`. The constraints pin every dependency from TIM's `uv.lock`, and pin `tim-api` and `tim-actions` to the versions in the image.

```dockerfile
FROM ghcr.io/itsnotapt/tim-data-investigate-platform/backend:4.0.0
COPY --chown=tim:tim acme-provider /tmp/acme-provider
RUN uv pip install --python /app/.venv/bin/python -c /app/constraints.txt /tmp/acme-provider
```

- **Packages.** `uv pip install` takes anything it can resolve: a local directory as above, a wheel, a git URL or an index name.
- **User.** The image runs as `tim`, which owns `/app/.venv`. No `USER` switch is needed.
- **Constraints.** A provider can't move TIM's pins. A provider that needs another `tim-actions` major fails the build with `No solution found`.
- **No runtime installs.** Nothing installs when the container starts. Every replica runs the same packages.
- **Tags.** Name a derived image `<tim version>-<revision>`, for example `4.0.0-acme.3`. The revision counts your own changes on that TIM version.
- **Checks.** `tim-api schema` and `tim-api check` run in the derived image and include the providers' types ([actions.md](actions.md#checking-files)).
- **Use it.** In Compose, set `TIM_API_IMAGE` and `TIM_API_IMAGE_TAG`. In Helm, set `api.image.repository`, and always set `api.image.tag` or `api.image.digest`.

How to write a provider is in [actions.md](actions.md#providers).

## Kubernetes (Helm)

Chart: `deploy/helm/tim`.

- It needs Kubernetes 1.34 or newer (`kubeVersion: >=1.34.0-0`), and Helm 3.
- CI validates the chart against Kubernetes 1.34 to 1.37.

It deploys:

- `<release>-tim-api` and `<release>-tim-web` Deployments and ClusterIP Services (port 8080), with:
  - liveness and readiness probes;
  - resource requests and limits;
  - non-root security contexts;
  - optional HPAs and PodDisruptionBudgets.
- ConfigMaps `<release>-tim-api` / `<release>-tim-web` with the non-secret variables, and a Secret `<release>-tim` (unless `secrets.existingSecret` is set).
- An Ingress for `ingress.host` with TLS, routing `/` to web (web proxies `/api/`).
- A migrations Job (`<release>-tim-migrate`, Helm hook) running `alembic upgrade head` with the api image.
- Optionally a single-pod PostgreSQL StatefulSet (`postgresql.enabled`).
- A `helm test` pod that checks `/healthz`, `/config.js` and `/api/healthChecks/readiness` through web.

The api and web pods restart automatically when their own ConfigMap or the Secret changes (checksum annotations). A change to one component's ConfigMap does not restart the other.

### Chart distribution

The chart is published as an OCI artifact to GitHub Container Registry, at `oci://ghcr.io/itsnotapt/tim-data-investigate-platform/charts/tim`.

- Chart releases are tagged `chart-vX.Y.Z`.
- `deploy/helm/tim/image-tags.yaml` pins the frontend and backend image versions. So `--version X.Y.Z` selects a chart version, and with it the image pair, without any tag settings.
- `Chart.yaml` `version` and `appVersion` are equal: the chart version.
- `api.image.tag`, `web.image.tag` and `digest` are optional overrides.

```bash
helm show values oci://ghcr.io/itsnotapt/tim-data-investigate-platform/charts/tim --version X.Y.Z > tim-values.yaml
helm upgrade --install tim oci://ghcr.io/itsnotapt/tim-data-investigate-platform/charts/tim --version X.Y.Z -n tim -f tim-values.yaml --wait
```

### Install

The commands below install from a checkout. To install a published chart, replace `deploy/helm/tim` with the OCI reference and `--version`.

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
helm test tim -n tim --logs
```

`helm test --logs` prints the test pod's output.

- The test pod has delete policy `before-hook-creation`. The next `helm test` replaces it.
- The last one stays in the namespace (`kubectl logs <release>-tim-test`).

`deploy/helm/tim/ci/*.yaml` are further examples: minimal, all features, and existing Secret.

- Rendering fails with a message when a required value is missing.
- Image tags default to the versions pinned in `image-tags.yaml`.
- `values.schema.json` rejects unknown keys and malformed values.

### Secrets

One Secret holds every sensitive variable. Its keys are the variable names.

| Key | Required | Notes |
| --- | --- | --- |
| `TIM_DATABASE_URL` | yes | `postgresql+asyncpg://user:password@host:5432/db` |
| `TIM_AUTH_CLIENT_SECRET` | unless workload identity | OBO client secret |
| `AGGRID_LICENSE` | no | Absent = AG Grid Enterprise trial mode |
| `POSTGRES_PASSWORD` | with `postgresql.enabled` | Must match the password in `TIM_DATABASE_URL` |

There are two ways to provide it:

- **Create it yourself**, and set `secrets.existingSecret`. This is recommended, and works with external secret operators.
- **Let the chart create it**, from `secrets.databaseUrl`, `secrets.authClientSecret` and `secrets.agGridLicense`.
  - The chart-created Secret is a pre-install/pre-upgrade hook, so it exists before the migrations Job.
  - `helm uninstall` leaves it in place (`kubectl delete secret <release>-tim`).

With `config.environment: production`, the chart refuses to render without an OBO credential:

- `secrets.authClientSecret`;
- `secrets.existingSecret`, expected to hold `TIM_AUTH_CLIENT_SECRET`;
- or workload identity.

### Entra workload identity

Instead of a client secret, federate the app registration with the release ServiceAccount (`system:serviceaccount:<namespace>:<release>-tim`), and set:

```yaml
serviceAccount:
  annotations:
    azure.workload.identity/client-id: <client id>
api:
  podLabels:
    azure.workload.identity/use: "true"
```

The workload identity webhook then injects:

- `AZURE_FEDERATED_TOKEN_FILE`, used for OBO when `TIM_AUTH_CLIENT_SECRET` is unset;
- `AZURE_CLIENT_ID` and `AZURE_TENANT_ID`, which `DefaultAzureCredential` uses for tag ingest.

Without workload identity, pass `AZURE_CLIENT_ID`, `AZURE_TENANT_ID` and `AZURE_CLIENT_SECRET` through `api.extraEnv` or `api.extraEnvFrom`. Compose doesn't wire them. Add them to the api environment if tag ingest needs a separate app identity.

Other api limits keep their defaults unless set through `api.extraEnv` (see [configuration.md](configuration.md)):

- `TIM_MAX_REQUEST_BYTES`, `TIM_MAX_RESULT_ROWS`, `TIM_MAX_RESULT_BYTES`;
- `TIM_RUN_TIMEOUT_SECONDS`, `TIM_MAX_CONCURRENT_RUNS`, `TIM_ROWS_PAGE_SIZE`, `TIM_MAX_PIVOT_ROWS`;
- `TIM_RUN_RETENTION_SECONDS`, `TIM_RUN_RETENTION_SWEEP_SECONDS`;
- `TIM_AUTH_AUTHORITY_HOST`, `TIM_KUSTO_OBO_SCOPE`, `TIM_TAG_INGEST_URL`.

### Database

Production uses an external (managed) PostgreSQL, via `TIM_DATABASE_URL`.

For evaluation, `postgresql.enabled: true` runs a single-pod `postgres:17-alpine` StatefulSet, with an 8 Gi PVC.

- It has no HA and no backups.
- The chart builds `TIM_DATABASE_URL` from `postgresql.auth`. Use a URL-safe password.
- Its PVC (`data-<release>-tim-postgresql-0`) survives `helm uninstall`.
- Delete the PVC before reinstalling with a different password, because an existing data directory keeps its original password.

The migrations Job runs as a hook:

- `pre-install,pre-upgrade` with an external database;
- `post-install,pre-upgrade` with the in-cluster PostgreSQL. It waits for PostgreSQL to accept connections.

A failed migration fails the install or upgrade, and the api is not rolled out. Logs: `kubectl logs job/<release>-tim-migrate`, kept for `migrations.ttlSecondsAfterFinished`.

### Uninstall

```bash
helm uninstall tim -n tim
```

`helm uninstall` removes the Deployments, Services, ConfigMaps, Ingress, PostgreSQL StatefulSet and the other release resources. These remain:

- the chart-created Secret `<release>-tim` (a hook): `kubectl delete secret <release>-tim`;
- the PostgreSQL PVC `data-<release>-tim-postgresql-0`: `kubectl delete pvc data-<release>-tim-postgresql-0`;
- completed migrations Jobs and their pods, until `migrations.ttlSecondsAfterFinished` (default 3600 s) after they finish: `kubectl delete job <release>-tim-migrate`;
- the last `helm test` pod (delete policy `before-hook-creation`): `kubectl delete pod <release>-tim-test`.

### Values reference

| Value | Default | Sets / meaning |
| --- | --- | --- |
| `config.environment` | `production` | `TIM_ENVIRONMENT` (api, web) |
| `config.publicUrl` | `https://<ingress.host>` | `REDIRECT_URI` = `<publicUrl>/blank.html` |
| `config.auth.tenantId` / `clientId` | required | `TIM_AUTH_TENANT_ID` / `TIM_AUTH_CLIENT_ID`, `AUTH_TENANT_ID` / `AUTH_CLIENT_ID` |
| `config.tags.clusterUri` / `database` | required / `Research` | `TIM_TAG_CLUSTER_URI` / `TIM_TAG_DATABASE`, `TAG_CLUSTER` / `TAG_DATABASE` |
| `secrets.existingSecret` | empty | Use this Secret instead of creating one |
| `secrets.databaseUrl` / `authClientSecret` / `agGridLicense` | empty | `TIM_DATABASE_URL` / `TIM_AUTH_CLIENT_SECRET` / `AGGRID_LICENSE` |
| `api.image.repository` / `tag` / `digest` | `ghcr.io/itsnotapt/tim-data-investigate-platform/backend` / empty / empty | Empty `tag` uses the backend version pinned in `image-tags.yaml`; `digest` wins over `tag` |
| `web.image.*` | same, `ghcr.io/itsnotapt/tim-data-investigate-platform/frontend`; empty `tag` uses the frontend version pinned in `image-tags.yaml` | |
| `api.replicaCount`, `web.replicaCount` | `2` | Ignored when autoscaling is enabled |
| `<component>.autoscaling.*` | disabled, 2 to 6 (api) / 2 to 4 (web), CPU 75 % | HPA (`autoscaling/v2`) |
| `<component>.podDisruptionBudget` | enabled, `minAvailable: 1` | Rendered only with more than one replica |
| `<component>.resources` | api 100m / 256Mi request, 1Gi limit; web 25m / 32Mi, 128Mi | |
| `<component>.livenessProbe` / `readinessProbe` | health endpoints above | |
| `<component>.podSecurityContext` / `securityContext` | non-root, seccomp `RuntimeDefault`, no privilege escalation, all capabilities dropped, read-only root filesystem | web mounts an `emptyDir` at `/tmp` |
| `<component>.extraEnv` / `extraEnvFrom` | empty | Further variables, e.g. `TIM_RUN_TIMEOUT_SECONDS` |
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

Ingress controllers have their own body-size and timeout defaults: ingress-nginx has 1 MB and 60 s. Set them to at least 25 MB and 620 s, as in the install example.

## Upgrades

- **Compose:**
  1. Update the checkout, or `TIM_API_IMAGE_TAG` and `TIM_WEB_IMAGE_TAG`.
  2. Run `docker compose -f deploy/compose.prod.yaml --env-file deploy/.env up -d --build`, or `pull` then `up -d --no-build`.
  3. `migrate` re-runs. It is a no-op when the schema is current. Then api and web are recreated.
- **Derived images:** rebuild each one `FROM` the new backend tag on every TIM release, and retag it `<tim version>-<revision>`.
  - Then point the stack at the new tag: `TIM_API_IMAGE_TAG` in Compose, `api.image.tag` in Helm.
  - A provider that needs another `tim-actions` major fails the rebuild. Update the provider first.
- **Helm:** run `helm upgrade` with the new chart `--version`.
  - The images follow the pair that chart version pins. Set `api.image.tag` or `web.image.tag` only to override.
  - The migrations Job runs first. The Deployments then roll with `maxUnavailable` 25 %, gated on readiness.
  - Migrations are forward-only. `helm rollback` restores the previous images, but not the previous schema. So back up the database before upgrading.
- **Running queries:** the api holds running Kusto queries in-process.
  - Pods stopped during a rollout end their running queries.
  - Clients see those runs as failed, and can rerun them.
- Back up PostgreSQL before every upgrade (`pg_dump`, or your managed service's snapshots).
