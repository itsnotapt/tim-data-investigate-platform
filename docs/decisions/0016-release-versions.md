# 0016. Release versions for frontend, backend and the Helm chart

- **Status:** Accepted
- **Date:** 2026-10-07
- **Deciders:** the user
- **Related:** [0003](0003-repo-layout.md), [0008](0008-helm-chart.md), [deployment.md](../deployment.md), [development.md](../development.md)

## Context
release-please owns all versioning. Before the rewrite, `main` had three release-please packages: `frontend` (1.5.6, tags `frontend-vX.Y.Z`), `backend` (3.0.4, tags `backend-vX.Y.Z`) and a repo-root `core` (3.0.7, tags `core-vX.Y.Z`, root `CHANGELOG.md`). It published the images `ghcr.io/itsnotapt/tim-data-investigate-platform/frontend`, `/frontend-enterprise` and `/backend`. The legacy combined chart (`helm/tim`, 0.0.2) was never published.

The rewrite replaces `frontend/` with `web/` and `backend/` with `api/`. Most changes are in the frontend and are usually not breaking; the backend changes rarely. The Helm chart (`deploy/helm/tim`) is the deployable unit: it decides which frontend works with which backend, so each chart version pins one frontend image tag and one backend image tag.

Constraints found in release-please 17.6.0 (bundled with `googleapis/release-please-action@v5`) and 17.11.2 (the latest release), checked by running its release-PR logic against a scratch clone of the repository:
- A package is bumped only by commits under its own path, or by the `linked-versions` plugin (equal versions) or a workspace plugin (node, cargo or maven dependencies). There is no option to bump the chart because another package released.
- The `yaml` extra-files updater re-serialises the whole file, dropping comments. The generic `x-release-please-version` marker is not per component, so two packages cannot each update their own line of `values.yaml`.
- The helm updater sets only `Chart.yaml` `version`; `appVersion` needs the generic marker.
- Every paragraph of a commit message that starts with a Conventional Commit type (`feat: …`) is read as a separate commit with the files of the whole commit, including the body of a GitHub merge commit (`Merge pull request #N from …`, then the PR title by default).
- Commits are read newest first in GitHub's history order, which is by commit date (as `git log`), and each package stops at the commit of its last release. On a branch that receives merge commits, a commit older than the last release commit is never released, even if it reaches the branch later.
- A commit that touches no files is applied to every package, except packages with `exclude-paths`: those skip it. The pushed empty commit `chore: release 4.0.0` (footer `Release-As: 4.0.0`) would otherwise force every package to 4.0.0.

## Decision
- **Three independent packages, no linked group.**
  | Path | `package-name` (tags) | `release-type` | Continues |
  |---|---|---|---|
  | `web` | `frontend` (`frontend-vX.Y.Z`) | node | legacy `frontend` 1.5.6 |
  | `api` | `backend` (`backend-vX.Y.Z`) | python | legacy `backend` 3.0.4 |
  | `deploy/helm/tim` | `chart` (`chart-vX.Y.Z`) | helm | new line, first release 1.0.0 |

  `web/CHANGELOG.md` and `api/CHANGELOG.md` start with the legacy `frontend/CHANGELOG.md` and `backend/CHANGELOG.md`, and release-please prepends to them.
