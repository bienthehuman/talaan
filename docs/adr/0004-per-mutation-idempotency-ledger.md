# 0004. Per-mutation idempotency ledger instead of batch-level keys

Status: accepted · Date: 2026-11-17

## Context
The most important failure is "the server applied it but the response was lost". The client must
retry safely, and the retry must not apply anything twice. Batches mix outcomes: some applied,
some conflicted, some rejected.

## Options
1. **Batch idempotency key.** One key per request; store the whole response.
2. **Per-mutation ledger.** Every mutation has a `mutation_id`; the server stores each result.
3. **Natural idempotency** (compare resulting state). Cannot tell a retry from a genuine repeat.

## Decision
Option 2. `applied_mutation(mutation_id PK, device_id, user_id, result JSONB, created_at)`. The
ledger row is inserted first, inside the same transaction as the change. A duplicate insert fails
on the primary key, and that request returns the stored result.

## Consequences
- Retries may be re-batched differently (e.g. smaller batch, other mutations added) and stay safe.
- Stored `conflict` and `rejected` results are replayed too, so a retry never changes a verdict.
- Concurrent duplicates serialize on the unique key (scenario 3). A different constraint failing
  must not be mistaken for a duplicate: the handler re-reads the ledger and re-raises if absent.
- A `mutation_id` already recorded for another user is `rejected` (`mutation_id_reuse`).
- The ledger grows forever. At scale, partition by time and expire rows older than the maximum
  client retry window (listed under "What I'd change at scale").
- Replayed results are snapshots and may be stale; clients reconcile via pull.
