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

Add ports, tool versions, test-runner worker limits and CLI quirks here as they are discovered.
