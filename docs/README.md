# TIM documentation

TIM is an investigation platform: analysts run actions against an instance's connections (Kusto, Snowflake), pivot from result rows into other actions, and annotate rows by `id`. It consists of a React single-page app (`web/`) and a FastAPI service (`api/`) backed by PostgreSQL.

**Contributors and agents: read [CODING_STANDARDS.md](../CODING_STANDARDS.md) before writing or reviewing code, and [RULES.md](RULES.md) for git and PR flow.**

| Document | Contents |
|---|---|
| [CODING_STANDARDS.md](../CODING_STANDARDS.md) | Coding rules a reviewer judges: docs, security, frontend, backend, tests |
| [RULES.md](RULES.md) | Process: sources of truth, when to ask the user, git, PRs and releases |
| [GLOSSARY.md](../GLOSSARY.md) | Domain vocabulary: investigations, tabs, actions, pivots, runs, annotations, tagging |
| [architecture.md](architecture.md) | Parts of the system, data flow, web and api internals, annotations and the change feed, persistence, security model, Kusto tables |
| [api.md](api.md) | HTTP API reference: endpoints, schemas, errors |
| [actions.md](actions.md) | For operators and action authors: action files, their schema and `tim-api check` |
| [development.md](development.md) | Local setup, running the stack, tests, linting, migrations, CI |
| [configuration.md](configuration.md) | Environment variables for api, web and the local stack, incl. the AG Grid licence key |
| [deployment.md](deployment.md) | Production deployment |
| [operations.md](operations.md) | Runbook: health checks, logs, common tasks and failures |
| [agents/](agents/issue-tracker.md) | Issue tracking, triage labels, domain-doc conventions and subagents: [issue tracker](agents/issue-tracker.md), [triage labels](agents/triage-labels.md), [domain docs](agents/domain.md), [subagents](agents/subagents.md) |
| [adr/](adr/README.md) | Architecture decision records: decisions that are hard to reverse, surprising without context and the result of a real trade-off |
