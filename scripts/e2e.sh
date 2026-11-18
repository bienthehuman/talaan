#!/usr/bin/env bash
# One command: fresh database, full stack, demo logins, Playwright.
#
#   bash scripts/e2e.sh                 run everything
#   bash scripts/e2e.sh -g offline      extra args go to `playwright test`
#   E2E_KEEP_DB=1 bash scripts/e2e.sh   reuse the running stack and its data
#
# Without E2E_KEEP_DB this deletes the compose database volume, which also drops the host-run
# `talaan` and `talaan_test` databases. Run `bash server/scripts/migrate.sh` afterwards before pytest.
set -euo pipefail
cd "$(dirname "$0")/.."

[ -f .env ] || cp .env.example .env

if [ -z "${E2E_KEEP_DB:-}" ]; then
  echo "== fresh database (docker compose down -v)"
  docker compose down -v --remove-orphans
fi

# The sync scenarios ask the server to fail on purpose (X-Fault header). Dev compose only.
export FAULT_INJECTION=1

echo "== build and start the stack"
docker compose up -d --build --wait

echo "== seed demo logins"
docker compose exec -T server python manage.py seed_demo

echo "== playwright"
cd e2e
npm ci
if [ -n "${CI:-}" ]; then
  npx playwright install --with-deps chromium
else
  npx playwright install chromium
fi
npx playwright test "$@"

# After the whole suite (not a filtered run), the server's own numbers must show what the scenarios
# just did: pushes, a conflict, a rejection, and retries after the dropped responses. /metrics is
# open in debug; this reads it from inside the stack, where the public proxy does not reach.
if [ "$#" -eq 0 ]; then
  cd ..
  echo "== metrics reflect the scenarios"
  metrics="$(docker compose exec -T server python -c \
    "import urllib.request;print(urllib.request.urlopen('http://127.0.0.1:8000/metrics').read().decode())")"
  need() { # name pattern minimum
    value="$(grep -E "^$1" <<<"$metrics" | grep -E "$2" | awk '{s+=$NF} END {print s+0}')"
    if [ "$value" -lt "$3" ]; then echo "metrics check failed: $1 $2 = $value, expected at least $3" >&2; exit 1; fi
    echo "  ok  $1 $2 = $value"
  }
  need talaan_mutations_total 'status="applied"' 50
  need talaan_conflicts_total 'field_conflict' 1
  need talaan_rejections_total 'locked' 1
  need talaan_retries_total '' 1
  need talaan_devices '' 2
fi

