# Talaan

Offline-first field data sync. Field workers fill in inspection forms with no network; every change
reaches the server exactly once, with no silent overwrites, even when the network fails mid-sync.

> Status: design phase. See [docs/BUILD_PLAN.md](docs/BUILD_PLAN.md).

## Stack

Django + DRF + simplejwt + PostgreSQL · React + TypeScript + Vite + Dexie + Workbox ·
pytest, Vitest, Playwright · Docker Compose, GitHub Actions.

## Run / test

Coming with the phase-0 skeleton (one-command setup via Docker Compose).

## Docs

[docs/README.md](docs/README.md) is the index.

## Guarantees and non-guarantees

Filled in as each guarantee gets a passing test (see `docs/failure-scenarios.md`).
