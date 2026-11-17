#!/usr/bin/env bash
# Apply migrations to the dev and test databases as the OWNER role.
# The running app and pytest use the least-privilege app role, which cannot run DDL.
set -euo pipefail
cd "$(dirname "$0")/.."

set -a
[ -f ../.env ] && . ../.env
set +a

OWNER_USER="${POSTGRES_OWNER_USER:-talaan_owner}"
OWNER_PASSWORD="${POSTGRES_OWNER_PASSWORD:-talaan_owner_dev}"

for db in "${POSTGRES_DB:-talaan}" "${POSTGRES_TEST_DB:-talaan_test}"; do
  echo "== migrate $db as $OWNER_USER"
  POSTGRES_USER="$OWNER_USER" POSTGRES_PASSWORD="$OWNER_PASSWORD" POSTGRES_DB="$db" \
    python manage.py migrate --noinput "$@"
done
