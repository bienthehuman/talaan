# Build plan

Source plan: "Offline-First Field Data Platform: PoC to v1" (Nov 13, 2026). This file tracks
phases, slices, the baseline checklist and the backlog. Planning unit is **review checkpoints**,
not days or weeks: slices are batched for review and ordered by risk and dependency.

## Phases

| Phase | Content | Done when |
|---|---|---|
| 0 | Design docs accepted. Walking skeleton (Django + Postgres + Vite PWA shell, login, health, CI, compose) with production constraints. Deployable now; deployed once a host is chosen. | Baseline checklist ticked, CI green, `v0.1.0` tagged. The live deploy is waived until a host exists. |
| 1 | Server sync core: `apply_mutation`, ledger, pull cursor, advisory lock, fault-injection middleware, 426 | pytest scenarios 2, 3, 7, 8, 10, 11 |
| 2 | Client local layer and engine: Dexie, atomic edit, outbox, push/pull, backoff, token refresh, Web Locks | Scenarios 1, 9, 12 |
| 3 | Conflicts: detection, `deleted_remotely`, resolution screen | Scenarios 4, 5, 6: all twelve pass in CI |
| 4 | v1: admin web, worker UX, operability, load test, README, demo video | `v1.0` |

Gate: do not start phase 3 until phase 2's tests pass.
Each phase ends with an automated demo (pytest and/or Playwright) plus a release tag.

## Phase 0 slices (done: tagged `v0.1.0` on 2026-11-17)

