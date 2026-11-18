# Talaan

Offline-first field data platform. PoC claim: field workers can create and edit inspection
submissions fully offline, and every change reaches the server exactly once, with no silent
overwrites, even when the network fails mid-sync.

Stack: Django + DRF + simplejwt + PostgreSQL (server), React + TypeScript + Vite + Dexie +
vite-plugin-pwa (client), pytest / Vitest / Playwright, Docker Compose, GitHub Actions.

## Rules for this repo

- **No AI attribution.** No `Co-Authored-By` lines in commits, no "Generated with" lines in PRs.
- **Docs are the source of truth.** `docs/` is accepted before code. Update docs when design changes.
- **Workflow:** one branch + PR per slice (DB, API, UI, tests). Squash merges, conventional-commit
  titles with PR number. The user reviews and merges, then says "merged and pulled".
- Design calls made inside a slice go under "decisions to check" in the PR. Ask only when a choice
  is costly to reverse. New ideas mid-slice go to the backlog table in `docs/BUILD_PLAN.md`.
- The server owns all versions and sequences. Client clocks are display-only.
- Every sync write goes through `sync.services.apply_mutation` / `_apply` (advisory lock + version
  bump + ledger). Admin actions too. Never write submissions any other way.
- `FAULT_INJECTION=1` is for dev/test only.

## Environment notes

