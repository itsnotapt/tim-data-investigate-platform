# Development

How to run, test and change TIM on a dev machine. Variables: [configuration.md](configuration.md). Production: [deployment.md](deployment.md). Process rules: [RULES.md](RULES.md). Code and doc style: [CODING_STANDARDS.md](../CODING_STANDARDS.md).

You need Node 24+, uv (it installs Python 3.12) and Docker Compose v2. Commands are the `scripts` in `web/package.json` and the tool settings in `api/pyproject.toml`.

## Things that aren't obvious

- **Run migrations before starting the api.** The api never creates tables. Alembic reads `TIM_DATABASE_URL` only from the process environment, not from `api/.env`, so export it (see the main loop below).
- **`api/.env.example` doesn't match the compose database.** Its URL uses the password `change-me`, but compose Postgres is `tim:tim`. Fix the URL in `api/.env` or export `TIM_DATABASE_URL`, which overrides `.env`. The api reads `.env` from the current directory, so start it from `api/`.
- **`TIM_ENVIRONMENT` defaults to `production`.** The dev-only switches (`TIM_AUTH_DISABLED`, `TIM_DATABASE_URL=memory://`, `TIM_TAG_INGEST_FAKE`) are refused or silently ignored unless it is `development` ([ADR-0011](adr/0011-development-only-modes.md)). `api/.env.example` sets it.
- **Startup needs a credential unless auth is disabled.** Set `TIM_AUTH_CLIENT_SECRET` or `AZURE_FEDERATED_TOKEN_FILE`, or uncomment `TIM_AUTH_DISABLED=true` in `api/.env`.
- **The api must listen on 8080.** `web/vite.config.ts` proxies `/api` there, so there is no CORS setup.
- **UI work without Entra:** set both `TIM_AUTH_DISABLED=true` (api) and `VITE_AUTH_STUB=true` (`web/.env.local`). Kusto schema and query calls then answer 503, because the on-behalf-of exchange needs a real token. Use `TIM_TAG_INGEST_FAKE=true` to exercise tag writes without a cluster.
- **The compose web container can't stub sign-in.** The UI at `:8081` needs a real Entra app registration (`REDIRECT_URI`), so use the main loop for UI work without one. The root `.env` (compose) and `api/.env` (main loop) are separate files.
- **Tests that don't run by default:** `slow` tests are deselected (`uv run pytest -m slow` runs them, and CI doesn't). `kusto` tests skip unless `TIM_TEST_KUSTO_INGEST_URL` is set. PostgreSQL tests use `TIM_TEST_DATABASE_URL`, falling back to a temporary `pgserver` (no Docker needed), and skip if neither works. See [configuration.md](configuration.md#test-only-variables).
- **`pytest` fails below 80 % coverage**, even when every test passes.
- **Playwright reuses a running server on port 5180 locally.** A stray dev server started without `VITE_AUTH_STUB` breaks the e2e tests. They run against the Vite dev server rather than a build, because production builds refuse the auth stub. Install the browser once with `npx playwright install chromium`. The e2e tests mock every `/api/**` call (`web/e2e/mocks`), so they need no api or database. Set `E2E_SHOTS=1` to save screenshots.
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

Run the checks CI runs before you push: in `api/`, `uv run pytest`, `uv run ruff check`, `uv run ruff format --check` and `uv run mypy`; in `web/`, the `lint`, `format:check`, `typecheck`, `test`, `build` and `e2e` scripts. The workflows are in `.github/workflows/`.

Where CI differs from a local run:

| CI does                                                                                          | Locally                                                                                       |
| ------------------------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------- |
| `uv sync --locked` and `npm ci`                                                                  | A stale `uv.lock` or `package-lock.json` passes `uv sync` / `npm install` but fails CI         |
| `npm audit --omit=dev --audit-level=high`                                                        | Not part of any script; run it yourself after changing dependencies                           |
| PostgreSQL tests against a `postgres:17` service (`TIM_TEST_DATABASE_URL`)                       | `pgserver` unless you set `TIM_TEST_DATABASE_URL`                                             |
| Playwright with `CI` set: `forbidOnly`, 1 retry, 2 workers, HTML report, never reuses a server    | `list` reporter only, no retries, reuses a running server                                     |
| `npx playwright install --with-deps chromium`                                                    | `--with-deps` installs OS packages and needs root; usually only `chromium` is needed           |
| `deploy-check.yml`: Helm, kubeconform and `yq` checks of the chart and release versions           | Needs those tools installed; read the workflow for the exact commands                         |
| `lint-workflows.yml`: actionlint and shellcheck on workflows, plus the `.github/scripts` tests     | `python3 -B -m unittest discover -s .github/scripts` (`-B` keeps `__pycache__` out of the tree) |

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

`build-web-gate` (`build-web.yml`) and `build-api-gate` (`build-api.yml`) are the required build checks. Both workflows run on every PR; a `changes` job skips the build jobs when the PR does not touch `web/` or `api/` (or the workflow file; for api also `docs/architecture.md` and `web/src/lib/api/openapi.json`, which the api tests read), and the gate job fails when the `changes` job or a build job failed or was cancelled. Runs on release-please PRs wait for approval (**Approve and run** on the PR) before they report.

Things the workflows don't tell you:

- An api release bumps the `tim-api` entry in `api/uv.lock` through a jsonpath in `release-please-config.json`. If you rename the package in `api/pyproject.toml`, update that jsonpath too, or `uv sync --locked` fails on the release PR.
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
