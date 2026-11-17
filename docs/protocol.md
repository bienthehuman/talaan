# Sync protocol

Status: accepted. Protocol version (`client_schema`): **1**.

This is the contract between any client and the server. The server owns every version number and
sequence. Client clocks are display-only and never decide anything.

## 1. Overview

A sync cycle is **push, then pull**. Push sends outbox mutations and receives one result per
mutation. Pull fetches everything that changed since the client's cursor. Transport is JSON over
HTTPS. Auth is a JWT access token (`Authorization: Bearer`).

Guarantees (each linked to a test in `failure-scenarios.md`):

1. A mutation is applied at most once, however many times it is sent (idempotency).
2. A mutation is applied whole or not at all.
3. No accepted change is silently overwritten (field-level conflict detection).
4. A pull never skips a change (gap-free cursor).
5. Transient failures never lose or reorder local changes.

Non-guarantees: real-time delivery, ordering across records, encryption of local data at rest,
survival of browser storage eviction.

## 2. Versioning and compatibility

- Every request carries `client_schema` (push body; `X-Client-Schema` header on all other calls).
  A missing or non-numeric value is `400 client_schema_required`. The check runs after authentication
  (a logged-out client learns to log in first) and **before** body validation, so an old client whose
  body has a different shape still gets its 426.
- If `client_schema < MIN_CLIENT_SCHEMA`, the server answers **426 Upgrade Required** with an
  RFC 7807 body (`code: client_too_old`). The client shows "update the app" and keeps local data.
- Form schema changes are safe by design: a submission is pinned to the `form_version` it was
  created on, and published form versions are immutable.

## 3. Operations (`op`)

| op | Who | Meaning | Allowed record status |
|---|---|---|---|
| `create` | worker | New submission for an assignment. Client generates the UUID. | n/a |
| `update` | worker | Change one or more fields | `draft`, `returned` |
| `submit` | worker | Move to `submitted`. All required fields must be present. | `draft`, `returned` |
| `delete` | worker | Soft delete (tombstone) | `draft`, `returned` |

Admin actions (`approve`, `return`, `restore`, `delete`, field edit) are REST endpoints under
`/api/admin/...`. They are **not** in the push protocol, but they call the same server-side
`_apply` path (advisory lock, version bump, ledger row, `server_seq`) so they obey every rule here.

## 4. Push: `POST /api/sync/push`

```json
{
  "device_id": "7b1e...",
  "client_schema": 1,
  "mutations": [
    {
      "mutation_id": "c0f4...",
      "record_id": "a91d...",
      "op": "update",
      "base_version": 4,
      "fields": { "oil_level": "low", "notes": "Leak near gasket" }
    }
  ]
}
```

- `create` additionally carries `assignment_id`; `base_version` is `0`; `fields` is the initial data.
- `submit` carries `fields: {}` (or final field values) and `base_version`.
- `delete` carries `fields: {}` and `base_version`.
- Maximum **50** mutations per request (more → 400 `batch_too_large`).
- Only workers push: any other role gets `403 forbidden` for the whole request. Pushes are rate limited
  per user (default `120/min`, `THROTTLE_PUSH`): `429 rate_limited` with `Retry-After`.
- The body may carry `app_version` (a string, optional). The first push registers the `device`; later
  ones refresh `last_seen_at` and `app_version`. A browser profile shared by two people keeps one device
  id, which moves to whoever synced last; the ledger still records who sent each mutation.
- A body that cannot be parsed (bad UUID, `mutations` not a list, negative `base_version`, ...) is
  `400 validation_error` and applies nothing. An unknown `op` is **not** a 400: it is a `rejected`
  (`invalid`) result for that mutation, so the rest of the batch still applies.
- The server processes mutations **in order**, each in its **own transaction**. One failing mutation
  does not roll back the others.

### Response

One result per mutation, in order:

```json
{
  "results": [
    {
      "mutation_id": "c0f4...",
      "status": "applied",
      "record": { "id": "a91d...", "version": 5, "field_versions": {"oil_level": 5, "notes": 5},
                  "data": {}, "status": "draft", "deleted": false }
    }
  ]
}
```

