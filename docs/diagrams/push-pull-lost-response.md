# Push/pull sequence with a lost response

Scenario 2: the server applies a mutation, then the response is lost.

```mermaid
sequenceDiagram
  autonumber
  participant UI as Worker UI
  participant DB as IndexedDB
  participant E as Sync engine
  participant S as Server
  participant PG as PostgreSQL

  UI->>DB: edit (record + outbox entry, one tx) [Saved on device]
  E->>DB: read oldest entry per record, set baseVersion, set sentAt (entry frozen)
  E->>S: POST /sync/push {mutation M1}
  S->>PG: BEGIN; INSERT ledger(M1); advisory lock; apply; version 5; COMMIT
  S--xE: 503 (response lost: drop-after-commit)
  Note over E: Transient failure. Outbox untouched.<br/>Backoff + jitter.
  E->>S: POST /sync/push {mutation M1} (identical)
  S->>PG: INSERT ledger(M1) fails (unique); read stored result
  S-->>E: applied, version 5 (stored result, nothing re-applied)
  E->>DB: drop outbox entry, update shadow + serverVersion [Synced]
  E->>S: GET /sync/pull?cursor=N
  S-->>E: records with server_seq > N, has_more=false
  E->>DB: apply records + save cursor (one tx)
```

Result: exactly one submission and one version bump on the server; the client ends in `Synced`.
The retry must be byte-for-byte the same mutation, which is why sent outbox entries are frozen.
