#!/usr/bin/env bash
# PROTOTYPE (#171), throwaway: the api (in memory, stub sign-in, dev actions) on :5191 and Vite on
# :5190. Open http://localhost:5190, New → Prototype → Comments cell prototype (#171), then Run, and add
# ?variant=A to the end of the URL, after the hash route (the bar then switches).
set -euo pipefail
here="$(cd "$(dirname "$0")" && pwd)"
web="$(cd "$here/../../../.." && pwd)"
(
  cd "$web/../api"
  TIM_ENVIRONMENT=development TIM_AUTH_DISABLED=true TIM_DEV_ACTIONS=true \
    TIM_DATABASE_URL=memory:// TIM_ACTIONS_DIR="$here/actions" \
    TIM_LABELS_FILE="$web/e2e/labels.yaml" \
    TIM_AUTH_TENANT_ID=00000000-0000-0000-0000-000000000000 \
    TIM_AUTH_CLIENT_ID=00000000-0000-0000-0000-000000000000 \
    uv run uvicorn tim_api.main:app --port 5191
) &
trap 'kill 0' EXIT
cd "$web"
VITE_AUTH_STUB=true TIM_API_PROXY_TARGET=http://localhost:5191 npx vite --port 5190 --strictPort
