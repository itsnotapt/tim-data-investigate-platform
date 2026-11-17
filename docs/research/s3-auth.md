# How can TIM reach S3: as the analyst, through federated workload identity, or only with keys?

Research for [How can TIM reach S3: as the analyst, through federated workload identity, or only with keys?](https://github.com/itsnotapt/tim-data-investigate-platform/issues/322) (map [Wayfinder: action authoring that's easy to start and fully specified](https://github.com/itsnotapt/tim-data-investigate-platform/issues/318); source ticket [S3 action and S3 connections](https://github.com/itsnotapt/tim-data-investigate-platform/issues/94)). Researched 2026-11-16. Entra discovery documents were fetched live. botocore source was read at `boto/botocore` `develop` commit `cebeeb1278` (2026-11-16). MinIO source was read at `minio/minio` `master` commit `7aac2a2c5b` (2026-02-12; the repository is archived).

## Answer

**AWS S3 works with all three: as the analyst, as TIM through workload identity, and with keys. MinIO works with all three too. Cloudflare R2 works only with keys.**

- **As the analyst (AWS):** TIM does the OBO exchange it already does for Kusto and Snowflake, for a scope on a new "AWS resource" Entra app. It then passes the token to STS `AssumeRoleWithWebIdentity`, against an IAM OIDC identity provider for the Entra tenant. AWS does not get a separate IAM user per analyst. The analyst assumes one shared IAM role.
  - **What AWS sees by default:** only the STS event names the analyst, by Entra's pairwise `sub`. Every S3 call after it shows only the role and a session name that TIM chooses.
  - **With two Entra claims added:** Entra can emit a source identity claim and session tag claims. Then every S3 call carries an analyst identity that AWS records and TIM cannot change. S3 policies can also authorise per analyst (ABAC) on those values.
- **As the analyst (AWS, Identity Center):** a heavier second route also works. It uses IAM Identity Center trusted identity propagation with S3 Access Grants. AWS then sees the analyst as an Identity Center directory user, and grants can be per user or group. It needs Identity Center, users provisioned from Entra, an Access Grants instance, and TIM's own AWS role besides. It covers only what Access Grants governs.
- **As TIM (AWS):** `AssumeRoleWithWebIdentity` also works with TIM's own identity, with no secret. The token is either an Entra app-only token (TIM's existing workload-identity credential) or a second projected AKS service-account token.
- **Keys:** these work everywhere. They are the only option for R2: R2 has no OIDC or web-identity federation. Its temporary credentials are derived from a parent key that TIM would still hold.

**Recommendation for TIM:** an `s3` connection type with `auth: obo` (AWS and MinIO), `auth: workload_identity` (AWS and MinIO) and a keys mechanism whose fields name keys in the instance Secret (any S3-compatible store, the only option for R2). For `obo` on AWS, document the Entra claims mapping for source identity as the way to get per-analyst audit, and the `oaud` pin as required trust-policy hardening (section 2).

| Path | Stores | Who AWS sees on S3 calls | Per-analyst authorisation | Secret in TIM |
|---|---|---|---|---|
| A. OBO + `AssumeRoleWithWebIdentity` | AWS, MinIO | The role, plus source identity if Entra emits it | ABAC on session tags or source identity (AWS); a policy claim (MinIO) | None beyond the existing OBO credential |
| B. OBO + Identity Center + Access Grants | AWS | `onBehalfOf` an Identity Center user (on services that log it) | Access Grants per user or group | None beyond the OBO and workload credentials |
| C. Workload identity + `AssumeRoleWithWebIdentity` | AWS, MinIO | TIM's role | None (TIM is the only gate) | None |
| D. Access keys | AWS, MinIO, R2, any S3-compatible store | The key's IAM user or R2 token | None | Access key ID and secret per connection |

## 1. `AssumeRoleWithWebIdentity`: what AWS needs and does

### The call

