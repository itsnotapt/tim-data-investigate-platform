# TIM

TIM is a Kusto investigation platform: `web/` (React, TypeScript) and `api/` (Python, FastAPI) backed by PostgreSQL.

- [CODING_STANDARDS.md](CODING_STANDARDS.md): read before writing or reviewing code.
- [docs/RULES.md](docs/RULES.md): sources of truth, git and PR flow.
- [docs/README.md](docs/README.md): documentation index.

## Agent skills

### Issue tracker

Issues and specs live in GitHub Issues for `itsnotapt/tim-data-investigate-platform`, managed with the `gh` CLI; larger work is planned as a map issue with child tickets. See [docs/agents/issue-tracker.md](docs/agents/issue-tracker.md).

### Triage labels

The triage labels and their transitions are in [docs/agents/triage-labels.md](docs/agents/triage-labels.md).

### Domain docs

Single context: domain terms are defined only in [GLOSSARY.md](GLOSSARY.md), decisions in [docs/adr/](docs/adr/README.md). See [docs/agents/domain.md](docs/agents/domain.md).
