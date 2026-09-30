# tim-api

FastAPI backend for the TIM rewrite. Python 3.12, managed with [uv](https://docs.astral.sh/uv/).

```bash
uv sync                                         # install (creates .venv)
uv run uvicorn tim_api.main:app --reload --port 8000   # run
uv run pytest                                   # test (with coverage, fails under 80%)
uv run ruff check                               # lint
uv run ruff format --check                      # format check (drop --check to apply)
uv run mypy                                     # type check (strict; src + tests)
```

Local stack (PostgreSQL, running api and web together): see [local-dev.md](../docs/rewrite/local-dev.md).

Health probes: `GET /api/healthChecks/liveness` and `/readiness` (204). OpenAPI docs at `/api/docs`.

## Configuration

Configuration is via `TIM_*` environment variables, optionally loaded from a `.env` file (see
`src/tim_api/config.py`). Copy `.env.example` to `.env` for local development; it lists every
variable with comments. Required: `TIM_AUTH_TENANT_ID`, `TIM_AUTH_CLIENT_ID`,
`TIM_TAG_CLUSTER_URI`, `TIM_DATABASE_URL`. Startup fails with a message naming any missing or
invalid variable (values are never printed). `TIM_AUTH_DISABLED` is rejected when
`TIM_ENVIRONMENT=production` (the default). The Kusto app identity uses the standard `AZURE_*`
variables read by `azure-identity`.

## Dev auth

Real JWT validation is a P2 task. Until then, for local work and tests set
`TIM_ENVIRONMENT=development` and `TIM_AUTH_DISABLED=true`: the `get_current_principal`
dependency (`src/tim_api/auth/`) returns a fixed dev `Principal` (`DEV_PRINCIPAL`) and startup
logs a loud warning once. With auth enabled (the default), every route that depends on it
returns 401 (`WWW-Authenticate: Bearer`) because validation is not implemented yet
(`TODO(P2)`). `TIM_AUTH_DISABLED=true` with `TIM_ENVIRONMENT=production` (the default
environment) fails settings load and app startup. Routes use it with
`principal: Principal = Depends(get_current_principal)`; there is no debug endpoint.

## Docker image

```bash
docker build -t tim-api api/
docker run --rm -p 8080:8080 --env-file .env tim-api
```

Multi-stage on `python:3.12-slim`: the `ghcr.io/astral-sh/uv` image runs `uv sync --locked --no-dev` into `/app/.venv` (bytecode compiled, project installed non-editable); the runtime stage copies only the venv and runs as non-root uid 10001. It serves `uvicorn tim_api.main:app` on port 8080 with `--proxy-headers` and one worker. `HEALTHCHECK` calls `/api/healthChecks/liveness` with the Python standard library. The image takes the same `TIM_*` variables as above (nothing is baked in); `uvicorn` trusts `X-Forwarded-*` only from `FORWARDED_ALLOW_IPS` (default `127.0.0.1`), so set it to the proxy address in deployment.
