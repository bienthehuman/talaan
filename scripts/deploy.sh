#!/usr/bin/env bash
# Deploy Talaan on a Docker host.
#
#   bash scripts/deploy.sh              run the version in .env.prod (TALAAN_VERSION)
#   bash scripts/deploy.sh v0.1.0       run that release (also the way to roll back)
#   DEPLOY_BUILD=1 bash scripts/deploy.sh   build the images here instead of pulling them
#
# It backs up the database, starts the new version (migrations run first, as the owner role), waits
# for every service to be healthy, then runs the smoke checks. See DEPLOY.md.
set -euo pipefail
# shellcheck source=scripts/lib.sh
. "$(dirname "$0")/lib.sh"
load_env

if [ -n "${1:-}" ]; then export TALAAN_VERSION="$1"; fi
echo "== deploying ${TALAAN_VERSION:-latest} to $TALAAN_DOMAIN"

# Back up first, but only if a database is already running (not on the very first deploy).
if [ -n "$(compose ps --status running --services 2>/dev/null | grep -x db || true)" ]; then
  echo "== backup before deploy"
  bash "$ROOT/scripts/backup.sh"
fi

if [ -n "${DEPLOY_BUILD:-}" ]; then
  echo "== build images"
  compose build server web
else
  echo "== pull images"
  compose pull server web
fi

echo "== start (migrations run first)"
compose up -d --remove-orphans --wait

echo "== smoke checks"
bash "$ROOT/scripts/smoke.sh" "$(base_url)"

echo "== deployed ${TALAAN_VERSION:-latest}"
