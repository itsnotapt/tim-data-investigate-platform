---
status: accepted
date: 2026-10-29
---

# One release version for TIM, its own for `tim-actions`

Almost every PR changes the frontend and the backend together, yet they, and the Helm chart that pins them, released on three version lines: a component release took a second release PR for the chart, and an operator read three numbers. TIM now releases both images and the chart as one release-please package with one version, and every release rolls both Deployments. `tim-actions` keeps its own version, because providers depend on its major.

- **Packages.** The root package (`.`) is `tim`, tagged `vX.Y.Z`, with one `CHANGELOG.md` at the repo root. Its version is in `web/package.json`, `api/pyproject.toml`, `api/uv.lock`, and the chart's `version` and `appVersion`. `api/tim-actions` stays the `tim-actions` package (`tim-actions-vX.Y.Z`), installed from its git tag ([0021](0021-tim-actions-and-derived-images.md)).
- **The images are `api` and `web`.** They are `ghcr.io/itsnotapt/tim-data-investigate-platform/api` and `…/web`, named like their directories, the chart's `api` and `web` values and the Compose variables `TIM_API_IMAGE` and `TIM_WEB_IMAGE`. The `backend` and `frontend` images end at 4.0.0 and 1.7.0 and stay in the registry.
- **Scopes name parts of TIM.** A title's scope is optional. When given, it names what the PR changes: `web`, `api`, `chart` or `tim-actions`.
- **Which commits release TIM.** release-please gives a root package every commit, including those under `api/tim-actions`. A commit releases nothing when all its files are under the root package's `exclude-paths`: files that ship in neither image nor the chart, such as tests and CI. `fix` is a patch, `feat` a minor, `!` a major. A `tim-actions` change releases TIM too, because the backend image ships `tim-actions`.
- **Every release publishes everything.** Each release builds and pushes both images as `X.Y.Z`, `X.Y` and `X`, then the chart `X.Y.Z`. The chart's image tags default to its `appVersion`, so there is no separate file of pinned tags. One release PR publishes all three.
- **Every release restarts both Deployments.** A new image tag changes the pod template. A web restart is invisible to analysts. An api restart ends the runs in flight on each replaced pod as "Run interrupted by server restart" ([0012](0012-query-run-limits-and-lifecycle.md)), as a config change, a node drain or a scale-down already does. If that becomes a problem, the fix is a graceful drain in the api, which also covers those other restarts.
- **The line starts at 2.0.0.** The first release carries the breaking changes made since frontend 1.7.0, backend 4.0.0 and chart 1.0.1.
- **One branch, squash merges.** `main` is the only long-lived branch and every PR is squash-merged into it, so the PR title is the release commit. A merge commit would let release-please read every commit of the branch, and a single `!` would major the release. Release PRs are opened against `main`, and merging one releases.
- **The squash body adds changelog entries.** release-please reads each Conventional Commit line in a squash body as a commit of its own with the PR's changed files, so each line is an entry in TIM's changelog, and in `tim-actions`' when the PR changes it. Body lines are `feat`, `fix` or `perf` with no scope and no `!`, so a breaking change is always in a title the check sees.
- **A break of `tim-actions` names it.** A `!` title majors TIM, and `tim-actions` too when the PR changes its files. So a breaking PR that changes `api/tim-actions` names `tim-actions` in its scope, and a breaking TIM change keeps `tim-actions` out of the PR when its interface doesn't break. `pr-conventions` checks this and that the title is a Conventional Commit.

Decided by the user. Replaces [0016](0016-release-versions.md). Contributors follow [RULES.md §6–7](../RULES.md#6-git). Related: [0008](0008-helm-chart.md), [0021](0021-tim-actions-and-derived-images.md).

## Considered Options

| Option | Pros | Cons |
|---|---|---|
| Separate versions for frontend, backend and chart ([0016](0016-release-versions.md)) | A frontend release doesn't restart the api | Most PRs change both; two release PRs per component release; three numbers for one deployment; the chart could pin a pair that never ran together in CI |
| One version, building and pinning only the components that changed | A frontend-only release doesn't restart the api | release-please can't choose per-component pins, so a workflow script must; restarts still happen for config changes, drains and scale-downs |
| Keep the `backend` and `frontend` image names, starting at 5.0.0 | Existing image references keep working | Names nothing else in TIM uses; a start below 5.0.0 would sort under the existing backend 4.0.0 |
| `tim-actions` on TIM's version | One number everywhere | Provider authors would see a major for every breaking TIM change, whatever happened to the interface |

## Consequences

- An instance that sets `api.image.repository`, `web.image.repository`, `TIM_API_IMAGE` or `TIM_WEB_IMAGE` to TIM's images, or builds a derived image `FROM …/backend`, changes the name once. The `backend` and `frontend` images get no new tags.
- A frontend-only fix also publishes the backend under the new version and restarts it.
- The release PR runs the full e2e suite on the commit both images are built from, so the frontend and backend a chart deploys have run together in CI.
- A derived image's tag stays `<tim version>-<revision>`; the TIM version is now the one version.
