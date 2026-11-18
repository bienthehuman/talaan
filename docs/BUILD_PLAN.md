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
| 4 | v1: admin web, worker UX, operability, load test, README, demo video | `v1.0` (tagged `v1.0.0`, done) |
| 5 | UI redesign "Wayfinding Line": tokens and font, components, header, worker and admin pages, polish ([REDESIGN_PLAN.md](REDESIGN_PLAN.md)) | `v1.1.0`: every screen on DESIGN_SYSTEM.md v2, all gates green, README media refreshed (tagged `v1.1.0`, done) |

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

## Phase 2 slices: client local layer and engine (done: tagged `v0.3.0` on 2026-11-18)

Exit: scenarios 1, 9, 12 pass in CI, plus the client half of scenario 2; tagged `v0.3.0`. The UI reads
IndexedDB only. Ordered by risk: the atomic local write first, then the engine on top of it, then auth
resume, then the thinnest UI that lets Playwright drive it all.

| Slice | Content | Status |
|---|---|---|
| 2.1 | **Local layer** (`src/db/`). Dexie schema and migrations; stores per DATA_MODEL section 2; `meta` (`deviceId`, `userId`, cursor); repositories; `editSubmission` = record + outbox entry in one transaction; coalescing of unsent edits only; all data keyed by `userId`. | done |
| 2.2 | **Sync engine** (`src/sync/`). Push then pull, per-result handling (applied / conflict / rejected), reference-data download, backoff with jitter, error classes, Web Locks, triggers (start, `online`, 60 s, "Sync now"); real `SyncBadge` status. | done |
| 2.3 | **Auth resume.** Token refresh, 401 pause and resume with the outbox untouched, logout confirmation with unsent changes, token storage decision (ADR 0010). | done |
| 2.4 | **Worker UI, thin.** Assignments and submissions read from IndexedDB; form filler (Zod built from the form JSON) that creates, edits, submits, deletes offline. Conflict and rejected states are shown as status only (resolution screen is phase 3). | done |
| 2.5 | **Playwright scenarios and release.** Scenarios 1, 2 (client half), 9 against the compose stack with `X-Fault`; `v0.3.0`. | done |

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

## Phase 3 slices: conflicts (done: tagged `v0.4.0` on 2026-11-18)

Exit: scenarios 4, 5 and 6 pass in CI, so all twelve do; tagged `v0.4.0`. The server already detects and
reports every conflict kind (phase 1) and the client already stores the report and stops syncing the
record (slice 2.2). What is missing is a way for a person to decide, a way for an admin to cause scenario 6,
and the proof in a real browser with two devices. Ordered so the test setup exists first.

| Slice | Content | Status |
|---|---|---|
| 3.1 | **Admin action endpoint.** One REST endpoint over `apply_admin_action` (approve, return, restore, delete, edit), admin only, so there is a way to delete a record while a worker is offline and to restore it. Scenario 4 server half (`test_merge.py`). OpenAPI and client types regenerated. | done |
| 3.2 | **Resolution logic** (`client/src/db/resolve.ts`, engine). Turn the person's choices into a new mutation; keep the starting value for the screen; pull clears a `deleted_remotely` conflict when the admin restores; any new queued entry triggers a sync. No UI. | done |
| 3.3 | **Resolution screen** on the inspection page: starting value, mine and theirs per field, with a choice for each; the two other conflict kinds; header shows how many records need a decision. | done |
| 3.4 | **Playwright scenarios 4, 5, 6** with two browser contexts as two devices, then `v0.4.0`. | done |

### Definition of done per slice (phase 3)

**3.1**
- A non-admin gets 403; an unknown record, a bad action and a missing reason come back as the service's `rejected` results, never as a 500.
- Every action goes through `apply_admin_action` (the existing write-path guard test still passes) and appears as an event.
- Scenario 4 (`test_merge.py`): two devices edit different fields over HTTP, both are applied, the server holds both values.
- Planted-bug check: dropping the permission class, or writing a record directly, fails a test. `openapi.yml` and `api-types.ts` regenerated.

