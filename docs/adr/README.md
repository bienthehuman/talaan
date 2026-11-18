# Architecture decision records

Format: context, options, decision, consequences. Numbered, never rewritten: supersede with a new ADR.
Status values: proposed, accepted, superseded by NNNN.

| # | Decision | Status |
|---|---|---|
| [0001](0001-client-generated-uuids.md) | Client-generated UUIDs instead of server IDs | accepted |
| [0002](0002-server-assigned-versions.md) | Server-assigned versions instead of timestamps or last-write-wins | accepted |
| [0003](0003-field-level-conflict-detection.md) | Field-level conflict detection, all-or-nothing per mutation | accepted |
| [0004](0004-per-mutation-idempotency-ledger.md) | Per-mutation idempotency ledger instead of batch-level keys | accepted |
| [0005](0005-advisory-lock-for-server-seq.md) | Advisory lock to order `server_seq` | accepted |
| [0006](0006-soft-deletes-with-tombstones.md) | Soft deletes with tombstones; purge left for later | accepted |
| [0007](0007-indexeddb-via-dexie.md) | IndexedDB via Dexie instead of SQLite (WASM) | accepted |
| [0008](0008-submissions-pinned-to-immutable-form-version.md) | Submissions pinned to an immutable form version | accepted |
| [0009](0009-no-background-sync-dependency.md) | No Background Sync API dependency | accepted |
| [0010](0010-token-storage-and-session-resume.md) | Token storage in localStorage, refresh once on 401, sign-out wipes local data | accepted |
