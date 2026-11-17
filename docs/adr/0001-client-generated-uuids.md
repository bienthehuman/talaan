# 0001. Client-generated UUIDs instead of server IDs

Status: accepted · Date: 2026-11-17

## Context
Workers create submissions with no network. A record needs an identity before the server has seen
it, so later edits, the outbox and retries can refer to it. A retried create must not produce a
second record.

## Options
1. **Server-assigned IDs.** The client uses a temporary local ID and remaps after the first sync.
2. **Client-generated UUIDs** used as the permanent primary key.

## Decision
Option 2. `submission.id` is a UUID generated on the device with `crypto.randomUUID()` (v4).

## Consequences
- No ID remapping. The outbox, local store and server all use one ID from the start.
- A retried `create` is safe: idempotency (ADR 0004) handles the same `mutation_id`, and a
  different `mutation_id` for an existing id is rejected as `id_taken`.
- A malicious or buggy client could choose an id already used by someone else. The server rejects it
  (`id_taken`, or `not_found` on later access) and never reveals the other owner.
- `crypto.randomUUID()` requires a secure context (HTTPS or localhost).
- Random v4 keys have worse index locality than time-ordered ids. Pull orders by `server_seq`, so
  this only affects the primary-key index, which is acceptable at this scale. UUIDv7 can be adopted
  later without a protocol change.
