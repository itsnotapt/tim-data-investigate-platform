# Local development

How to run TIM (`web/` + `api/` + PostgreSQL) on a dev machine. Legacy `frontend/` and `backend/` are not covered.

## Prerequisites

- **Node 24** and npm (`web/`).
- **[uv](https://docs.astral.sh/uv/)** with Python 3.12 (`api/`).
- **Docker** with Compose v2 (PostgreSQL, or the whole stack).

## Main loop: Postgres in Docker, api and web on the host

```bash
cp .env.example .env                       # optional, every variable has a dev default
docker compose up -d postgres              # PostgreSQL on localhost:5432 (tim/tim/tim)

cd api
cp .env.example .env                       # then edit, see "Required env" below
uv sync
uv run alembic upgrade head          # create/upgrade tables (not run automatically)
uv run uvicorn tim_api.main:app --reload --port 8080

cd web                                     # second terminal
npm install
npm run dev                                # http://localhost:5173
```

The Vite dev server proxies `/api` to `http://localhost:8080` (`web/vite.config.ts`), so the browser stays same-origin and no CORS setup is needed. Keep the api on port 8080 or change the proxy target. Set `VITE_AUTH_STUB=true` in `web/.env.local` for the stub sign-in (see `web/README.md`).

## Full stack in containers

```bash
cp .env.example .env                       # optional
docker compose up --build
```

| Service    | URL / port                              | Notes                                                                 |
| ---------- | --------------------------------------- | --------------------------------------------------------------------- |
| `web`      | http://localhost:8081 (`WEB_PORT`)      | nginx image; proxies `/api/` to `http://api:8080`                     |
| `api`      | http://localhost:8080 (`API_PORT`)      | docs at `/api/docs`, liveness at `/api/healthChecks/liveness`         |
| `postgres` | 127.0.0.1:5432 (`POSTGRES_PORT`)        | `postgres:17-alpine`, data in the `postgres-data` volume              |

`api` waits for a healthy `postgres`, and `web` for a healthy `api`. `docker compose down -v` also deletes the database volume. The api never creates tables itself. In compose, the one-shot `migrate` service runs `alembic upgrade head` and `api` starts only after it succeeds. Outside compose, run `uv run alembic upgrade head` from `api/` first.

## Required env

Compose reads the repo-root `.env` (template: `.env.example`, lists every variable). Compose pins `TIM_ENVIRONMENT=development` for `api` and `web`.

- `api` (see `api/README.md`): `TIM_DATABASE_URL` (compose builds it from `POSTGRES_*`), `TIM_AUTH_TENANT_ID`, `TIM_AUTH_CLIENT_ID`, `TIM_TAG_CLUSTER_URI` (https). Placeholder values are fine for dev.
- `web` container (see `web/README.md`): `BACKEND_URI`, `REDIRECT_URI`, `AUTH_CLIENT_ID`, `AUTH_TENANT_ID`, `TAG_CLUSTER`. `AGGRID_LICENSE` is optional (AG Grid runs as a trial when empty, ADR-0006). Compose maps these from the `TIM_*` and `REDIRECT_URI` values in `.env`.
- For a locally run api, use `TIM_DATABASE_URL=postgresql+asyncpg://tim:tim@localhost:5432/tim` in `api/.env`.

## Dev auth

`TIM_AUTH_DISABLED=true` (the compose default) makes every api request run as a fixed dev user and logs a warning at startup. It is only accepted with `TIM_ENVIRONMENT=development`; the api refuses to start in production with it. Real token validation is a later task. Pair it with the web stub auth (`VITE_AUTH_STUB=true` when using `npm run dev`). The web container image does not yet have a stub-auth switch, so the full-stack web UI shows the "not implemented" auth error until MSAL lands (P3-01). Use the main loop for UI work.
