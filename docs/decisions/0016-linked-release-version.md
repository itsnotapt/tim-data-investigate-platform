# 0016. Linked release version for web, api and chart

- **Status:** Proposed
- **Date:** 2026-10-07
- **Deciders:** the user
- **Related:** [0008](0008-helm-chart.md), [deployment.md](../deployment.md), [development.md](../development.md)

## Context
release-please should own all versioning. `web`, `api` and the Helm chart (`deploy/helm/tim`) were versioned independently, so `Chart.appVersion` could not serve as a default image tag: one value cannot name the right tag for both images. Users had to set `api.image.tag` and `web.image.tag` by hand on every install and upgrade, and the chart refused to render without them.

release-please's helm updater (`src/updaters/helm/chart-yaml.ts`) sets only `version` in `Chart.yaml`, never `appVersion`. This holds for every release from 17.3.0 (bundled with `googleapis/release-please-action@v4`, v4.4.1) through 17.6.0 (action v5.0.0) to 17.11.2 and current main. `appVersion` therefore needs the generic `x-release-please-version` marker. The helm and generic updaters both run on `Chart.yaml` (release-please merges them into a composite updater), and comments and formatting are preserved (verified locally with release-please 17.3.0).

## Decision
- **Linked group.** `release-please-config.json` has a `linked-versions` plugin (group name `tim`, components `web`, `api`, `chart`). The three always release together with one shared version. If only one has commits, all three are released at the highest computed bump, and the others get a "Synchronize tim versions" chore entry in their changelogs.
- **Tags and changelogs.** Tags stay `web-vX.Y.Z`, `api-vX.Y.Z` and `chart-vX.Y.Z`, each with its own `CHANGELOG.md` in its directory.
- **`core` is separate.** The root package `core` (repo-root `CHANGELOG.md`, tags `core-vX.Y.Z`) is not linked.
- **Chart version equals app version.** The helm strategy sets `Chart.yaml` `version`; an `extra-files` generic entry sets `appVersion: "X.Y.Z" # x-release-please-version`. Chart `version`, `appVersion`, web version and api version are equal. `api/uv.lock` is still updated through the existing toml `extra-files` entry.
- **Image tags default to `appVersion`.** `api.image.tag` and `web.image.tag` default to `.Chart.AppVersion` when empty. `digest` wins over `tag`, and an explicit `tag` overrides the default. The "tag or digest required" validation is removed. `app.kubernetes.io/version` comes from `appVersion` and matches the deployed images unless overridden.
- **Images tagged from the release version.** The release workflow tags images `X.Y.Z`, `X.Y`, `X` (no `v` prefix) and `sha-<sha>`, taken from release-please's `<path>--version` output.
- **Chart published after images.** `publish-chart` needs `build-web` and `build-api`, so the chart never references images that do not exist yet.
- **CI guards.** `release-please.yml` checks before pushing the chart that chart version, `appVersion`, web and api versions are equal. `deploy-check.yml` also runs on `.release-please-manifest.json` and `release-please-config.json`, checks that `Chart.yaml` version and `appVersion`, `web/package.json`, `api/pyproject.toml` and the three manifest entries are equal, and checks that rendering `ci/minimal-values.yaml` yields `:<appVersion>` for both images.

## Alternatives considered
| Option | Pros | Cons |
|---|---|---|
| Chart versioned independently, `appVersion` tracking the app | Chart changes release alone | A chart-only release cannot pick up a new `appVersion` unless the chart also has commits; users juggle two version numbers |
| One combined root package with `extra-files` for every manifest | One version, one PR | Loses per-component changelogs and tags; the root `core` package carries the legacy 3.x version line |
| Wait for or upgrade release-please to handle `appVersion` | No marker comment | No release does it (17.3.0 through 17.11.2 and main) |
| Keep required explicit tags | No coupling between components | Manual on every install and upgrade; defeats release-please |
| Linked versions with generic `appVersion` marker (chosen) | One version for all three; `--version X.Y.Z` deploys matching images; per-component changelogs and tags kept | Components release together even when unchanged |

## Consequences
- A chart-only fix also produces new web and api releases and images (same code, new tag).
- A `feat` in one component bumps the minor version of all three.
- `image.tag` and `digest` remain available as overrides.
- `core` stays on its own version line.
- Versions in `web/package.json`, `api/pyproject.toml`, `api/uv.lock` and `Chart.yaml` are never edited by hand; `Release-As: X.Y.Z` in a commit footer forces a version.
- Supersedes the image tag and chart version rules in [0008](0008-helm-chart.md).
