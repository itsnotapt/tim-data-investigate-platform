# TIM

TIM is a Kusto investigation platform: `web/` (React, TypeScript) and `api/` (Python, FastAPI) backed by PostgreSQL.

**Before doing anything, read [docs/RULES.md](docs/RULES.md).** The [documentation index](docs/README.md) lists everything else.

Key rules (details in RULES.md):
- Frontend code goes in `web/`, backend code in `api/`. See [docs/architecture.md](docs/architecture.md).
- Update docs in the same change as the code. Docs and comments describe the current code only; rationale and history go in an ADR in `docs/decisions/`.
- Every change ships with tests; lint, type checks and tests must pass ([docs/development.md](docs/development.md)).
- Commit only when asked, never on `main`; branch as `feat/…`, `fix/…`, `docs/…` or `chore/…`; use Conventional Commits.
