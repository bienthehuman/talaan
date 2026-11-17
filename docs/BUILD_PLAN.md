# Build plan

Source plan: "Offline-First Field Data Platform: PoC to v1" (Nov 13, 2026). This file tracks
phases, slices, the baseline checklist and the backlog. Planning unit is **review checkpoints**,
not days or weeks: slices are batched for review and ordered by risk and dependency.

## Phases

| Phase | Content | Done when |
|---|---|---|
| 0 | Design docs accepted. Walking skeleton (Django + Postgres + Vite PWA shell, login, health, CI, compose) with production constraints. Deployed once a host is chosen. | Baseline checklist ticked, CI green, `v0.1` |
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
| 0.5 | Deploy skeleton (blocked on hosting decision) | blocked |

## Baseline checklist (phase 0)

**Repo and GitHub**
- [x] README, `.gitignore`, `.gitattributes`, `.editorconfig`, `.env.example`
- [x] Version pins (`.nvmrc`, `packageManager`, `.python-version`, exact versions in lockfiles), current versions checked at scaffold
- [ ] GitHub repo created (private); `main` protected (PRs required, squash only, no force-push, strict required checks). **Blocked:** GitHub does not offer branch protection or rulesets on private repos on this plan (HTTP 403). Squash-only merging and delete-branch-on-merge are set at repo level. Needs the repo to go public or a plan upgrade.
- [x] `.github/pull_request_template.md` (summary, definition of done, test plan, decisions to check)
- [x] CI on every PR: lint, typecheck, format, unit, integration, build, e2e, OpenAPI/client drift, `npm audit` (prod deps); badge in README. Jobs: `server`, `client`, `e2e`.
- [x] SECURITY.md, CONTRIBUTING.md, CLAUDE.md (env quirks), Dependabot
- [ ] LICENSE (needs the owner to choose the licence and the copyright holder name)

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
- [ ] Deploy target chosen (**open: user said "not yet"**); HTTPS, deploy on tag, tag per milestone
- [ ] Prod compose file + DEPLOY.md regardless of hosting (slice 0.5)
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
