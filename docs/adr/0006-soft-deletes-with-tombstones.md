# 0006. Soft deletes with tombstones; retention and purge left for later

Status: accepted · Date: 2026-11-17

## Context
Other devices only learn about a deletion through pull. If the row simply disappears, a device that
is offline never finds out and keeps a ghost record that can come back through an edit.

## Options
1. **Hard delete.** Simple, but offline devices never learn of it.
2. **Soft delete with a tombstone.** `deleted_at` set, version bumped, new `server_seq` assigned.
3. **Separate deletion log.** Same effect with a second table to join and keep consistent.

## Decision
Option 2. A delete is a normal versioned change. Tombstones appear in pull (`deleted: true`).

## Consequences
- A delete can conflict like any write: edit after delete is `deleted_remotely`; delete after a
  newer edit is `edited_since_base`. Deletion never silently overrides newer work.
- Admins can restore a record (clears `deleted_at`, bumps version) as the correction path.
- Tombstones accumulate. Purging is **deferred**, and it is unsafe to purge a tombstone newer than
  the oldest cursor of any device that may still sync. A future design needs either a retention
  window longer than the longest allowed offline period or forcing a full resync for stale devices.
- Queries on live data must filter `deleted_at IS NULL`; pull must not.
