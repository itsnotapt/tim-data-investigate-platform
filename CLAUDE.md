# TIM

TIM is a Kusto investigation platform: `web/` (React, TypeScript) and `api/` (Python, FastAPI) backed by PostgreSQL.

**Before doing anything, read [docs/RULES.md](docs/RULES.md).** The [documentation index](docs/README.md) lists everything else.

Key rules (details in RULES.md):
- Frontend code goes in `web/`, backend code in `api/`. See [docs/architecture.md](docs/architecture.md).
- Update docs in the same change as the code. Docs and comments describe the current code only; rationale and history go in an ADR in `docs/decisions/`.
- Every change ships with tests; lint, type checks and tests must pass ([docs/development.md](docs/development.md)).
- Commit only when asked. Never commit to `main` or `development` directly: branch off `development` as `feat/…`, `fix/…`, `docs/…`, `chore/…` or `refactor/…`; use Conventional Commits.
- PRs into `development` are squash-merged, so the PR title is the release commit; `main` takes only merge commits from `development` and release-please ([RULES.md §6–7](docs/RULES.md#6-git)).
