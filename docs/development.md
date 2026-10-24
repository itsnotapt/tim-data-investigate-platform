# Development

How to run, test and change TIM on a dev machine. Related docs:

- Variables: [configuration.md](configuration.md).
- Production: [deployment.md](deployment.md).
- Process rules: [RULES.md](RULES.md).
- Code and doc style: [CODING_STANDARDS.md](../CODING_STANDARDS.md).

You need:

- Node 24+;
- uv, which installs Python 3.12;
- Docker Compose v2.

The commands are the `scripts` in `web/package.json` and the tool settings in `api/pyproject.toml`.

## Things that aren't obvious

- **Run migrations before starting the api.** The api never creates tables. Alembic reads `TIM_DATABASE_URL` only from the process environment, not from `api/.env`. So export it, as the main loop below does.
- **`api/.env.example` doesn't match the compose database.** Its URL uses the password `change-me`, but compose Postgres is `tim:tim`. Either:
  - fix the URL in `api/.env`, or
  - export `TIM_DATABASE_URL`, which overrides `.env`.

  The api reads `.env` from the current directory, so start it from `api/`.
- **`TIM_ENVIRONMENT` defaults to `production`.** These dev-only switches are refused or silently ignored unless it is `development` ([ADR-0011](adr/0011-development-only-modes.md)):
  - `TIM_AUTH_DISABLED`;
  - `TIM_DEV_ACTIONS`;
  - `TIM_DATABASE_URL=memory://`;
  - `TIM_TAG_INGEST_FAKE`.

  `api/.env.example` sets it to `development`.
- **A connection that uses `obo` needs a credential at startup, unless auth is disabled.** This applies when `TIM_CONNECTIONS_FILE` names such a connection. Set one of:
  - `TIM_AUTH_CLIENT_SECRET`;
  - `AZURE_FEDERATED_TOKEN_FILE`;
  - `TIM_AUTH_DISABLED=true`: uncomment it in `api/.env`.

  Without a connections file, no credential is needed.