- **No `core` package.** The repo-root package is removed. The root `CHANGELOG.md` is deleted; its history stays in git and in the `core-vX.Y.Z` GitHub releases. Root-only commits release nothing.
- **Images keep the legacy names.** `ghcr.io/itsnotapt/tim-data-investigate-platform/frontend` and `/backend`, tagged `X.Y.Z`, `X.Y`, `X` (no `v`) and `sha-<sha>` from release-please's `<path>--version` output. There is no `-enterprise` image: the app is enterprise-only ([0006](0006-ag-grid-enterprise.md)).
- **Pinned image tags.** `deploy/helm/tim/image-tags.yaml` holds `frontend: X.Y.Z` and `backend: X.Y.Z`. The `web` and `api` packages each update their own key through a `yaml` `extra-files` entry; the file has no comments because that updater rewrites it. The templates read it with `.Files.Get`: an empty `web.image.tag` / `api.image.tag` uses the pinned version, an explicit `tag` overrides it and `digest` wins over both. `api/uv.lock` is still updated through its `toml` `extra-files` entry.
- **The chart gets a patch release in the next release PR after a component release.** The chart package lists `chore` in its `changelog-sections` ("Image updates and chores"). A release PR that releases only components is merged as `chore: release main` and changes `image-tags.yaml`, so the next release-please run sees a `chore` commit under the chart and opens a chart patch release. The chart bump stays a patch whatever the component's bump was. When the same release PR also releases the chart (a `feat`/`fix` under `deploy/helm/tim`), the new tags ship in that chart version and no extra patch follows, because the release commit is the chart's own release commit.
- **Chart changes follow Conventional Commits.** `fix` → patch, `feat` → minor, `feat!` → major. Any other `chore` under `deploy/helm/tim` also gives a patch. Commits that only touch `deploy/helm/tim/ci` (lint values) are excluded.
- **`appVersion` equals the chart version.** A chart pins two apps, so `appVersion` names the chart release rather than one app; the app versions are in `image-tags.yaml`. A generic `extra-files` entry sets `appVersion: "X.Y.Z" # x-release-please-version`. `app.kubernetes.io/version` is the chart version.
- **Empty commits release nothing.** Every package has `exclude-paths` (`web/e2e`, `api/tests`, `deploy/helm/tim/ci`), so commits touching no files, including the empty `chore: release 4.0.0` commit, are skipped. To force a version, put `Release-As: X.Y.Z` in the footer of a commit that touches files under that package.
- **Two branches, two merge methods.** `development` is the default and integration branch; feature and Dependabot PRs are **squash-merged** into it, so each PR is one commit whose subject is its reviewed PR title and whose files are the PR's files. The squash commit body is blank, so footers from branch commits (`BREAKING CHANGE:`, `Release-As:`) do not reach release-please unless typed into the merge dialog. `main` is the release branch: it takes only `development` and `release-please--*` PRs, as **merge commits**, so release-please on `main` sees each squashed commit with its own type and files. A squash of `development` into `main` would collapse a whole release into one commit (one `!` would major every package); rebase-merge rewrites the commits, so `main` and `development` would not share history.
- **Merge commits are ignored.** A merge commit's message is `Merge pull request #N from …` followed by the PR title; GitHub offers no blank body with that title. release-please would read a title starting with `type:` or `type(scope):` as a commit with all the files of the merge, so `pr-conventions` requires other titles for `development` → `main` and back-sync PRs (for example `Release: …`). A merge commit whose first line is `Merge pull request …` is otherwise not a Conventional Commit and is skipped. The back-sync job sets its merge message explicitly. A release PR merge carries `chore: release main`; for a package that the release PR does not release (the chart after a component-only release) it only repeats the release commit's `chore` entry.
- **Back-sync with a merge commit.** After the release PRs are merged, `sync-development` in `release-please.yml` merges `main` into `development` through a PR with a merge commit, so the release commits (versions, `CHANGELOG.md`, `image-tags.yaml`) are in `development` and the next `development` → `main` merge has no conflicts. A squashed back-sync would be a new `chore` commit that changes `image-tags.yaml`; the next `development` → `main` merge would bring it to `main` and release a spurious chart patch. `development` therefore also allows merge commits, only for the back-sync. The PR is opened with `GITHUB_TOKEN`, which starts no workflow, so the job runs `pr_conventions.py` itself, sets the `pr-conventions` status and merges the PR; no PAT and no ruleset bypass are needed.
- **Release freeze.** A commit squashed into `development` while a release PR is open would be older than the release commit and never released. `pr-conventions` fails PRs into `development` while `main` has commits `development` lacks or a release PR is open, and fails a `development` → `main` PR with a commit older than its package's last release tag.
- **Breaking changes are checked by path.** Into `development`, a breaking PR title needs the label `release:major-<package>` for every package whose files the PR changes. Into `main`, every breaking commit needs the label for every package whose files it touches, and a `Release-As` footer on a commit that touches no package files fails.
- **Required checks.** `pr-conventions` is required on `development`; it runs on every PR, and `sync-development` sets it for the back-sync. `main` requires no status check: release PRs are opened with `GITHUB_TOKEN`, so no workflow runs on them, and the `development` → `main` PR contains only commits that passed their checks on `development`.
- **First releases.** The manifest is seeded with `web` 1.5.6, `api` 3.0.4 and `deploy/helm/tim` 0.1.0. Conventional Commits then give frontend 1.6.0 (features, no breaking web commit), backend 4.0.0 (`feat(api)!`) and chart 1.0.0 (that breaking commit also touches the chart, and a breaking change on 0.x goes to 1.0.0). No `release-as` configuration is used, so nothing has to be removed afterwards.
- **Publishing.** `publish-chart` in `release-please.yml` runs when the chart releases. It waits for `build-web` and `build-api` when they run in the same workflow, and runs when they are skipped. Before pushing it checks that `Chart.yaml` `version` and `appVersion` equal the release, that `image-tags.yaml` matches `web/package.json` and `api/pyproject.toml`, and that both pinned images exist in the registry.
- **CI guard.** `deploy-check.yml` checks that the manifest, `Chart.yaml` `version` and `appVersion` agree for the chart; the manifest, `web/package.json` and `image-tags.yaml` for frontend; and the manifest, `api/pyproject.toml`, `api/uv.lock` and `image-tags.yaml` for backend. It also checks that rendering `ci/minimal-values.yaml` uses the pinned tags.

