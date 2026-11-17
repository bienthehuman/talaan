# Contributing

This is a solo portfolio project, but it is run like a team repo so the history reads cleanly.
The rules live in [docs/CONVENTIONS.md](docs/CONVENTIONS.md); the short version:

- **One slice per pull request** (database, API, UI, tests), on a branch named
  `<phase>-<slice>-<short-name>` such as `1-2-apply-mutation`.
- **Squash merge**, with a conventional-commit title: `feat(sync): idempotent apply (#12)`.
- **Docs first.** `docs/` is the source of truth. Change it in the same PR as the design change.
- **Write the definition of done before the code**, and tick only what you verified.
- New ideas that come up mid-slice go in the backlog table in `docs/BUILD_PLAN.md`, not into the slice.

## Set up

See the Run / test section of the [README](README.md). Environment quirks (ports, tool versions,
database roles) are in [CLAUDE.md](CLAUDE.md).

## Before opening a pull request

```bash
cd server && ruff check . && ruff format --check . && python -m pytest
cd client && npm run typecheck && npm run lint && npm run format:check && npm test
bash scripts/e2e.sh        # full stack + Playwright (drops the compose database)
```

CI runs the same three jobs (`server`, `client`, `e2e`). If you change the API, regenerate
`server/openapi.yml` and `client/src/lib/api-types.ts`; CI fails when they drift.
