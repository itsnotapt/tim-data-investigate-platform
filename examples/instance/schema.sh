#!/usr/bin/env bash
# Writes schema/: the JSON Schemas of the action files, the connections file and the labels file,
# with this provider's types, for yaml-language-server. Run it after changing a type or the TIM
# version, and commit the result.
#   ./schema.sh <backend image>
set -euo pipefail
cd "$(dirname "$0")"

base=${1:?give the backend image, such as ghcr.io/itsnotapt/tim-data-investigate-platform/backend:5.0.0}
docker buildx build --builder default --build-arg "BASE=$base" --load --tag tim-instance:schema .
mkdir -p schema
for kind in actions connections labels; do
  docker run --rm tim-instance:schema tim-api schema "$kind" > "schema/$kind.schema.json"
done
