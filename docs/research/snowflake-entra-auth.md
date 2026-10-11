# Can Snowflake accept the analyst's Entra token?

Research for [#67](https://github.com/itsnotapt/tim-data-investigate-platform/issues/67) (map [#65](https://github.com/itsnotapt/tim-data-investigate-platform/issues/65)). Researched 2026-10-10. Connector source read at `snowflakedb/snowflake-connector-python` commit `e58434c` (v4.8.0, 2026-09-30).

## Answer

**Yes.** Snowflake External OAuth with `EXTERNAL_OAUTH_TYPE = AZURE` accepts any Entra-issued, signed access token whose issuer, audience and user-mapping claim match the security integration. It does not check which client got the token. TIM can therefore keep its current pattern: the API does an OBO exchange (as it does for Kusto, [ADR-0009](../adr/0009-obo-token-exchange.md)), this time for a scope on a "Snowflake OAuth Resource" app registration, and passes the result to `snowflake.connector.connect(authenticator="oauth", token=...)`. Queries then run as the analyst's own Snowflake user, under that user's roles.

Power BI's Snowflake SSO is the same pattern in production: a Microsoft service gets an Entra token for Snowflake on the user's behalf and presents it ([Snowflake: Power BI SSO](https://docs.snowflake.com/en/user-guide/oauth-powerbi)). No Snowflake page describes OBO by name. Snowflake's Entra guide does describe "programmatic clients that will request an Access Token on behalf of a user" ([Snowflake: Entra External OAuth](https://docs.snowflake.com/en/user-guide/oauth-azure)).

**Recommendation for TIM:** make External OAuth through OBO the Snowflake connection's auth mechanism, with the `session:role-any` scope so each analyst's own default role and grants apply. Fall back to a service user with workload identity federation (no secret, and it reuses the AKS workload identity TIM already has) only where the Snowflake admin won't set up External OAuth. Treat that fallback as a different trust model and label it as such in instance configuration.

## 1. Does an OBO-exchanged token work, and what must be configured?

### How OBO produces the token

- The API sends the user's token (with `aud` set to TIM's own app) plus its client credential, and asks for a `scope` on the downstream API. Entra returns a delegated token for that downstream API ([Microsoft: OBO flow](https://learn.microsoft.com/en-us/entra/identity-platform/v2-oauth2-on-behalf-of-flow)). This is exactly what `obo.py` already does for `{cluster}/.default`.
- OBO "only uses delegated *scopes* and not application *roles*" ([OBO flow](https://learn.microsoft.com/en-us/entra/identity-platform/v2-oauth2-on-behalf-of-flow)). So the Snowflake role has to be expressed as a **delegated scope** (Snowflake's "user-delegated" format), not as an app role (Snowflake's "app-only" format).
- The resulting token's format (v1 or v2) is chosen by the **resource** app's `requestedAccessTokenVersion`. It does not depend on the endpoint or the client. `null` means v1 ([Microsoft: app manifest](https://learn.microsoft.com/en-us/entra/identity-platform/reference-microsoft-graph-app-manifest), [OBO flow, response section](https://learn.microsoft.com/en-us/entra/identity-platform/v2-oauth2-on-behalf-of-flow)).

### Entra side (Entra admin)

1. **Snowflake resource app registration**, single tenant. Under *Expose an API*, set an Application ID URI (`api://<app-id>` recommended) and add a delegated scope for each Snowflake role, named `session:scope:<role>` (for example `session:scope:analyst`). Or add a single `session:role-any` scope ([Entra External OAuth](https://docs.snowflake.com/en/user-guide/oauth-azure)).
2. **Keep the resource app on v1 tokens** (`requestedAccessTokenVersion` null or 1, the default). Snowflake's documented integration assumes v1 throughout:
   - The issuer it uses is the `https://sts.windows.net/<tenant-id>/` form ([Entra External OAuth](https://docs.snowflake.com/en/user-guide/oauth-azure), [Power BI SSO](https://docs.snowflake.com/en/user-guide/oauth-powerbi)).
   - It maps users on the `upn` claim, and `upn` is a v1 claim that v2 tokens carry only as an optional claim ([Microsoft: access token claims](https://learn.microsoft.com/en-us/entra/identity-platform/access-token-claims-reference)).
   - In v1 tokens `aud` can be the resource URI used in the request. In v2 tokens it is always the client-ID GUID ([access token claims](https://learn.microsoft.com/en-us/entra/identity-platform/access-token-claims-reference)).

   *Inference, not tested:* switching the resource app to v2 means changing the issuer to `.../v2.0`, the audience to the GUID, and adding `upn` as an optional claim.
3. **TIM's app registration** (the one app for SPA and API) gets a delegated API permission on that scope, with admin consent. TIM is both client and middle tier, so this is the "use of a single application" case in Microsoft's OBO consent guidance ([OBO flow, consent section](https://learn.microsoft.com/en-us/entra/identity-platform/v2-oauth2-on-behalf-of-flow)). Without consent, OBO returns `invalid_grant` or `interaction_required`, which TIM already maps to `403 consent-required`. Conditional Access on the Snowflake resource surfaces the same way.

### Snowflake side (Snowflake admin; needs `CREATE INTEGRATION`, by default only ACCOUNTADMIN has it)

```sql
CREATE SECURITY INTEGRATION tim_entra
  TYPE = EXTERNAL_OAUTH
  ENABLED = TRUE
  EXTERNAL_OAUTH_TYPE = AZURE
  EXTERNAL_OAUTH_ISSUER = 'https://sts.windows.net/<tenant-id>/'   -- exact, trailing slash included
  EXTERNAL_OAUTH_JWS_KEYS_URL = 'https://login.microsoftonline.com/<tenant-id>/discovery/v2.0/keys'
  EXTERNAL_OAUTH_AUDIENCE_LIST = ('api://<snowflake-resource-app-id>')  -- must equal the App ID URI
  EXTERNAL_OAUTH_TOKEN_USER_MAPPING_CLAIM = 'upn'
  EXTERNAL_OAUTH_SNOWFLAKE_USER_MAPPING_ATTRIBUTE = 'login_name'   -- or 'email_address'
  EXTERNAL_OAUTH_ANY_ROLE_MODE = 'ENABLE';                          -- only if using session:role-any
```

Sources: [Entra External OAuth](https://docs.snowflake.com/en/user-guide/oauth-azure), [CREATE SECURITY INTEGRATION (External OAuth)](https://docs.snowflake.com/en/sql-reference/sql/create-security-integration-oauth-external).

- **User mapping.** The claim named by `EXTERNAL_OAUTH_TOKEN_USER_MAPPING_CLAIM` (Entra `upn`) must equal the Snowflake user's `LOGIN_NAME` or `EMAIL_ADDRESS`. Mapping falls back to `name` if `login_name` is unset. B2B guest users need `unique_name` instead of `upn` ([Power BI SSO](https://docs.snowflake.com/en/user-guide/oauth-powerbi)). The Snowflake user must already exist, because Snowflake does a user lookup at login ([External OAuth overview](https://docs.snowflake.com/en/user-guide/oauth-ext-overview)). Users are normally provisioned with Entra SCIM ([Snowflake: Entra SCIM](https://docs.snowflake.com/en/user-guide/scim-azure)).
- **Role mapping.** Pick one of two scope choices:
  - `session:scope:<role>`: the session runs with that fixed role, and the user must hold it.
  - `session:role-any` with `EXTERNAL_OAUTH_ANY_ROLE_MODE = ENABLE` (or `ENABLE_FOR_PRIVILEGE` plus `USE_ANY_ROLE`): the user's default role is used and role switching is allowed. Default secondary roles are activated only in any-role mode.

  "if you do not define a scope, the connection attempt to Snowflake will fail." ACCOUNTADMIN, ORGADMIN, GLOBALORGADMIN and SECURITYADMIN are blocked by default ([External OAuth overview](https://docs.snowflake.com/en/user-guide/oauth-ext-overview), [CREATE SECURITY INTEGRATION](https://docs.snowflake.com/en/sql-reference/sql/create-security-integration-oauth-external)).
- **Exactness.** Issuer and scope values are case-sensitive and must match exactly. A wrong issuer means dropping and recreating the integration ([Entra External OAuth](https://docs.snowflake.com/en/user-guide/oauth-azure)). `SYSTEM$VERIFY_EXTERNAL_OAUTH_TOKEN` is Snowflake's diagnostic for a rejected token ([External OAuth overview](https://docs.snowflake.com/en/user-guide/oauth-ext-overview)).
- **Network.** Account and user network policies still apply, so they must allow the TIM API's egress ([Entra External OAuth](https://docs.snowflake.com/en/user-guide/oauth-azure)).

### What TIM's OBO call would request

The scope is `api://<snowflake-resource-app-id>/session:role-any` (or `.../session:scope:<role>`). This would be a per-connection setting, the analogue of `TIM_KUSTO_OBO_SCOPE`. The shared MSAL app and cache from ADR-0009 work unchanged; MSAL caches per user and scope.

Avoid `/.default` here. It returns every consented `session:scope:*` scope at once, and Snowflake's docs don't say how several role scopes in one token are resolved.

The account URL must be instance configuration, never user input. This is the same reason as the Kusto cluster allow-list: Microsoft warns never to send a token anywhere but its audience ([OBO flow](https://learn.microsoft.com/en-us/entra/identity-platform/v2-oauth2-on-behalf-of-flow)).

## 2. How the Python connector takes the token

- `connect(account=..., authenticator="oauth", token=<access token>)`. `user` may be omitted because the token identifies the user (`empty_user_allowed_authenticators` in `connection.py`). `token_file_path` is an alternative; if both are set, the file wins ([connector API](https://docs.snowflake.com/en/developer-guide/python-connector/python-connector-api), [connect guide](https://docs.snowflake.com/en/developer-guide/python-connector/python-connector-connect), `src/snowflake/connector/connection.py`).
- **The token is used at login only.** After login the connector calls `auth_class.reset_secrets()`, which drops the token (`connection.py`). The session is then kept alive with Snowflake's own session and master tokens, renewed through `/session/token-request` (`network.py` `_renew_session`). "A session is independent of an identity provider (IdP) session." Programmatic sessions idle out after 240 minutes by default, and a session policy can cap the maximum lifespan ([session policies](https://docs.snowflake.com/en/user-guide/session-policies)). So a run longer than the Entra token's lifetime (about an hour) is fine once connected.
- **No refresh.** For a user-supplied token, `AuthByOAuth.reauthenticate()` returns `{"success": False}`. The connector explicitly does not renew "OAuth v1.0 (AuthByOAuth), whose user-supplied token cannot be renewed (SNOW-2329031)" (`auth/oauth.py`, `auth/_auth.py`). An expired token at login fails with 390318 `OAUTH_ACCESS_TOKEN_EXPIRED`. TIM must get a fresh token from MSAL (cache or OBO) for each new connection.
- **Connection reuse.** A connection is bound to one analyst, so it can never be shared or pooled across users. The connector is DB-API `threadsafety` 2, meaning threads can share the module and connections ([connector API](https://docs.snowflake.com/en/developer-guide/python-connector/python-connector-api)). The simplest correct model is one connection per action run, opened with a just-acquired token and closed at the end. A per-user pool keyed by `oid` is an optimisation that would need eviction on idle timeout.
- **Bind parameters.** The default `paramstyle` is `pyformat` (client-side binding); `qmark` and `numeric` bind on the server. This is relevant to #65's "backend helpers use bind parameters by default." Async execution (`execute_async`, `get_query_status`, `get_results_from_sfqid`) exists if a run should be cancellable or polled by query id ([connector API](https://docs.snowflake.com/en/developer-guide/python-connector/python-connector-api)).

## 3. Fallbacks when External OAuth isn't available

All of these authenticate **as one Snowflake service user**, not as the analyst.

| Fallback | How | Secret to manage |
|---|---|---|
| **Workload identity federation** (best fallback) | `CREATE USER ... TYPE = SERVICE WORKLOAD_IDENTITY = (TYPE = AZURE ISSUER = 'https://login.microsoftonline.com/<tid>/v2.0' SUBJECT = '<managed identity object id>')`; then `connect(authenticator="WORKLOAD_IDENTITY", workload_identity_provider="AZURE")` ([WIF](https://docs.snowflake.com/en/user-guide/workload-identity-federation)). Since v4.7.1 the connector natively detects AKS workload identity from `AZURE_CLIENT_ID`, `AZURE_TENANT_ID` and `AZURE_FEDERATED_TOKEN_FILE` (`wif_util.py` `create_azure_attestation`; `DESCRIPTION.md`). These are the same variables TIM already uses for its OBO credential. | None. Not available in Azure sovereign clouds (Azure China, US Gov) ([WIF](https://docs.snowflake.com/en/user-guide/workload-identity-federation)). |
| **Key-pair** | `ALTER USER ... ADD KEY PAIR` (named, supports role restriction and expiry) or `RSA_PUBLIC_KEY`/`RSA_PUBLIC_KEY_2` for rotation; `connect(authenticator="SNOWFLAKE_JWT", private_key_file=...)` ([key-pair auth](https://docs.snowflake.com/en/user-guide/key-pair-auth), [connect guide](https://docs.snowflake.com/en/developer-guide/python-connector/python-connector-connect)) | A private key (2048-bit RSA minimum) in a Kubernetes secret |
| **OAuth client credentials** | Entra app role `session:role:<role>` (allowed member type Application) on the resource app, plus `authenticator="OAUTH_CLIENT_CREDENTIALS"` with `oauth_client_id`, `oauth_client_secret`, `oauth_token_request_url` and `oauth_scope` ([Entra External OAuth](https://docs.snowflake.com/en/user-guide/oauth-azure), [connect guide](https://docs.snowflake.com/en/developer-guide/python-connector/python-connector-connect)). Needs the External OAuth integration anyway; *inference:* it must map a claim present in app-only tokens, such as `sub` or `oid`, because they carry no `upn`. | A client secret. If External OAuth exists, use OBO instead. |

**What access control is lost with any service-user fallback:**

- **Per-analyst authorisation.** Every analyst gets the union of what the service user's role can read. Snowflake RBAC, secondary roles, and row access or masking policies that branch on the current user or role no longer separate analysts. TIM would become the only gate, and today it has no per-user data authorisation (the [architecture security model](../architecture.md#security-model) relies on Kusto doing that through OBO).
- **Per-analyst audit in Snowflake.** `QUERY_HISTORY` and `LOGIN_HISTORY` show the service user. A partial mitigation is to set `QUERY_TAG` (session parameter, up to 2000 characters, shown in `QUERY_HISTORY`) to the analyst's identity on each connection ([parameters](https://docs.snowflake.com/en/sql-reference/parameters)). The analyst can't tamper with it because TIM sets it server-side, but it is advisory only and Snowflake enforces nothing on it.
- **Revocation and Conditional Access.** Disabling an analyst in Entra or Snowflake, or a Conditional Access or MFA policy on Snowflake, no longer stops their TIM queries. Only revoking their TIM access does.
- **Per-user governance.** Per-user resource monitors, warehouses and default roles no longer apply.

## Implications for other tickets

- **Auth is per connection, configured per instance** (consistent with #65's "each connection has its own auth mechanism"). A Snowflake connection needs `account`, an auth mode (`obo` or `workload_identity`/`keypair`), the OBO scope, and optionally `warehouse`, `role` and `database`.
- **The OBO exchange must happen before the run is created**, as for Kusto today, so consent errors come back on the `POST`. Under OBO the action receives a ready connection or token, never the analyst's TIM token.
- **No connection pooling across users.** Connection cost is one login per run unless a per-user pool is built.
- **Sovereign clouds.** OBO works there (ADR-0009 templates the authority), but WIF does not, so the only secret-free fallback is unavailable in Azure China and US Gov.
