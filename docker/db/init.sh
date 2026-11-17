#!/bin/bash
# Runs once, on first start of an empty data directory.
#
# Two roles (docs/ARCHITECTURE.md section 7):
#   talaan_owner  owns the schema and runs migrations. Never used by the running app.
#   talaan_app    least privilege: SELECT/INSERT/UPDATE/DELETE on tables, no DDL.
# Databases: talaan, plus talaan_test where CREATE_TEST_DB=1 (pytest, also run as talaan_app).
set -euo pipefail

psql -v ON_ERROR_STOP=1 --username postgres --dbname postgres \
  -v owner_pw="$OWNER_PASSWORD" -v app_pw="$APP_PASSWORD" <<'SQL'
CREATE ROLE talaan_owner LOGIN PASSWORD :'owner_pw' NOSUPERUSER NOCREATEDB NOCREATEROLE;
CREATE ROLE talaan_app   LOGIN PASSWORD :'app_pw'   NOSUPERUSER NOCREATEDB NOCREATEROLE;
CREATE DATABASE talaan OWNER talaan_owner;
SQL

# The test database exists only where CREATE_TEST_DB=1 (development and CI), never in production.
databases="talaan"
if [ "${CREATE_TEST_DB:-}" = "1" ]; then
  psql -v ON_ERROR_STOP=1 --username postgres --dbname postgres \
    -c "CREATE DATABASE talaan_test OWNER talaan_owner;"
  databases="talaan talaan_test"
fi

for db in $databases; do
  # The test database also gets TRUNCATE so transactional tests can flush between runs.
  # The dev/production database does not.
  truncate=""
  if [ "$db" = "talaan_test" ]; then truncate=", TRUNCATE"; fi

  psql -v ON_ERROR_STOP=1 --username postgres --dbname "$db" <<SQL
GRANT USAGE ON SCHEMA public TO talaan_app;
ALTER DEFAULT PRIVILEGES FOR ROLE talaan_owner IN SCHEMA public
  GRANT SELECT, INSERT, UPDATE, DELETE${truncate} ON TABLES TO talaan_app;
ALTER DEFAULT PRIVILEGES FOR ROLE talaan_owner IN SCHEMA public
  GRANT USAGE, SELECT ON SEQUENCES TO talaan_app;
SQL
done
