# 0007. IndexedDB via Dexie instead of SQLite (WASM) in the browser

Status: accepted · Date: 2026-11-17

## Context
The client needs durable local storage with multi-store transactions (a record and its outbox entry
must commit together, scenario 12), indexes, and a reasonable footprint on mobile browsers.

## Options
1. **IndexedDB through Dexie.** Native to every browser, small wrapper, real transactions.
2. **SQLite compiled to WASM** (e.g. on OPFS). Familiar SQL and the same engine as a future MAUI
   client, but larger, browser support for persistent file APIs is uneven, and some setups need
   cross-origin isolation headers or workers.
3. **localStorage.** No transactions, small quota, synchronous. Not suitable.

## Decision
Option 1. Dexie provides ergonomic schemas, indexes and `db.transaction('rw', ...)`.

## Consequences
- Atomic local edit is straightforward: both writes in one transaction; aborting rolls back both.
- Queries are index-based, not SQL. Complex reporting stays on the server.
- Testing uses `fake-indexeddb` in Vitest, which can simulate an aborted transaction.
- Data is not encrypted at rest and can be evicted by the browser. This is a **known risk**:
  call `navigator.storage.persist()` after login, ask workers to install the PWA, and document it.
- A later MAUI/SQLite client speaks the same protocol; the local store is not part of the contract.
