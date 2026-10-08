---
status: accepted
date: 2026-10-06
---

# Development-only modes refuse to run in production

Local work and tests need to run without Entra, Postgres or a Kusto cluster, but those shortcuts must never reach a deployment, where they would drop authentication or lose data on restart. `TIM_ENVIRONMENT` is `development` or `production` and **defaults to `production`**, and settings validation (`api/src/tim_api/config.py`) makes the app fail at startup if a shortcut is enabled in production.

| Mode | Setting | Effect | In production |
|---|---|---|---|
| In-memory storage | `TIM_DATABASE_URL=memory://` | Data lives in the process and is lost on restart | Refuses to start |
| Auth bypass | `TIM_AUTH_DISABLED=true` | Every request runs as a fixed dev user. OBO is unavailable (503). A warning is logged at startup | Refuses to start |
| Fake tag ingest | `TIM_TAG_INGEST_FAKE=true` | Tag writes are recorded in memory, not sent to Kusto | Flag is ignored and the real client is used |

The auth bypass is also re-checked when each request is authenticated (`api/src/tim_api/auth/dependencies.py`).

Decided by the user. Related: [0004](0004-postgresql-persistence.md), [0005](0005-auth-entra-popup-obo.md), [configuration](../configuration.md).

## Considered Options

| Option | Pros | Cons |
|---|---|---|
| Default to `development` | Easier to run locally | A forgotten variable in a deployment would quietly turn off auth |
| Log a warning only | Never blocks | Easy to miss. The failure is silent |
| Separate dev build | No dev code in the production image | Two builds to maintain, and tests would not cover the real code |

## Consequences

- A deployment must set the real variables. A missing or wrong one stops startup instead of weakening it.
- Tests and local runs set `TIM_ENVIRONMENT=development` explicitly.