**3.2**
- Resolving a `field_conflict` sends one new mutation (new id) with base = the server's current version, carrying the chosen "mine" fields and every non-conflicting local field, and none of the fields where the person chose "theirs".
- Choosing "theirs" for every field sends nothing and leaves the record synced.
- `deleted_remotely`: "discard" removes the local edits; "keep and wait" stays as is, and when a pull brings the restored record the edits are queued again under a new mutation id (the old id's stored answer is the conflict).
- `edited_since_base` (a delete against newer edits): "keep the record" drops the delete; "delete anyway" sends a new delete at the current version.
- The screen's starting value survives: edits record what each field held before the first unsent change.
- Planted bugs fail a test (wrong base version, reusing the old mutation id, carrying a field the person gave up, not clearing on restore).

**3.3**
- Every conflict kind has a screen with plain words; a decision cannot be applied half-made; keyboard only works; axe passes in light and dark.
- "Needs your decision" is visible on the list and counted in the header.

**3.4**
- Scenario 4: two devices edit different fields offline; both sync; both values on both devices and the server.
- Scenario 5: two devices edit the same field offline; the second sees the conflict, nothing is overwritten; after resolving, a new version is applied and the other device sees it.
- Scenario 6: an admin deletes while a worker edits offline; the worker gets `deleted_remotely`, local edits are kept until they decide; both outcomes (discard, and restore then resync) are covered.
- Each is shown to fail when its guarantee is broken. All twelve scenarios green; `v0.4.0` tagged.

## Phase 4 slices: v1 (done: tagged `v1.0.0` on 2026-11-18)

Exit: `v1.0`. The PoC proved the sync engine; v1 makes it something a reviewer can open, click through
and break on purpose (source plan, "From PoC to portfolio-ready v1"). Already done in earlier phases: login
and push rate limits, sign-out wipes local data after confirmation, the production compose file and deploy
scripts, the protocol spec, the ADRs, the failure-scenario table. Ordered so the admin API exists before the
admin screens, and metrics exist before the load test that reads them.

| Slice | Content | Status |
|---|---|---|
| 4.1 | **Admin API.** Review queue (list and filter submissions, detail with its event history), assignment create and cancel, form-version create and publish, conflict log. Admin only, permission catalog enforced, OpenAPI and types regenerated. | done |
| 4.2 | **Admin web: review.** Admin routes, role gate, review queue, submission detail with history; approve, return (reason), restore, delete, edit through the slice 3.1 endpoint. Admin is online only. | done |
| 4.3 | **Admin web: forms, assignments, conflict log.** Form-version editor (JSON with a live preview built from the same schema code as the worker form, not drag and drop), assignment management, conflict log. | done |
| 4.4 | **Worker experience.** Installable-app prompt, sync-status panel (pending changes, last sync, retry now, what failed), storage persistence request, tap-target and label audit. | done |
| 4.5 | **Operability.** Structured JSON logs carrying `request_id`, `device_id`, `mutation_id`; `/metrics` with pushes, conflicts, rejections, retries and pull lag; not exposed through the public proxy. | done |
| 4.6 | **Load test.** 50 simulated devices pushing and pulling together; throughput, p95 latency and where the advisory lock becomes the bottleneck; hardware, dataset and exact commands published. | done |
| 4.7 | **Ship.** Codespaces dev container with seeded logins, README (claim, demo clip, one-command setup, guarantees linked to tests, "try to break it", "what I'd change at scale"), scripted demo walkthrough, CI badges, `v1.0`. | done |

### Definition of done per slice (phase 4)

**4.1**
- Non-admins get 403 on every endpoint; each needs its catalog permission (`assignment.manage`, `form.publish`, `conflictlog.view`).
- Listing filters by status, worker, assignment and deleted; paged; a record's history lists every event in order with its actor.
- Publishing a form version uses the existing schema validation and immutability; assigning pins the version; cancelling keeps existing submissions.
- The conflict log lists every `conflict` and `rejected` event with the record, worker, kind, fields and time, and says whether the worker has since changed that record.
- Planted bugs fail a test (missing permission check, publishing an invalid schema, unpaged list).

**4.2**
- An admin can find a submitted record, read it with its history, and approve or return it (reason required); a worker's device sees the change after a sync.
- Workers cannot reach admin routes; axe passes in light and dark; keyboard only works.
- Playwright: review flow end to end across two browser contexts (worker submits offline, admin approves).

**4.3**
- The editor refuses a schema the server would refuse, with the same messages; the preview renders the form a worker would see; publishing makes a new immutable version.
- An admin can assign a published form to a worker, cancel it, and see conflicts with their outcome.
- Playwright: publish, assign, worker syncs and fills it in.

**4.4**
- The app can be installed from the prompt on a supported browser and the prompt never appears when already installed; the sync panel shows pending count, last sync, next retry and per-record problems, and "retry now" works.
- Storage persistence is requested after the first successful sync and its result is shown.
- Every interactive control is at least 44 px; axe and the keyboard pass on every worker screen.

**4.5**
- Every request log line is JSON with `request_id`; sync lines also carry `device_id` and `mutation_id`; the id is returned in a response header.
- `/metrics` exposes counters for pushes, results by status, rejections by code, retries (repeated mutation ids) and pull lag; only reachable from inside the stack or with a token; tests read the numbers after known traffic.
- No secrets, tokens or form data in logs (a test checks).

**4.6**
- One command runs the test against the compose stack and prints throughput, p95 and error rate for 50 devices; results are in the repo with hardware, dataset size and the exact commands.
- The write-up shows how throughput changes as devices grow and names the first bottleneck with evidence (lock wait time against query time), stated as honest conditions rather than a headline number.

**4.7**
- A reviewer can open the repo in Codespaces, get seeded data and the three logins, and cause a conflict from two windows by following the README.
- Each guarantee in the README links to the test that proves it; the demo walkthrough is a Playwright script that records the lost-response and two-device conflict flows.
- `v1.0` tagged, release published.

## Phase 5 slices: UI redesign "Wayfinding Line" (done: tagged `v1.1.0` on 2026-11-18)

Exit: `v1.1.0`. The look changes, the behaviour does not. Rules in [DESIGN_SYSTEM.md](DESIGN_SYSTEM.md) v2
and [ADR 0012](adr/0012-visual-identity-and-self-hosted-font.md); reasons in
[REDESIGN_PLAN.md](REDESIGN_PLAN.md). No slice touches the server, `src/db/` or the sync engine.

| Slice | Content | Status |
|---|---|---|
| 5.0 | **Docs.** Redesign plan, DESIGN_SYSTEM.md v2, ADR 0012, PRODUCT.md. | done |
| 5.1 | **Foundation.** `tokens.css` v2, self-hosted Barlow fonts precached, global primitives restyled. No markup changes (`theme-color`, favicon and manifest colours move to 5.3 with the band). | done |
| 5.2 | **Components.** Buttons (primary, secondary, quiet, destructive), fields, Yes/No segments, station line (in `SyncBadge`), status chip, banner, toast, dialog, table, quiet empty states, skeletons; `/styleguide` updated. | done |
| 5.3 | **Shell.** Sign band header (worker numeral, Sync now primary), admin rail and phone tab row with `aria-current`; favicon, PWA icons, manifest and `theme-color` in the band colour. | done |
| 5.4 | **Worker pages.** Assignments, inspection (sticky submit, Delete moved), sync status, conflict panel, login, 404/error (via the quiet states from 5.2). | done |
| 5.5 | **Admin pages.** Review queue, submission detail (two columns, action panel, field titles in history), forms, form editor, assignments, conflict log. | done |
| 5.6 | **Polish and proof.** Audit and critique pass, dark and reduced-motion check, README screenshots, re-recorded demo GIFs, `v1.1.0`. | done |
| 5.8 | **Controls polish** (owner feedback after `v1.1.0`): input focus as a highlight, eye button in password fields, roomier and styled selects and date fields, account menu with the theme as three choices and Sign out, right-aligned button groups, centred dialogs. | in review |

### Definition of done per slice (phase 5)

Every slice: `npm run typecheck && npm run lint && npm run format:check && npm test` and `bash
scripts/e2e.sh` green; before/after screenshots at 390 px and 1366 px, light and dark, in the PR; accessible
names used by tests unchanged unless the PR lists the change; no inline `style=`; `modules.test.ts` green.

- **5.1** Every token pair in DESIGN_SYSTEM.md section 2 is in `tokens.css`; fonts load offline (Playwright
  offline reload shows Barlow); no request leaves the origin; axe clean in light and dark.
- **5.2** Each component has default, hover, focus, active, disabled and busy or error states in the style
  guide; the station line keeps every v1 label and is `aria-hidden` itself; axe clean on `/styleguide`.
- **5.3** Phone header is at most two rows for both roles; the current admin page is announced
  (`aria-current`); the tap-target test passes.
- **5.4** Delete is not next to the primary action; the inspection page says where edits are; empty states
  are body size; the tap-target test passes on every worker page.
- **5.5** Destructive actions are separated from Approve; history shows field titles; the admin assignments
  page has no horizontal scroll at 390 px.
- **5.6** Impeccable audit has no open P0/P1; demo GIFs and README screenshots show v2; `v1.1.0` tagged.

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
- [x] Audit trail (`submission_event`, append-only): landed with the sync core in phase 1 and is shown in the admin review screen
- [x] Security headers (incl. CSP), login rate limit, secure cookies in production, no secrets in repo, dev-only seeded logins (push rate limit in phase 1)
- [x] Local dev: compose stack (db, migrate, server, web), seed command, and `bash scripts/e2e.sh` for a fresh DB end to end

**Delivery**
- [x] Deployable to any single Docker host: HTTPS and HSTS via Caddy, deploy on tag (Release workflow, SSH step off until configured), rollback by redeploying a tag. **No host chosen yet (owner: "not for now"), so no live deployment.**
- [x] Tag per milestone: `v0.1.0` (Release workflow ran end to end; the published images were deployed locally through `deploy.sh`'s pull path and passed the smoke checks)
- [ ] Live demo with seeded logins and a nightly reset (backlog; needs a host and a demo mode that does not use debug)
- [x] Prod compose file, `DEPLOY.md`, backup and restore (round trip tested in CI), smoke checks
- [x] Docs index, ADRs for hard-to-reverse decisions (0001 to 0010), conventions doc, backlog table

## Decisions already made

- Project name: Talaan.
- Stack as in the source plan (Django/DRF, Postgres, React/Vite/Dexie).
- No AI attribution in commits or PRs.
- One PR per slice, squash merge; user says "merged and pulled".

## Open questions

- Hosting target for a live demo (none chosen; the README offers Codespaces instead).
- The Codespaces dev container has not been run in a real Codespace; only its pieces were tested.
- The LICENSE (MIT, under the repository owner's handle) was flagged in PR #7 and #30 and not yet confirmed.

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
| Revoke refresh tokens server-side (rotation with grace for a lost refresh response, or a per-user token version) | ADR 0010 | later | |
| Engine test "syncs on start, when the browser comes online, and every 60 seconds" timed out (5 s) once in five full client runs | CSS Modules slice | soon | timing under load; the SyncStatusPage races were fixed in that slice |
| Metrics from rollups instead of grouped queries over the ledger at every scrape (it scans `applied_mutation`); pull lag per device with a time series store | Slice 4.5 | when the ledger is large | what I would change at scale |
| Clear the Dependabot `minimatch` alert (build-time only, via vite-plugin-pwa > workbox-build > glob): try an npm `overrides` entry, or dismiss as tolerable | Slice 0.5 | when convenient | `npm audit --omit=dev` is already clean |
| Postgres major-version upgrade procedure, tested | Slice 0.5 | later | currently a manual note in DEPLOY.md |
