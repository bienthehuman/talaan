#!/usr/bin/env bash
# Load test: simulated devices against the compose stack. See docs/loadtest/README.md.
#
#   bash loadtest/run.sh                                  the two standard runs, about 8 minutes
#   bash loadtest/run.sh field                            50 devices, about 10 s between sync cycles
#   bash loadtest/run.sh realistic                        50 devices, 1 s between sync cycles (heavy)
#   bash loadtest/run.sh saturation                       0 s think time, 1 to 100 devices
#   DEVICES="10 50" DURATION=30s THINK=0 bash loadtest/run.sh custom
#
# It raises the push rate limit (one device is one user), switches the server to JSON logs, seeds
# 100 load-test workers, and for each step runs k6 in Docker while sampling Postgres for sessions
# waiting on the advisory lock. Results go to loadtest/results/<label>/ and are summarised by
# loadtest/analyze.py. It does NOT reset the database: the dataset grows from step to step, and the
# row counts before and after are part of the report.
set -euo pipefail
cd "$(dirname "$0")/.."

mode="${1:-all}"
K6_IMAGE="${K6_IMAGE:-grafana/k6:2.4.0}"
BASE="${BASE:-http://127.0.0.1:8080}"
DURATION="${DURATION:-45s}"
OUT_ROOT="loadtest/results"

export THROTTLE_PUSH="100000/min" LOG_FORMAT=json LOG_LEVEL=INFO
[ -f .env ] || cp .env.example .env

echo "== stack (WEB_CONCURRENCY=${WEB_CONCURRENCY:-3})"
docker compose up -d --build --wait
docker compose exec -T server python manage.py seed_demo >/dev/null
docker compose exec -T server python manage.py seed_loadtest --workers 100

psql() { docker compose exec -T db psql -U postgres -d talaan -Atc "$1"; }

run_step() { # label devices think
  local label="$1" devices="$2" think="$3"
  local out="$OUT_ROOT/$label"
  mkdir -p "$out"
  local since
  since="$(date -u +%Y-%m-%dT%H:%M:%SZ)"
  echo "== $label: $devices devices, think ${think}s, $DURATION"

  # Postgres sampler: sessions waiting on the advisory lock, and active sessions, once a second.
  (
    while true; do
      echo "$(date +%s),$(psql "select count(*) filter (where wait_event_type='Lock' and wait_event='advisory'), count(*) filter (where state='active') from pg_stat_activity where datname='talaan'" | tr '|' ',')"
      sleep 1
    done
  ) >"$out/pg-$devices.csv" 2>/dev/null &
  local sampler=$!

  docker run --rm --network host --user "$(id -u):$(id -g)" -v "$PWD/loadtest/k6:/scripts:ro" -v "$PWD/$out:/out" "$K6_IMAGE" run \
    -e BASE="$BASE" -e VUS="$devices" -e DURATION="$DURATION" -e THINK="$think" \
    --summary-export="/out/k6-$devices.json" /scripts/devices.js >"$out/k6-$devices.txt" 2>&1 || true

  kill "$sampler" 2>/dev/null || true
  wait "$sampler" 2>/dev/null || true
  docker compose logs --no-color --since "$since" server >"$out/server-$devices.log" 2>&1
  tail -n 12 "$out/k6-$devices.txt" | sed 's/^/   /'
}

counts() { psql "select 'submissions='||(select count(*) from submissions_submission)||' events='||(select count(*) from submissions_submissionevent)||' ledger='||(select count(*) from sync_appliedmutation)||' users='||(select count(*) from accounts_user)"; }

run_set() { # label think devices...
  local label="$1" think="$2"; shift 2
  mkdir -p "$OUT_ROOT/$label"
  counts >"$OUT_ROOT/$label/dataset-before.txt"
  for n in "$@"; do run_step "$label" "$n" "$think"; done
  counts >"$OUT_ROOT/$label/dataset-after.txt"
  python3 loadtest/analyze.py "$OUT_ROOT/$label" --think "$think" --duration "$DURATION" --workers "${WEB_CONCURRENCY:-3}"
}

case "$mode" in
  realistic) run_set realistic 1 50 ;;
  field) run_set field 10 50 ;;
  saturation) run_set saturation 0 1 5 10 25 50 100 ;;
  custom)
    read -ra devs <<<"${DEVICES:-10 50}"
    run_set "${LABEL:-custom}" "${THINK:-0}" "${devs[@]}"
    ;;
  all) run_set field 10 50; run_set realistic 1 50; run_set saturation 0 1 5 10 25 50 100 ;;
  *) echo "usage: $0 [field|realistic|saturation|custom|all]" >&2; exit 2 ;;
esac
