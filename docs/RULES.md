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
- Never commit directly to `development` or `main`. Branch off `development` with a short-lived branch named by type: `feat/<short-name>`, `fix/<short-name>`, `docs/<short-name>`, `chore/<short-name>`, `refactor/<short-name>`. Bots use `dependabot/` and `release-please--` branches.
- Use [Conventional Commits](https://www.conventionalcommits.org/) (`feat:`, `fix:`, `docs:`, `chore:`, `refactor:`, `test:`, optionally scoped, e.g. `feat(web): …`). Release notes and versions are generated from them by release-please.

**Branches and merge methods** (enforced by rulesets and `pr-conventions.yml`):

| Branch | Role | PRs come from | Merge method |
|---|---|---|---|
| `development` | Default and integration branch | `feat/`, `fix/`, `docs/`, `chore/`, `refactor/`, `dependabot/` branches | **Squash**. The PR title becomes the commit subject and the commit body is blank. |
| `development` | | `main` (the back-sync) | **Merge commit**. Merge commits on `development` are only for the back-sync. |
| `main` | Release branch; release-please runs on it | `development` and `release-please--*` | **Merge commit**, so release-please sees each squashed commit. |

- The PR title into `development` is the commit release-please reads: its type and `!` apply to every package whose files the PR changes. Leave the squash commit body empty; a `BREAKING CHANGE:` or `Release-As:` footer typed into it is applied to every package the PR touches, and `pr-conventions` does not see it, so mark a breaking change with `!` in the title.
- A merge commit's message is `Merge pull request #N from …` followed by the PR title, and release-please reads any paragraph that starts with `type:` or `type(scope):` as a commit with every file of the merge. So the title of a PR merged with a merge commit (`development` → `main`, the back-sync) must not start that way: use e.g. `Release: web export and api fixes`. Do not edit the merge commit message.
- **Releasing:** open a `development` → `main` PR and read the `release-projection` comment `pr-conventions.yml` posts on it (the versions release-please would propose); then merge `development` into `main`, then merge each release PR release-please opens (after a frontend or backend release it opens a chart patch release PR as well). When no release PR is open, `release-please.yml` merges `main` back into `development` with a merge commit (the back-sync).
- **Release freeze:** from the `development` → `main` merge until the back-sync, nothing else is merged into `development`; `pr-conventions` fails while `main` has commits `development` lacks or a release PR is open. release-please reads history newest first by commit date and stops at the last release, so a commit merged into `development` while a release is pending would never be released. Re-run the check after the back-sync.

## 7. Releases

- Three release-please packages: `web/` is `frontend` (tags `frontend-vX.Y.Z`), `api/` is `backend` (`backend-vX.Y.Z`) and `deploy/helm/tim` is `chart` (`chart-vX.Y.Z`). There is no root package.
- The files a commit touches decide which packages it bumps; the Conventional Commit scope does not select packages (except in a breaking title, below). Files only under `web/e2e`, `api/tests` or `deploy/helm/tim/ci` release nothing.
- A breaking commit (`!` or a `BREAKING CHANGE:` footer) bumps the major of every package whose files it touches. A PR into `development` is one commit, so a `!` title majors every package the PR changes: keep breaking changes in their own PR, out of `web/` and `api/` unless that package should go major. The scope of a breaking title must name every package whose files the PR changes: `frontend` (`web/`), `backend` (`api/`), `chart` (`deploy/helm/tim`), comma-separated without spaces, e.g. `feat(backend,chart)!: …`. A breaking title without a scope fails when the PR touches any package; extra scope entries are allowed. `pr-conventions.yml` checks this. The scope in non-breaking titles is free-form and unchecked.
- `Release-As: X.Y.Z` must be on a commit that touches that package's files; empty commits are ignored. To force a version, add the footer in the squash-merge dialog of a PR that changes only that package.
- Never edit versions by hand; release-please owns them.

See [development.md](development.md#ci-and-releases) and [ADR-0016](decisions/0016-release-versions.md).
