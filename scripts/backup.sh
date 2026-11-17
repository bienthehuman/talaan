#!/usr/bin/env bash
# Dump the database to backups/talaan-<UTC timestamp>.dump (custom format) and keep the newest
# BACKUP_KEEP files (default 14). Run it from cron as well; see DEPLOY.md.
set -euo pipefail
# shellcheck source=scripts/lib.sh
. "$(dirname "$0")/lib.sh"
load_env

dir="${BACKUP_DIR:-$ROOT/backups}"
keep="${BACKUP_KEEP:-14}"
mkdir -p "$dir"
file="$dir/talaan-$(date -u +%Y%m%dT%H%M%SZ).dump"

# Written to a temp name first so a failed dump never leaves a file that looks valid.
compose exec -T db pg_dump -U postgres -Fc talaan > "$file.partial"
mv "$file.partial" "$file"
echo "backup written: $file ($(du -h "$file" | cut -f1))"

# Prune old backups.
# shellcheck disable=SC2012
ls -1t "$dir"/talaan-*.dump 2>/dev/null | tail -n "+$((keep + 1))" | while read -r old; do
  rm -f -- "$old"
  echo "pruned: $old"
done
