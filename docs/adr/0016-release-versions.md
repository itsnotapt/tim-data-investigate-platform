---
status: accepted
date: 2026-10-07
---

# Release versions for frontend, backend and the Helm chart

The frontend changes often and the backend rarely, so TIM releases them and the Helm chart, the deployable unit that decides which frontend runs with which backend, as three independent release-please packages, and each chart version pins one frontend and one backend image. Every PR is squash-merged into `development`, so its title is one release commit, and `development` reaches `main` only through merge commits, so release-please on `main` reads one typed commit per PR. The chart follows a component release through a native release-please mechanism, without workflow edits to release PRs.

- **Packages.** `web/` is `frontend` (tags `frontend-vX.Y.Z`) and `api/` is `backend` (`backend-vX.Y.Z`); both continue the previous app's version lines. `deploy/helm/tim` is `chart` (`chart-vX.Y.Z`), a line that started at 1.0.0. There is no root package, so commits outside the three paths release nothing.
- **Which commits release a package.** Commits that change files under the package path, minus `web/e2e`, `api/tests` and `deploy/helm/tim/ci`: `fix` is a patch, `feat` a minor, `!` a major. `build`, `ci`, `docs`, `refactor`, `test` and `style` release nothing on their own. Under the chart, `chore` also releases a patch. Commits that change no files release nothing, because every package has `exclude-paths`.
- **The chart pins images in `deploy/helm/tim/image-tags.yaml`.** Each component release updates its own key there. The tags are not in `values.yaml`, because release-please cannot update one component's line in a commented file. `appVersion` equals the chart version, because a chart release pins two apps.
- **A component release is followed by a chart patch.** release-please cannot bump one package because another one released. Instead, the release PR's `chore: release main` commit changes `image-tags.yaml`, and the chart counts `chore` as a release, so the next release PR carries a chart patch. If the same release PR also releases the chart, the new tags ship in that chart version.
- **Squash into `development`, merge commits into `main`.** Squashing `development` into `main` would collapse a release into one commit, so a single `!` would major every package. Rebase merges would stop `main` and `development` from sharing history. Titles of merge-commit PRs must not look like Conventional Commits, because release-please reads the PR title in the merge commit body as a commit carrying every file of the merge.
- **Back-sync with a merge commit.** After a release, `sync-development` merges `main` into `development` so the release commits are in `development` and the next merge into `main` has no conflicts. A squashed back-sync would be a new `chore` commit that changes `image-tags.yaml`, and it would release a spurious chart patch.
- **Release freeze.** release-please reads commits by commit date and stops at each package's last release commit. A commit squashed into `development` while a release is in progress would be older than that release commit and would never be released, so `pr-conventions` blocks merges into `development` during a release.
- **Breaking changes name their packages.** A `!` in a PR title majors every package the PR changes, so the title's scope must name each of them (`feat(backend,chart)!: …`). The history then shows which packages go major.

Decided by the user. Contributors follow [RULES.md §6–7](../RULES.md#6-git). [development.md](../development.md) covers the checks and the repository settings, and `release-please-config.json` and `.github/workflows/` hold the rest. Related: [0001](0001-react-python-web-api.md), [0008](0008-helm-chart.md), [deployment.md](../deployment.md).

## Considered Options

- **One linked version for web, api and chart:** a frontend fix would release an unchanged backend, and the existing version lines would end.
- **A root package carrying the chart version:** the chart would bump by the component's level, so a breaking backend change would be a chart major.
- **Image tags in `values.yaml`:** no release-please updater can change one component's line in that file.
- **`release-as` in the configuration:** it forces the same version on every later release until someone removes it.
- **Per-package `release:major-*` labels instead of a scope:** labels are invisible to release-please and to `git log`, and they can change after the check has run.

## Consequences

- One PR is one release commit. Keep PRs single-purpose, and put a breaking change in its own PR so it majors only the packages it names.
- A component release takes two release PRs: the first publishes the image, and the second releases the chart patch that pins it. Until the second PR is merged, `image-tags.yaml` on `main` is ahead of the latest published chart.
- A published chart version is never overwritten. A chart is pushed only when release-please releases a new chart version.
- `development` is frozen from the `development` → `main` merge until the back-sync.
