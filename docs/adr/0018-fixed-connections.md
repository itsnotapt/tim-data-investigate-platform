---
status: accepted
date: 2026-10-20
---

# Fixed connections

Analysts used to type any Kusto cluster, checked against an allow-list, and actions now reach Snowflake too. A connection is one fixed endpoint, configured by the operator in an optional connections file with an explicit auth mechanism. Actions run as the analyst wherever the connection type allows it.

- **Connections file.** `TIM_CONNECTIONS_FILE`, YAML, validated at startup by a `Connection` model per connection type. Each entry has `name`, `title`, `type`, `auth` and the type's own fields (Kusto `cluster`, `databases`; Snowflake `account`, `warehouse`, `role`). No secrets: a future mechanism that needs one names a key in the instance Secret.
- **Auth, named by whose identity the system behind the connection sees.**
  - `obo`: TIM's one MSAL client ([0009](0009-obo-token-exchange.md)) exchanges the analyst's token for the connection's `scope`. Kusto defaults to `{cluster}/.default`. Snowflake uses External OAuth with its own app registration (`session:role-any`).
  - `workload_identity`: runs as TIM. It's the Snowflake fallback where External OAuth isn't set up.

  Each connection type declares the mechanisms it supports.
- **Tokens.** Hooks call `token_for(scope)`; they never see the analyst's raw token. TIM gets each `obo` token before a run exists, so consent and MFA errors come back on the `POST`.
- **Actions declare their connections.** That covers fixed connection fields and `kind="connection"` params. `ctx.hook()` refuses any other connection.
- **No gating.** Every analyst sees every connection, and the system behind the connection enforces access. A `workload_identity` connection gives every analyst TIM's access, which is the operator's explicit choice.
- **The browser** sees a connection's name, title, type, editor and `databases`, never its URL or auth.
- **URL checks.** The Kusto `Connection` model keeps the URL shape checks and normalisation of the old allow-list, run at startup.

Decided by the user. Related: [0005](0005-auth-entra-popup-obo.md), [0009](0009-obo-token-exchange.md), [0017](0017-actions-from-providers.md), [configuration](../configuration.md), [deployment](../deployment.md).

## Considered Options

| Option | Pros | Cons |
|---|---|---|
| Free-text clusters with an allow-list | Analysts reach any cluster | Pattern lists are hard to get right; presets, files and share links can't name an endpoint stably; Snowflake has no equivalent |
| Connections in the action files | One file | Connections are operator config, action files are author content |
| Snowflake via a service user only | Simple | Loses per-analyst roles, row access policies, Snowflake audit and Conditional Access revocation |
| Secrets in the connections file | Self-contained | Secrets in a ConfigMap |
| Gating connections by Entra app roles | Restricted sources | Annotations are instance-wide anyway; deferred to a later effort |

## Consequences

- Adding a cluster or account is a config change and a restart.
- One Snowflake login per run; connections can't be pooled across analysts.
- An instance with only `workload_identity` connections needs no OBO credential.
