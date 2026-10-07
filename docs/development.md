# Development

How to run, test and change TIM (`web/` React SPA, `api/` FastAPI, PostgreSQL) on a dev machine. For environment variables see [configuration.md](configuration.md); for production see [deployment.md](deployment.md).

## Prerequisites

| Tool            | Version                    | Used for                         |
| --------------- | -------------------------- | -------------------------------- |
| Node.js + npm   | Node 24 or newer           | `web/`                           |
| uv              | current, with Python 3.12  | `api/` (Python is `>=3.12,<3.13`) |
| Docker          | Compose v2                 | PostgreSQL, or the whole stack   |

## Main loop: Postgres in Docker, api and web on the host

```bash
cp .env.example .env                  # optional: every compose variable has a default
docker compose up -d postgres         # PostgreSQL on 127.0.0.1:5432 (user/password/db: tim)

cd api
cp .env.example .env                  # then edit, see below
uv sync
export TIM_DATABASE_URL=postgresql+asyncpg://tim:tim@localhost:5432/tim
uv run alembic upgrade head           # tables are never created by the api itself
uv run uvicorn tim_api.main:app --reload --port 8080

cd web                                # second terminal
npm install
npm run dev                           # http://localhost:5173
```

- The api must listen on **8080**: the Vite dev server proxies `/api` to `http://localhost:8080` (`web/vite.config.ts`), so the browser stays same-origin and no CORS setup is needed.
- `alembic` reads only the `TIM_DATABASE_URL` process environment variable, not `api/.env`. Export it as above (or prefix the command).
- `api/.env` needs `TIM_DATABASE_URL`, `TIM_AUTH_TENANT_ID`, `TIM_AUTH_CLIENT_ID` and `TIM_TAG_CLUSTER_URI`; placeholder values work for dev. Start from `api/.env.example`, which sets `TIM_ENVIRONMENT=development`.
- Web variables for `npm run dev` go in `web/.env.local` (template: `web/.env.example`); `web/public/config.js` supplies the placeholder runtime config. See [configuration.md](configuration.md#web-vite-development).

### Dev authentication

| Side | Setting                    | Effect                                                                                  |
| ---- | -------------------------- | --------------------------------------------------------------------------------------- |
| api  | `TIM_AUTH_DISABLED=true`   | Every request runs as a fixed dev user; a warning is logged at startup. Refused when `TIM_ENVIRONMENT=production`. |
| web  | `VITE_AUTH_STUB=true`      | Fixed fake account and token, no Entra sign-in. Refused (config error) in production builds. |

Set both for UI work without an Entra tenant. Kusto calls need the on-behalf-of exchange, which is unavailable while auth is disabled (the api answers 503), so schema and query calls do not work in this mode; use `TIM_TAG_INGEST_FAKE=true` (with `TIM_ENVIRONMENT=development`) to exercise tag writes without a cluster.

## Full stack in containers

```bash
cp .env.example .env                  # optional
docker compose up --build
```

| Service    | Host port                          | Notes                                                                |
| ---------- | ---------------------------------- | -------------------------------------------------------------------- |
| `postgres` | `127.0.0.1:5432` (`POSTGRES_PORT`) | `postgres:17-alpine`, data in the `postgres-data` volume             |
| `migrate`  | none                               | One-shot `alembic upgrade head`; `api` starts after it succeeds      |
| `api`      | `8080` (`API_PORT`)                | Docs at `/api/docs`; liveness at `/api/healthChecks/liveness`        |
| `web`      | `8081` (`WEB_PORT`)                | nginx; serves the SPA, proxies `/api/` to `http://api:8080`          |

`api` waits for `migrate`, `web` waits for a healthy `api`. `docker compose down` stops the stack; `docker compose down -v` also deletes the database volume. Compose pins `TIM_ENVIRONMENT=development` for `api` and `web`. The web container has no stub-auth switch, so the UI at `:8081` needs a real Entra app registration (redirect URI `REDIRECT_URI`); use the main loop for UI work without one.

## API checks (`api/`)

```bash
uv run pytest                         # tests + coverage (fails below 80 %)
uv run ruff check
uv run ruff format --check            # `uv run ruff format` to fix
uv run mypy                           # strict, covers src and tests
```

| Topic              | Detail                                                                                                           |
| ------------------ | ---------------------------------------------------------------------------------------------------------------- |
| Markers            | `slow` (over ~5 s) is deselected by default; run with `uv run pytest -m slow` or `-m "slow or not slow"`. `kusto` tests need `TIM_TEST_KUSTO_INGEST_URL` (optional `TIM_TEST_KUSTO_DATABASE`, `TIM_TEST_KUSTO_TABLE`) and skip otherwise. |
| PostgreSQL tests   | Use `TIM_TEST_DATABASE_URL` (`postgresql+asyncpg://...`) if set, else a temporary server from the `pgserver` dev dependency (no Docker). They skip if neither works. Tests apply the migrations themselves. |
| Coverage           | `--cov` is on by default; `fail_under = 80` (`api/pyproject.toml`).                                              |

## Web checks (`web/`)

| Command                                | Purpose                                                              |
| -------------------------------------- | -------------------------------------------------------------------- |
| `npm run lint`                         | ESLint                                                               |
| `npm run format:check` / `format`      | Prettier check / write                                               |
| `npm run typecheck`                    | `tsc --noEmit` for `src` and for `e2e`                               |
| `npm test` / `npm run test:watch`      | Vitest (jsdom), single run / watch                                   |
| `npm run build`                        | Typecheck, then `vite build` into `web/dist`                         |
| `npm run e2e` / `e2e:headed`           | Playwright, headless / headed Chromium                               |

End-to-end tests need the browser once: `npx playwright install chromium`. Playwright starts the Vite dev server itself (`npx vite --port 5180 --strictPort`) with `VITE_AUTH_STUB=true`. It uses the dev server rather than a production build because the auth stub is refused in production builds. Every `/api/**` call is intercepted by mocks in `web/e2e/mocks`, so no api or database is needed. Reports go to `web/playwright-report` and `web/test-results` (git-ignored).

Specs are organised by feature, one file per flow in `web/e2e/flows/` (for example `query-manager.spec.ts`, `pivot.spec.ts`, `share.spec.ts`, `tag-events.spec.ts`), plus `web/e2e/smoke.spec.ts`. Run a single file with `npx playwright test e2e/flows/pivot.spec.ts`.

Set `E2E_SHOTS=1` to also write screenshots to `web/e2e/.screenshots` (git-ignored by `web/.gitignore`); without it the screenshot helpers do nothing.

### Dependency pins

| Pin (`web/package.json`)                   | Why                                                                                                                                  | Lift when                                                                                           |
| ------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------- |
| `typescript` `~6.0.3`                      | `typescript-eslint` declares the peer range `>=4.8.4 <6.1.0`, so TypeScript 6.1 or newer breaks `npm install` or lint.               | `typescript-eslint` supports TypeScript 6.1 or newer.                                               |
| `overrides.openapi-typescript.typescript`  | `openapi-typescript` declares the peer `typescript@^5.x`; the override (`$typescript`) makes it use the project's TypeScript.        | `openapi-typescript` widens its TypeScript peer range to cover the version in use.                  |
| `overrides.dompurify` `^3.4.15`            | `monaco-editor` 0.55 depends on exactly `dompurify` 3.2.7, which `npm audit --omit=dev` flags (CI runs `npm audit`). The override installs a 3.4.x release instead. `@kusto/monaco-kusto` 15 peers on `monaco-editor@^0.55.0`, so the editor cannot simply be upgraded. | `monaco-editor` ships a `dompurify` dependency that passes `npm audit`, and `@kusto/monaco-kusto` accepts that `monaco-editor`. |

The api has no version pins or overrides beyond the Python range `>=3.12,<3.13` in `api/pyproject.toml`; `uv.lock` fixes the rest.

## API types

The SPA's API types are generated from the api's OpenAPI document. After changing a route, request or response model:

```bash
cd api
uv run python -m tim_api.openapi_export          # writes web/src/lib/api/openapi.json
UPDATE_SNAPSHOTS=1 uv run pytest tests/test_openapi_contract.py   # refresh api/tests/snapshots
cd ../web
npm run gen:api                                   # writes web/src/lib/api/schema.d.ts
```

Commit the three outputs with the change. The export needs no environment or database. The contract test fails if the committed spec or snapshots are stale.

## Database migrations

Schema changes are Alembic revisions in `api/migrations/versions/` (async engine, URL from `TIM_DATABASE_URL`).

```bash
cd api
uv run alembic revision -m "add foo column"       # then edit the new file's upgrade()/downgrade()
uv run alembic upgrade head
uv run alembic downgrade -1                       # or: downgrade base (drops everything)
uv run alembic current
```

The api image contains `alembic.ini` and `migrations/`, so the same image runs migrations in compose and in deployment (see [operations.md](operations.md#run-database-migrations)).

## CI and releases

| Workflow (`.github/workflows/`) | Trigger                                   | What it runs                                                                                          |
| ------------------------------- | ----------------------------------------- | ----------------------------------------------------------------------------------------------------- |
| `build-api.yml`                 | PR / push to `main` touching `api/**`     | `uv sync --locked`, ruff check, ruff format check, mypy, pytest against a `postgres:17` service; Docker build (no push) |
| `build-web.yml`                 | PR / push to `main` touching `web/**`     | `npm ci`, `npm audit --omit=dev --audit-level=high`, lint, format check, typecheck, test, build, Playwright e2e; Docker build (no push) |
| `release-please.yml`            | push to `main`                            | release-please manifest with components `core` (repo root), `web` and `api`; a `web` or `api` release builds and pushes `ghcr.io/<repo>/tim-web` or `ghcr.io/<repo>/tim-api` |

Run the same commands locally before opening a PR.

## Commits and branches

Branch naming, Conventional Commits and documentation rules are in [RULES.md](RULES.md). Release notes and versions are generated from commit messages, so use the `feat:`, `fix:` and related prefixes with a scope such as `(web)` or `(api)`.