## Alternatives considered
| Option | Pros | Cons |
|---|---|---|
| Linked group for web, api and chart, image tags defaulting to `appVersion` | One version, one PR | Breaks the legacy lines; a frontend fix releases an unchanged backend |
| Root `core` package carrying the chart version | Sees every commit, so the chart bumps in the same PR | Bumps the chart by the component's level (a breaking backend change would be a chart major); chart changes cannot be told apart |
| Root package with `always-bump-patch` | Same-PR patch bump | Chart `feat`/`feat!` would also be patches |
| Workflow step that edits the release-please branch | Same-PR chart bump | release-please rewrites the branch on every run; the manifest and chart tags drift |
| Image tags in `values.yaml` | One file | No release-please updater can change one component's line in a commented file |
| Per-package `release-as` to override the empty `chore: release 4.0.0` commit | Explicit | Stays in the config and forces the same version on later releases until removed |
| Merge commits from feature branches straight into `main` | Per-commit types | Every branch commit must be a correct Conventional Commit; one `!` in a branch commit majors every package it touches |
| Squash `development` into `main` | Linear `main` | One commit per release: one `!` majors every package, per-PR types are lost |
| Squash-merged back-sync | Linear `development` | Releases a spurious chart patch; `main` is never an ancestor of `development` |
| Back-sync PR opened with a PAT or GitHub App so workflows run on it | Normal checks | A long-lived secret to manage; the job can run the same check itself |
| Required checks on `main` | Gate releases | Release PRs never get the check (opened by `GITHUB_TOKEN`) and would block forever |
| Independent packages, pinned `image-tags.yaml`, chart picking up the release commit as a `chore` (chosen) | Native release-please only; legacy lines continue; chart patch on any image change; chart CC for its own changes | Chart patch arrives one release PR later; other chart `chore` commits also release a patch |

## Consequences
- A frontend-only fix needs two release PRs: the first releases the frontend image, the second releases a chart patch that pins it. Until the second is merged, `image-tags.yaml` on `main` is ahead of the latest published chart.
- A published chart version is never overwritten: a chart is pushed only when release-please releases the chart, with a new version.
- Commit types that release-please hides (`build`, `ci`, `docs`, `refactor`, `test`, `style`) in `web/` or `api/` build no image; in `deploy/helm/tim` they ship with the next chart release.
- Versions in `web/package.json`, `api/pyproject.toml`, `api/uv.lock`, `Chart.yaml` and `image-tags.yaml` are never edited by hand.
- An empty commit with `Release-As` has no effect.
- A PR into `development` is one release commit: a `!` title majors every package the PR changes, so a breaking change goes in its own PR with one label per package it touches.
- Releasing is a sequence: merge `development` into `main`, merge each release PR (a component release is followed by a chart patch PR), then `sync-development` merges `main` back. `development` is frozen in between.
- Rebase merges are disabled; merge commits on `development` are only for the back-sync.
- Supersedes the image tag and chart version rules in [0008](0008-helm-chart.md).
