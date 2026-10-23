# A derived image, built the way docs/deployment.md tells operators to: TIM's backend image with a
# provider installed against its constraints. build-api.yml builds it from the PR's image.
#   docker build --build-arg BASE=<backend image> [--build-arg PROVIDER=incompatible] .
ARG BASE=ghcr.io/itsnotapt/tim-data-investigate-platform/backend:4
FROM ${BASE}
ARG PROVIDER=provider
COPY --chown=tim:tim ${PROVIDER} /tmp/provider
RUN uv pip install --python /app/.venv/bin/python -c /app/constraints.txt /tmp/provider
