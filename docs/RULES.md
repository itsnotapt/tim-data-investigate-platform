# Working rules

Process rules for everyone working on TIM, human or agent. Code rules are in [CODING_STANDARDS.md](../CODING_STANDARDS.md); the [documentation index](README.md) lists everything else.

## 1. Code layout

`web/` holds the React app and `api/` the FastAPI service. [architecture.md](architecture.md) describes the layout and how the parts fit together.

## 2. Sources of truth

1. The code. If a doc disagrees with the code, the code wins; fix the doc in the same change.
2. ADRs in [`docs/adr/`](adr/README.md) with status `accepted`; [adr/README.md](adr/README.md) describes the format. Changing something an ADR decided needs a new ADR that supersedes it.

Ask the user before implementing a choice that is hard to reverse: datastore, auth model, licensing, a breaking API change, dropping a feature. Record the outcome in an ADR when it passes the tests in [adr/README.md](adr/README.md#adding-an-adr).

## 3. Documentation

Documentation rules are in [CODING_STANDARDS.md](../CODING_STANDARDS.md#documentation). [agents/domain.md](agents/domain.md#updating-glossarymd) says how to update the glossary.

## 4. Engineering

Code rules are in [CODING_STANDARDS.md](../CODING_STANDARDS.md); [development.md](development.md) has the commands that run lint, type checks and tests.

## 5. Tests

Test rules are in [CODING_STANDARDS.md](../CODING_STANDARDS.md#tests). Do not merge with failing or skipped tests unless the user agrees.

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

See [development.md](development.md#ci-and-releases) and [ADR-0016](adr/0016-release-versions.md).
