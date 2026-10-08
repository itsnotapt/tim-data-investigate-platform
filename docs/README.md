# TIM documentation

TIM is a Kusto investigation platform: analysts run KQL, pivot between data sources with shared query templates, and tag and comment on events. It consists of a React single-page app (`web/`) and a FastAPI service (`api/`) backed by PostgreSQL.

**Contributors and agents: read [RULES.md](RULES.md) first.**

| Document | Contents |
|---|---|
| [RULES.md](RULES.md) | How to work on the repo: sources of truth, docs, engineering, tests, git |
| [architecture.md](architecture.md) | Components, data flow, web and api internals, persistence, security model, glossary |
| [api.md](api.md) | HTTP API reference: endpoints, schemas, errors |
| [development.md](development.md) | Local setup, running the stack, tests, linting, migrations, CI |
| [configuration.md](configuration.md) | Environment variables for api, web and the local stack, incl. the AG Grid licence key |
| [deployment.md](deployment.md) | Production deployment |
| [operations.md](operations.md) | Runbook: health checks, logs, common tasks and failures |
| [decisions/](decisions/README.md) | Architecture decision records (the place for rationale and history) |
