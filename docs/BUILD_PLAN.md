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

## Phase 0 slices

| Slice | Content | Status |
|---|---|---|
| 0.0 | Repo basics, CLAUDE.md, this plan | in progress |
| 0.1 | Design docs: architecture, data model (with correction paths), roles × steps, protocol, conventions, design system, ADR 0001–0009 | done (docs accepted 2026-11-17) |
| 0.2 | Server skeleton: Django, DRF, simplejwt, Postgres, health, OpenAPI page, RFC 7807 errors | in review |
| 0.3 | Client skeleton: Vite React TS, PWA shell, routing, login, theme tokens, 404/error pages | in review |
| 0.4 | Compose, CI (build, lint, typecheck, format, unit, integration, e2e, OpenAPI drift), branch protection | in review |
| 0.5 | Deployable skeleton (no host chosen): production compose with Caddy HTTPS, deploy / backup / restore / smoke scripts, release workflow (images and GitHub release on tag, optional SSH deploy), `DEPLOY.md`, `prod-smoke` CI job. Branch ruleset on `main` (repo made public). | in review |

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
- [ ] Tag per milestone: `v0.1.0` after this slice merges (first real run of the Release workflow)
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
| Postgres major-version upgrade procedure, tested | Slice 0.5 | later | currently a manual note in DEPLOY.md |
