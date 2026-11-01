#!/usr/bin/env bash
# The demo instance's checks, which .github/workflows/build-api.yml runs: the action tests in the
# image, the image build (which checks the dataset against data/SHA256SUMS), and `tim-api check` on
# config/.
#   ./ci.sh <api image> [demo image tag]
# Needs Docker.
set -euo pipefail
cd "$(dirname "$0")"

base=${1:?give the api image, such as ghcr.io/itsnotapt/tim-data-investigate-platform/api:2.0.0}
image=${2:-tim-demo:ci}
# The default builder sees images loaded into the local Docker, such as an api image built
# just before.
build=(docker buildx build --builder default --build-arg "BASE=$base")

echo "::group::Tests"
"${build[@]}" --target test .
echo "::endgroup::"

echo "::group::Image"
"${build[@]}" --load --tag "$image" .
echo "::endgroup::"

# The connection's auth: none is refused in production, so the check runs in development, as the
# demo instance does.
echo "::group::tim-api check"
docker run --rm -e TIM_ENVIRONMENT=development "$image" tim-api check \
  --actions /etc/tim/actions --connections /etc/tim/connections.yaml \
  --labels /etc/tim/labels.yaml
echo "::endgroup::"
