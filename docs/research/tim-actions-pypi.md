# How does `tim-actions` get published to PyPI from this monorepo?

Research for [How does tim-actions get published to PyPI from this monorepo?](https://github.com/itsnotapt/tim-data-investigate-platform/issues/319), part of the map [Wayfinder: action authoring that's easy to start and fully specified](https://github.com/itsnotapt/tim-data-investigate-platform/issues/318). It feeds "Distribution and versioning". The motivating findings are §1 of [Action authoring is hard to start and under-specified in places](https://github.com/itsnotapt/tim-data-investigate-platform/issues/315).

Researched 2026-11-16 against `origin/main` at `475da9f`. The local experiments used uv 0.12.21 on the host, and the published `ghcr.io/itsnotapt/tim-data-investigate-platform/api:2.0.0` image, which ships uv 0.12.24 and `tim-actions==0.1.0`. Warehouse (PyPI's code) was read at `pypi/warehouse@99b93c6`.

## Answer

- **The image build never needs an index for `tim-actions`.** The api image already has `tim-actions` installed, and its `constraints.txt` pins it. A provider whose `pyproject.toml` has no `[tool.uv.sources]` installs into the image today, even though `tim-actions` isn't on PyPI. The constrained install keeps the image's copy (experiment E1).
- **PyPI fixes the author's machine, not the image.** Without an index, `uv lock` on a fresh provider fails, so every trial author added a path source. That path source then broke the image build. With `tim-actions` on PyPI, a provider needs no `[tool.uv.sources]` at all. The same `pyproject.toml` locks on a laptop and installs in the image.
- **Publishing is one job in `release-please.yml`.** It is gated on `steps.release.outputs['api/tim-actions--release_created']` and uses trusted publishing (OIDC) through a GitHub environment. It can't be a workflow triggered by the `tim-actions-v*` tag. release-please creates that tag with `GITHUB_TOKEN`, and tags pushed that way trigger no workflows.
- **The name `tim-actions` is free, and nothing reserves it.** PyPI returned 404 for it on 2026-11-16. A pending trusted publisher doesn't reserve a name. The name is claimed by the first upload, so the real fix is to upload 0.1.0 soon. 0.x versions are ordinary final releases.
- **To develop against a TIM checkout, keep a path source and turn sources off in the image.** `uv pip install --no-sources`, or `UV_NO_SOURCES=1`, makes a provider that has a path or git source install in the image (E3, E5). Setting `ENV UV_NO_SOURCES=1` in TIM's api image would make the documented one-line install work for every source form, with no change to authors' Dockerfiles.
- **Git is a poor substitute for an index.**
  - The image has no `git` binary, so any git source fails there (E4).
  - A direct reference (`tim-actions @ git+…`) needs a hatchling opt-in. It replaces the image's `tim-actions` with the tag's build, even under `-c constraints.txt` (E6).
  - PyPI rejects any upload that has a direct reference.
- **GitHub Packages is out.** It has no Python registry.

**Recommendation.**

1. Publish `tim-actions` to PyPI now, from a `publish-tim-actions` job in `release-please.yml` with trusted publishing and a `pypi` environment.
2. Backfill 0.1.0 from the `tim-actions-v0.1.0` tag, which is the commit `api:2.0.0` was built from.
3. Set `ENV UV_NO_SOURCES=1` in the api image.
4. Tell authors to declare `tim-actions[…]>=0.1,<0.2` with no sources. Use an editable path source only to develop against an unreleased checkout.

Before the first upload, two decisions are needed. Both are under [Open questions for "Distribution and versioning"](#open-questions-for-distribution-and-versioning): whether the pending 0.1.1 should be 0.2.0, and the PyPI page's metadata.

## 1. Trusted publishing from GitHub Actions

### What PyPI requires

- **Permission.** The publishing job needs `id-token: write`. PyPI says to grant it at job level, not workflow level ([PyPI: using a publisher](https://docs.pypi.org/trusted-publishers/using-a-publisher/)).
- **The publisher's fields.** These are the repository owner, the repository, the workflow filename and, optionally, an environment. All must match the run, or the upload fails with `invalid-publisher` ([PyPI: troubleshooting](https://docs.pypi.org/trusted-publishers/troubleshooting/)).
- **A GitHub environment.** It's "optional, but strongly encouraged" ([using a publisher](https://docs.pypi.org/trusted-publishers/using-a-publisher/)). With required reviewers, the environment stops anyone who can push to the workflow from publishing alone ([PyPI: security model](https://docs.pypi.org/trusted-publishers/security-model/)).
- **No reusable workflow.** "Reusable workflows cannot currently be used as the workflow in a Trusted Publisher" ([troubleshooting](https://docs.pypi.org/trusted-publishers/troubleshooting/)). `pypa/gh-action-pypi-publish` says the same, and suggests a separate job in the calling workflow instead ([action README](https://github.com/pypa/gh-action-pypi-publish#trusted-publishing)).
- **Separate build and publish jobs.** PyPI recommends a publish job of two steps: download the artifacts a separate build job made, then publish ([security model](https://docs.pypi.org/trusted-publishers/security-model/)). uv's own example splits the jobs the same way, so the build never holds `id-token: write` ([uv: GitHub integration](https://docs.astral.sh/uv/guides/integration/github/)).
- **Attestations.** `pypa/gh-action-pypi-publish` generates and uploads PEP 740 attestations by default under trusted publishing ([action README](https://github.com/pypa/gh-action-pypi-publish#generating-and-uploading-attestations)). uv's example adds `astral-sh/attest-action` before `uv publish` ([uv: GitHub integration](https://docs.astral.sh/uv/guides/integration/github/)).
- **Pull requests from forks get no OIDC token** in the upstream repository's workflows ([security model](https://docs.pypi.org/trusted-publishers/security-model/)).

### Why the tag can't trigger it

- release-please creates the `tim-actions-vX.Y.Z` tag and its GitHub release with the workflow's `GITHUB_TOKEN`. `release-please.yml` passes `secrets.GITHUB_TOKEN`.
- "Events triggered by the `GITHUB_TOKEN` will not create a new workflow run". The exceptions are `workflow_dispatch` and `repository_dispatch` ([GitHub: triggering a workflow](https://docs.github.com/en/actions/how-tos/write-workflows/choose-when-workflows-run/trigger-a-workflow)). The release-please action warns about the same thing ([release-please-action README](https://github.com/googleapis/release-please-action)).
- So `on: push: tags: tim-actions-v*` never fires for a release. The options are:

| Option | How | Cost |
|---|---|---|
| A job in `release-please.yml` (recommended) | `if: ${{ steps.release.outputs['api/tim-actions--release_created'] }}`, as the action's README shows for a path package. The trusted publisher's workflow is `release-please.yml`. | The workflow that opens release PRs can also publish. An environment with reviewers limits that. |
| A separate `publish-tim-actions.yml`, on `workflow_dispatch` with a tag input | The release-please job runs `gh workflow run`, which `GITHUB_TOKEN` may trigger. It needs `actions: write`. | One more hop, but the same workflow also serves the 0.1.0 backfill and any re-run. |
| A tag push with a PAT | Give release-please a personal access token | A long-lived secret, which trusted publishing is meant to avoid |

### The outputs a job needs

The `api/tim-actions` package's outputs carry a path prefix: `api/tim-actions--release_created`, `--tag_name`, `--version` and `--sha`. A path that contains `/` is read with property access, as in `steps.release.outputs['api/tim-actions--release_created']` ([release-please-action README, Path outputs](https://github.com/googleapis/release-please-action#path-outputs)). The current `release-please` job exports only the root package's outputs, so it would also export these.

### A sketch of the job

```yaml
  build-tim-actions:
    needs: release-please
    if: ${{ needs.release-please.outputs.tim-actions-release }}
    runs-on: ubuntu-latest
    permissions: { contents: read }
    steps:
      - uses: actions/checkout@v7
        with: { ref: "${{ needs.release-please.outputs.tim-actions-tag }}", persist-credentials: false }
      - uses: astral-sh/setup-uv@v10.2.0
      - run: uv build --package tim-actions --no-sources --out-dir dist
        working-directory: api
      - uses: actions/upload-artifact@v…
        with: { name: tim-actions-dist, path: api/dist/ }

  publish-tim-actions:
    needs: build-tim-actions
    runs-on: ubuntu-latest
    environment: pypi
    permissions: { id-token: write }
    steps:
      - uses: actions/download-artifact@v…
        with: { name: tim-actions-dist, path: dist/ }
      - uses: pypa/gh-action-pypi-publish@release/v1
```

- **The build command.** `uv build --package <name>` builds one workspace member. `--no-sources` is recommended when publishing, so the package builds the way other tools see it ([uv: building and publishing](https://docs.astral.sh/uv/guides/package/), [uv: dependencies](https://docs.astral.sh/uv/concepts/projects/dependencies/)).
- **The build works today.** `uv build --package tim-actions --no-sources` in `api/` builds `tim_actions-0.1.0.tar.gz` and `tim_actions-0.1.0-py3-none-any.whl`, and `twine check` passes both. The wheel's `Requires-Dist` is the plain `project.dependencies` with the `kusto` and `snowflake` extras, because sources never reach the metadata ([uv: dependencies](https://docs.astral.sh/uv/concepts/projects/dependencies/)).
- **`uv publish` works too.** It uses trusted publishing from GitHub Actions with no credentials configured ([uv: building and publishing](https://docs.astral.sh/uv/guides/package/)). PyPI calls `pypa/gh-action-pypi-publish` the stable interface ([using a publisher](https://docs.pypi.org/trusted-publishers/using-a-publisher/)).

### The name and the 0.x version

- **The name is free.** `https://pypi.org/simple/tim-actions/` and `/pypi/tim-actions/json` returned 404 on 2026-11-16, as did `timactions`, `tim-action` and `timaction`. `tim` is taken.
- **Nothing reserves it before the first upload.** "A 'pending' publisher does not create a project or reserve a project's name until it is actually used to publish." If another user registers the name first, the pending publisher "will be invalidated" ([PyPI: creating a project through OIDC](https://docs.pypi.org/trusted-publishers/creating-a-project-through-oidc/)).
- **Other reasons a name is refused.** It conflicts with the standard library, it's "too similar to an existing project", it's prohibited by the admins, or someone registered it without publishing ([PyPI: choosing a name](https://docs.pypi.org/project-management/choosing-a-name/)). `tim` exists, so the similarity check only answers at the first upload. *Inference:* `tim-actions` normalises to neither `tim` nor anything taken, so it is unlikely to be refused.
- **A placeholder doesn't hold a name.** An empty package that holds a name is "name squatting", and PEP 541 lists it as grounds for removal ([PEP 541](https://peps.python.org/pep-0541/)). The way to claim `tim-actions` is to publish the real 0.1.0.
- **0.x is an ordinary version.** `0.1.0` is a final release under PEP 440, so installers pick it without `--pre` ([PEP 440](https://peps.python.org/pep-0440/)).
- **Files are permanent.** "PyPI does not allow for a filename to be reused, even once a project has been deleted and recreated" ([PyPI: publishing troubleshooting](https://docs.pypi.org/publishing/troubleshooting/)). A bad upload is fixed with a new version, never a re-upload.

### Backfilling 0.1.0

`tim-actions-v0.1.0` and `v2.0.0` point at the same commit, `8f51c25`, so a 0.1.0 wheel built from that tag is the `tim-actions` inside `api:2.0.0`. Four commits under `api/tim-actions` have landed since, and the open release PR proposes `tim-actions` 0.1.1 and TIM 2.1.0. A backfill needs a run that publishes a given tag. Either the `workflow_dispatch` workflow above does it, or a one-off run of a job that checks out `tim-actions-v0.1.0`, under the same trusted publisher.

## 2. `[tool.uv.sources]` in a derived image

### Experiments

Each provider was a throwaway hatchling package with `dependencies = ["tim-actions[kusto]>=0.1,<0.2"]` unless the table says otherwise. Each was built with the documented step on `api:2.0.0`:

```dockerfile
COPY pyproject.toml /tmp/provider/
COPY src /tmp/provider/src
RUN uv pip install --python /app/.venv/bin/python -c /app/constraints.txt $FLAGS /tmp/provider
```

| # | Provider's source for `tim-actions` | Flags | Result in the image |
|---|---|---|---|
| E1 | None | none | **Installs.** `tim-actions` stays the image's `file:///app/tim-actions` copy, though PyPI doesn't have it. |
| E2 | `{ path = "../tim-data-investigate-platform/api/tim-actions", editable = true }` | none | **Fails:** `error: Distribution not found at: file:///tmp/tim-data-investigate-platform/api/tim-actions`. This is §1's failure. |
| E3 | The same path source | `--no-sources` | **Installs**, keeping the image's `tim-actions` |
| E4 | `{ git = "https://github.com/itsnotapt/tim-data-investigate-platform", tag = "tim-actions-v0.1.0", subdirectory = "api/tim-actions" }` | none | **Fails:** `Git executable not found`. The image has no `git`. |
| E4b | The same git source | `--no-sources` | **Installs**, keeping the image's `tim-actions` |
| E5 | The path source of E2, with `ENV UV_NO_SOURCES=1` in the Dockerfile | none | **Installs**, keeping the image's `tim-actions` |
| E6 | `"tim-actions[kusto] @ git+https://github.com/itsnotapt/tim-data-investigate-platform@tim-actions-v0.1.0#subdirectory=api/tim-actions"` in `project.dependencies`, with `git` added to the image | none | First fails in hatchling: "cannot be a direct reference unless field `tool.hatch.metadata.allow-direct-references` is set to `true`". With that set, it **installs, and replaces the image's `tim-actions`**: `- tim-actions==0.1.0 (from file:///app/tim-actions)`, `+ tim-actions==0.1.0 (from git+…@8f51c25…)`. The `==0.1.0` constraint doesn't stop it, because the versions are equal. |

On the host, an author's `uv lock` gave these results:

| # | Provider | Result |
|---|---|---|
| H1 | No source | **Fails.** `pypi.org/simple/tim-actions/` is a 404. uv words the empty range as "only the following versions of tim-actions[kusto] are available: tim-actions[kusto]<0.1, tim-actions[kusto]>=0.2", which wrongly suggests versions exist. |
| H2 | The git source of E4 | **Locks**, at commit `8f51c25` |

### What the experiments show

- **`uv pip install` reads `[tool.uv.sources]`** from a local project it installs. `--no-sources` ignores the table ("Used to lock against the standards-compliant, publishable package metadata"), and it can also be set as `UV_NO_SOURCES` (`uv pip install --help`). Sources are a uv-only, development-time extension. "Sources are only respected by uv", and published metadata comes from `project.dependencies` ([uv: dependencies](https://docs.astral.sh/uv/concepts/projects/dependencies/)).
- **The image only needs the provider's own new dependencies from an index.** A dependency the venv already satisfies within the constraints is kept (E1, E3–E5). That holds for `tim-actions`, `pydantic` and every other TIM pin. So publishing to PyPI changes nothing inside the image.
- **The image's `tim-actions` is safe only while the requirement is a plain version.** A URL requirement for `tim-actions` reinstalls it from that URL (E6). The image would then hold `tim-actions` from a different build than the one `tim-api` was tested with. Nothing fails if the version number is the same.
- **Which source forms work with `uv pip install -c constraints.txt`:**

| Form | Without `--no-sources` | With `--no-sources` |
|---|---|---|
| None, plain `tim-actions>=0.1,<0.2` | Works | Works |
| `path` (editable or not) | Fails unless the path exists in the build context at the same relative place | Works |
| `git` | Fails, because there's no `git` in the image | Works |
| `index = "<name>"` | Needs the index reachable from the build (inferred, not tested) | Works (inferred) |
| `workspace = true` | Fails outside the workspace (inferred, not tested) | Works (inferred) |
| Direct reference in `project.dependencies` | Replaces the image's copy; fails without `git` | Not affected: it isn't a source |

### Patterns for local development against a checkout

- **The default, once `tim-actions` is on PyPI.** No `[tool.uv.sources]`. `uv add 'tim-actions[kusto]>=0.1,<0.2'`, `uv sync` and `uv run pytest` work against the released interface, and the image build is unchanged.
- **Against an unreleased TIM checkout.** Add `tim-actions = { path = "<checkout>/api/tim-actions", editable = true }` under `[tool.uv.sources]`. Editable has to be asked for, since "an editable installation is not used for path dependencies by default" ([uv: dependencies](https://docs.astral.sh/uv/concepts/projects/dependencies/)). The image build then needs `--no-sources`, from the author's Dockerfile or from `ENV UV_NO_SOURCES=1` in TIM's api image (E5). The image still installs against its own `tim-actions`. A provider that needs unreleased interface changes builds only on an api image that has them.
- **Against a tag without a checkout.** A git source with `tag` and `subdirectory` locks on the host (H2) and is ignored in the image with `--no-sources` (E4b). It pins one tag, so every `tim-actions` release means editing it.

`UV_NO_SOURCES=1` in the api image needs no change from authors, and it removes §1's `Distribution not found` failure for every source form. A side effect: a provider that deliberately pins a dependency to a git or index source loses that pin in the image, and resolves the plain requirement instead.

## 3. Alternatives if PyPI is deferred

| Option | Author's side | TIM's side | Verdict |
|---|---|---|---|
| **A git source at the tag** (`[tool.uv.sources]`, `git`, `tag`, `subdirectory`) | A sources table naming one exact tag, edited for every release. uv only: pip and other tools ignore the table ([uv: dependencies](https://docs.astral.sh/uv/concepts/projects/dependencies/)). Needs `git` locally. | Nothing, if the image ignores sources (`UV_NO_SOURCES`) | Workable stopgap. Documents a tag string in every provider. |
| **A direct reference** (`tim-actions @ git+…@tag#subdirectory=api/tim-actions`) | Needs `allow-direct-references` in hatchling (E6). Can't state a range like `>=0.1,<0.2`. The provider itself can never go on PyPI, because Warehouse rejects uploads with "Can't have direct dependency" ([warehouse/forklift/metadata.py](https://github.com/pypi/warehouse/blob/main/warehouse/forklift/metadata.py)). | Replaces the image's `tim-actions` (E6), and fails without `git` (E4). | Rule out |
| **GitHub Packages** | None | GitHub Packages offers npm, RubyGems, Maven, Gradle, NuGet and containers. It has no Python registry ([GitHub Packages introduction](https://docs.github.com/en/packages/learn-github-packages/introduction-to-github-packages)). | Not possible |
| **A self-hosted index** (a PEP 503 index on GitHub Pages, or a flat `find-links` page of release assets) | `[[tool.uv.index]]` with `explicit = true`, and `tim-actions = { index = "tim" }` ([uv: indexes](https://docs.astral.sh/uv/concepts/indexes/)). pip users need `--extra-index-url` or `--find-links`. | A job that builds and publishes the index page | More work than PyPI, for a worse result. Leaves the PyPI name open for someone else, which is the dependency-confusion case uv's `first-index` default guards against ([uv: indexes](https://docs.astral.sh/uv/concepts/indexes/)). |

Whatever the source, the image build is the same, because the image already has `tim-actions`. The alternatives differ only in how an author's `uv lock` finds it.

## Open questions for "Distribution and versioning"

- **0.1.1 or 0.2.0.** The open release PR proposes `tim-actions` 0.1.1, yet it includes "a param has only a name" and title templates that change what files and providers write. The config has `bump-patch-for-minor-pre-major: true`, so in 0.x a `feat` bumps the patch, and only a breaking change bumps the minor ([release-please config schema](https://github.com/googleapis/release-please/blob/main/schemas/config.json)). ADR-0024 has PRs not mark breaking changes, so a break of the interface reaches PyPI as a patch unless the release PR sets `release-as`. A provider pinned `>=0.1,<0.2` would pick it up on its next `uv lock`. In the image, the exact pin in `constraints.txt` still holds.
- **`release-as` in config is deprecated.** release-please's schema marks the per-package `release-as` option "[DEPRECATED] … Consider using a `Release-As` commit instead". ADR-0024 relies on the config option ([config schema](https://github.com/googleapis/release-please/blob/main/schemas/config.json)).
- **The PyPI page.**
  - `api/tim-actions/pyproject.toml` has no `license` and no `[project.urls]`, though the repository is MIT.
  - Its README is the long description, and its links are relative (`../../docs/actions.md`), so they break on PyPI.
- **Environment and approval.** Whether the `pypi` environment requires a reviewer, which adds one manual approval per `tim-actions` release.
- **Backfill.** Whether to publish 0.1.0 at all, or only from the next release onward. 0.1.0 matches `api:2.0.0`, so publishing it lets an author lock against what that image runs.
