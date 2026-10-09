# TIM documentation

TIM is a Kusto investigation platform: analysts run KQL, pivot between data sources with shared query templates, and tag and comment on events. It consists of a React single-page app (`web/`) and a FastAPI service (`api/`) backed by PostgreSQL.

**Contributors and agents: read [CODING_STANDARDS.md](../CODING_STANDARDS.md) before writing or reviewing code, and [RULES.md](RULES.md) for git and PR flow.**

| Document | Contents |
|---|---|
| [CODING_STANDARDS.md](../CODING_STANDARDS.md) | Coding rules a reviewer judges: docs, security, frontend, backend, tests |
| [RULES.md](RULES.md) | Process: sources of truth, when to ask the user, git, PRs and releases |
| [GLOSSARY.md](../GLOSSARY.md) | Domain vocabulary: investigations, tabs, query templates, pivots, query runs, tagging |
| [architecture.md](architecture.md) | Parts of the system, data flow, web and api internals, persistence, security model, Kusto tables |
| [api.md](api.md) | HTTP API reference: endpoints, schemas, errors |
| [development.md](development.md) | Local setup, running the stack, tests, linting, migrations, CI |
| [configuration.md](configuration.md) | Environment variables for api, web and the local stack, incl. the AG Grid licence key |
| [deployment.md](deployment.md) | Production deployment |
| [operations.md](operations.md) | Runbook: health checks, logs, common tasks and failures |
| [agents/](agents/issue-tracker.md) | Issue tracking, triage labels and domain-doc conventions: [issue tracker](agents/issue-tracker.md), [triage labels](agents/triage-labels.md), [domain docs](agents/domain.md) |
| [adr/](adr/README.md) | Architecture decision records: decisions that are hard to reverse, surprising without context and the result of a real trade-off |