| status | Meaning | Client action |
|---|---|---|
| `applied` | Committed | Drop the outbox entry; update shadow and `serverVersion` |
| `conflict` | Nothing applied; see `conflict` | Mark the record `conflict`, keep local data, show resolution |
| `rejected` | Permanent failure; see `code` | Mark the record `rejected` with the reason; never retry automatically |

### Conflict result

```json
{
  "mutation_id": "c0f4...", "status": "conflict",
  "conflict": {
    "kind": "field_conflict",
    "fields": [{"field": "oil_level", "server_value": "ok", "client_value": "low", "server_version": 6}]
  },
  "record": { "...current server copy..." }
}
```

`kind` is one of `field_conflict`, `deleted_remotely`, `edited_since_base` (delete vs newer edits).

`fields` by kind: `field_conflict` lists each clashing field with `server_value`, `client_value` and
`server_version`; `edited_since_base` lists the fields changed after the client's base with
`server_value` and `server_version`; `deleted_remotely` has an empty list.

### Result details

- A `rejected` result carries `detail` (a sentence for people) and, for `invalid`, `errors`:
  `[{"field", "code", "message"}]` with codes such as `required`, `unknown_field`, `type`, `enum`,
  `minimum`, `maximum`, `maxLength`.
- `record` is the server's copy: `id`, `assignment_id`, `form_version_id`, `version`, `field_versions`,
  `data`, `status`, `deleted`, `server_seq`. It is attached to `applied` and `conflict` results, and to a
  `rejected` result only when the user may see the record (so `not_found`, `forbidden`, `id_taken`
  and `mutation_id_reuse` never reveal anything).

### Rejected codes

| code | Meaning |
|---|---|
| `locked` | Record is `approved` or `submitted`; workers cannot edit |
| `not_found` | Unknown record, or not visible to this user (the two are indistinguishable on purpose) |
| `id_taken` | `create` for an id that exists under another user, or already exists here |
| `invalid` | Failed validation against the pinned form version (`errors` lists fields) |
| `invalid_state` | Op not allowed in the current status, or the assignment was cancelled (`create`) |
| `unknown_form_version` | `assignment_id` missing, not yours, or form version unknown |
| `mutation_id_reuse` | `mutation_id` already recorded for another user |
| `forbidden` | The user's role cannot perform this op (for example an admin pushing a worker mutation) |

### Transient failures are not statuses

Network error, timeout, HTTP 5xx and 429 mean the client **retries the same, unmodified batch**
with exponential backoff and jitter. 401 pauses the cycle (section 8).

## 5. Server rules

1. **Idempotency.** The ledger row (`applied_mutation`) is inserted first, in the same transaction
   as the change, and holds the result. A repeated `mutation_id` returns the stored result and
   changes nothing, including stored `conflict` and `rejected` results. A concurrent duplicate
   blocks on the ledger's unique key, then returns the stored result.
2. **One transaction per mutation.**
3. **Versions.** Each accepted mutation sets `version = version + 1`, and
   `field_versions[f] = new version` for every field it changed. `base_version` is the version the
   client last confirmed.
4. **Creates.** The client generates the UUID. An existing id under another user is `id_taken`.
   A retry of the same create is handled by rule 1. A different `mutation_id` for an id that
   already exists for this user is also `id_taken`.
5. **Deletes** are soft: `deleted_at` is set, `version` bumped, a new `server_seq` assigned so the
   tombstone reaches other devices via pull.
6. **Validation** against the pinned form version. Drafts may be incomplete. `submit` requires every
   required field.
7. **Ordering lock.** Every sync write takes `pg_advisory_xact_lock(SEQ_LOCK)` before `nextval` and
   holds it to commit (section 7).
8. **Stored results are snapshots.** A replayed mutation returns the result as it was, even if the
   record has changed since. The client reconciles through pull.
