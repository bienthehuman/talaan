#!/usr/bin/env bash
# Shows the server half of "exactly once" from a terminal, with no browser.
#
#   bash scripts/lost-response-demo.sh [base-url]        (default http://127.0.0.1:8080)
#
# It pushes one new record with `X-Fault: drop-after-commit`: the server commits it and then throws
# the answer away (503), which is what a phone sees when the network dies after the server has
# already done the work. It then sends the SAME mutation again and shows that the server recognises
# it, answers with the stored result, and still holds exactly one record at version 1.
# Needs the stack running with FAULT_INJECTION=1 (the dev container sets it; scripts/e2e.sh too).
set -euo pipefail
base="${1:-http://127.0.0.1:8080}"
json() { python3 -c "import json,sys; d=json.load(sys.stdin); print(eval(sys.argv[1], {'d': d}))" "$1"; }

token="$(curl -sS "$base/api/auth/token/" -H 'Content-Type: application/json' \
  -d '{"username":"worker1","password":"demo-password-1"}' | json "d['access']")"
auth=(-H "Authorization: Bearer $token" -H 'X-Client-Schema: 1')
assignment="$(curl -sS "$base/api/assignments/" "${auth[@]}" | json "d['results'][0]['id']")"

record="$(python3 -c 'import uuid;print(uuid.uuid4())')"
mutation="$(python3 -c 'import uuid;print(uuid.uuid4())')"
body="{\"device_id\":\"$(python3 -c 'import uuid;print(uuid.uuid4())')\",\"client_schema\":1,\"app_version\":\"demo\",\"mutations\":[{\"mutation_id\":\"$mutation\",\"record_id\":\"$record\",\"op\":\"create\",\"base_version\":0,\"assignment_id\":$assignment,\"fields\":{\"notes\":\"sent twice\"}}]}"

echo "1. Push the mutation, and make the server drop its answer after committing:"
code="$(curl -sS -o /dev/null -w '%{http_code}' "$base/api/sync/push/" "${auth[@]}" \
  -H 'Content-Type: application/json' -H 'X-Fault: drop-after-commit' -d "$body")"
echo "   HTTP $code (the phone saw a failure; the server had already committed)"
[ "$code" = "503" ] || { echo "expected 503; is FAULT_INJECTION=1 set on the server?" >&2; exit 1; }

echo "2. The phone retries the very same mutation:"
retry="$(curl -sS "$base/api/sync/push/" "${auth[@]}" -H 'Content-Type: application/json' -d "$body")"
echo "   result: $(json "d['results'][0]['status']" <<<"$retry"), record version $(json "d['results'][0]['record']['version']" <<<"$retry")"

echo "3. The server holds exactly one such record:"
count="$(curl -sS "$base/api/sync/pull/?cursor=0&limit=500" "${auth[@]}" |
  json "len([r for r in d['records'] if r['id']=='$record'])")"
echo "   records with id $record: $count"
if [ "$count" = "1" ]; then echo "Exactly once."; else echo "unexpected count" >&2; exit 1; fi
