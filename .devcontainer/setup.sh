#!/usr/bin/env bash
# Runs once when the Codespace (or dev container) is created: build the stack, seed the demo logins.
set -euo pipefail
cd "$(dirname "$0")/.."

[ -f .env ] || cp .env.example .env

docker compose up -d --build --wait
docker compose exec -T server python manage.py seed_demo

cat <<'MSG'

Talaan is running.
  App:        the forwarded port 8080 (open it from the Ports tab)
  Logins:     worker1, worker2, admin    password: demo-password-1
  Try it:     see "Try to break it" in README.md

Fault injection is on in this environment (FAULT_INJECTION=1, development only).
MSG
