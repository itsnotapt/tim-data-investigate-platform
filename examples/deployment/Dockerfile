# The derived image: TIM's api image with this provider installed against its constraints
# (docs/actions.md#building-and-deploying).
#   docker build --build-arg BASE=<api image> --tag <image> .
#   docker build --build-arg BASE=<api image> --target test .   # the tests, in the image
ARG BASE
FROM ${BASE} AS instance
COPY --chown=tim:tim pyproject.toml /tmp/provider/
COPY --chown=tim:tim src /tmp/provider/src
RUN uv pip install --python /app/.venv/bin/python -c /app/constraints.txt /tmp/provider

# The tests run against the tim-actions the image ships.
FROM instance AS test
RUN uv pip install --python /app/.venv/bin/python -c /app/constraints.txt pytest
COPY --chown=tim:tim tests /tmp/provider/tests
COPY --chown=tim:tim config /tmp/provider/config
WORKDIR /tmp/provider
RUN python -m pytest -p no:cacheprovider

FROM instance
