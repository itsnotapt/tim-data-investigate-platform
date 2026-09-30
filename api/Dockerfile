# syntax=docker/dockerfile:1
# TIM API image. Build context: api/  (docker build -t tim-api api/)

FROM python:3.12-slim-bookworm AS builder
COPY --from=ghcr.io/astral-sh/uv:0.12 /uv /uvx /bin/

ENV UV_COMPILE_BYTECODE=1 \
    UV_LINK_MODE=copy \
    UV_PYTHON_DOWNLOADS=never \
    UV_PROJECT_ENVIRONMENT=/app/.venv

WORKDIR /app

# Dependencies first (cached until pyproject.toml / uv.lock change).
RUN --mount=type=cache,target=/root/.cache/uv \
    --mount=type=bind,source=uv.lock,target=uv.lock \
    --mount=type=bind,source=pyproject.toml,target=pyproject.toml \
    uv sync --locked --no-dev --no-install-project

# Then the project itself, installed non-editable so src/ is not needed at runtime.
COPY pyproject.toml uv.lock README.md ./
COPY src ./src
RUN --mount=type=cache,target=/root/.cache/uv \
    uv sync --locked --no-dev --no-editable


FROM python:3.12-slim-bookworm AS runtime

RUN groupadd --system --gid 10001 tim \
 && useradd --system --uid 10001 --gid tim --no-create-home --shell /usr/sbin/nologin tim

COPY --from=builder --chown=tim:tim /app/.venv /app/.venv

ENV PATH="/app/.venv/bin:$PATH" \
    PYTHONUNBUFFERED=1 \
    PYTHONDONTWRITEBYTECODE=1

WORKDIR /app
# Migrations: `docker run ... alembic upgrade head` (alembic.ini + migrations/ live in /app).
COPY --chown=tim:tim alembic.ini ./
COPY --chown=tim:tim migrations ./migrations
USER tim
EXPOSE 8080

HEALTHCHECK --interval=30s --timeout=5s --start-period=15s --retries=3 \
    CMD ["python", "-c", "import urllib.request as u; u.urlopen('http://127.0.0.1:8080/api/healthChecks/liveness', timeout=3)"]

# One worker per container (target-architecture: task registry and TTL sweeper stay simple).
# --proxy-headers only trusts X-Forwarded-* from FORWARDED_ALLOW_IPS (default 127.0.0.1);
# set that env var to the proxy/ingress address(es) in deployment.
CMD ["uvicorn", "tim_api.main:app", "--host", "0.0.0.0", "--port", "8080", "--proxy-headers"]
