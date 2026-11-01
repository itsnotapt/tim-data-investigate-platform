---
status: accepted
date: 2026-10-06
---

# Development-only modes refuse to run in production

Local work and tests need to run without Entra, Postgres or a Kusto cluster, but those shortcuts must never reach a deployment, where they would drop authentication or lose data on restart. `TIM_ENVIRONMENT` is `development` or `production` and **defaults to `production`**, and the app fails at startup if a shortcut is enabled in production. Settings validation (`api/src/tim_api/config.py`) checks the settings; the registry build (`api/src/tim_api/actions/registry.py`) checks the connections file.

| Mode | Setting | Effect | In production |
|---|---|---|---|
| In-memory storage | `TIM_DATABASE_URL=memory://` | Data lives in the process and is lost on restart | Refuses to start |
| Auth bypass | `TIM_AUTH_DISABLED=true` | Every request runs as the user named by the stub token (`dev:<upn>`), or a fixed dev user without one. OBO is unavailable (503). A warning is logged at startup | Refuses to start |
| Stub sign-in in the web container | `STUB_SIGN_IN=true` | Shows a "Who are you?" screen instead of Entra sign-in. The browser sends the stub token (`dev:<upn>`) for the name chosen. The Entra variables are not required | The entrypoint exits |
| Development actions | `TIM_DEV_ACTIONS=true` | Registers `tim.dev_json`, `tim.dev_run_kql`, the `dev_rows` and `dev_sink` action types and the `dev_kql` connection type. A warning is logged at startup | Refuses to start |
| Kusto without a token | `auth: none` on a `kusto` connection in the connections file | Queries go to the cluster without a token, and its `cluster` may be `http`. | Refuses to start |

The auth bypass is also re-checked when each request is authenticated (`api/src/tim_api/auth/dependencies.py`).

Decided by the user. Related: [0004](0004-postgresql-persistence.md), [0005](0005-auth-entra-popup-obo.md), [0026](0026-a-demo-instance-needs-no-accounts.md), [configuration](../configuration.md).

## Considered Options

| Option | Pros | Cons |
|---|---|---|
| Default to `development` | Easier to run locally | A forgotten variable in a deployment would quietly turn off auth |
| Log a warning only | Never blocks | Easy to miss. The failure is silent |
| Separate dev build | No dev code in the production image | Two builds to maintain, and tests would not cover the real code. Also rejected for development actions: a dev-only package |

## Consequences

- A deployment must set the real variables. A missing or wrong one stops startup instead of weakening it.
- Tests and local runs set `TIM_ENVIRONMENT=development` explicitly.