- **The api must listen on 8080.** `web/vite.config.ts` proxies `/api` there, so there is no CORS setup. `TIM_API_PROXY_TARGET` changes the target.
- **UI work without Entra:** set both:
  - `TIM_AUTH_DISABLED=true` for the api;
  - `VITE_AUTH_STUB=true` in `web/.env.local`.

  With both set:
  - You are signed in as `dev.user@example.com`.
  - To be another analyst, run `localStorage.setItem('tim.devStubUpn', 'bob@example.com')` in the browser console and reload.
  - The stub sends `Bearer dev:<upn>`. The api runs the request as that analyst.
  - Kusto tab calls and runs on `obo` connections answer 503. The on-behalf-of exchange needs a real token.
  - `TIM_TAG_INGEST_FAKE=true` exercises tag writes without a cluster.
  - The [development actions](#development-actions) give you actions without a connection.
- **The compose web container can't stub sign-in.** The UI at `:8081` needs a real Entra app registration (`REDIRECT_URI`). For UI work without one, use the main loop. The root `.env` (compose) and `api/.env` (main loop) are separate files.
- **Tests that don't run by default:** see [configuration.md](configuration.md#test-only-variables) for the variables.
  - **`slow` tests** are deselected. `uv run pytest -m slow` runs them. CI doesn't.
  - **`kusto` tests** skip unless one of these is set:
    - `TIM_TEST_KUSTO_INGEST_URL`, for tag ingestion;
    - `TIM_TEST_KUSTO_CLUSTER`, for Run KQL and `kql_query` on a real cluster as an `AZURE_*` identity.

    They run locally against the shared test cluster (see [Live Kusto tests](#live-kusto-tests)), and in CI in the [`kusto-live` job](#ci-and-releases).
  - **PostgreSQL tests** use `TIM_TEST_DATABASE_URL`. Without it they use a temporary `pgserver`, which needs no Docker. They skip if neither works.
- **`pytest` fails below 80 % coverage**, even when every test passes.
- **Playwright fails if its ports are busy.** It never reuses a running server, so a stray server on its ports (default 5180 and 5181) stops the run.
  - Set `E2E_PORT` to move the ports. See [e2e tests](#e2e-tests).
  - The tests run against the Vite dev server, not a build, because production builds refuse the auth stub.
  - Install the browser once with `npx playwright install chromium`.
  - Playwright also starts its own api, so uv must be installed. See [e2e tests](#e2e-tests).
  - Set `E2E_SHOTS=1` to save screenshots.
- **`npm ls` reports `msw` as invalid.** That is expected. `@vitest/mocker` peers on `msw@^2` for browser mode, which TIM doesn't use: tests run in jsdom. It clears once `vitest` accepts `msw` 3.

## Main loop: Postgres in Docker, api and web on the host

```bash
cp .env.example .env                  # optional: every compose variable has a default
docker compose up -d postgres         # 127.0.0.1:5432, user/password/db: tim

cd api
cp .env.example .env                  # then edit: database URL and credential, see above
uv sync
export TIM_DATABASE_URL=postgresql+asyncpg://tim:tim@localhost:5432/tim
uv run alembic upgrade head
uv run uvicorn tim_api.main:app --reload --port 8080

cd web                                # second terminal, from the repo root
npm install
npm run dev                           # http://localhost:5173
```

Web variables for `npm run dev` go in `web/.env.local`. The template is `web/.env.example`. See [configuration.md](configuration.md#web-vite-development).

**Full stack in containers:** run `docker compose up --build`, then open `http://localhost:8081`.

- Services, ports and start order are in `compose.yaml`.
- `docker compose down -v` also deletes the database.

## Checks

Run the checks CI runs before you push:

- **`api/`:** `uv run pytest`, `uv run ruff check`, `uv run ruff format --check` and `uv run mypy`.
- **`api/tim-actions/`:** `uv run pytest` and `uv run mypy`.
- **`web/`:** the `lint`, `format:check`, `typecheck`, `test`, `build` and `e2e` scripts.

When `az account show` succeeds, set the [live Kusto test](#live-kusto-tests) variables first, so the `kusto` tests run rather than skip.

The workflows are in `.github/workflows/`. Where CI differs from a local run:

| CI does                                                                                          | Locally                                                                                       |
| ------------------------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------- |
| `uv sync --locked --all-packages` and `npm ci`                                                   | A stale `uv.lock` or `package-lock.json` passes `uv sync` / `npm install` but fails CI         |
| `npm audit --omit=dev --audit-level=high`                                                        | Not part of any script; run it yourself after changing dependencies                           |
| PostgreSQL tests against a `postgres:17` service (`TIM_TEST_DATABASE_URL`)                       | `pgserver` unless you set `TIM_TEST_DATABASE_URL`                                             |
| Playwright with `CI` set: `forbidOnly`, 1 retry, 3 workers, HTML report                             | `list` reporter only, no retries                                                              |
| The e2e job's api on a `postgres:17` service (`TIM_TEST_DATABASE_URL`). The job also runs when `api/` changes | `pgserver` unless you set `TIM_TEST_DATABASE_URL`                                  |
| `npx playwright install --with-deps chromium`                                                    | `--with-deps` installs OS packages and needs root; usually only `chromium` is needed           |
| `build-api.yml` `docker-build-api`: builds the api image and runs the derived-image and `deploy/config` checks | Needs Docker; read the workflow for the exact commands |
| `deploy-check.yml`: Helm, kubeconform and `yq` checks of the chart and release versions, and the rendered `/etc/tim` mount and variables of both compose files | Needs those tools installed; read the workflow for the exact commands |
| `lint-workflows.yml`: actionlint and shellcheck on workflows, plus the `.github/scripts` tests     | `python3 -B -m unittest discover -s .github/scripts` (`-B` keeps `__pycache__` out of the tree) |

## Live Kusto tests

The `kusto` tests run against the shared test cluster, signed in with your own Azure CLI login, which `DefaultAzureCredential` picks up.

1. Sign in to the test tenant: `az login --tenant $(gh variable get TIM_TESTS_TENANT_ID)`.
2. Your account needs Viewer on the `Research` database to query, and Ingestor to ingest. Ask a maintainer of the cluster.
3. In `api/`, read the cluster from the repository variables and run the tests:

   ```sh
   export TIM_TEST_KUSTO_CLUSTER=$(gh variable get TIM_TEST_KUSTO_CLUSTER)
   export TIM_TEST_KUSTO_INGEST_URL=$(gh variable get TIM_TEST_KUSTO_INGEST_URL)
   uv run pytest -m kusto --no-cov
   ```

Both databases default to `Research`, as in CI. Each run adds an `itest` row to the ingest table.

## e2e tests

`npm run e2e` in `web/` runs every Playwright flow in `web/e2e/`. `playwright.config.ts` starts two servers:

- **The api**, on the port after Vite's (`E2E_PORT + 1`, default 5181), through `web/e2e/api_server.py` (`uv run --project ../api`).
  - It runs with `TIM_ENVIRONMENT=development`, `TIM_AUTH_DISABLED=true`, `TIM_DEV_ACTIONS=true`, `TIM_ACTIONS_DIR=web/e2e/actions`, `TIM_CONNECTIONS_FILE=web/e2e/connections.yaml` and `TIM_LABELS_FILE=web/e2e/labels.yaml`.
  - The dev compose stack runs the same instance with `TIM_CONFIG_DIR=./web/e2e`, `TIM_ACTIONS_DIR=/etc/tim/actions`, `TIM_CONNECTIONS_FILE=/etc/tim/connections.yaml`, `TIM_LABELS_FILE=/etc/tim/labels.yaml` and `TIM_DEV_ACTIONS=true` in `.env`.
  - Its Postgres is `TIM_TEST_DATABASE_URL`. Without it, it is a temporary `pgserver`, deleted when the run ends.
  - The script empties that database and applies the migrations once per run. So never point `TIM_TEST_DATABASE_URL` at a database you want to keep.
- **Vite**, on `E2E_PORT` (default 5180), with `VITE_AUTH_STUB=true`. It proxies `/api` to that api (`TIM_API_PROXY_TARGET`).

Neither server is reused, locally or in CI. If a port is in use, Playwright fails before any test runs.

- `E2E_PORT` must be a whole number from 1 to 65534. Anything else makes the config throw.
- Each run takes two ports. For parallel worktrees, give each its own `E2E_PORT`, two apart: 5180, 5182, 5184.

There are two kinds of flow. What the spec imports picks the kind:

| Flow | Imports | Talks to |
|---|---|---|
| Against the real api | `e2e/realApi.ts` | The api above. Nothing is intercepted. `page.route` is only for faults the server can't produce. New flows are written this way |
| Mocked | `e2e/fixtures.ts` | `web/e2e/mocks`, which intercept every `/api/**` call. The flows for the template and Kusto features, which predate actions |

In a real-api flow:

- **`page`** is signed in as a new analyst for each test, `analyst.upn`. The sign-in goes through the stub's `localStorage` key `tim.devStubUpn`.
- **`signIn(upn)`** opens a second browser context signed in as another analyst, for flows with several analysts.
- **`idPrefix`** is a random per-test prefix. The whole run shares one database. Give the `id`s a test creates this prefix, for example in the rows it pastes into `tim.dev_json`. Then annotations from other tests never show up.
- **Each scenario is one action** in `web/e2e/actions/*.yaml`. Add an action there rather than mocking a response.

## Development actions

With `TIM_DEV_ACTIONS=true`, the api registers actions that need no connection, and a connection type that runs no queries. It is development only ([ADR-0011](adr/0011-development-only-modes.md)).

- They are for e2e tests and UI work.
- They are in `tim_actions.dev`.
- Validate a directory that uses them with `uv run tim-api check --dev-actions --actions <dir>`.
- Print their schema with `uv run tim-api schema actions --dev-actions`.

There are two actions and two action file types:

- **`tim.dev_json` "JSON (development)"**: the run yields the rows the analyst pastes into its `rows` param, a JSON array of objects.
  - The optional `idColumn` param names the column that gives each row its `id`.
  - Its `pivot` is `rows`, for running it on selected rows.
- **`dev_rows`**, an action file type. It has the common fields (`key`, `name`, `menu`, `description`, `pivot`, `params`, `columns`, `id`), and these:

  | Field | What it does |
  |---|---|
  | `rows` | The rows the run yields |
  | `generate: <n>` | Yields `n` rows instead, numbered from 1. Each declared column gets a value made from the row number (`Host-2`, `2`, `true`, `2026-01-01T00:02:00Z`, `PT2S`, `{"n": 2}` by type). Without `columns`, each row is `{n}`. Give `rows` or `generate`, not both |
  | `params` with `from_columns` | Filter the rows. A param with a value keeps the rows whose first non-empty `from_columns` value equals it, or is one of its values for `many`. Only `string`, `number` and `boolean` params filter |
  | `delay` | Seconds to wait before the rows. Cancel or the timeout ends the run at once. Its worker thread still sleeps until the delay or the timeout |
  | `error` | Ends the run in error with this message, after the delay |
  | `details` | Run details (scalars) the run reports |

  ```yaml
  type: dev_rows
  key: dev-sign-ins
  name: Sign-ins
  menu: Development / Rows
  pivot: rows
  id: CorrelationId
  params:
    - { name: users, kind: string, many: true, required: false, from_columns: [User] }
  rows:
    - { User: alice@example.com, CorrelationId: c-1 }
    - { User: bob@example.com, CorrelationId: c-2 }
  ```

- **`dev_sink`**, an action file type for a sink ([architecture.md](architecture.md#sinks)). It has the common fields of a sink (`key`, `name`, `menu`, `description`), and these:
  - `delay`: seconds to wait before the sink ends. Cancel or the timeout ends the run at once.
  - `error`: ends the run in error with this message, after the delay.

  Without `error` it discards the rows.

`TIM_DEV_ACTIONS` also registers a connection type:

- **`dev_kql`**. It runs no queries, and its `auth` is `workload_identity` only.
  - Its `kql` editor schema has one table, `SignIns` (`TimeGenerated`, `UserPrincipalName`, `ResultType`), for any non-empty `database`.
  - Without a `database`, it gives no schema.
  - `web/e2e/connections.yaml` has two `dev_kql` connections. The action `dev-kql-editor` in `web/e2e/actions/editor-schema.yaml` uses them.

To use them with the main loop, uncomment `TIM_DEV_ACTIONS` and `TIM_ACTIONS_DIR` in `api/.env`.

- The actions in `web/e2e/actions` are the e2e scenarios.
- The dev `compose.yaml` takes `TIM_DEV_ACTIONS` and the instance file paths from the root `.env`, and mounts `TIM_CONFIG_DIR` (default `deploy/config`) at `/etc/tim` ([deployment.md](deployment.md#instance-files)).

## The uv workspace

`api/` is a uv workspace with two members. Each is its own distribution, with its own version and release ([ADR-0021](adr/0021-tim-actions-and-derived-images.md)):

| Member | Directory | What it is |
|---|---|---|
| `tim-api` | `api/` | The API |
| `tim-actions` | `api/tim-actions/` | The interface providers build against: `Action`, `Param`, `Column`, `Provider`, `Hook`, param validation, `tim_actions.testing` and its pytest plugin, and TIM's built-in provider |

They share one `api/uv.lock` and one `api/.venv`.

- `tim-api` depends on `tim-actions` through `[tool.uv.sources]`. So `uv sync` in `api/` installs both, with `tim-actions` editable.
- `uv sync --all-packages`, which CI runs, also installs `tim-actions`' own dev group.
- Run `uv add` in the member whose dependency it is.

Each member has its own tool settings in its `pyproject.toml`.

- `uv run ruff check` in `api/` lints both, each with its own settings.
- `mypy` and `pytest` run once per member, from its directory.

## Dependency pins

These pins hold `web/package.json` back on purpose.

- `.github/dependabot.yml` ignores the matching updates.
- When you lift a pin, remove its ignore rule too.

| Pin (`web/package.json`)                  | Why                                                                                                                                                                                               | Lift when                                                                                                        |
| ----------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------- |
| `typescript` `~6.0.3`                     | `typescript-eslint` declares the peer range `>=4.8.4 <6.1.0`, so TypeScript 6.1 or newer breaks `npm install` or lint.                                                                            | `typescript-eslint` supports TypeScript 6.1 or newer.                                                            |
| `overrides.openapi-typescript.typescript` | `openapi-typescript` declares the peer `typescript@^5.x`; the override (`$typescript`) makes it use the project's TypeScript.                                                                     | `openapi-typescript` widens its TypeScript peer range to cover the version in use.                               |
| `monaco-editor` `^0.55.1`                 | `@kusto/monaco-kusto` 15.0.1, the latest release, peers on `monaco-editor@^0.55.0` (0.55.x only). Its language service is built against that editor, so a newer `monaco-editor` is not installed. | `@kusto/monaco-kusto` releases a version that accepts a newer `monaco-editor`.                                   |
| `overrides.dompurify` `^3.4.15`           | `monaco-editor` 0.55 depends on exactly `dompurify` 3.2.7, which `npm audit --omit=dev` flags (CI runs `npm audit`). The override installs a 3.4.x release instead.                               | The `monaco-editor` pin is lifted: `monaco-editor` 0.57 depends on `dompurify` 3.4.15, which passes `npm audit`. |
| `@types/node` `^24`                       | Matches the Node 24 runtime (`engines.node`, `web/Dockerfile`), so Node APIs newer than 24 are a type error.                                                                                       | The runtime moves to a newer Node major. Move `engines.node` and the `web/Dockerfile` base image with it.         |

## AG Grid upgrades

Stored column views keep the `state.version` AG Grid reported and are never rewritten ([ADR-0022](adr/0022-column-views-store-grid-state.md)). On every AG Grid upgrade:

- Read the release's state-migration notes. A stored column view goes through `setState`'s own migration, then the browser's fit step (`web/src/features/action-column-views/columnViewState.ts`).
- Check the `getState` and `setState` behaviour the fit step relies on:
  - `getState` leaves out a section that is empty;
  - `setState` resets every section it isn't told to ignore.
- Run the column views e2e flow: `npx playwright test e2e/flows/column-views.spec.ts` in `web/`.

## API types

The SPA's API types are generated from the api's OpenAPI document. After you change a route, request or response model, run these in this order and commit all three outputs:

```bash
cd api
uv run python -m tim_api.openapi_export          # writes web/src/lib/api/openapi.json
UPDATE_SNAPSHOTS=1 uv run pytest tests/test_openapi_contract.py   # refresh api/tests/snapshots
cd ../web
npm run gen:api                                   # writes web/src/lib/api/schema.d.ts
```

- The export needs no environment or database.
- The contract test fails if the committed spec or snapshots are stale.

## Database migrations

To add a revision:

1. Run `uv run alembic revision -m "…"` in `api/`.
2. Fill in `upgrade()` and `downgrade()` in the new file in `api/migrations/versions/`.

Every alembic command needs `TIM_DATABASE_URL` exported, with a `postgresql+asyncpg://` URL.

The api image ships the migrations, so deployments run them with the same image ([operations.md](operations.md#run-database-migrations)).

## CI and releases

The rules live elsewhere:

- Branches, titles, the merge method and how titles decide releases: [RULES.md §6–7](RULES.md#6-git).
- Which commits release each package: [ADR-0016](adr/0016-release-versions.md).

The required checks are:

- **`pr-conventions`** (`pr-conventions.yml`), run by `.github/scripts/pr_conventions.py`. It checks:
  - that the PR title is a Conventional Commit;
  - that a breaking title's scope names every package the PR changes.

  It is skipped for `release-please--*` branches.
- **`build-web-gate`** (`build-web.yml`) and **`build-api-gate`** (`build-api.yml`), the build checks.

Both build workflows run on every PR. A `changes` job skips the build jobs when the PR touches none of these paths:

| Workflow | Paths |
|---|---|
| `build-web.yml` | `web/`, the workflow file, and `.editorconfig`, which Prettier reads |
| `build-api.yml` | `api/`, the workflow file, `docs/architecture.md` and `web/src/lib/api/openapi.json`, which the api tests read, and `deploy/config/`, which the image build checks |

- The gate job fails when the `changes` job or a build job failed or was cancelled.
- Runs on release-please PRs wait for approval (**Approve and run** on the PR) before they report.

Things the workflows don't tell you:

- **Renaming a package means updating its jsonpath.** An api release bumps the `tim-api` entry in `api/uv.lock` through a jsonpath in `release-please-config.json`. A `tim-actions` release bumps the `tim-actions` entry the same way. If you rename either package in its `pyproject.toml`, update its jsonpath too. Otherwise `uv sync --locked` fails on the release PR.
- **Images come from mirrors, not Docker Hub.** Docker Hub's anonymous pull limit stalls CI.
  - Docker Hub images are pulled through `mirror.gcr.io`: the Dockerfile bases, the `# syntax` frontend, the BuildKit image in `setup-buildx-action` and the `postgres` service.
  - `nginx-unprivileged` comes from its publisher's `ghcr.io/nginx`.
  - When you change one, keep the same image and tag.
  - Check the tag exists on the mirror: `docker buildx imagetools inspect mirror.gcr.io/library/<image>:<tag>`.
- **`kusto-live`** (`build-api.yml`) runs `pytest -m kusto` on pushes to `main` that change the api.
  - It signs in as an Entra test app through GitHub OIDC (`azure/login`, no secret).
  - The app needs a federated credential with subject `repo:itsnotapt/tim-data-investigate-platform:ref:refs/heads/main`. That is why pull requests can't run the job.
  - The app also needs Ingestor and Viewer on the test database.
  - The job reads the repository variables `TIM_TESTS_CLIENT_ID`, `TIM_TESTS_TENANT_ID`, `TIM_TEST_KUSTO_CLUSTER` and `TIM_TEST_KUSTO_INGEST_URL`.
  - It also reads `TIM_TEST_KUSTO_QUERY_DATABASE` and `TIM_TEST_KUSTO_DATABASE`, both defaulting to `Research`.
  - It is skipped while `TIM_TESTS_CLIENT_ID` is unset.
  - It is not part of `build-api-gate`. A failure shows on the commit but blocks nothing.
  - Each run adds an `itest` row to the ingest table.
- **Actions use their major tag (`@vN`).** `astral-sh/setup-uv` publishes only full version tags, so it is pinned to `v10.2.0`.

Repository settings that the branch flow depends on. They live in GitHub, not in the repo:

| Setting | Value |
|---|---|
| Default branch | `main` |
| Merge methods | squash only; merge commit and rebase disabled |
| Squash commit | title: PR title; message: blank |
| Actions | may create pull requests (release-please) |
| Ruleset `main` | no deletion, no force push; changes through a PR (0 approvals); required status checks `pr-conventions`, `build-web-gate` and `build-api-gate` (GitHub Actions), branches need not be up to date |
