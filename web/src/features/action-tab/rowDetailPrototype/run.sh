#!/usr/bin/env bash
# PROTOTYPE (#170, throwaway): `npm run prototype:row-detail`. Starts a throwaway api (a temporary
# pgserver database, deleted on exit) with the prototype's action and the e2e labels, seeds a few
# annotations, then vite with the stub sign-in. Ctrl+C stops both.
set -euo pipefail
here="$(cd "$(dirname "$0")" && pwd)"
web="$(cd "$here/../../../.." && pwd)"
port="${PROTOTYPE_PORT:-5190}"
api_port=$((port + 1))
cd "$web"

TIM_ENVIRONMENT=development TIM_LOG_LEVEL=WARNING TIM_AUTH_DISABLED=true TIM_DEV_ACTIONS=true \
  TIM_ACTIONS_DIR="$here/actions" TIM_LABELS_FILE="$web/e2e/labels.yaml" \
  TIM_ANNOTATION_POLL_SECONDS=2 \
  TIM_AUTH_TENANT_ID=00000000-0000-0000-0000-000000000000 \
  TIM_AUTH_CLIENT_ID=00000000-0000-0000-0000-000000000000 \
  uv run --project ../api python e2e/api_server.py "$api_port" &
api=$!
trap 'kill "$api" 2>/dev/null || true; wait "$api" 2>/dev/null || true' EXIT

echo "Starting the api on :$api_port ..."
until curl -sf "http://localhost:$api_port/api/healthChecks/readiness" >/dev/null; do
  kill -0 "$api" 2>/dev/null || { echo "The api didn't start." >&2; exit 1; }
  sleep 1
done
"$here/seed.sh" "http://localhost:$api_port"

cat <<EOF

  Row detail prototype: http://localhost:$port/?variant=A
  New > Prototype > Process events (prototype), Run, then D on a row (or right-click > Row detail).
  [ and ] cycle the variants; the bar also sets font, long values and folding.
  evt-0001 has the most history; every 9th row has no id.

EOF
VITE_AUTH_STUB=true TIM_API_PROXY_TARGET="http://localhost:$api_port" \
  npx vite --port "$port" --strictPort