- It is unsigned: "You do not need to use AWS security credentials to call AssumeRoleWithWebIdentity" ([STS: AssumeRoleWithWebIdentity](https://docs.aws.amazon.com/STS/latest/APIReference/API_AssumeRoleWithWebIdentity.html)). botocore builds the STS client with `signature_version=UNSIGNED` for it (`botocore/credentials.py`, `AssumeRoleWithWebIdentityCredentialFetcher`).
- `WebIdentityToken` is "the OAuth 2.0 access token or OpenID Connect ID token". It is at most 20000 characters and signed with RS256/384/512 or ES256/384/512 ([AssumeRoleWithWebIdentity](https://docs.aws.amazon.com/STS/latest/APIReference/API_AssumeRoleWithWebIdentity.html)). An Entra access token is acceptable.
- **`RoleSessionName`:** required, 2 to 64 characters of `[\w+=,.@-]`. The caller sets it freely.
- **`DurationSeconds`:** 900 up to the role's maximum session duration (1 to 12 hours). The default is 3600.
- **Policies:** inline or managed session policies are optional and can only narrow the role.
- **Response:** includes `SubjectFromWebIdentityToken` (the token's `sub`), `Audience`, `Provider` and `SourceIdentity` ([AssumeRoleWithWebIdentity](https://docs.aws.amazon.com/STS/latest/APIReference/API_AssumeRoleWithWebIdentity.html)).
- AWS warns that the `sub` is logged in CloudTrail. It recommends a GUID or pairwise identifier rather than personal data ([AssumeRoleWithWebIdentity](https://docs.aws.amazon.com/STS/latest/APIReference/API_AssumeRoleWithWebIdentity.html)). Entra's `sub` is pairwise per application, so it satisfies this ([access token claims](https://learn.microsoft.com/en-us/entra/identity-platform/access-token-claims-reference)).
- **SDK support:** botocore's `AssumeRoleWithWebIdentityCredentialFetcher` takes a `web_identity_token_loader` callable and refreshes credentials before they expire. TIM can pass a loader that returns an OBO or app-only token. The stock provider reads `AWS_WEB_IDENTITY_TOKEN_FILE`, `AWS_ROLE_ARN` and `AWS_ROLE_SESSION_NAME` (`botocore/credentials.py`).

### The IAM OIDC identity provider

- **Issuer URL:** it must be `https` and serve `/.well-known/openid-configuration` with a `jwks_uri`. The JWKS may hold at most 100 RSA keys. The provider lists 1 to 100 audiences (client IDs) ([IAM: create an OIDC provider](https://docs.aws.amazon.com/IAM/latest/UserGuide/id_roles_providers_create_oidc.html)).
- **Thumbprints:** AWS validates the IdP's certificate against its trusted root CA library. A thumbprint is only a fallback ([create an OIDC provider](https://docs.aws.amazon.com/IAM/latest/UserGuide/id_roles_providers_create_oidc.html)).
- **Entra's issuer:** both Entra issuers serve discovery. I checked this live: `https://login.microsoftonline.com/<tid>/v2.0/.well-known/openid-configuration` (JWKS `.../discovery/v2.0/keys`) and `https://sts.windows.net/<tid>/.well-known/openid-configuration` (JWKS `https://login.windows.net/common/discovery/keys`). Both advertise RS256 and `subject_types_supported: ["pairwise"]`.
  - *Inference, not tested:* AWS's prerequisites list `public` subject types. Entra advertises only `pairwise`. AWS's session-tags page names Entra as a supported IdP ([session tags](https://docs.aws.amazon.com/IAM/latest/UserGuide/id_session-tags.html)), so AWS probably accepts it, but a real test should confirm it.
- **Token version:** the resource app's `requestedAccessTokenVersion` chooses the issuer the token carries (`null` means v1) ([app manifest](https://learn.microsoft.com/en-us/entra/identity-platform/reference-microsoft-graph-app-manifest)). The IAM provider URL must match that issuer.

### Which audience AWS checks: `azp` before `aud`

- "If your OIDC identity provider is setting both aud and azp claims in the token, AWS STS will use the value in the azp claim as the aud claim" ([create an OIDC provider](https://docs.aws.amazon.com/IAM/latest/UserGuide/id_roles_providers_create_oidc.html)).
- The generic OIDC condition keys are ([IAM condition keys](https://docs.aws.amazon.com/IAM/latest/UserGuide/reference_policies_iam-condition-keys.html)):

  | Key | Claim |
  |---|---|
  | `<provider>:aud` | `azp` if present, else `aud` |
  | `<provider>:oaud` | `aud` (trust policy only) |
  | `<provider>:sub` | `sub` |
  | `<provider>:amr` | `amr` (multivalued) |
  | `<provider>:email` | `email` (trust policy only; not unique) |

- Entra v2 access tokens carry `azp`, the client that requested the token. Their `aud` is always the resource app's client ID. v1 tokens carry `appid` instead of `azp`, and their `aud` can be the resource URI ([access token claims](https://learn.microsoft.com/en-us/entra/identity-platform/access-token-claims-reference)).
- **Consequence for a v2 resource app:** in an OBO token for the AWS resource app, `azp` is TIM's app ID. So the IAM provider's audience list and `:aud` hold **TIM's** app ID, not the AWS resource app's.
  - TIM uses one app registration for the SPA and the API. So the analyst's own TIM sign-in token (`aud` and `azp` both TIM) would also pass an `:aud`-only check.
  - **The trust policy must also pin `<provider>:oaud` to the AWS resource app's ID.** *Inference, not tested.*
- *Inference, not tested:* with a v1 resource app there is no `azp`, so `:aud` is the resource app's `aud`. This avoids the trap, but the issuer becomes `sts.windows.net`.

## 2. Path A: the analyst, through OBO

### Flow

1. The analyst calls TIM with their TIM token, as today.
2. Before the run is created, TIM does OBO for `api://<aws-resource-app>/<scope>` with the shared MSAL app ([ADR-0009](../adr/0009-obo-token-exchange.md)). Consent errors come back on the `POST`, as for Kusto.
3. TIM calls `AssumeRoleWithWebIdentity(RoleArn, WebIdentityToken=<OBO token>, RoleSessionName=<analyst oid>, DurationSeconds=900..)`, then S3 with the returned credentials.

### Entra side

- **Register an "AWS resource" app**, single tenant. Under *Expose an API*, add a delegated scope (for example `s3.access`). TIM's app gets a delegated permission on it, with admin consent. This is the same pattern as the Snowflake resource app.
- **For per-analyst audit and ABAC, add claims through claims mapping** on that resource app ([claims customization](https://learn.microsoft.com/en-us/entra/identity-platform/jwt-claims-customization), [claims customization reference](https://learn.microsoft.com/en-us/entra/identity-platform/reference-claims-customization)):
  - `https://aws.amazon.com/source_identity`. `user.objectid` always fits AWS's character set (`[\w.,+=@-]`, 2 to 256 characters, not starting with `aws:`) ([monitor and control actions taken with assumed roles](https://docs.aws.amazon.com/IAM/latest/UserGuide/id_credentials_temp_control-access_monitor.html)). A UPN fits only when it has no other characters.
  - Session tags in AWS's flattened format: `https://aws.amazon.com/tags/principal_tags/<Key>` and `https://aws.amazon.com/tags/transitive_tag_keys`. AWS documents this format as "compatible with identity providers that don't support nested objects in JWT claims, such as Microsoft Entra ID". The limits are 50 tags, keys up to 128 characters and values up to 256 ([session tags](https://docs.aws.amazon.com/IAM/latest/UserGuide/id_session-tags.html)).
  - **Emitting mapped claims needs one of two settings, otherwise token issuance fails with AADSTS50146.** Either `acceptMappedClaims: true` on the resource app, or a custom signing key ([claims customization](https://learn.microsoft.com/en-us/entra/identity-platform/jwt-claims-customization)).
    - `acceptMappedClaims` works only for single-tenant apps, whose App ID URI is on a verified tenant domain. Otherwise Entra returns AADSTS501461.
    - A custom signing key requires validators to fetch keys from `openid-configuration?appid=<client-id>`. *Inference:* IAM's OIDC provider cannot add that query, so use `acceptMappedClaims`.

### AWS side

- **IAM OIDC provider** for the Entra issuer that matches the resource app's token version. Its audience is TIM's app ID for v2 (section 1).
- **One role** whose trust policy:
  - allows `sts:AssumeRoleWithWebIdentity` for that provider;
  - pins `:aud` (TIM's app ID) and `:oaud` (the AWS resource app's ID);
  - allows `sts:SetSourceIdentity` and `sts:TagSession` if Entra emits those claims. Once an IdP sends a source identity, every role trusting that IdP needs `sts:SetSourceIdentity` ([monitor and control](https://docs.aws.amazon.com/IAM/latest/UserGuide/id_credentials_temp_control-access_monitor.html), [session tags](https://docs.aws.amazon.com/IAM/latest/UserGuide/id_session-tags.html)).
- **Per-analyst authorisation:** the role's permissions and the bucket policies use `aws:PrincipalTag/<Key>` or `aws:SourceIdentity` conditions. For example, a prefix per team tag. This is ABAC on one role, not an IAM role per analyst ([session tags](https://docs.aws.amazon.com/IAM/latest/UserGuide/id_session-tags.html)).
- **Session length:** the role's maximum session duration must be at least what TIM requests (minimum 900 seconds).

### What AWS records

- **The STS event** ([CloudTrail userIdentity](https://docs.aws.amazon.com/awscloudtrail/latest/userguide/cloudtrail-event-reference-user-identity.html)):
  - `userIdentity.type` is `WebIdentityUser`;
  - `principalId` is `<provider>:<aud>:<sub>`, and `userName` is the `sub`;
  - `requestParameters` carry `roleSessionName`, `sourceIdentity` and `principalTags`.
- **Later S3 calls** show the assumed-role ARN with the session name ([CloudTrail userIdentity](https://docs.aws.amazon.com/awscloudtrail/latest/userguide/cloudtrail-event-reference-user-identity.html)).
  - **Without source identity:** the session name is the only per-analyst trace. TIM sets it, and nothing binds it to the token.
    - *Inference, not tested:* `sts:RoleSessionName` conditions accept single-valued keys as policy variables ([IAM condition keys](https://docs.aws.amazon.com/IAM/latest/UserGuide/reference_policies_iam-condition-keys.html)). Pinning it to `${<provider>:sub}` would bind it, but to the pairwise `sub` that only Entra can map back to a user.
  - **With source identity:** it is in `sessionContext.sourceIdentity` on every call, persists through role chaining, and cannot be changed ([monitor and control](https://docs.aws.amazon.com/IAM/latest/UserGuide/id_credentials_temp_control-access_monitor.html)).
- **S3 object reads are data events.** They are logged only if a trail or event data store enables S3 data events, which are billed separately ([logging data events](https://docs.aws.amazon.com/awscloudtrail/latest/userguide/logging-data-events-with-cloudtrail.html)).

### A consequence of the single app registration

*Inference, not tested:* TIM's SPA and API share one client ID. That client holds the consented delegated permission on the AWS resource app. So an analyst could get an AWS-resource token in their browser and call `AssumeRoleWithWebIdentity` directly, outside TIM. They would get the same role, tags and source identity TIM would get for them, so ABAC still applies. But TIM's action constraints would not. The same holds for Kusto and Snowflake today. A separate confidential API app registration would close it, which is outside this ticket's scope.

## 3. Path B: the analyst as an Identity Center user (trusted identity propagation)

### Flow

1. TIM, with its own AWS credentials (path C), calls `sso-oauth:CreateTokenWithIAM`. The call is SigV4-signed, uses grant type `urn:ietf:params:oauth:grant-type:jwt-bearer`, and passes the analyst's Entra token (after OBO, for an audience the application authorises) as `assertion`. It is made against a customer-managed Identity Center application ([CreateTokenWithIAM](https://docs.aws.amazon.com/singlesignon/latest/OIDCAPIReference/API_CreateTokenWithIAM.html), [apps with a trusted token issuer](https://docs.aws.amazon.com/singlesignon/latest/userguide/using-apps-with-trusted-token-issuer.html)).
2. TIM takes `sts:identity_context` from the returned ID token. It calls `sts:AssumeRole` with `ProvidedContexts` (`ProviderArn` `arn:aws:iam::aws:contextProvider/IdentityCenter`). The role trust needs `sts:SetContext` ([identity-enhanced role sessions](https://docs.aws.amazon.com/singlesignon/latest/userguide/trustedidentitypropagation-identity-enhanced-iam-role-sessions.html), [sts:SetContext](https://docs.aws.amazon.com/IAM/latest/UserGuide/id_credentials_temp_control-access_sts-setcontext.html)).
3. TIM calls S3 Control `GetDataAccess` (target, `READ`/`WRITE`/`READWRITE`, 900 to 43200 seconds). It gets credentials scoped to the matching grant and calls S3 with them. When both the role and the directory user have grants, the most restrictive applies ([GetDataAccess](https://docs.aws.amazon.com/AmazonS3/latest/API/API_control_GetDataAccess.html), [Access Grants credentials](https://docs.aws.amazon.com/AmazonS3/latest/userguide/access-grants-credentials.html), [directory identities](https://docs.aws.amazon.com/AmazonS3/latest/userguide/access-grants-directory-ids.html)).

### What it needs

- **Identity Center:** an instance, with Entra users provisioned (SCIM or manual) ([automatic provisioning](https://docs.aws.amazon.com/singlesignon/latest/userguide/provision-automatically.html)).
- **Trusted token issuer** for the Entra issuer ([TTI settings](https://docs.aws.amazon.com/singlesignon/latest/userguide/trusted-token-issuer-configuration-settings.html)):
  - an OIDC discovery URL and an RS256 JWT with `iss`, `sub`, `aud` and `exp`;
  - one claim mapped uniquely to an Identity Center user attribute (user name, email or external ID). AWS's own example maps Entra `preferred_username` to `userName` ([trusted identity propagation](https://docs.aws.amazon.com/singlesignon/latest/userguide/trustedidentitypropagation.html));
  - no Entra custom signing keys;
  - at most 10 per instance.
- **Customer-managed application** with three settings: a grant whose `AuthorizedAudiences` lists the token's audience; the access scope `s3:access_grants:read_write`; and an authentication method whose actor policy allows TIM's role ([apps with a trusted token issuer](https://docs.aws.amazon.com/singlesignon/latest/userguide/using-apps-with-trusted-token-issuer.html)).
- **S3 Access Grants instance:** associated with the Identity Center instance in the same Region, with grants to users or groups ([Access Grants instance](https://docs.aws.amazon.com/AmazonS3/latest/userguide/access-grants-instance.html)).

### What it gives and doesn't

- CloudTrail records `onBehalfOf` (`userId`, `identityStoreArn`) for identity-enhanced sessions. But "Not all AWS services log the onBehalfOf element" ([CloudTrail userIdentity](https://docs.aws.amazon.com/awscloudtrail/latest/userguide/cloudtrail-event-reference-user-identity.html)).
  - *Not verified:* I found no primary source confirming that S3 data events made with `GetDataAccess` credentials carry `onBehalfOf`.
- Services without user-based authorisation ignore the identity context. Plain bucket policies and IAM policies do not see the user; only Access Grants does ([identity-enhanced role sessions](https://docs.aws.amazon.com/singlesignon/latest/userguide/trustedidentitypropagation-identity-enhanced-iam-role-sessions.html)).
- It is five services' worth of configuration and three AWS calls per run. Path A with source identity gives a comparable audit trail for less. Path B is the option for an AWS account that already governs S3 through Identity Center and Access Grants.

## 4. Path C: TIM's own identity, without a secret

There are two token sources. Either way the IAM side is an OIDC provider plus a role whose trust pins `:sub`.

| Token source | Issuer in IAM | Audience | `sub` to pin | TIM-side change |
|---|---|---|---|---|
| Entra app-only token: TIM's existing client assertion (`AZURE_FEDERATED_TOKEN_FILE`), client-credentials grant for `api://<aws-resource-app>/.default` | Entra (same provider as path A) | as in section 1 | TIM's service principal object ID ([access token claims](https://learn.microsoft.com/en-us/entra/identity-platform/access-token-claims-reference)) | None in the chart |
| A second projected service-account token with audience `sts.amazonaws.com` | The AKS cluster's OIDC issuer (`{issuer}/.well-known/openid-configuration`, `{issuer}/openid/v1/jwks`) | `sts.amazonaws.com` | `system:serviceaccount:<namespace>:<sa>` | A second `serviceAccountToken` projected volume in the chart; re-read the file on each call, because Kubernetes rotates it ([AKS workload identity](https://learn.microsoft.com/en-us/azure/aks/workload-identity-overview)) |

- *Inference, not tested:* with the Entra token source, the path-A role and the path-C role trust the same provider and audience. Keep them apart by pinning `:sub` on the TIM role. On the analyst role, require the source identity or tag claims that only user tokens carry, or use a separate resource app.
- AWS sees TIM's role only. Per-analyst audit would be a `RoleSessionName` that TIM sets, which is advisory. This is the same trade-off as Snowflake's workload-identity fallback.

## 5. S3-compatible stores

### MinIO

- MinIO implements STS `AssumeRoleWithWebIdentity` against an OpenID provider configured by `config_url` (discovery) and `client_id` ([AIStor AssumeRoleWithWebIdentity](https://docs.min.io/enterprise/aistor-object-store/developers/security-token-service/assumerolewithwebidentity/), `minio/minio` `docs/sts/web-identity.md`).
- **Audience check:** the token's `aud` must contain `client_id`, or else its `azp` must (`internal/config/identity/openid/jwt.go`, `Validate`). With an Entra v2 OBO token, `client_id` is the MinIO resource app's ID.
- **Policy:** set one of two, never both.
  - `role_policy`: every user of that provider gets the same policies. TIM passes the `RoleArn` the server prints.
  - `claim_name` (default `policy`): policy names come from a token claim. *Inference, not tested:* Entra app roles in the `roles` claim would give per-analyst policies.
  - Sources: [OIDC access management](https://docs.min.io/community/minio-object-store/administration/identity-access-management/oidc-access-management.html), `docs/sts/web-identity.md`.
- **Session length:** `DurationSeconds` runs from 900 seconds to 365 days ([AIStor AssumeRoleWithWebIdentity](https://docs.min.io/enterprise/aistor-object-store/developers/security-token-service/assumerolewithwebidentity/)).
- The STS endpoint is the MinIO endpoint itself, so `obo` and `workload_identity` both work.
- *Not verified:* whether MinIO's docs' "id_token" wording excludes access tokens. The validation code checks the signature, `exp`, and `aud`/`azp`, and nothing ID-token specific.
- **The open-source repository is archived.** `minio/minio`'s README says "THIS REPOSITORY IS NO LONGER MAINTAINED" and points to AIStor. Current docs are AIStor's.

### Cloudflare R2

- The S3 API authenticates with R2 API tokens. The access key ID is the token ID, and the secret is the SHA-256 of the token value ([R2 S3 tokens](https://developers.cloudflare.com/r2/api/s3/tokens/), [R2 API tokens](https://developers.cloudflare.com/r2/api/tokens/)).
- **Token scope:** account or user tokens, with Admin or Object, read-write or read-only permissions, scoped to buckets.
- **Endpoint:** `https://<ACCOUNT_ID>.r2.cloudflarestorage.com`, plus jurisdiction endpoints.
- **Temporary credentials** come from a parent token. They are created through the Temporary Credentials API, or locally: TIM signs an HS256 JWT with the parent secret, the temporary secret is the SHA-256 of that JWT, and the parent access key ID is reused. They can be scoped by `permission`, `prefixes`, `objects` and `ttlSeconds` ([R2 temporary credentials](https://developers.cloudflare.com/r2/api/s3/temporary-credentials/)).
- **No federation:** none of these pages mention OIDC, web identity or federation. R2 is keys only, and the parent key is a secret TIM holds.

## Implications for other tickets

- **Connection type `s3`.** Proposed fields (none of them a secret, per [ADR-0018](../adr/0018-fixed-connections.md)):

  | Field | Description |
  |---|---|
  | `endpoint` | Optional for AWS; required for MinIO and R2. Validated like the Kusto `cluster`: `https`, no credentials, path, query or fragment. |
  | `region` | Required for AWS; R2 uses `auto`. |
  | `bucket` | The bucket, optionally with a `prefix`. A restriction, not just a suggestion. |
  | `auth` | `obo`, `workload_identity`, or a keys mechanism. |
  | `role_arn` | For `obo` and `workload_identity` on AWS, and for MinIO's role-policy mode. |
  | `scope` | For `obo`, with no default (like Snowflake). |
  | Secret key names | For keys only: the keys in the instance Secret that hold the access key ID and secret. |

- **Secrets.**
  - `obo` and `workload_identity` add none. They reuse the OBO credential TIM already has: the client secret or `AZURE_FEDERATED_TOKEN_FILE`.
  - Keys add two Secret keys per connection. Startup fails when a named key is missing.
  - The AKS-token variant of `workload_identity` needs a chart change instead (a second projected token).
- **Error timing.** OBO runs before the run is created, as today. The STS call needs only the OBO token, so it can also run before the run and return `AccessDenied` on the `POST`. *Inference:* map it like a consent failure (403), not a 502.
- **Credentials are per analyst and per run.** Never cache STS credentials across analysts. botocore's refreshing fetcher can be used per run with a token loader that calls MSAL.
- **Docs for instance admins** need the AWS trust-policy template: pin both `:aud` and `:oaud`, add `sts:SetSourceIdentity`/`sts:TagSession`, and enable S3 data events for object-level audit. They also need the Entra claims-mapping steps.
- **Untested points to check with a real account first:**
  - AWS accepts Entra's `pairwise`-only discovery;
  - the `:oaud` pin rejects the analyst's TIM sign-in token;
  - claims mapping emits the source identity claim into an OBO token.
