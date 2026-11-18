# Failure scenarios

The PoC is done when all twelve pass in CI. Each is an automated test. Test paths are the **planned**
locations; they are created in the phase that implements them. Update the status column as tests
land. `pytest -m phase1` runs the phase 1 scenarios.

| # | Scenario | Pass condition | Test type | Planned test | Phase | Status |
|---|---|---|---|---|---|---|
| 1 | Create and edit offline, reload the browser | Data and outbox survive; badge shows "Saved on device" | Playwright (`context.setOffline(true)`) | `e2e/tests/01-offline-reload.spec.ts` | 2 | done (slice 2.5) |
| 2 | Response lost after commit, client retries | Exactly one submission on server; client ends synced | Playwright + pytest | `e2e/tests/02-lost-response.spec.ts`, `server/sync/tests/test_lost_response.py` | 1 (pytest), 2 | done (server half 1.3, Playwright half 2.5) |
| 3 | Same batch sent twice concurrently | One ledger row per mutation; same result to both | pytest, two threads | `server/sync/tests/test_concurrent_duplicate.py` | 1 | done (slice 1.4) |
| 4 | Two devices edit different fields | Both applied; server holds both values | pytest + Playwright, two contexts | `server/sync/tests/test_merge.py`, `e2e/tests/04-merge.spec.ts` | 3 | todo |
| 5 | Two devices edit the same field | Second gets conflict; nothing overwritten; resolution yields a new applied version | Playwright | `e2e/tests/05-conflict.spec.ts` | 3 | todo |
| 6 | Admin deletes while worker edits offline | Worker gets `deleted_remotely`; local edits kept until worker decides | Playwright | `e2e/tests/06-deleted-remotely.spec.ts` | 3 | todo |
| 7 | 20 concurrent updates to one record | Created at version 1, 20 updates give versions 2..21, no gaps; contradicting edits lose nothing silently | pytest, thread pool | `server/sync/tests/test_concurrent_updates.py` | 1 | done (slice 1.4) |
| 8 | Writers and a puller run concurrently | Puller sees every change exactly once (no skipped `server_seq`); fails without the advisory lock | pytest, threads | `server/sync/tests/test_pull_gap.py` | 1 | done (slice 1.4) |
| 9 | Token expires mid-sync | Outbox intact; sync resumes after refresh or login (server half, `expire-token`, is tested in `server/sync/tests/test_fault_injection.py`) | Playwright | `e2e/tests/09-token-expiry.spec.ts` | 2 | done (engine tests 2.3, Playwright 2.5) |
| 10 | Worker edits an approved submission | `rejected: locked`; clear message; no retry loop | pytest + Playwright | `server/sync/tests/test_locked.py`, `e2e/tests/10-locked.spec.ts` | 1 (pytest), 3 | pytest done (1.2 service, 1.3 HTTP); Playwright half in phase 3 |
| 11 | Client too old | 426 returned; app shows update notice; local data kept | pytest | `server/sync/tests/test_client_schema.py` | 1 | done (slice 1.3) |
| 12 | Tab killed during a local write | Record and outbox are both present or both absent | Vitest + fake-indexeddb | `client/src/db/submissions.test.ts` | 2 | done (slice 2.1) |

## Guarantees mapped to scenarios

| Guarantee (protocol §1) | Scenarios |
|---|---|
| 1. Applied at most once | 2, 3 |
| 2. Whole or nothing | 5, 10 |
| 3. No silent overwrite | 4, 5, 6, 7 |
| 4. Gap-free pull | 8 |
| 5. Transient failures lose nothing | 1, 2, 9, 12 |

Compatibility (scenario 11) is covered by protocol §2.

## Write-up: scenario 8

Show the test **failing** with the advisory lock removed and **passing** with it. Written up in
[`writeups/pull-gap.md`](writeups/pull-gap.md).
