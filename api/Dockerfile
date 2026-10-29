# syntax=mirror.gcr.io/docker/dockerfile:1
# TIM API image. Build context: api/  (docker build -t tim-api api/)

FROM mirror.gcr.io/library/python:3.12-slim-trixie AS builder
COPY --from=ghcr.io/astral-sh/uv:0.12 /uv /uvx /bin/

ENV UV_COMPILE_BYTECODE=1 \
    UV_LINK_MODE=copy \
    UV_PYTHON_DOWNLOADS=never \
    UV_PROJECT_ENVIRONMENT=/app/.venv

WORKDIR /app

# Dependencies first (cached until the pyproject.toml files / uv.lock change).
RUN --mount=type=cache,target=/root/.cache/uv \
    --mount=type=bind,source=uv.lock,target=uv.lock \
    --mount=type=bind,source=pyproject.toml,target=pyproject.toml \
    --mount=type=bind,source=tim-actions/pyproject.toml,target=tim-actions/pyproject.toml \
    uv sync --locked --no-dev --no-install-workspace

# Then the workspace (tim-api and tim-actions), installed non-editable so the sources are not
# needed at runtime.
COPY pyproject.toml uv.lock README.md ./
COPY src ./src
COPY tim-actions/pyproject.toml tim-actions/README.md ./tim-actions/
COPY tim-actions/src ./tim-actions/src
RUN --mount=type=cache,target=/root/.cache/uv \
    uv sync --locked --no-dev --no-editable

# The constraints derived images install providers against (ADR-0021): every locked dependency,
# plus tim-api and tim-actions pinned to their installed versions so a provider for another
# breaking tim-actions version fails to resolve.
RUN uv export --locked --no-dev --no-hashes --no-header --no-emit-workspace \
        --output-file constraints.txt \
 && /app/.venv/bin/python -c "from importlib.metadata import version; \
print(*(f'{d}=={version(d)}' for d in ('tim-api', 'tim-actions')), sep='\n')" >> constraints.txt


FROM mirror.gcr.io/library/python:3.12-slim-trixie AS runtime

RUN groupadd --system --gid 10001 tim \
 && useradd --system --uid 10001 --gid tim --no-create-home --shell /usr/sbin/nologin tim

COPY --from=builder --chown=tim:tim /app/.venv /app/.venv
# Derived images: `uv pip install --python /app/.venv/bin/python -c /app/constraints.txt <packages>`
# (docs/deployment.md). The tim user has no home, so uv runs without a cache.
COPY --from=ghcr.io/astral-sh/uv:0.12 /uv /bin/
COPY --from=builder /app/constraints.txt /app/constraints.txt

ENV PATH="/app/.venv/bin:$PATH" \
    PYTHONUNBUFFERED=1 \
    PYTHONDONTWRITEBYTECODE=1 \
    UV_COMPILE_BYTECODE=1 \
    UV_LINK_MODE=copy \
    UV_NO_CACHE=1 \
    UV_PYTHON_DOWNLOADS=never

WORKDIR /app
# Migrations: `docker run ... alembic upgrade head` (alembic.ini + migrations/ live in /app).
COPY --chown=tim:tim alembic.ini ./
COPY --chown=tim:tim migrations ./migrations
USER tim
EXPOSE 8080

HEALTHCHECK --interval=30s --timeout=5s --start-period=15s --retries=3 \
    CMD ["python", "-c", "import urllib.request as u; u.urlopen('http://127.0.0.1:8080/api/healthChecks/liveness', timeout=3)"]

# One worker per container: runs and the retention sweeper are process-local.
# --proxy-headers only trusts X-Forwarded-* from FORWARDED_ALLOW_IPS (default 127.0.0.1);
# set that env var to the proxy/ingress address(es) in deployment.
CMD ["uvicorn", "tim_api.main:app", "--host", "0.0.0.0", "--port", "8080", "--proxy-headers"]
