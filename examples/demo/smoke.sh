#!/usr/bin/env bash
# The demo instance's smoke test, which .github/workflows/demo-smoke.yml runs:
# - builds TIM's images from this checkout, as `docker compose up --build` does;
# - starts the demo, and checks that the loader loads the dataset;
# - runs smoke.py's checks over HTTP;
# - starts it again, keeping its volumes, and checks that the loader attaches the dataset
#   instead of loading it again, then runs smoke.py's checks again.
#   ./smoke.sh
# Needs Docker and Python 3. It pulls the 4.6 GB emulator image. It runs as its own Compose project,
# tim-demo-smoke, and deletes that project's containers and volumes when it ends. TIM_DEMO_PORT
# sets the web container's port, 8081 by default.
set -euo pipefail
cd "$(dirname "$0")"

compose=(docker compose -p tim-demo-smoke)
timings=()

# step <name> <command>...: runs the command in a log group, and times it.
step() {
  local name=$1 start=$SECONDS
  shift
  echo "::group::$name"
  "$@"
  echo "::endgroup::"
  timings+=("| $name | $((SECONDS - start)) s |")
}

finish() {
  local status=$?
  if [ "$status" -ne 0 ]; then
    echo "::endgroup::"
    "${compose[@]}" ps --all
    "${compose[@]}" logs --no-color --tail 200
  fi
  "${compose[@]}" down --volumes --remove-orphans
  {
    echo "| Step | Took |"
    echo "|---|---|"
    printf '%s\n' "${timings[@]}"
  } | tee -a "${GITHUB_STEP_SUMMARY:-/dev/null}"
  exit "$status"
}
trap finish EXIT

# start: starts the demo and waits for the web container. Compose stops with an error when the
# loader doesn't finish.
start() {
  "${compose[@]}" up --detach --wait --wait-timeout 900
}

loader_log() {
  "${compose[@]}" logs --no-color --no-log-prefix kusto-init
}

# events <log>: the loader's count of the events in the database.
events() {
  sed -nE 's/^([0-9,]+) events in the Security database\.$/\1/p' <<<"$1"
}

check_loaded() {
  local log
  log=$(loader_log)
  echo "$log"
  grep -qx "Created the Security database." <<<"$log" \
    || { echo "FAILED: the first start did not create the Security database." >&2; return 1; }
  grep -q "^Loading " <<<"$log" \
    || { echo "FAILED: the first start did not load the dataset." >&2; return 1; }
  loaded=$(events "$log")
  [ -n "$loaded" ] || { echo "FAILED: the loader did not count the events." >&2; return 1; }
}

check_attached() {
  local log
  log=$(loader_log)
  echo "$log"
  grep -qxE "Attached the Security database from the emulator's volume\.|The Security database is already attached\." <<<"$log" \
    || { echo "FAILED: the restart did not attach the Security database." >&2; return 1; }
  if grep -qE "^(Created the Security database|Loading |Loaded |Dropped )" <<<"$log"; then
    echo "FAILED: the restart loaded the dataset again." >&2
    return 1
  fi
  [ "$(events "$log")" = "$loaded" ] \
    || { echo "FAILED: the restart counts $(events "$log") events, not $loaded." >&2; return 1; }
}

"${compose[@]}" down --volumes --remove-orphans
step "Pull the emulator and PostgreSQL" "${compose[@]}" pull kusto postgres
step "Build TIM's images" "${compose[@]}" build
step "First start" start
step "Check the first start loaded the dataset" check_loaded
step "Check the demo" python3 smoke.py
step "Stop, keeping the volumes" "${compose[@]}" down
step "Restart" start
step "Check the restart attached the dataset" check_attached
step "Check the demo after the restart" python3 smoke.py
echo "The demo instance's smoke test passed."
