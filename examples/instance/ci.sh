#!/usr/bin/env bash
# The instance's checks, which .github/workflows/ci.yaml runs: the tests in the image, the image
# build, `tim-api check` on config/, and the committed schema against the image's.
#   ./ci.sh <api image> [instance image tag]
# Needs Docker and uv.
set -euo pipefail
cd "$(dirname "$0")"

base=${1:?give the api image, such as ghcr.io/itsnotapt/tim-data-investigate-platform/api:2.0.0}
image=${2:-tim-instance:ci}
# The default builder sees images loaded into the local Docker, such as a api image built
# just before.
build=(docker buildx build --builder default --build-arg "BASE=$base")

echo "::group::Tests"
"${build[@]}" --target test .
echo "::endgroup::"

echo "::group::Image"
"${build[@]}" --load --tag "$image" .
echo "::endgroup::"

echo "::group::tim-api check"
docker run --rm -v "$PWD/config:/etc/tim:ro" "$image" tim-api check \
  --actions /etc/tim/actions --connections /etc/tim/connections.yaml \
  --labels /etc/tim/labels.yaml
echo "::endgroup::"

echo "::group::Schema"
for kind in actions connections labels; do
  docker run --rm "$image" tim-api schema "$kind" | diff -u "schema/$kind.schema.json" - \
    || { echo "schema/$kind.schema.json is stale: run ./schema.sh $base" >&2; exit 1; }
done
# Each YAML document against its schema, as yaml-language-server validates it in an editor.
uv run --quiet --no-project --with jsonschema==4.26.0 --with pyyaml==6.0.3 python - <<'PY'
import json
from glob import glob

import jsonschema
import yaml

files = {
    "actions": glob("config/actions/*.yaml") + glob("src/example_provider/actions/*.yaml"),
    "connections": ["config/connections.yaml"],
    "labels": ["config/labels.yaml"],
}
problems = []
for kind, paths in files.items():
    with open(f"schema/{kind}.schema.json") as f:
        validator = jsonschema.Draft202012Validator(json.load(f))
    for path in paths:
        with open(path) as f:
            for number, document in enumerate(yaml.safe_load_all(f), 1):
                for error in validator.iter_errors(document):
                    problems.append(f"{path}, document {number}: {error.message}")
if problems:
    raise SystemExit("\n".join(problems))
PY
echo "::endgroup::"
