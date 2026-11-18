#!/usr/bin/env bash
# Post-deploy checks against a running site. Usage: bash scripts/smoke.sh https://talaan.example.com
#
#   SMOKE_INSECURE=1                accept a self-signed certificate (CI uses Caddy's internal CA)
#   SMOKE_USER / SMOKE_PASSWORD     also sign in and call /api/me/
#
# Exits non-zero if any check fails, after waiting up to 90 s for the site to come up.
set -uo pipefail

base="${1:?Usage: smoke.sh <base url>}"
base="${base%/}"
curl_opts=(-sS --max-time 10)
if [ -n "${SMOKE_INSECURE:-}" ]; then curl_opts+=(-k); fi

failed=0
pass() { echo "  ok    $1"; }
fail() {
  echo "  FAIL  $1" >&2
  failed=1
}

# has_header "<headers>" "<regex>": true if a header line matches (case-insensitive).
has_header() { grep -qiE "$2" <<<"$1"; }
# count_header "<headers>" "<name>": how many times the header appears.
count_header() { grep -ic "^$2:" <<<"$1" || true; }
# status_of "<headers>": the HTTP status code of the first response line.
status_of() { head -1 <<<"$1" | grep -oE '[0-9]{3}' | head -1; }
http() { curl "${curl_opts[@]}" "$@"; }

echo "== waiting for $base"
for _ in $(seq 1 45); do
  if http -o /dev/null -f "$base/api/health/" 2>/dev/null; then break; fi
  sleep 2
done

echo "== checks"

health="$(http "$base/api/health/" 2>&1)"
if grep -q '"status":"ok"' <<<"$health" && grep -q '"database":"ok"' <<<"$health"; then
  pass "health reports the database up"
else
  fail "health: $health"
fi

shell="$(http -D - -o /dev/null "$base/" 2>&1 | tr -d '\r')"
if [ "$(status_of "$shell")" = "200" ]; then pass "app shell served"; else fail "app shell status: $(status_of "$shell")"; fi
if has_header "$shell" "^strict-transport-security: max-age="; then pass "HSTS on the shell"; else fail "no HSTS on the shell"; fi
if has_header "$shell" "^content-security-policy:.*default-src 'self'"; then pass "CSP on the shell"; else fail "no CSP on the shell"; fi
if has_header "$shell" "^x-content-type-options: nosniff"; then pass "nosniff on the shell"; else fail "no nosniff on the shell"; fi
if has_header "$shell" "^cache-control:.*no-cache"; then pass "shell is not cached"; else fail "shell is cacheable"; fi

api="$(http -D - -o /dev/null "$base/api/health/" 2>&1 | tr -d '\r')"
hsts_count="$(count_header "$api" "strict-transport-security")"
if [ "$hsts_count" = "1" ]; then pass "HSTS on the API, sent once"; else fail "HSTS header count on the API: $hsts_count"; fi

metrics_code="$(http -o /dev/null -w '%{http_code}' "$base/metrics" 2>&1)"
if [ "$metrics_code" = "404" ]; then pass "metrics are not public"; else fail "/metrics status $metrics_code (must be 404 on the public site)"; fi
if has_header "$api" "^x-request-id: "; then pass "responses carry a request id"; else fail "no X-Request-ID on the API"; fi

sw_status="$(http -o /dev/null -w '%{http_code}' "$base/sw.js" 2>&1)"
if [ "$sw_status" = "200" ]; then pass "service worker served"; else fail "sw.js status $sw_status"; fi

asset="$(http "$base/" | grep -oE '/assets/index-[^"]+\.js' | head -1)"
if [ -z "$asset" ]; then
  fail "could not find the app bundle"
elif http "$base$asset" | grep -q "Style guide"; then
  fail "production bundle contains the style guide"
else
  pass "production bundle has no style guide"
fi

# DEBUG must be off: an unknown API path returns problem+json, never Django's debug page.
missing="$(http -D - "$base/api/definitely-missing/" 2>&1 | tr -d '\r')"
if [ "$(status_of "$missing")" = "404" ] && has_header "$missing" "^content-type: application/problem\+json"; then
  pass "API errors are problem+json (debug is off)"
else
  fail "unexpected response for an unknown API path"
fi
if grep -q "DEBUG = True" <<<"$missing"; then fail "Django debug page is exposed"; fi

for page in "/api/docs/:API docs page" "/admin/login/:admin login page" "/static/admin/css/base.css:static files served"; do
  path="${page%%:*}"
  label="${page#*:}"
  code="$(http -o /dev/null -w '%{http_code}' "$base$path" 2>&1)"
  if [ "$code" = "200" ]; then pass "$label"; else fail "$label (status $code)"; fi
done

if [ -n "${SMOKE_USER:-}" ] && [ -n "${SMOKE_PASSWORD:-}" ]; then
  token="$(http -X POST "$base/api/auth/token/" -H 'Content-Type: application/json' \
    -d "{\"username\":\"$SMOKE_USER\",\"password\":\"$SMOKE_PASSWORD\"}" |
    sed -n 's/.*"access":"\([^"]*\)".*/\1/p')"
  if [ -z "$token" ]; then
    fail "could not sign in as $SMOKE_USER"
  else
    me="$(http "$base/api/me/" -H "Authorization: Bearer $token")"
    if grep -q "\"username\":\"$SMOKE_USER\"" <<<"$me"; then
      pass "sign in and /api/me/ as $SMOKE_USER"
    else
      fail "/api/me/ returned: $me"
    fi
  fi
fi

if [ "$failed" -ne 0 ]; then
  echo "smoke checks FAILED" >&2
  exit 1
fi
echo "smoke checks passed"
