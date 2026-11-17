# Shared by the deploy scripts. Sourced, not executed.
# shellcheck shell=bash

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
ENV_FILE="${ENV_FILE:-$ROOT/.env.prod}"

load_env() {
  if [ ! -f "$ENV_FILE" ]; then
    echo "Missing $ENV_FILE. Copy .env.prod.example to .env.prod and fill it in." >&2
    exit 1
  fi
  set -a
  # shellcheck disable=SC1090
  . "$ENV_FILE"
  set +a
}

compose() {
  docker compose --env-file "$ENV_FILE" -f "$ROOT/docker-compose.prod.yml" "$@"
}

# The public base URL, including a non-standard HTTPS port (used by CI, never in production).
base_url() {
  local port="${HTTPS_PORT:-443}"
  if [ "$port" = "443" ]; then echo "https://$TALAAN_DOMAIN"; else echo "https://$TALAAN_DOMAIN:$port"; fi
}
