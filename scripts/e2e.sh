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
