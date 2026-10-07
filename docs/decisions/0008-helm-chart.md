# 0008. Helm chart for Kubernetes deployment

- **Status:** Accepted
- **Date:** 2026-10-06
- **Deciders:** the user
- **Related:** [deployment.md](../deployment.md), [0004](0004-postgresql-persistence.md), [0006](0006-ag-grid-enterprise.md)

## Context
TIM ships as two images (`tim-web`, `tim-api`) and needs PostgreSQL ([0004](0004-postgresql-persistence.md)). Compose covers single-host installs; Kubernetes installs need the same topology (web is the only public entry, the api and database stay internal, schema migrations run before the api rolls out) without a second set of variable names to learn. The optional AG Grid licence key ([0006](0006-ag-grid-enterprise.md)) and the Entra client secret must stay out of ConfigMaps and values files that get committed. See [deployment.md](../deployment.md) for the topology.

## Decision
One chart, `deploy/helm/tim`, with no subcharts or dependencies.

- **Same variable names as Compose.** The ConfigMaps `<release>-tim-api` and `<release>-tim-web` set the same variable names as `deploy/compose.prod.yaml` (`TIM_ENVIRONMENT`, `TIM_AUTH_TENANT_ID`, `AUTH_TENANT_ID`, `TAG_CLUSTER`, `BACKEND_URI`, ...). Each entry in `values.yaml` names the variable it sets.
- **One Secret.** Its keys are the variable names: `TIM_DATABASE_URL`, optional `TIM_AUTH_CLIENT_SECRET` and `AGGRID_LICENSE` (and `POSTGRES_PASSWORD` with the in-cluster database). Either set `secrets.existingSecret` to a Secret you manage, or the chart creates `<release>-tim` from `secrets.databaseUrl`, `secrets.authClientSecret` and `secrets.agGridLicense`. The optional keys are mounted with `optional: true`.
- **Ingress to web only.** The Ingress routes `/` to the web Service. Web's nginx proxies `/api/` to the api; the chart sets `BACKEND_URI` to `http://<release>-tim-api.<namespace>.svc.<clusterDomain>:<api.service.port>` (`clusterDomain` defaults to `cluster.local`).
- **Migrations as a Helm hook Job.** `<release>-tim-migrate` runs `alembic upgrade head` with the api image. With an external database it is `pre-install,pre-upgrade`; with `postgresql.enabled` it is `post-install,pre-upgrade` (the database does not exist yet at pre-install) and an init container waits with `pg_isready`. A failed Job fails the install or upgrade. `migrations.enabled: false` removes it.
- **Database.** An external managed PostgreSQL through `TIM_DATABASE_URL` is the production path. `postgresql.enabled: true` adds a single-replica `postgres:17-alpine` StatefulSet with a PVC, for evaluation only (no HA, no backups). There is no Bitnami or other database dependency.
- **Hardened pods.** All pods run with `runAsNonRoot`, seccomp `RuntimeDefault`, `allowPrivilegeEscalation: false` and `capabilities.drop: [ALL]` (api uid 10001, web uid 101, PostgreSQL uid 70). `readOnlyRootFilesystem: true` is set for the api and the migrations Job (which reuse `api.securityContext`) and is `false` for web and PostgreSQL. The api, migrations Job, web and PostgreSQL mount an `emptyDir` on `/tmp`. The ServiceAccount token is not mounted by default (`serviceAccount.automountServiceAccountToken`) and never in the migrations Job or PostgreSQL pod.
- **Validation.** Templates call `required`/`fail` (`tim.validate` in `_helpers.tpl`) for the tenant and client ids, an https `config.tags.clusterUri`, `ingress.host`, a public URL, the database URL (or `postgresql.auth.password`) and, in production, an OBO credential (client secret, `secrets.existingSecret` or workload identity). `values.schema.json` sets `additionalProperties: false` on the root and the nested objects, so unknown keys are rejected.

## Alternatives considered
| Option | Pros | Cons |
|---|---|---|
| Bitnami PostgreSQL subchart | Mature, more options | External dependency and image policy; production should use a managed database anyway |
| Separate charts for web and api | Independent release | web and api share configuration and the Secret; two installs to keep in step, and migrations must precede the api |
| Plain manifests / Kustomize | No templating | Validation, optional parts (HPA, PDB, in-cluster database) and the hook ordering need hand-editing |
| Api migrates at startup | No Job | Races between replicas; a failed migration surfaces as crash loops; the api already never migrates on its own |
| Helm chart, one chart (chosen) | One install, schema-checked values, hooks order migrations | Chart must be kept in step with Compose and the configuration docs |

## Consequences
- The chart-created Secret is a `pre-install,pre-upgrade` hook (weight -10) so it exists before the migrations Job. Helm does not delete hook resources on uninstall, so `helm uninstall` leaves it; remove it with `kubectl delete secret <release>-tim`. A Secret passed with `secrets.existingSecret` is never managed by the chart.
- The in-cluster database's PVC comes from the StatefulSet `volumeClaimTemplates`, which Kubernetes does not delete with the StatefulSet. It survives `helm uninstall`, and an existing data directory keeps its original password, so delete the PVC before reinstalling with a different one.
- Web runs with a read-only root filesystem: its entrypoint writes `config.js` and the nginx conf to `/tmp/tim`, on the `emptyDir` the chart mounts at `/tmp`.
- Image tags are per component (`api.image.tag`, `web.image.tag`; `digest` wins over `tag`). There is no global tag. Each needs a `tag` or a `digest`: rendering fails otherwise (`api.image.tag or api.image.digest is required`, likewise for web). `web` and `api` are versioned independently, so a single chart default would be wrong for one of them; `Chart.appVersion` is informational only.
- The chart is distributed as an OCI artifact on GHCR (`oci://ghcr.io/itsnotapt/tim-data-investigate-platform/charts/tim`), pushed by the release-please workflow when a `chart-vX.Y.Z` release is created. The chart version is independent of the web and api versions. There is no Helm repository index to host.
- Migrations are forward-only: `helm rollback` restores images, not the schema. Back up the database before upgrading.
- Pods restart when the chart's ConfigMaps or Secret change (checksum annotations).
- A new configuration variable has to be added to the chart (ConfigMap, schema, `values.yaml`) as well as to Compose; otherwise it is reachable only through `api.extraEnv` / `web.extraEnv`.
