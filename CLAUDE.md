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

- **Ports:** Talaan's Postgres is on host port **5434**. 5432 is a local Postgres; 5433 is the Hilom dev DB.
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