| Slice | Content | Status |
|---|---|---|
| 0.0 | Repo basics, CLAUDE.md, this plan | done (#1) |
| 0.1 | Design docs: architecture, data model (with correction paths), roles × steps, protocol, conventions, design system, ADR 0001–0009 | done (#1) |
| 0.2 | Server skeleton: Django, DRF, simplejwt, Postgres, health, OpenAPI page, RFC 7807 errors | done (#2) |
| 0.3 | Client skeleton: Vite React TS, PWA shell, routing, login, theme tokens, 404/error pages | done (#3) |
| 0.4 | Compose, CI (build, lint, typecheck, format, unit, integration, e2e, OpenAPI drift), branch protection | done (#4) |
| 0.5 | Deployable skeleton (no host chosen): production compose with Caddy HTTPS, deploy / backup / restore / smoke scripts, release workflow (images and GitHub release on tag, optional SSH deploy), `DEPLOY.md`, `prod-smoke` CI job. Branch ruleset on `main` (repo made public). | done (#7) |

## Phase 1 slices: server sync core

Exit: pytest scenarios 2, 3, 7, 8, 10, 11 pass in CI (see `failure-scenarios.md`), the scenario 8 write-up
shows the test failing without the advisory lock, tagged `v0.2.0`. Ordered by risk: the data model and
its database-level invariants first, then the rules without HTTP, then the API, then the concurrency proofs.

| Slice | Content | Status |
|---|---|---|
| 1.1 | **Data model and database invariants.** Apps `forms`, `assignments`, `submissions`, `sync`; tables and migrations from DATA_MODEL.md section 1; sequence `submission_server_seq`; Django admin for form JSON; demo form and assignments in `seed_demo`. | done |
| 1.2 | **Sync service, no HTTP.** `apply_mutation` / `_apply` for create, update, submit, delete; ledger, events, validation, field-level conflicts; admin actions (approve, return, restore, delete, edit) through the same path; guard against direct writes. | done |
| 1.3 | **Push / pull API and fault injection.** `POST /api/sync/push`, `GET /api/sync/pull`, assignments and form versions, device registration, 426, batch cap, throttle; the four fault modes; OpenAPI and generated client types. | done |
| 1.4 | **Concurrency proofs.** Scenarios 3, 7, 8 with real threads; the scenario 8 write-up; `v0.2.0`. | done (`v0.2.0`) |

### Definition of done per slice (written before the code)

**1.1**
- Every table in DATA_MODEL.md section 1 exists with a migration; migrations apply as the owner role and everything is usable as the app role.
- Invariants are enforced by the database and each has a test that runs **as the restricted app role**: status `CHECK`; `version >= 1`; unique `server_seq`; unique `(form_id, number)`; a published `form_version` cannot be updated or deleted; `submission_event` is append-only; `applied_mutation` rows can never be deleted and their `result` can be set once; a submission's `form_version_id` must match its assignment's.
- The form schema format is written down (DATA_MODEL.md section 5) with a sample that the demo seed uses.
- A form version can be created and published from Django admin; submissions and events are read-only there.
- `seed_demo` creates a form, a published version and one assignment per worker (idempotent).
- Mutation check: each trigger or grant test fails when its trigger or grant is removed. Automated as `server/scripts/mutation_check.sh` and run in CI, so a guard test cannot quietly become vacuous.

**1.2**
- One write path: a guard test fails if any code outside `sync/services.py` writes `Submission`.
- Every rule in protocol.md sections 4 to 6 has a test: each op, each `rejected` code, each conflict kind, merge of different fields, same value is not a conflict, replay returns the stored result (applied, conflict and rejected), `mutation_id_reuse`.
- Admin actions go through the same core and bump version and `server_seq`.
- Mutation check on the service: `server/scripts/mutation_check_service.py` plants 21 deliberate bugs (no advisory lock, weakened conflict check, skipped validation, cross-worker leak, ...) and requires the tests to catch each; run after changing the service.
- Scenario 10 passes at service level.

**1.3**
- Contract tests pin the response shapes in protocol.md; unauthenticated, wrong role and other-worker's records behave as ROLES.md says.
- Scenarios 11 and 2 (pytest half) and 10 (API half) pass; fault injection modes each have a test and the middleware refuses to load outside debug.
- `server/openapi.yml` and `client/src/lib/api-types.ts` regenerated; CI drift checks pass.
- Mutation check extended to the API layer (batch cap, 426, visibility, cursor logic, every fault mode): `server/scripts/mutation_check_service.py` now plants 40 bugs.

**1.4**
- Scenarios 3, 7, 8 use real threads against real Postgres as the app role.
- Scenario 8 is shown failing with the advisory lock removed (recorded run in the write-up) and passing with it.
- `v0.2.0` tagged; the phase demo is `pytest -m phase1`.

## Phase 2 slices: client local layer and engine

Exit: scenarios 1, 9, 12 pass in CI, plus the client half of scenario 2; tagged `v0.3.0`. The UI reads
IndexedDB only. Ordered by risk: the atomic local write first, then the engine on top of it, then auth
resume, then the thinnest UI that lets Playwright drive it all.

| Slice | Content | Status |
|---|---|---|
| 2.1 | **Local layer** (`src/db/`). Dexie schema and migrations; stores per DATA_MODEL section 2; `meta` (`deviceId`, `userId`, cursor); repositories; `editSubmission` = record + outbox entry in one transaction; coalescing of unsent edits only; all data keyed by `userId`. | in review |
| 2.2 | **Sync engine** (`src/sync/`). Push then pull, per-result handling (applied / conflict / rejected), reference-data download, backoff with jitter, error classes, Web Locks, triggers (start, `online`, 60 s, "Sync now"); real `SyncBadge` status. | not started |
| 2.3 | **Auth resume.** Token refresh, 401 pause and resume with the outbox untouched, logout confirmation with unsent changes, token storage decision (ADR 0010). | not started |
| 2.4 | **Worker UI, thin.** Assignments and submissions read from IndexedDB; form filler (Zod built from the form JSON) that creates, edits, submits, deletes offline. Conflict and rejected states are shown as status only (resolution screen is phase 3). | not started |
| 2.5 | **Playwright scenarios and release.** Scenarios 1, 2 (client half), 9 against the compose stack with `X-Fault`; `v0.3.0`. | not started |

### Definition of done per slice (phase 2)

**2.1**
- Scenario 12: a write that is interrupted (transaction aborted mid-way) leaves record and outbox both present or both absent; Vitest with fake-indexeddb.
- A second user on the same device never sees the first user's data.
- Editing a record twice before a push coalesces to one outbox entry; an entry already sent (`sentAt`) is never changed.
- Planted-bug check on the repository (drop the transaction, coalesce a sent entry) fails a test.

**2.2**
- Every protocol result status and transient failure class has a test (stubbed fetch): applied, conflict, rejected, 5xx, 429 with `Retry-After`, timeout, network error, 426.
- A retry resends the same unmodified mutation ids (lost-response case, engine half).
- Two engines on one database (two tabs) never sync at once.
- Pull applies to `shadow` without touching unsent `data`; cursor advances only after the page is stored.

**2.3**
- A 401 mid-sync pauses; the outbox is unchanged; a refresh resumes from the start of a cycle; a failed refresh asks for login and keeps local data.
- Logging out with unsent changes needs explicit confirmation.
- ADR 0010 records the token storage choice and why.

**2.4**
- A worker can complete a whole inspection with the network off; axe gate passes on the new pages.
- "Saved on this device" and "Synced" never look alike.

**2.5**
- Scenarios 1, 2 (client half) and 9 are green in `e2e`, and each is shown to fail when its guarantee is broken.
- `v0.3.0` tagged.

## Baseline checklist (phase 0)

**Repo and GitHub**
- [x] README, `.gitignore`, `.gitattributes`, `.editorconfig`, `.env.example`
- [x] Version pins (`.nvmrc`, `packageManager`, `.python-version`, exact versions in lockfiles), current versions checked at scaffold
- [x] GitHub repo created (public); `main` protected by a ruleset: PR required, squash only, no force-push or deletion, linear history, strict required checks `server`, `client`, `e2e` (`prod-smoke` is added once this slice merges). Secret scanning, push protection, Dependabot alerts and private vulnerability reporting are on.
- [x] `.github/pull_request_template.md` (summary, definition of done, test plan, decisions to check)
- [x] CI on every PR: lint, typecheck, format, unit, integration, build, e2e, OpenAPI/client drift, `npm audit` (prod deps); badge in README. Jobs: `server`, `client`, `e2e`.
- [x] SECURITY.md, CONTRIBUTING.md, CLAUDE.md (env quirks), Dependabot
- [x] LICENSE (MIT, copyright holder is the GitHub handle; owner to confirm in the 0.5 PR)

**Product shell**
- [x] Favicon (SVG), page titles per route, app name/tagline, theme-color, 404 and error pages
- [x] Design system accepted in docs before screens (tokens, light/dark, type, spacing, components); `/styleguide` page built
- [x] UX state components built (loading, empty, error, forbidden, confirm-destructive, toasts); each screen applies them as it lands
- [x] a11y gate: axe in Playwright on every screen in light, dark and system-dark at desktop and phone size (incl. contrast); keyboard pass (skip link, keyboard-only sign-in, focus rings, dialog focus). Verified the gate fails on a deliberate contrast break.
- [x] Responsive: decided per audience (worker = mobile first, admin = desktop first), see DESIGN_SYSTEM.md

**Backend and data**
- [x] Health endpoint, API reference page, RFC 7807 errors with codes, list/paging contract (sort allow-list lands with the first list endpoint)
- [x] Auth (JWT), roles and permission catalog (tested against ROLES.md), **restricted DB role** (app and tests run as it)
- [ ] Audit trail (`submission_event`, append-only): lands with the sync core in phase 1
- [x] Security headers (incl. CSP), login rate limit, secure cookies in production, no secrets in repo, dev-only seeded logins (push rate limit in phase 1)
- [x] Local dev: compose stack (db, migrate, server, web), seed command, and `bash scripts/e2e.sh` for a fresh DB end to end

**Delivery**
- [x] Deployable to any single Docker host: HTTPS and HSTS via Caddy, deploy on tag (Release workflow, SSH step off until configured), rollback by redeploying a tag. **No host chosen yet (owner: "not for now"), so no live deployment.**
- [x] Tag per milestone: `v0.1.0` (Release workflow ran end to end; the published images were deployed locally through `deploy.sh`'s pull path and passed the smoke checks)
- [ ] Live demo with seeded logins and a nightly reset (backlog; needs a host and a demo mode that does not use debug)
- [x] Prod compose file, `DEPLOY.md`, backup and restore (round trip tested in CI), smoke checks
- [ ] Docs index, ADRs for hard-to-reverse decisions, conventions doc, backlog table

## Decisions already made

- Project name: Talaan.
- Stack as in the source plan (Django/DRF, Postgres, React/Vite/Dexie).
- No AI attribution in commits or PRs.
- One PR per slice, squash merge; user says "merged and pulled".

## Open questions

- Hosting target for the live demo (phase 0.5).
- Python/Node/Postgres versions: pin current at scaffold.

## Backlog

| Idea | Origin | Priority | Notes |
|---|---|---|---|
| Photo attachments via separate upload channel | Source plan stretch | later | |
| .NET MAUI client speaking the same protocol | Source plan stretch | later | best proof the protocol is a contract |
| Grafana dashboard on `/metrics` | Source plan stretch | later | |
| Safe-watermark pull cursor replacing the advisory lock | ADR 0005 | later | |
| Document 401/429/problem+json responses in the OpenAPI schema (removes the client `unwrap()` workaround) | Slice 0.3 | later | |
| Public demo: seeded logins and a nightly data reset, without running Django in debug | Playbook, slice 0.5 | when a host exists | needs its own demo flag; `seed_demo` is debug-only today |
| Monitoring and alerting (uptime check on `/api/health/`, metrics) | Slice 0.5 | v1 operability | `/metrics` is in the v1 plan |
| Sign release images (cosign) and publish an SBOM | Slice 0.5 | later | |
| Clear the Dependabot `minimatch` alert (build-time only, via vite-plugin-pwa > workbox-build > glob): try an npm `overrides` entry, or dismiss as tolerable | Slice 0.5 | when convenient | `npm audit --omit=dev` is already clean |
| Postgres major-version upgrade procedure, tested | Slice 0.5 | later | currently a manual note in DEPLOY.md |
