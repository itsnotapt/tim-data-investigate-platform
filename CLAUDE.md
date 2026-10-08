# TIM

TIM is a Kusto investigation platform: `web/` (React, TypeScript) and `api/` (Python, FastAPI) backed by PostgreSQL.

**Before doing anything, read [docs/RULES.md](docs/RULES.md).** The [documentation index](docs/README.md) lists everything else.

Key rules (details in RULES.md):
- Frontend code goes in `web/`, backend code in `api/`. See [docs/architecture.md](docs/architecture.md).
- Update docs in the same change as the code. Docs and comments describe the current code only; rationale and history go in an ADR in `docs/adr/`.
- Every change ships with tests; lint, type checks and tests must pass ([docs/development.md](docs/development.md)).
- Commit only when asked. Never commit to `main` or `development` directly: branch off `development` as `feat/…`, `fix/…`, `docs/…`, `chore/…` or `refactor/…`; use Conventional Commits.
- PRs into `development` are squash-merged, so the PR title is the release commit; `main` takes only merge commits from `development` and release-please ([RULES.md §6–7](docs/RULES.md#6-git)).

## Agent skills

### Issue tracker

Issues live in GitHub Issues for `itsnotapt/tim-data-investigate-platform`, managed with the `gh` CLI. See [docs/agents/issue-tracker.md](docs/agents/issue-tracker.md).

### Triage labels

The default labels: `needs-triage`, `needs-info`, `ready-for-agent`, `ready-for-human`, `wontfix`. See [docs/agents/triage-labels.md](docs/agents/triage-labels.md).

### Domain docs

Single-context: the domain vocabulary in [GLOSSARY.md](GLOSSARY.md) and the ADRs in [docs/adr/](docs/adr/README.md). See [docs/agents/domain.md](docs/agents/domain.md).
