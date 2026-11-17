# 0005. Advisory lock to order `server_seq`

Status: accepted · Date: 2026-11-17

## Context
Pull uses a cursor: "give me everything with `server_seq` greater than N". Sequence values are
assigned at `nextval` time, not commit time. Two transactions can take 101 and 102, and 102 can
commit first. A pull in between returns 102, the client stores cursor 102, and change 101 is never
delivered. Scenario 8 reproduces this.

## Options
1. **Advisory lock** (`pg_advisory_xact_lock`) taken before `nextval` and held to commit. Values
   commit in order. Simple, but serializes all sync writes.
2. **Safe watermark.** Store the writing transaction's id on each row; pull returns only rows
   older than the oldest in-flight transaction (`pg_snapshot_xmin`). No write serialization, but
   more subtle and needs extra columns and care.
3. **Logical replication / change data capture.** Reads changes in commit order from the WAL.
   Correct and scalable, but heavy operationally and not a PoC-sized dependency.
4. **Overlapping cursor window** (re-read the last N seconds). Probabilistic, not a guarantee.

## Decision
Option 1 for the PoC. Every write, including admin actions, calls `pg_advisory_xact_lock(4242)`
before `nextval`, inside the mutation's transaction.

## Consequences
- Sequence values become visible in order, so a cursor never skips a change.
- Writes are serialized; throughput is bounded by transaction length, so keep transactions short
  and do validation work before taking the lock where possible.
- The lock key is a single constant. Any write path that bypasses it silently breaks the
  guarantee. CLAUDE.md forbids this, and a test covers it.
- Scenario 8 is the proof: it fails when the lock is removed and passes with it. It becomes a
  write-up.
- The v1 load test (50 devices) reports where the lock becomes the bottleneck.
- Migration path: option 2 first (same protocol, no client change), option 3 if scale demands it.
