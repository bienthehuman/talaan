#!/usr/bin/env bash
# Proves the database-guard tests can fail.
#
# For each guard (trigger or privilege) it removes the guard from the TEST database, runs the tests
# that are supposed to protect it, and requires at least one of them to fail. It then restores the
# guard. A guard whose removal goes unnoticed means a test has become vacuous, and this exits 1.
#
#   bash scripts/mutation_check.sh
#
# Needs the compose database running (`docker compose up -d db`) and the migrated test database
# (`bash scripts/migrate.sh`). Changes are made as the Postgres superuser inside the container and
# are always undone, including on Ctrl-C.
set -uo pipefail
cd "$(dirname "$0")/.." || exit 1
REPO="$(cd .. && pwd)"

psql_super() {
  docker compose -f "$REPO/docker-compose.yml" exec -T db \
    psql -q -U postgres -d "${POSTGRES_TEST_DB:-talaan_test}" -v ON_ERROR_STOP=1 -c "$1" >/dev/null
}

# name | SQL that removes the guard | SQL that restores it | tests that must notice
MUTATIONS=(
  "form_version immutability trigger|ALTER TABLE forms_formversion DISABLE TRIGGER forms_formversion_guard|ALTER TABLE forms_formversion ENABLE TRIGGER forms_formversion_guard|forms/tests/test_models.py"
  "submission guard trigger (version, sequence, pinning, no delete)|ALTER TABLE submissions_submission DISABLE TRIGGER submissions_submission_guard|ALTER TABLE submissions_submission ENABLE TRIGGER submissions_submission_guard|submissions/tests/test_invariants.py"
  "submission_event append-only trigger|ALTER TABLE submissions_submissionevent DISABLE TRIGGER submissions_submissionevent_guard|ALTER TABLE submissions_submissionevent ENABLE TRIGGER submissions_submissionevent_guard|submissions/tests/test_events.py"
  "submission_event privileges (UPDATE and DELETE revoked from the app role)|GRANT UPDATE, DELETE ON submissions_submissionevent TO talaan_app|REVOKE UPDATE, DELETE ON submissions_submissionevent FROM talaan_app|submissions/tests/test_events.py"
  "ledger guard trigger (result set once, never deleted)|ALTER TABLE sync_appliedmutation DISABLE TRIGGER sync_appliedmutation_guard|ALTER TABLE sync_appliedmutation ENABLE TRIGGER sync_appliedmutation_guard|sync/tests/test_ledger.py"
  "ledger privileges (DELETE revoked from the app role)|GRANT DELETE ON sync_appliedmutation TO talaan_app|REVOKE DELETE ON sync_appliedmutation FROM talaan_app|sync/tests/test_ledger.py"
)

current_restore=""
restore_on_exit() {
  if [ -n "$current_restore" ]; then
    echo "restoring after interruption..." >&2
    psql_super "$current_restore"
  fi
}
trap restore_on_exit EXIT INT TERM

survived=0
for entry in "${MUTATIONS[@]}"; do
  IFS='|' read -r name break_sql restore_sql tests <<<"$entry"
  if ! psql_super "$break_sql"; then
    echo "could not apply the mutation for: $name" >&2
    exit 2
  fi
  current_restore="$restore_sql"

  output="$(python -m pytest -q -p no:cacheprovider "$tests" 2>&1)"
  failed="$(grep -cE '^FAILED' <<<"$output" || true)"

  psql_super "$restore_sql"
  current_restore=""

  if [ "$failed" -gt 0 ]; then
    printf '  caught    %-68s (%s failing)\n' "$name" "$failed"
  else
    printf '  SURVIVED  %-68s no test noticed\n' "$name" >&2
    survived=$((survived + 1))
  fi
done

# Everything must be back to normal.
if ! python -m pytest -q -p no:cacheprovider >/dev/null 2>&1; then
  echo "the suite fails after restoring the guards; the test database is in an unexpected state" >&2
  exit 3
fi

if [ "$survived" -gt 0 ]; then
  echo "$survived guard(s) could be removed without a test failing" >&2
  exit 1
fi
echo "all ${#MUTATIONS[@]} guards are protected by a test that fails without them"
