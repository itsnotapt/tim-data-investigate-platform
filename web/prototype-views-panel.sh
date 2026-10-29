#!/usr/bin/env bash
# PROTOTYPE: runs the Views panel variants. A throwaway api with the e2e actions and the dev
# sign-in, on a temporary Postgres deleted on exit, and Vite proxying to it. Not for main.
set -euo pipefail
cd "$(dirname "$0")"
API_PORT=${API_PORT:-5191}
PORT=${PORT:-5190}
# api_server.py empties TIM_TEST_DATABASE_URL when it's set: never point it at a real database.
unset TIM_TEST_DATABASE_URL
export TIM_ENVIRONMENT=development TIM_LOG_LEVEL=WARNING TIM_AUTH_DISABLED=true TIM_DEV_ACTIONS=true
export TIM_ACTIONS_DIR="$PWD/e2e/actions" TIM_CONNECTIONS_FILE="$PWD/e2e/connections.yaml"
export TIM_LABELS_FILE="$PWD/e2e/labels.yaml"
export TIM_AUTH_TENANT_ID=00000000-0000-0000-0000-000000000000
export TIM_AUTH_CLIENT_ID=00000000-0000-0000-0000-000000000000
uv run --project ../api python e2e/api_server.py "$API_PORT" &
api=$!
trap 'kill $api 2>/dev/null || true' EXIT
echo "Views panel prototype: http://localhost:$PORT/#/?variant=A  (← → or the bar to switch)"
VITE_AUTH_STUB=true TIM_API_PROXY_TARGET="http://localhost:$API_PORT" npx vite --port "$PORT" --strictPort
