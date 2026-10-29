# A derived image, built the way docs/deployment.md tells operators to: TIM's api image with a
# provider installed against its constraints. build-api.yml builds it from the PR's image.
#   docker build --build-arg BASE=<api image> [--build-arg PROVIDER=incompatible] .
ARG BASE=ghcr.io/itsnotapt/tim-data-investigate-platform/api:2
FROM ${BASE}
ARG PROVIDER=provider
COPY --chown=tim:tim ${PROVIDER} /tmp/provider
RUN uv pip install --python /app/.venv/bin/python -c /app/constraints.txt /tmp/provider