9. **Device registration.** First sync upserts `device` and updates `last_seen_at`/`app_version`.
10. **Clearing a field.** A value of `null` in `fields` removes the field from `data`. The clear is
    versioned like any change (`field_versions[f]` is set), so a stale device that then types into the
    cleared field gets a conflict instead of silently re-adding it.
11. **Only accepted changes consume a version and a `server_seq`.** A conflict or rejection writes the
    ledger row and an event and nothing else, so the sequence has no gaps from refused mutations.
12. **Order of checks**, so the same mutation always gets the same verdict: role (`forbidden`), then
    record visibility (`not_found`), then lock (`locked`), then deleted (`deleted_remotely` conflict),
    then `base_version` sanity (`invalid`: it must be between 0 and the record's version), then field
    conflicts, then validation (`invalid`).
13. **Submit** checks only the fields sent with it for conflicts; the rest of the record is submitted as
    the server holds it (a merge of what every device entered). Every `required` field must be present.
    A submitted record is `invalid_state` to submit again, `locked` once approved.
14. **Create** is refused as `unknown_form_version` when `assignment_id` is missing or not the user's,
    and as `invalid_state` when the assignment was cancelled. The form version is taken from the
    assignment, never from the client.
15. **Events.** Every applied change, conflict and rejection on a record the user can see is appended to
    `submission_event` (kind, actor, mutation id, detail) in the same transaction. Nothing is logged for
    `not_found`, `forbidden`, `id_taken` or a rejected `create`.

### Admin actions

Server-side only (REST endpoints arrive with the review UI); they run through the same core as push,
so they take the advisory lock, bump `version`, draw a `server_seq`, and leave a ledger row (device
`00000000-0000-0000-0000-000000000000`) and an event.

| Action | Allowed when | Result |
|---|---|---|
| `approve` | `submitted`, not deleted | status `approved` (workers locked out) |
| `return` | `submitted` or `approved`, not deleted; **a reason is required** | status `returned` (workers can edit again); the previous status is kept in the event |
| `restore` | deleted | clears `deleted_at` |
| `delete` | not deleted | tombstone |
| `edit` | not deleted; at least one field | applies fields (`null` clears); a `submitted` or `approved` record must stay complete |

Anything else is `rejected` (`invalid_state`, or `invalid` for a missing reason or fields); a non-admin
gets `forbidden`.

## 6. Conflict rules

Detected per field using server versions, never timestamps. A mutation is applied whole or not at
all.

For each field `f` in an `update`, it conflicts if **both**:
- `field_versions[f] > base_version`, and
- the server's current value differs from the client's new value (identical answers are not a conflict).

| Situation | Outcome |
|---|---|
| Two devices change different fields | Both applied; merged automatically |
| Same field, different values | Second gets `conflict` (`field_conflict`); nothing applied |
| Worker edits, record deleted meanwhile | `conflict` (`deleted_remotely`); worker discards or asks admin to restore |
| Worker deletes, record edited after worker's base | `conflict` (`edited_since_base`); never silently deletes newer work |
| Worker edits an `approved`/`submitted` record | `rejected` (`locked`); nothing to resolve |
| Admin returns a submission | Normal update; worker sees it on next pull and can edit again |

**Resolution is just another update.** The client builds a new mutation with a new `mutation_id`,
`base_version` = the server's current version, containing the worker's chosen values. Non-conflicting
local fields carry over. It gets the same idempotency and validation as any write.

## 7. Pull: `GET /api/sync/pull?cursor=1042&limit=200`

```json
{ "records": [ { "id": "...", "version": 7, "server_seq": 1050, "deleted": false, "...": "..." } ],
  "next_cursor": 1050, "has_more": false }
```

- Returns records visible to the user with `server_seq > cursor`, ordered by `server_seq`.
- Visibility: a worker sees the records of their own assignments (including those of a later cancelled
  assignment); an admin sees everything. Other roles get `403 forbidden`.
- `limit` default 200, max 500 (a larger value is clamped, a non-number or less than 1 is
  `400 validation_error`). `cursor` is a whole number, at least 0; the initial cursor is `0`.
- `next_cursor` is the `server_seq` of the last record returned, or the cursor sent when there are none.
- Each record has the same shape as the `record` in push results (`id`, `assignment_id`,
  `form_version_id`, `version`, `field_versions`, `data`, `status`, `deleted`, `server_seq`).
- Tombstones are included (`deleted: true`).
- The client loops until `has_more` is false, saving the cursor in the same local transaction as
  the records it covers.
- **At-least-once.** The client ignores a pulled record whose `version <= local serverVersion`.
- Assignments and form versions are small; for the PoC they are re-fetched in full
  (`GET /api/assignments`, `GET /api/form-versions`), not cursor-based.
  - `GET /api/assignments` returns `{"results": [{"id", "form_version_id", "form_name", "site_name",
    "due_date", "cancelled"}]}`: a worker's own (cancelled ones are marked, not hidden), all for an admin.
  - `GET /api/form-versions` returns `{"results": [{"id", "form_id", "form_name", "number", "schema",
    "published_at"}]}`: published versions only; a worker gets the versions they have an assignment
    for (an older version stays listed while newer ones exist, because their records are pinned to it).
  - Both are plain lists, not paged, and both take `X-Client-Schema`.

### The gap problem

Without ordering, transactions taking `server_seq` 101 and 102 can commit as 102 then 101. A pull in
between sets the cursor to 102 and **never sees 101**. For the PoC, every sync write takes
`pg_advisory_xact_lock(4242)` before `nextval` and keeps it until commit, so values commit in order.
This serializes writes, which is fine at PoC scale. Alternatives (safe watermark, logical
replication) are in ADR 0005. Test scenario 8 fails without the lock.

## 8. Auth expiry

A 401 during sync stops the cycle and leaves the outbox untouched. The client refreshes the token or
asks the user to log in again, then resumes from the start of a cycle. Logging out with unsent
changes needs explicit confirmation. Local data is keyed by `userId`.

## 9. Error format

Non-2xx responses (other than per-mutation results) use RFC 7807 (`application/problem+json`) with a
stable `code`:

| Status | `code` | When |
|---|---|---|
| 400 | `validation_error` | The request cannot be parsed; `errors` maps fields to messages |
| 400 | `batch_too_large` | More than 50 mutations |
| 400 | `client_schema_required` | No usable protocol version was sent |
| 401 | `unauthenticated` | Missing, invalid or expired token |
| 403 | `forbidden` | The role cannot use this endpoint |
| 426 | `client_too_old` | `client_schema` below the server's minimum |
| 429 | `rate_limited` | Throttled; `Retry-After` and `retry_after` say how long |
| 5xx | `server_error` | Unexpected failure; safe to retry the same batch |
| 400 / 503 | `invalid_fault` / `fault_injected` | Fault injection only (section 10) |

## 10. Fault injection (dev and test only)

Installed only when `FAULT_INJECTION=1`, and the server refuses to start with it unless
`DJANGO_DEBUG=1`; the middleware itself also refuses to load outside debug. Without it the header below is
ignored. A test asks for a failure **per request** with the `X-Fault` header, so a fault applies to exactly the
request that carries it and nothing is stored on the server (reliable with several workers; a
Playwright test adds the header to one request with `page.route`). Only `/api/sync/` paths are affected.

| Value | Effect |
|---|---|
| `fail-before` | `503 fault_injected` without running the view or touching the database |
| `drop-after-commit` | Run the view (every mutation commits), then discard the response and answer `503`: "the server applied it but the response was lost" |
| `delay=<ms>` | Run the view, then hold the response (capped at 30 000 ms) |
| `expire-token[=<n>]` | Push only: after `n` mutations are applied (default 1) answer `401`, if more remain |

Combine with commas (`delay=200,drop-after-commit`). An unknown or malformed value is `400 invalid_fault`,
so a typo in a test fails loudly instead of injecting nothing. There is no endpoint that sets rules.
