# How do comparable tools give plugin connections secrets?

Question: [#321](https://github.com/itsnotapt/tim-data-investigate-platform/issues/321) (map [#318](https://github.com/itsnotapt/tim-data-investigate-platform/issues/318)).
Checked on 2026-11-16. Docs versions: Airflow 3.4.0; Grafana "latest" docs (13.x) and `main` source; Superset 6.0.0 docs and `master` source; Kubernetes v1.37 docs; Helm 4.3.1 docs; Docker docs (undated); pydantic-settings docs (PyPI latest is 2.16.3, released 2026-11-13). Local checks used TIM's locked pydantic 2.13.5 and pydantic-settings 2.15.0.
Undated pages are marked "undated". Sources on `main`/`master` can change after this date.

Sources:

- [A1] Airflow, Managing Connections: https://airflow.apache.org/docs/apache-airflow/stable/howto/connection.html
- [A2] Airflow, Secrets Backend: https://airflow.apache.org/docs/apache-airflow/stable/security/secrets/secrets-backend/index.html
- [A3] Airflow, Masking sensitive data: https://airflow.apache.org/docs/apache-airflow/stable/security/secrets/mask-sensitive-values.html
- [A4] Airflow, Configuration reference (`[secrets]`, `[core]`): https://airflow.apache.org/docs/apache-airflow/stable/configurations-ref.html
- [A5] Airflow, Setting configuration options (`_cmd`, `_secret`): https://airflow.apache.org/docs/apache-airflow/stable/howto/set-config.html
- [A6] Airflow source, `airflow-core/src/airflow/provider.yaml.schema.json` (`main`): https://raw.githubusercontent.com/apache/airflow/main/airflow-core/src/airflow/provider.yaml.schema.json
- [G1] Grafana, Provision Grafana: https://grafana.com/docs/grafana/latest/administration/provisioning/
- [G2] Grafana, Configure Grafana (variable expansion): https://grafana.com/docs/grafana/latest/setup-grafana/configure-grafana/
- [G3] Grafana, Configure a Grafana Docker image (`__FILE`): https://grafana.com/docs/grafana/latest/setup-grafana/configure-docker/
- [G4] Grafana plugin tools, Add authentication for data source plugins: https://grafana.com/developers/plugin-tools/how-to-guides/data-source-plugins/add-authentication-for-data-source-plugins
- [G5] Grafana source, `pkg/services/provisioning/values/values.go` (`main`)
- [G6] Grafana source, `pkg/setting/expanders.go` (`main`)
- [G7] Grafana, Admin HTTP API (provisioning reload): https://grafana.com/docs/grafana/latest/developers/http_api/admin/
- [S1] Superset 6.0.0, Connecting to Databases: https://superset.apache.org/user-docs/6.0.0/configuration/databases/
- [S2] Superset, Importing and Exporting Datasources ("Next", unreleased docs): https://superset.apache.org/admin-docs/configuration/importing-exporting-datasources/
- [S3] Superset source (`master`): `superset/db_engine_specs/base.py`, `superset/databases/types.py`, `superset/databases/schemas.py`
- [S4] Superset source (`master`): `superset/databases/api.py` (`import_`), `superset/commands/database/export.py`
- [K1] Kubernetes, Secrets (last modified 2026-07-23): https://kubernetes.io/docs/concepts/configuration/secret/
- [K2] Kubernetes, ConfigMaps (last modified 2025-11-21): https://kubernetes.io/docs/concepts/configuration/configmap/
- [K3] Kubernetes, Good practices for Secrets (last modified 2025-06-22): https://kubernetes.io/docs/concepts/security/secrets-good-practices/
- [H1] Helm, Chart tips and tricks: https://helm.sh/docs/howto/charts_tips_and_tricks/
- [H2] Helm, Template functions and pipelines (`lookup`): https://helm.sh/docs/chart_template_guide/functions_and_pipelines/
- [D1] Docker, Use secrets in Compose (undated): https://docs.docker.com/compose/how-tos/use-secrets/
- [D2] Compose file reference, `secrets` and `services` (undated): https://docs.docker.com/reference/compose-file/secrets/, https://docs.docker.com/reference/compose-file/services/
- [D3] Docker, Compose variable interpolation (undated): https://docs.docker.com/compose/how-tos/environment-variables/variable-interpolation/
- [P1] pydantic-settings docs: https://pydantic.dev/docs/validation/latest/concepts/pydantic_settings/
- [P2] pydantic types, `SecretStr`: https://pydantic.dev/docs/validation/latest/api/pydantic/types/
- [E1] External Secrets Operator, ExternalSecret API and Azure Key Vault provider (unversioned): https://external-secrets.io/latest/api/externalsecret/, https://external-secrets.io/latest/provider/azure-key-vault/
- [C1] Secrets Store CSI Driver, Secret auto rotation and Sync as Kubernetes Secret: https://secrets-store-csi-driver.sigs.k8s.io/topics/secret-auto-rotation, https://secrets-store-csi-driver.sigs.k8s.io/topics/sync-as-kubernetes-secret
- [KV] Microsoft Learn, Azure Key Vault throttling guidance (2026-07-15): https://learn.microsoft.com/en-us/azure/key-vault/general/overview-throttling
- [T] TIM worktree: `docs/adr/0018-fixed-connections.md`, `api/tim-actions/src/tim_actions/connections.py`, `deploy/helm/tim/values.yaml`, `deploy/helm/tim/templates/api.yaml`, `deploy/compose.prod.yaml`, `docs/deployment.md`
- [M] Local checks with TIM's api venv (Python, pydantic 2.13.5)

## Short answer

The three tools all mark which connection fields are secret in the connection type itself, and keep those fields out of what the UI reads back. Airflow uses a fixed `password` field plus sensitive key names in `extra` [A3][A6]. Grafana splits `jsonData` from `secureJsonData` [G4]. Superset uses an `EncryptedField` type [S3]. None of them makes the operator paste a secret into plain config to get it in. Airflow resolves connections from a secrets backend, then env vars, then its database [A2]. Grafana expands `$VAR` and, in source, `$__file{}` inside provisioning files at startup or reload [G1][G5][G6]. Superset offers a password-store hook that reads env vars [S1]. On the platform side, Kubernetes updates mounted Secret files in place, but not env vars and not `subPath` mounts [K1][K2]. Compose mounts secrets as files at `/run/secrets/<name>` [D2]. ADR-0018's sentence answers where the value lives on Helm (the instance Secret) [T]. It doesn't say how the value reaches the api process, what Compose does, how a type declares a secret field, or whether rotation needs a restart. Five options follow, with no pick.

## 1. How each tool declares a secret field

| Tool | Declared by | UI or API sees | Validated without the value |
|---|---|---|---|
| Airflow | Standard `password` field, plus `extra` keys whose names contain a keyword (`password`, `secret`, `token`, `api_key`, ...) or match `sensitive_var_conn_names` [A3][A4] | Values masked in task logs and rendered fields, by value, not by field [A3] | Provider `conn-fields` give each field a JSON Schema. `format: password` is only a rendering hint. There is no `sensitive` flag for connection fields; `sensitive` exists only for config options [A6] |
| Grafana | Plugin puts the field in `secureJsonData`, not `jsonData` [G4] | Encrypted on save, never sent back. The browser gets `secureJsonFields`, one boolean per key that says the key is set [G4] | Plugin backend reads `DecryptedSecureJSONData`. Proxy routes can template `{{ .SecureJsonData.apiKey }}` [G4] |
| Superset | Engine spec parameter typed `EncryptedString` / `EncryptedDict` ("A database field that should be stored in encrypted_extra") [S3] | OpenAPI field tagged `x-encrypted-extra`. Value moved to `encrypted_extra` and shown masked (`masked_encrypted_extra`). `encrypted_extra_sensitive_fields` lists JSONPaths to mask, default `$.*` [S3] | SSH tunnel credentials are `load_only`: accepted on input, never serialised back [S3] |
| pydantic | Field typed `SecretStr` | `repr`, `str` and JSON show `**********` [P2][M]. JSON Schema is `{"type": "string", "format": "password", "writeOnly": true}` [M] | A type check works offline. But a constraint error prints the raw value: `input_value='hunter2-short'` [M] |

Every tool marks secrets in the type. None trusts the operator to remember. Only Superset's marker also drives storage.

## 2. How the value gets in

**Airflow.**

- A connection can be a whole `AIRFLOW_CONN_{CONN_ID}` env var, JSON or URI, password included. Such connections "are not displayed in the Airflow UI" [A1].
- A configured backend class (`[secrets] backend`, `backend_kwargs`) is searched first, then env vars, then the metastore. "This search ordering is not configurable" [A2].
- Airflow's own config takes `_cmd` (run a command) and `_secret` (read from the backend) suffixes for a fixed list of options, such as `sql_alchemy_conn` and `fernet_key` [A5].
- Lookup cost and rotation: `[secrets] use_cache` (default `False`, experimental) caches Variables "when parsing DAGs only". "There is no caching in place when DAG tasks are run" [A4]. Each lookup outside parsing goes to the backend, so a rotated value is seen on the next lookup. `cache_ttl_seconds` (default 900) bounds the delay when the cache is on [A4].

**Grafana.**

- Provisioning files expand `$ENV_VAR` and `${ENV_VAR}`, for values only. `$$` is a literal `$`, and unescaped `$` in a password silently truncates it (`${PASSWORD}` with `Pa$sw0rd` gives `Pa`) [G1].
- In source, each provisioned value goes through `setting.ExpandVar`, then `os.ExpandEnv` [G5]. `ExpandVar` registers `env` and `file` expanders. The file expander reads the path and trims whitespace on each expansion [G6].
- So `$__file{/run/secrets/x}` works in provisioning files, but only the source shows this. The provisioning page documents only `$VAR` [G1]. `$__env{}` / `$__file{}` / `$__vault{}` are documented for `grafana.ini`, and `$__vault` is Enterprise-only [G2].
- `GF_<SECTION>_<KEY>__FILE` reads a `grafana.ini` option from a file, for example a Docker secret at `/run/secrets/admin_password` [G3].
- Datasources are added or updated "during startup" [G1]. `POST /api/admin/provisioning/datasources/reload` reloads them [G7]. A reload re-expands values, so a rotated file is read again. This is inferred from [G5][G6], not tested.

**Superset.**

- Passwords sit in the SQLAlchemy URI or the "Secure Extra" field, encrypted in the metadata DB with `SECRET_KEY` [S1][S2].
- `SQLALCHEMY_CUSTOM_PASSWORD_STORE` is a function from URL to password. The documented example formats the URI's password placeholder from `os.environ` ("A common pattern is to use environment variables to make secrets available") [S1].
- Export writes `masked_encrypted_extra` when there is something to mask [S4]. Import takes `passwords`, `ssh_tunnel_passwords` and `encrypted_extra_secrets` as JSON maps beside the ZIP [S4]. The secret travels apart from the config file.

## 3. Platform mechanics

**Kubernetes.**

- A mounted Secret has one file per key, on tmpfs [K1].
- Updates reach mounted files "using an eventually-consistent approach". The delay can be "the kubelet sync period + cache propagation delay" [K1].
- "A container using a Secret as a subPath volume mount does not receive automated Secret updates" [K1].
- The Secrets page doesn't say env vars stay stale. The ConfigMap page does: "ConfigMaps consumed as environment variables are not updated automatically and require a pod restart" [K2]. The CSI driver docs say the same of Secrets [C1].
- Env var names are restricted. With `envFrom`, invalid keys are skipped, but the Pod still starts [K1].
- Anyone who can create a Pod in the namespace can read its Secrets. Apps "must avoid logging the secret data in the clear" [K1][K3].

**External stores.**

- External Secrets Operator syncs an Azure Key Vault or AWS Secrets Manager entry into a Kubernetes Secret key on a `refreshInterval`, for example `1h`. It authenticates to Key Vault preferably with workload identity [E1].
- The Secrets Store CSI driver mounts store entries as files. Optional rotation (`rotationPollInterval`, default `2m`) updates the mount and any synced Secret. Apps "must watch for file changes". For env vars, "the pod needs to be restarted". Rotation is alpha [C1].
- A CSI-synced Secret exists only while a pod mounts the volume [C1].
- Key Vault guidance: cache secrets in memory, and "re-read ... only when the cached copy stops working". A 429 means throttled. Where the target service supports Entra auth, use it instead of a stored credential [KV].

**Helm.**

- Restart-on-change is a convention: a `checksum/...` annotation built with `sha256sum` from a template in the chart [H1]. It can't see a Secret the chart didn't render. TIM's `checksum/secret` therefore does nothing with `existingSecret` [T].
- `lookup` reads live objects, but returns nothing under `helm template` or a client `--dry-run` [H2]. A chart can't check offline that a referenced key exists.
- `existingSecret` is a chart convention, not a Helm feature. TIM's chart already follows it [T].

**Compose.**

- Top-level `secrets:` take a `file:` or a host `environment:` variable [D2].
- A service that lists a secret gets it read-only at `/run/secrets/<name>` (mode `0444` by default; long syntax sets `target`, `uid`, `gid`, `mode`) [D2].
- Docker's guide argues env vars are "often available to all processes" and may end up in logs. It shows the image convention `MYSQL_PASSWORD_FILE=/run/secrets/...` [D1].
- `environment:` interpolation is resolved when a command such as `up` runs [D3]. `docker compose config` prints the resolved values [D3].
- Unverified: whether editing a `file:` secret on the host reaches a running container.

**pydantic-settings.**

- `secrets_dir` reads one file per field, with the file name as the key. Docker's `/run/secrets` is the documented example [P1].
- Env vars and dotenv take priority over the secrets dir. A missing dir only warns [P1].
- `AzureKeyVaultSettingsSource` and `AWSSecretsManagerSettingsSource` exist [P1].
- All sources are read when the settings object is constructed. In-place reload means calling `__init__` again [P1].
- This covers TIM's own settings, not entries in a YAML list such as the connections file.

## 4. How far ADR-0018 gets

The ADR says "a future mechanism that needs one names a key in the instance Secret" [T]. On Helm it fits the existing design: one Secret, keys named after env vars, `existingSecret` recommended and fed by operators such as ESO [T][E1]. It leaves five things open.

- **Delivery.** The api gets named keys through `secretKeyRef` only [T]. A new key needs one of three things: a chart change, `api.extraEnv`, or the whole Secret by `envFrom`, which also exposes `TIM_DATABASE_URL` under its own name.
- **Compose.** There is no instance Secret. The analogue is `deploy/.env`, interpolated into a fixed `x-api-env` list, so a new key also needs a compose edit [T][D3].
- **Declaration.** Nothing says how a connection type marks a field secret, so `check` can't tell a key name from a value.
- **Rotation.** Env values need a restart [K2][C1]. TIM restarts on Secret change only for the chart-created Secret [T].
- **Offline check.** `check` can validate a key's syntax, but not its presence: `lookup` is empty offline [H2].

Also relevant: the connections file itself is mounted with `subPath` and read once [T], so no secret embedded in it could rotate either.

## 5. Options for TIM

All options share three things. A connection type declares a secret field by type: a TIM type wrapping pydantic `SecretStr`, whose schema already says `format: password`, `writeOnly` [M]. `InstanceConnection` keeps sending the browser only name, title, type, editor and databases [T]. And because pydantic errors echo `input_value` [M], resolved values should be validated with errors scrubbed, or validated after the reference is checked.

| | (a) Key in the instance Secret | (b) Named env var (`*_env`) | (c) File reference | (d) `$__env{}` / `$__file{}` expansion | (e) Secrets backend |
|---|---|---|---|---|---|
| File says | `api_key: {secret: WEATHER_API_KEY}` | `api_key_env: WEATHER_API_KEY` | `api_key_file: /etc/tim/secrets/weather-api-key` | `api_key: $__file{/run/secrets/weather}` in any field | `api_key: {vault: weather-api-key}` |
| Declared by | Field type `SecretRef` | Field type or `*_env` naming | Field type `SecretFile` | Not declared: any field can expand | Field type `SecretRef` plus instance backend config |
| `check` offline | Key syntax (env name rules [K1]); not presence | Same as (a) | Path shape and allowed dir; not existence | Expression syntax only; the expanded field is unchecked | Name syntax; not presence |
| Helm | Chart can derive `secretKeyRef`s from `connections` values, same Secret, `existingSecret` works | `api.extraEnv` / `extraEnvFrom`, any Secret (what trial authors did) | Mount the instance Secret, or a CSI volume, as a directory, without `subPath` [K1][C1] | As (b) or (c) | Workload identity already in chart; ESO/CSI do the same outside TIM [E1][C1] |
| Compose | Key in `deploy/.env` plus an `x-api-env` line | Same, operator edits compose | `secrets:` at `/run/secrets` [D2] | Either | Needs a client secret to reach the vault; no workload identity |
| Rotation without restart | No (env) [K2] | No (env) | Yes, if re-read on use; kubelet or CSI delay [K1][C1] | Only with a reload, as Grafana's API [G7] | Yes, with a TTL cache; mind throttling [KV] |
| Never seen by browser or logs | Holds if hooks get only `SecretStr` | Weaker: each hook reads `os.environ` itself | Holds; value never in a ConfigMap | Weakest: a secret can be expanded into `title` or a URL | Holds; adds a network dependency at startup |

Trade-offs in short:

- **(a)** is the ADR literally. It is one place for every sensitive value, and it works with ESO. It is restart-only, and Compose needs a second mechanism.
- **(b)** is the most flexible and needs no chart change. Each hook reads `os.environ` its own way unless TIM resolves the field centrally, so masking and checks vary by plugin. Airflow's `AIRFLOW_CONN_*` and Superset's `os.environ` password store are precedents [A1][S1].
- **(c)** is the only option that rotates on both platforms without a TIM-side store. It matches Docker's `_FILE` convention and Grafana's `__FILE` [D1][G3]. It needs a directory mount and a re-read on use, a cheap tmpfs read [K1]. A fixed dir would follow `secrets_dir` [P1].
- **(d)** is generic and familiar from Grafana, but the type can't declare which fields are secret. The `$`-escaping trap is documented [G1]. Values are in the model before validation, which conflicts with error scrubbing [M].
- **(e)** is Airflow's model [A2]. It rotates and audits in the vault, but ties TIM to a store API. Key Vault itself says to prefer Entra auth where the service supports it [KV]; that is already `workload_identity`. ESO and the CSI driver give most of the benefit to (a)-(c) with no TIM code [E1][C1].

Options combine. For example, (a) or (b) for env plus (c) for files, behind one `SecretRef` field type with `env:` / `file:` variants. The decision belongs to the "Secrets and identity for connections" ticket.

## Unverified or not fetched

- Airflow's custom-provider how-to page returned 404. Provider field declaration comes from the schema [A6] and [A1].
- Grafana `$__file{}` in provisioning is from source only [G5][G6]. Re-expansion on reload is inferred.
- ESO `refreshInterval` default isn't stated on the fetched page [E1].
- Compose `file:` secret propagation of host edits isn't documented [D2].
- Superset's handling of a password inside an exported `sqlalchemy_uri` is in `export_to_dict`, which wasn't read [S4].
