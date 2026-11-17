#!/usr/bin/env bash
# Restore a backup made by scripts/backup.sh into the running database. DESTRUCTIVE: it replaces
# the current data.
#   bash scripts/restore.sh backups/talaan-<timestamp>.dump
#   bash scripts/restore.sh latest        the newest file in backups/
set -euo pipefail
# shellcheck source=scripts/lib.sh
. "$(dirname "$0")/lib.sh"
load_env

file="${1:-}"
if [ "$file" = "latest" ]; then
  # shellcheck disable=SC2012
  file="$(ls -1t "${BACKUP_DIR:-$ROOT/backups}"/talaan-*.dump 2>/dev/null | head -1)"
fi
if [ -z "$file" ] || [ ! -f "$file" ]; then
  echo "Usage: bash scripts/restore.sh <backup file | latest>" >&2
  exit 1
fi

if [ -z "${RESTORE_YES:-}" ]; then
  read -r -p "This REPLACES all data in the database with $file. Type 'restore' to continue: " answer
  [ "$answer" = "restore" ] || { echo "aborted"; exit 1; }
fi

# Stop the app so nothing writes during the restore; the database stays up.
compose stop server web caddy

# --role makes the restored objects belong to the owner role, so the default privileges that
# grant the app role access apply to them, exactly as after a normal migration.
compose exec -T db pg_restore -U postgres -d talaan --clean --if-exists --no-owner \
  --role=talaan_owner < "$file"

compose up -d --wait
echo "restored from $file"
