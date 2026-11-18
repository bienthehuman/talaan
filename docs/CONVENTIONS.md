# Conventions

Status: accepted.

## Git and PRs

- One branch + one PR per slice: DB → API → UI → tests. Branch names: `phase-slice-short-name`
  (e.g. `1-2-apply-mutation`).
- `main` is protected: PRs required, squash only, no force-push, strict required checks.
- PR titles are conventional commits with the PR number: `feat(sync): idempotent apply (#12)`.
  Types: `feat`, `fix`, `docs`, `test`, `refactor`, `chore`, `ci`, `build`.
- **No AI attribution** in commits or PRs.
- PR template: summary, test plan, **decisions to check**, docs touched, baseline-checklist boxes
  ticked (phase 0).
- Each slice has a written definition of done in the PR. Ideas that come up mid-slice go to the
  backlog table in `BUILD_PLAN.md`, not into the slice.
- Docs change in the same PR as the design change.

## Server (Python / Django)

- Versions pinned in `.python-version` and lockfile. Lint and format with ruff; type-check with
  mypy (or pyright) on `sync`.
- Business rules live in `services.py` modules, not in views or serializers. Views are thin.
- **Never write a submission outside `sync.services._apply`.** No `Submission.objects.update(...)`,
  no `.save()` elsewhere. A guard test checks this.
- Every sync write: advisory lock before `nextval`, version bump, ledger row, event row.
- Migrations are reviewed like code. The app role has no DDL rights.
- Settings from environment; no secrets in the repo; `.env.example` stays complete.

## API

- JSON, snake_case, ISO-8601 UTC timestamps.
- Errors: RFC 7807 (`application/problem+json`) with a stable `code`, plus per-field `errors` where
  relevant. Per-mutation outcomes are results, not HTTP errors (protocol §4).
- Lists: `limit` (default 50, max 200), `cursor` or `page` as documented per endpoint, `ordering`
  with an allow-list. Response envelope: `{ "results": [...], "next": ..., "count"?: ... }`.
- OpenAPI generated from DRF; the TypeScript client is generated from it; CI fails on drift.

## Client (TypeScript / React)

- Strict TypeScript; ESLint + Prettier; Vitest for unit tests.
- UI reads from IndexedDB, never from the network directly. Only `src/sync/` talks to sync endpoints.
- Every local edit is a single Dexie transaction covering the record and its outbox entry.
- A sent outbox entry is frozen: never edit or coalesce into it.
- Zod schemas are derived from the form JSON; no hand-written duplicates of form rules.
- Sentence case for all UI text. Every screen has loading, empty, error, forbidden and
  confirm-destructive states.
- Styles (ADR 0011): a class used by one component goes in `Component.module.css` beside it; tokens, base
  styles, accessibility utilities and primitives shared by several components stay global in `src/theme/`.
  Token values only, never raw colours; no inline `style=` (CSP); tests never select by class.

## Testing

- Pyramid: pytest (server rules and concurrency), Vitest (client logic, fake-indexeddb),
  Playwright (offline and multi-device flows).
- Each failure scenario is one named test (see `failure-scenarios.md`); a test's name includes its
  scenario number.
- Concurrency tests use real threads against real Postgres, never mocks.
- CI worker limits and flake handling: record in `CLAUDE.md` when discovered.
- A phase is done only when its tests pass in CI and a tagged demo run exists.

## Docs

- `docs/` is the source of truth; generated artifacts (permission catalog, OpenAPI) are tested
  against it.
- ADRs are numbered and never rewritten; supersede instead.
