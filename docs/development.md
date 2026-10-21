# Development

How to run, test and change TIM on a dev machine. Variables: [configuration.md](configuration.md). Production: [deployment.md](deployment.md). Process rules: [RULES.md](RULES.md). Code and doc style: [CODING_STANDARDS.md](../CODING_STANDARDS.md).

You need Node 24+, uv (it installs Python 3.12) and Docker Compose v2. Commands are the `scripts` in `web/package.json` and the tool settings in `api/pyproject.toml`.

## Things that aren't obvious

- **Run migrations before starting the api.** The api never creates tables. Alembic reads `TIM_DATABASE_URL` only from the process environment, not from `api/.env`, so export it (see the main loop below).
- **`api/.env.example` doesn't match the compose database.** Its URL uses the password `change-me`, but compose Postgres is `tim:tim`. Fix the URL in `api/.env` or export `TIM_DATABASE_URL`, which overrides `.env`. The api reads `.env` from the current directory, so start it from `api/`.
- **`TIM_ENVIRONMENT` defaults to `production`.** The dev-only switches (`TIM_AUTH_DISABLED`, `TIM_DEV_ACTIONS`, `TIM_DATABASE_URL=memory://`, `TIM_TAG_INGEST_FAKE`) are refused or silently ignored unless it is `development` ([ADR-0011](adr/0011-development-only-modes.md)). `api/.env.example` sets it.
- **Startup needs a credential unless auth is disabled.** Set `TIM_AUTH_CLIENT_SECRET` or `AZURE_FEDERATED_TOKEN_FILE`, or uncomment `TIM_AUTH_DISABLED=true` in `api/.env`.
- **The api must listen on 8080.** `web/vite.config.ts` proxies `/api` there (unless `TIM_API_PROXY_TARGET` says otherwise), so there is no CORS setup.
- **UI work without Entra:** set both `TIM_AUTH_DISABLED=true` (api) and `VITE_AUTH_STUB=true` (`web/.env.local`). You are signed in as `dev.user@example.com`; to be another analyst, run `localStorage.setItem('tim.devStubUpn', 'bob@example.com')` in the browser console and reload. The stub sends `Bearer dev:<upn>`, and the api runs the request as that analyst. Kusto schema and query calls answer 503, because the on-behalf-of exchange needs a real token. Use `TIM_TAG_INGEST_FAKE=true` to exercise tag writes without a cluster, and the [development actions](#development-actions) for actions without a connection.
- **The compose web container can't stub sign-in.** The UI at `:8081` needs a real Entra app registration (`REDIRECT_URI`), so use the main loop for UI work without one. The root `.env` (compose) and `api/.env` (main loop) are separate files.
- **Tests that don't run by default:** `slow` tests are deselected (`uv run pytest -m slow` runs them, and CI doesn't). `kusto` tests skip unless `TIM_TEST_KUSTO_INGEST_URL` is set. PostgreSQL tests use `TIM_TEST_DATABASE_URL`, falling back to a temporary `pgserver` (no Docker needed), and skip if neither works. See [configuration.md](configuration.md#test-only-variables).
- **`pytest` fails below 80 % coverage**, even when every test passes.
- **Playwright reuses a running Vite server on port 5180 locally.** A stray dev server started without `VITE_AUTH_STUB` breaks the e2e tests. They run against the Vite dev server rather than a build, because production builds refuse the auth stub. Install the browser once with `npx playwright install chromium`. Playwright also starts its own api, so uv must be installed: see [e2e tests](#e2e-tests). Set `E2E_SHOTS=1` to save screenshots.
- **`npm ls` reports `msw` as invalid.** That is expected: `@vitest/mocker` peers on `msw@^2` for browser mode, which TIM doesn't use (tests run in jsdom). It clears once `vitest` accepts `msw` 3.

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

Web variables for `npm run dev` go in `web/.env.local` (template: `web/.env.example`). See [configuration.md](configuration.md#web-vite-development).

**Full stack in containers:** `docker compose up --build`, then open `http://localhost:8081`. Services, ports and start order are in `compose.yaml`, and `docker compose down -v` also deletes the database.

## Checks

Run the checks CI runs before you push: in `api/`, `uv run pytest`, `uv run ruff check`, `uv run ruff format --check` and `uv run mypy`; in `api/tim-actions/`, `uv run pytest` and `uv run mypy`; in `web/`, the `lint`, `format:check`, `typecheck`, `test`, `build` and `e2e` scripts. The workflows are in `.github/workflows/`.

Where CI differs from a local run:

| CI does                                                                                          | Locally                                                                                       |
| ------------------------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------- |
| `uv sync --locked --all-packages` and `npm ci`                                                   | A stale `uv.lock` or `package-lock.json` passes `uv sync` / `npm install` but fails CI         |
| `npm audit --omit=dev --audit-level=high`                                                        | Not part of any script; run it yourself after changing dependencies                           |
| PostgreSQL tests against a `postgres:17` service (`TIM_TEST_DATABASE_URL`)                       | `pgserver` unless you set `TIM_TEST_DATABASE_URL`                                             |
| Playwright with `CI` set: `forbidOnly`, 1 retry, 3 workers, HTML report, never reuses a server    | `list` reporter only, no retries, reuses a running Vite server                                |
| The e2e job's api on a `postgres:17` service (`TIM_TEST_DATABASE_URL`); it also runs when `api/` changes | `pgserver` unless you set `TIM_TEST_DATABASE_URL`                                       |
| `npx playwright install --with-deps chromium`                                                    | `--with-deps` installs OS packages and needs root; usually only `chromium` is needed           |
| `deploy-check.yml`: Helm, kubeconform and `yq` checks of the chart and release versions           | Needs those tools installed; read the workflow for the exact commands                         |
| `lint-workflows.yml`: actionlint and shellcheck on workflows, plus the `.github/scripts` tests     | `python3 -B -m unittest discover -s .github/scripts` (`-B` keeps `__pycache__` out of the tree) |

## e2e tests

`npm run e2e` in `web/` runs every Playwright flow in `web/e2e/`. `playwright.config.ts` starts two servers:

- **The api**, on port 5181, through `web/e2e/api_server.py` (`uv run --project ../api`). It runs with `TIM_ENVIRONMENT=development`, `TIM_AUTH_DISABLED=true`, `TIM_DEV_ACTIONS=true` and `TIM_ACTIONS_DIR=web/e2e/actions`. Its Postgres is `TIM_TEST_DATABASE_URL`, or a temporary `pgserver` deleted when the run ends. The script empties that database and applies the migrations once per run, so never point `TIM_TEST_DATABASE_URL` at a database you want to keep. This server is never reused.
- **Vite**, on port 5180, with `VITE_AUTH_STUB=true`, proxying `/api` to that api (`TIM_API_PROXY_TARGET`).

There are two kinds of flow, picked by what the spec imports:

| Flow | Imports | Talks to |
|---|---|---|
| Against the real api | `e2e/realApi.ts` | The api above. Nothing is intercepted; `page.route` is only for faults the server can't produce. New flows are written this way |
| Mocked | `e2e/fixtures.ts` | `web/e2e/mocks`, which intercept every `/api/**` call. The flows for the template and Kusto features, which predate actions |

In a real-api flow:

- `page` is signed in as a new analyst for each test, `analyst.upn`, through the stub's `localStorage` key `tim.devStubUpn`. `signIn(upn)` opens a second browser context signed in as another analyst, for flows with several analysts.
- `idPrefix` is a random per-test prefix. The database is shared by the whole run, so give the `id`s a test creates this prefix (for example in the rows it pastes into `tim.dev_json`), and annotations from other tests never show up.
- Each scenario is one action in `web/e2e/actions/*.yaml`. Add an action there rather than mocking a response.

## Development actions

With `TIM_DEV_ACTIONS=true` (development only, [ADR-0011](adr/0011-development-only-modes.md)) the api registers actions that need no connection, for e2e tests and for UI work. They are in `tim_actions.dev`. Validate a directory that uses them with `uv run tim-api check --dev-actions --actions <dir>`, and print their schema with `uv run tim-api schema actions --dev-actions`.

- **`tim.dev_json` "JSON (development)"**: the analyst pastes rows into its `rows` param, a JSON array of objects, and the run yields them. The optional `idColumn` param names the column that gives each row its `id`. Its `pivot` is `rows`, for running it on selected rows.
- **`dev_rows`**, an action file type. Besides the common fields (`key`, `name`, `menu`, `description`, `pivot`, `params`, `columns`, `id`):

  | Field | What it does |
  |---|---|
  | `rows` | The rows the run yields |
  | `generate: <n>` | Yields `n` rows instead, numbered from 1. Each declared column gets a value made from the row number (`Host-2`, `2`, `true`, `2026-01-01T00:02:00Z`, `PT2S`, `{"n": 2}` by type); without `columns`, each row is `{n}`. Give `rows` or `generate`, not both |
  | `params` with `from_columns` | Filter the rows: a param with a value keeps the rows whose first non-empty `from_columns` value equals it (or is one of its values, for `many`). Only `string`, `number` and `boolean` params filter |
  | `delay` | Seconds to wait before the rows. Cancel or the timeout ends the run at once, though its worker thread sleeps on until the delay or the timeout |
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

To use them with the main loop, uncomment `TIM_DEV_ACTIONS` and `TIM_ACTIONS_DIR` in `api/.env` (the actions in `web/e2e/actions` are the e2e scenarios); the dev `compose.yaml` carries the same variables, commented out.

## The uv workspace

`api/` is a uv workspace with two members, each its own distribution with its own version and release ([ADR-0021](adr/0021-tim-actions-and-derived-images.md)):

| Member | Directory | What it is |
|---|---|---|
| `tim-api` | `api/` | The API |
| `tim-actions` | `api/tim-actions/` | The interface providers build against: `Action`, `Param`, `Column`, `Provider`, `Hook`, param validation, and TIM's built-in provider |

They share one `api/uv.lock` and one `api/.venv`. `tim-api` depends on `tim-actions` through `[tool.uv.sources]`, so `uv sync` in `api/` installs both, with `tim-actions` editable. `uv sync --all-packages`, which CI runs, also installs `tim-actions`' own dev group. Run `uv add` in the member whose dependency it is.

Each member has its own tool settings in its `pyproject.toml`. `uv run ruff check` in `api/` lints both, each with its own settings; `mypy` and `pytest` run once per member, from its directory.

## Dependency pins

These pins hold `web/package.json` back on purpose. `.github/dependabot.yml` ignores the matching updates. When you lift a pin, remove its ignore rule too.

| Pin (`web/package.json`)                  | Why                                                                                                                                                                                               | Lift when                                                                                                        |
| ----------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------- |
| `typescript` `~6.0.3`                     | `typescript-eslint` declares the peer range `>=4.8.4 <6.1.0`, so TypeScript 6.1 or newer breaks `npm install` or lint.                                                                            | `typescript-eslint` supports TypeScript 6.1 or newer.                                                            |
| `overrides.openapi-typescript.typescript` | `openapi-typescript` declares the peer `typescript@^5.x`; the override (`$typescript`) makes it use the project's TypeScript.                                                                     | `openapi-typescript` widens its TypeScript peer range to cover the version in use.                               |
| `monaco-editor` `^0.55.1`                 | `@kusto/monaco-kusto` 15.0.1, the latest release, peers on `monaco-editor@^0.55.0` (0.55.x only). Its language service is built against that editor, so a newer `monaco-editor` is not installed. | `@kusto/monaco-kusto` releases a version that accepts a newer `monaco-editor`.                                   |
| `overrides.dompurify` `^3.4.15`           | `monaco-editor` 0.55 depends on exactly `dompurify` 3.2.7, which `npm audit --omit=dev` flags (CI runs `npm audit`). The override installs a 3.4.x release instead.                               | The `monaco-editor` pin is lifted: `monaco-editor` 0.57 depends on `dompurify` 3.4.15, which passes `npm audit`. |
| `@types/node` `^24`                       | Matches the Node 24 runtime (`engines.node`, `web/Dockerfile`), so Node APIs newer than 24 are a type error.                                                                                       | The runtime moves to a newer Node major. Move `engines.node` and the `web/Dockerfile` base image with it.         |

## API types

The SPA's API types are generated from the api's OpenAPI document. After you change a route, request or response model, run these in this order and commit all three outputs:

```bash
cd api
uv run python -m tim_api.openapi_export          # writes web/src/lib/api/openapi.json
UPDATE_SNAPSHOTS=1 uv run pytest tests/test_openapi_contract.py   # refresh api/tests/snapshots
cd ../web
npm run gen:api                                   # writes web/src/lib/api/schema.d.ts
```

The export needs no environment or database. The contract test fails if the committed spec or snapshots are stale.

## Database migrations

Add a revision with `uv run alembic revision -m "…"` in `api/`, then fill in `upgrade()` and `downgrade()` in `api/migrations/versions/`. Every alembic command needs `TIM_DATABASE_URL` exported, with a `postgresql+asyncpg://` URL. The api image ships the migrations, so deployments run them with the same image ([operations.md](operations.md#run-database-migrations)).

## CI and releases

Branches, titles, the merge method and how titles decide releases are in [RULES.md §6–7](RULES.md#6-git). Which commits release each package is in [ADR-0016](adr/0016-release-versions.md). `.github/scripts/pr_conventions.py` is the required `pr-conventions` check (`pr-conventions.yml`). It checks that the PR title is a Conventional Commit and that a breaking title's scope names every package the PR changes. It is skipped for `release-please--*` branches.

`build-web-gate` (`build-web.yml`) and `build-api-gate` (`build-api.yml`) are the required build checks. Both workflows run on every PR; a `changes` job skips the build jobs when the PR does not touch `web/` or `api/` (or the workflow file; for web also `.editorconfig`, which Prettier reads; for api also `docs/architecture.md` and `web/src/lib/api/openapi.json`, which the api tests read), and the gate job fails when the `changes` job or a build job failed or was cancelled. Runs on release-please PRs wait for approval (**Approve and run** on the PR) before they report.

Things the workflows don't tell you:

- An api release bumps the `tim-api` entry in `api/uv.lock` through a jsonpath in `release-please-config.json`, and a `tim-actions` release bumps the `tim-actions` entry the same way. If you rename either package in its `pyproject.toml`, update its jsonpath too, or `uv sync --locked` fails on the release PR.
- Images do not come from Docker Hub, whose anonymous pull limit stalls CI: Docker Hub images (Dockerfile bases, the `# syntax` frontend, the BuildKit image in `setup-buildx-action`, the `postgres` service) are pulled through `mirror.gcr.io`, and `nginx-unprivileged` from its publisher's `ghcr.io/nginx`. Keep the same image and tag when you change one, and check the tag exists on the mirror (`docker buildx imagetools inspect mirror.gcr.io/library/<image>:<tag>`).
- Use each action's major tag (`@vN`). `astral-sh/setup-uv` publishes only full version tags, so it is pinned to `v10.2.0`.

Repository settings that the branch flow depends on. They live in GitHub, not in the repo:

| Setting | Value |
|---|---|
| Default branch | `main` |
| Merge methods | squash only; merge commit and rebase disabled |
| Squash commit | title: PR title; message: blank |
| Actions | may create pull requests (release-please) |
| Ruleset `main` | no deletion, no force push; changes through a PR (0 approvals); required status checks `pr-conventions`, `build-web-gate` and `build-api-gate` (GitHub Actions), branches need not be up to date |