- **Ports:** Talaan's Postgres is on host port **5434**. 5432 is a local Postgres; 5433 is another project's dev DB.
- **Tools:** Python 3.12 (`server/.python-version`), Node 24, Docker + Compose, Postgres 18 image. No `uv`; use `python -m venv server/.venv`.
- **Server setup:** `docker compose up -d db`, then in `server/`: `python -m venv .venv && . .venv/bin/activate && pip install -r requirements-dev.txt && bash scripts/migrate.sh`.
- **Tests:** `cd server && python -m pytest`. They run against the pre-migrated `talaan_test` DB **as the least-privilege `talaan_app` role**, which has no DDL rights. After adding a migration, run `bash scripts/migrate.sh` (runs as `talaan_owner`) or pytest exits with a pending-migrations message.
- **DB roles:** `talaan_owner` owns the schema and runs migrations; `talaan_app` is the runtime role. The init script is `docker/db/init.sh` and only runs on a fresh volume (`docker compose down -v` to redo it). `talaan_test` additionally grants TRUNCATE so transactional tests can flush; `talaan` does not.
- **Lint:** `cd server && ruff check . && ruff format --check .`
- **Client setup:** `cd client && npm ci`. Dev server: `npm run dev` (port 5173, proxies `/api`, `/admin`, `/static` to Django on 8000). Checks: `npm run typecheck && npm run lint && npm run format:check && npm test`. Build: `npm run build`.
- **TypeScript is pinned to 5.9, not 6 or 7.** `typescript-eslint` 8.73 needs below 6.1 and `openapi-typescript` 7.13 needs 5.x. Revisit when both support newer.
- **API types:** `server/openapi.yml` is generated (`cd server && python manage.py spectacular --file openapi.yml --validate`); then `cd client && npm run gen:api` writes `src/lib/api-types.ts`. Regenerate both after any API change; CI will fail on drift (slice 0.4).
- **Client tests** stub `fetch` (see `src/test/utils.tsx`) and use `axe-core` for structural a11y. Colour contrast is not measurable in jsdom; it is covered by the Playwright axe gate.
- **Style guide** route `/styleguide` exists in dev and when built with `VITE_STYLEGUIDE=1` (e2e); it is absent from production builds.
- **`npm audit`** reports 4 moderate findings, all in the build-time chain `vite-plugin-pwa` > `workbox-build` > `glob`/`minimatch`. Not shipped to the browser. The suggested fix downgrades vite-plugin-pwa to 1.1.0; not done.
- **Seed demo logins (dev only):** `python manage.py seed_demo` creates `admin`, `worker1`, `worker2` (password `demo-password-1`).
- **Shell quirk:** do not use `pkill -f <pattern>` in a command that contains the pattern; it kills its own shell.
- **Full stack:** `docker compose up -d --build --wait` serves the built app at http://127.0.0.1:8080 (nginx serves the client and proxies `/api`, `/admin`, `/static` to gunicorn). Services: `db`, `migrate` (one-shot, owner role), `server` (app role, non-root), `web`. Then `docker compose exec server python manage.py seed_demo`.
- **E2E:** `bash scripts/e2e.sh` = fresh DB (`down -v`), build, seed, Playwright (104 tests, desktop + Pixel 7). It deletes the compose DB volume, which drops the host `talaan` and `talaan_test` databases: run `bash server/scripts/migrate.sh` afterwards before host pytest. `E2E_KEEP_DB=1` reuses the running stack. Extra args go to Playwright (`-g offline`, `--project=mobile`).
- **E2E worker limit:** 2 workers (`e2e/playwright.config.ts`). The compose stack runs Postgres, gunicorn and nginx alongside.
- **Healthchecks use `127.0.0.1`, not `localhost`:** inside the nginx container `localhost` resolves to IPv6 first and nginx listens on IPv4 only.
- **CSP is strict (`'self'` only):** no inline `style=` attributes in the client; use classes. The nginx CSP for the shell is in `client/nginx/security-headers.conf`; Django sets its own on `/api` and `/admin`.
- **Playwright `getByLabel("Password")` is ambiguous** (the show/hide button's label contains "password"); use `{ exact: true }`. Headings: use `exact: true` for "Assignments" (also matches "No assignments yet").
- **`main` is protected by a ruleset** (public repo): changes only via PR, squash only, strict required checks (`server`, `client`, `e2e`, `prod-smoke`), no bypass. You cannot push to `main`; open a PR. Merge with `gh pr merge --squash` only after checks pass, and only when the user says to.
- **Production stack:** `docker-compose.prod.yml` (project name `talaan-prod`, separate from the dev stack) with Caddy for HTTPS. Deploy with `bash scripts/deploy.sh [version]`; scripts: `backup.sh`, `restore.sh`, `smoke.sh`, shared `lib.sh`. Details in `DEPLOY.md`. Test it locally with `ENV_FILE=<file> DEPLOY_BUILD=1 SMOKE_INSECURE=1 bash scripts/deploy.sh` using `TALAAN_DOMAIN=localhost HTTPS_PORT=8443 HTTP_PORT=8081` and throwaway secrets.
- **Settings are strict outside debug:** `DJANGO_SECRET_KEY` of 32+ characters and `POSTGRES_PASSWORD` are required (no dev defaults). `NUM_PROXIES=2` in production (Caddy, nginx) so the login throttle sees real client addresses.
- **Compose reads a `.env` in the repo root automatically.** The prod scripts always pass `--env-file`, which disables that; when testing prod compose by hand do the same or dev values leak in.
- **Lint shell and workflows with Docker** (no local install): `docker run --rm -v "$PWD:/mnt" -w /mnt koalaman/shellcheck-alpine:stable shellcheck -x scripts/*.sh docker/db/init.sh` and `docker run --rm -v "$PWD:/repo" -w /repo rhysd/actionlint:latest`.
- **`gh pr edit` fails** with a Projects (classic) GraphQL error on this `gh` version; update PR bodies with `gh api -X PATCH repos/OWNER/REPO/pulls/N -F body=@file`. `gh repo edit --visibility` also lacks the confirm flag here; use the REST API.
- **Server apps (phase 1):** `forms` (Form, FormVersion; schema rules in `forms/schema.py`), `assignments`, `submissions` (Submission, SubmissionEvent), `sync` (AppliedMutation, Device). The sync service itself arrives in slice 1.2.
- **Submission rows are guarded by the database, not just by convention:** a trigger rejects any UPDATE that does not raise `version` by exactly 1 and `server_seq` strictly, any change to id/assignment/form version, and any DELETE. In tests use the `make_submission` fixture (sets up rows by hand) and `next_server_seq()`; production code must go through `sync.services` (slice 1.2).
- **DB invariants are tested as the restricted app role.** Guards behind a privilege revoke (`submission_event`, ledger DELETE) also have an `owner_conn` test (conftest) that proves the trigger on its own; privileges are asserted with `has_table_privilege`.
- **`bash server/scripts/mutation_check.sh`** disables each trigger/grant in the test DB, requires the guarding tests to fail, restores it (runs in CI, ~10 s). When you add a trigger or revoke, add a line to its `MUTATIONS` list. It talks to Postgres through `docker compose exec db`, so the compose db must be up.
- **Ad-hoc SQL on the test DB:** `docker compose exec -T db psql -U postgres -d talaan_test -c "..."` (superuser inside the container).
- **Django 6.1 admin:** overriding `get_actions` needs the `action_location` parameter (see `forms/admin.py`), otherwise a deprecation warning.
- **ruff `DJ012`** wants model members in Django style order (fields, Meta, `__str__`, `save`, then other methods).
- **Sync service (`sync/services.py`) is the only writer of `Submission` and `SubmissionEvent`.** Entry points: `apply_mutation(user, device_id, Mutation)` and `apply_admin_action(user, record_id, action, ...)`; both go through `_run_once` (ledger row first, advisory lock, handler, result stored, one transaction). A runtime guard (`submissions/guard.py`, `write_access()`) raises `DirectWriteError` for any other ORM write; a test scans the source (AST) so the gate is opened only in `guard.py` and `services.py`. Test fixtures that must build rows by hand wrap them in `write_access()`.
- **Service tests** build scenarios with `sync/tests/helpers.py` (`create`, `push`, `submitted`, `admin`, `row`). Results are plain dicts (`status`, `code`, `record`, ...); see `sync/results.py` and `docs/protocol.md`.
- **`python server/scripts/mutation_check_service.py`** (about 2 min) plants deliberate bugs in the service, validator and guard and requires a test to fail for each. Exits 1 if one survives, 2 if a pattern went stale after a refactor (update the entry). Run it after changing those files.
- **Ruff `S311`** is ignored in tests so seeded `random` can be used for repeatable randomized checks.
- **Sync API (phase 1):** `POST /api/sync/push`, `GET /api/sync/pull`, `GET /api/assignments`, `GET /api/form-versions` (`sync/views.py`, serializers in `sync/serializers.py`). The non-push endpoints take `X-Client-Schema`; 426 and 400 are checked after auth and before validation. Response serializers exist only to type the OpenAPI schema; the service returns plain dicts.
- **Fault injection:** set `FAULT_INJECTION=1` (needs `DJANGO_DEBUG=1`), then send `X-Fault: fail-before | drop-after-commit | delay=<ms> | expire-token[=n]` on one request (comma-separate to combine). No server-side rule state, no endpoint. In tests use the `fault_injection` fixture and create API clients *after* it.
- **HTTP test helpers:** `sync/tests/api_helpers.py` (`api(user)`, `push`, `pull`, `create_mut`, `mut`, `assert_problem`) and the `worker_client` / `admin_client` / `other_worker_client` fixtures. `pytest -m phase1` runs the phase 1 scenario tests.
- **`settings_test.py` replaces the throttle-rate dict**, so any new throttle scope needs a rate there (it failed with `KeyError: 'push'` once). Lower a rate for one test with `monkeypatch.setitem(ScopedRateThrottle.THROTTLE_RATES, "<scope>", "2/min")`.
- **Do not run pytest or edit `sync/`, `forms/validation.py` or `submissions/guard.py` while `mutation_check_service.py` runs**: it rewrites those files temporarily (it restores them, including on failure).
- **Threaded tests** (`sync/tests/test_concurrent_*.py`, `test_pull_gap.py`) use `django_db(transaction=True)` and `sync/tests/concurrency.run_together` (threads released together, each closes its DB connection). pytest-django flushes the DB afterwards, which deletes the seeded `worker`/`admin` groups; `conftest.pytest_runtest_teardown` puts them back. If `talaan_test` ever lacks the groups (an aborted run), re-run `bash server/scripts/migrate.sh` is not enough: insert them with psql (`insert into auth_group(name) values ('worker'),('admin')`).
- **`mutation_check_service.py`** takes optional words to run only matching entries (`python scripts/mutation_check_service.py lock`).
- **Client local DB:** `client/src/db/` (Dexie, one database per user via `dbFor(userId)`). Only its functions may write `submissions` and `outbox`. Tests get a fresh `fake-indexeddb` per test from `src/test/setup.ts` (it also repoints `Dexie.dependencies.indexedDB`; without that, state leaks between tests).
- **Sync engine tests** (`client/src/sync/engine.test.ts`) script a fake server over stubbed `fetch` (`server({push, pull})`); apply logic is in `src/db/apply.ts`. `python3 scripts/mutation_check.py` (in `client/`, about 1 minute) plants 16 bugs in the engine and apply code and requires a test to fail for each; run it after changing them.
- **Auth resume:** `client/src/auth/refresh.ts` (`refreshSession`, single flight) is passed to the engine as `refresh`; sign-out (`AuthContext.logout`) stops the engine and deletes that user's IndexedDB database; session expiry deletes nothing (ADR 0010). `scripts/mutation_check.py` now runs the whole client suite per planted bug (23 bugs, a few minutes).
- **Worker UI:** pages in `client/src/pages/` read IndexedDB through `useLive` / `useLocalDb` (`src/db/useLive.ts`); form logic (schema parsing, Zod validation) is in `src/forms/`. Test fixtures: `src/test/fixtures.ts` (`GENERATOR_SCHEMA`, `seedReference`). The test worker has user id 2, so its database is `dbFor(2)`. `src/test/setup.ts` closes cached Dexie instances after every test and gives async queries a 4 s timeout.
- **E2E sync scenarios** (`e2e/tests/01-`, `02-`, `09-`): `scripts/e2e.sh` exports `FAULT_INJECTION=1` (the dev compose forwards it; the prod compose never does). Scenarios that rewrite requests with `page.route` use `test.use({ serviceWorkers: "block" })`, because a service worker hides requests from `route`. Helpers in `e2e/tests/helpers.ts` (`startInspection`, `pendingCount`, `serverRecords`). Tests share the `worker1` account, so each finds its own record by id.
- **Admin actions over HTTP:** `POST /api/admin/submissions/<id>/actions/` (`sync/views.AdminActionView`, `IsAdmin`) calls `apply_admin_action`; refusals are 200 `rejected` results. `pytest -m phase3` runs the phase 3 scenarios that have a server half.
- **Conflict resolution** is `client/src/db/resolve.ts` (`loadConflict`, `resolveFieldConflict`, `resolveEditedSinceBase`); the restore re-queue is in `applyPull`. Re-issuing an entry (`reissue`) keeps its queue position and gives it a new mutation id.
- **Two-device e2e** (`04-`, `05-`, `06-`, `10-`): `secondDevice(browser, baseURL)` makes another browser profile for worker1 (own IndexedDB and device id); `adminAction(request, id, action)` drives the admin endpoint (the demo admin is `admin` / `demo-password-1`). Go offline per context with `context.setOffline`. Tests share worker1, so each finds its record by id.

