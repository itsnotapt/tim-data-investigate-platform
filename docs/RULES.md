# Working rules

These rules apply to everyone working on TIM, human or agent. Read this file before making a change, then use the [documentation index](README.md) to find what you need.

## 1. Code layout

| Path | Contents |
|---|---|
| `web/` | React single-page app (TypeScript, Vite) |
| `api/` | FastAPI service (Python 3.12, uv) |
| `deploy/` | Deployment assets (see [deployment.md](deployment.md)) |
| `docs/` | Project documentation and architecture decision records |

New features go in `web/` or `api/`; see [architecture.md](architecture.md) for how they fit together.

## 2. Sources of truth

1. The code. If a doc disagrees with the code, the code wins; fix the doc in the same change.
2. Accepted ADRs in [`docs/decisions/`](decisions/README.md). Changing something an ADR decided needs a new ADR that supersedes it.
3. The docs in `docs/`.

When a change involves a choice that is expensive to reverse (datastore, auth model, licensing, breaking API change, dropping a feature), ask the user before implementing it and record the outcome in an ADR.

## 3. Documentation

- **Update docs in the same change as the code.** A change isn't done until the docs describe the new behaviour (configuration, commands, endpoints, architecture).
- Docs and code comments describe the system **as it is now**. No history ("previously", "used to", "was changed to"), no task or ticket IDs, no justification essays.
- Rationale and history belong in an ADR in [`docs/decisions/`](decisions/README.md):
  1. Copy [`0000-template.md`](decisions/0000-template.md) to `NNNN-short-title.md` using the next free number. Numbers are never reused or renumbered.
  2. Fill in context, decision, alternatives and consequences. Set the status to **Proposed**, or **Accepted** once the user agrees.
  3. Add a row to the table in [`decisions/README.md`](decisions/README.md).
  4. If it replaces an earlier ADR, set the old one to **Superseded by NNNN**. Don't delete ADRs.
- A code comment may link to an ADR (`# See docs/decisions/0004-postgresql-persistence.md`) where the code would otherwise look surprising.
- Configuration changes are documented in [configuration.md](configuration.md); deployment changes in [deployment.md](deployment.md).
- Dates are `YYYY-MM-DD`.

## 4. Engineering

**General**
- No secrets in the repo. Configuration comes from environment variables.
- The user identity is always taken from the access token, never from the request body.

**Web (`web/`)**
- TypeScript in strict mode, function components and hooks.
- All API calls go through the typed client in `web/src/lib/api/`; all auth goes through the auth module. When the API changes, regenerate the types (`npm run gen:api`).
- The grid is AG Grid Enterprise; there is no Community build (see [ADR-0006](decisions/0006-ag-grid-enterprise.md)).
- `npm run lint`, `npm run format:check`, `npm run typecheck` and `npm test` must pass.

**API (`api/`)**
- Type hints everywhere; `ruff check`, `ruff format --check` and `mypy` must be clean.
- Database schema changes go through an Alembic migration in `api/migrations/`.
- Kusto and Entra ID are accessed through interfaces so tests can replace them.

See [development.md](development.md) for the exact commands.

## 5. Tests

- Every change ships with tests. Bug fixes include a test that fails without the fix.
- API: every endpoint has at least a happy-path test and a test for its main error case (pytest).
- Web: unit/component tests (Vitest + Testing Library) for logic-heavy code; Playwright e2e tests for user flows.
- Don't merge with failing or skipped tests unless the user agrees.

## 6. Git

- Commit, push or open a PR only when the user asks.
- Never commit directly to `main`. Use a short-lived branch named by type: `feat/<short-name>`, `fix/<short-name>`, `docs/<short-name>`, `chore/<short-name>`, `refactor/<short-name>`.
- Use [Conventional Commits](https://www.conventionalcommits.org/) (`feat:`, `fix:`, `docs:`, `chore:`, `refactor:`, `test:`, optionally scoped, e.g. `feat(web): …`). Release notes and versions are generated from them by release-please.
