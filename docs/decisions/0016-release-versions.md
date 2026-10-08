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
- A commit that touches no files is applied to every package, except packages with `exclude-paths`: those skip it. The pushed empty commit `6655691` (`chore: release 4.0.0`, footer `Release-As: 4.0.0`) would otherwise force every package to 4.0.0.

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
- **Empty commits release nothing.** Every package has `exclude-paths` (`web/e2e`, `api/tests`, `deploy/helm/tim/ci`), so commits touching no files, including `6655691`, are skipped. To force a version, put `Release-As: X.Y.Z` in the footer of a commit that touches files under that package.
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
| Per-package `release-as` to override `6655691` | Explicit | Stays in the config and forces the same version on later releases until removed |
| Independent packages, pinned `image-tags.yaml`, chart picking up the release commit as a `chore` (chosen) | Native release-please only; legacy lines continue; chart patch on any image change; chart CC for its own changes | Chart patch arrives one release PR later; other chart `chore` commits also release a patch |

## Consequences
- A frontend-only fix needs two release PRs: the first releases the frontend image, the second releases a chart patch that pins it. Until the second is merged, `image-tags.yaml` on `main` is ahead of the latest published chart.
- A published chart version is never overwritten: a chart is pushed only when release-please releases the chart, with a new version.
- Commit types that release-please hides (`build`, `ci`, `docs`, `refactor`, `test`, `style`) in `web/` or `api/` build no image; in `deploy/helm/tim` they ship with the next chart release.
- Versions in `web/package.json`, `api/pyproject.toml`, `api/uv.lock`, `Chart.yaml` and `image-tags.yaml` are never edited by hand.
- An empty commit with `Release-As` has no effect.
- Supersedes the image tag and chart version rules in [0008](0008-helm-chart.md).
