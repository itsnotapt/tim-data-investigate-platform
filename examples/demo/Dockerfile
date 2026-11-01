# The demo image: TIM's api image with the demo's instance files, the dataset and its loader.
#   docker build --build-arg BASE=<api image> --tag <image> .
#   docker build --build-arg BASE=<api image> --target test .   # the action tests, in the image
ARG BASE
# The release holding the dataset; data/SHA256SUMS lists its files.
ARG DATASET=demo-data-v1

FROM ${BASE} AS instance
COPY config /etc/tim

# The tests run against the tim-actions the image ships.
FROM instance AS test
RUN uv pip install --python /app/.venv/bin/python -c /app/constraints.txt pytest
COPY --chown=tim:tim tests /tmp/demo/tests
COPY --chown=tim:tim config /tmp/demo/config
WORKDIR /tmp/demo
RUN python -m pytest -p no:cacheprovider

# Every file data/SHA256SUMS lists, from the release; a file that doesn't match fails the build.
FROM mirror.gcr.io/library/alpine:3.22 AS dataset
ARG DATASET
WORKDIR /data
COPY data/SHA256SUMS ./
RUN while read -r _ name; do \
      wget -q "https://github.com/itsnotapt/tim-data-investigate-platform/releases/download/$DATASET/$name" \
        || exit 1; \
    done < SHA256SUMS \
 && sha256sum -c SHA256SUMS

FROM instance
ARG DATASET
ENV DEMO_DATASET=${DATASET}
COPY --from=dataset /data/*.jsonl.gz /demo/data/
COPY data/LICENSE data/NOTICE /demo/data/
COPY kusto /demo/kusto
# The loader copies each file here for the emulator, which mounts the same volume.
USER root
RUN install -d -o tim -g tim /ingest
USER tim
