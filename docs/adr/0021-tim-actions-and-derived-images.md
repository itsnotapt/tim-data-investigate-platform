---
status: accepted
date: 2026-10-20
---

# The `tim-actions` distribution and derived images

Providers need TIM's interface without depending on the whole API, and their code has to reach a running instance. The interface is a separate `tim-actions` distribution with its own semver, and providers are installed into a derived image built from TIM's backend image, against the constraints TIM ships. Instance files are mounted read-only under `/etc/tim`.

- **`tim-actions`.** A uv workspace member under `api/`. It holds the interface (`Action`, `Sink`, `Param`, `Provider`, `Hook`, `Connection`), the built-in action types and hooks, with connection types as extras (`tim-actions[kusto,snowflake]`), param validation and `resolve()`, and `tim_actions.testing` with a `pytest11` plugin. `tim-api` depends on it. It is released as a fourth release-please package (`tim-actions-vX.Y.Z`) and published to PyPI, and installed from a git tag until then.
- **Derived images.** `FROM` the backend image, `uv pip install --python /app/.venv/bin/python -c /app/constraints.txt <packages>`. The image ships `uv` and the constraints exported from `uv.lock`, so a provider can't move TIM's pins, and a conflict, such as a `tim-actions` major mismatch, fails the build. Nothing installs at runtime. Tags are `<tim version>-<revision>`.
- **Files under `/etc/tim`.** Action files at `/etc/tim/actions` (Helm `actions.files` or `actions.existingConfigMap`), and `connections.yaml` and `labels.yaml` from structured Helm values in their own ConfigMap. Compose binds one config directory.
- **Schemas by CLI.** `tim-api schema` and `tim-api check` in the image, not an endpoint: `yaml-language-server` can't send a bearer token, and authors shouldn't need a running instance.

Code: the workspace in `api/pyproject.toml` (`[tool.uv.workspace]`), the package in `api/tim-actions/`, its release in `release-please-config.json`.

Decided by the user. Related: [0008](0008-helm-chart.md), [0016](0016-release-versions.md), [0017](0017-actions-from-providers.md), [deployment](../deployment.md).

## Considered Options

| Option | Pros | Cons |
|---|---|---|
| Providers depend on `tim-api` | No new distribution | Pulls in FastAPI, SQLAlchemy and the rest; couples provider versions to every API change |
| pip installs at container start | No image build | Slow, network-dependent starts; replicas can resolve differently |
| A plugin volume | No image build | Native wheels must match the image; unpinned dependencies |
| A schema endpoint | Always current | Must be unauthenticated for `yaml-language-server`, and needs a running instance |
| A startup check of the `tim-actions` version | Clear error | The constrained install already fails the build |

## Consequences

- Every instance with providers maintains a small image build and retags it on each TIM release.
- An interface change is a `tim-actions` major, and providers pin `>=1,<2`.
- `examples/instance/` is built in this repo's CI, so a breaking interface change fails its own PR.
