# 0002. Server-assigned versions instead of timestamps or last-write-wins

Status: accepted · Date: 2026-11-17

## Context
Two devices can edit the same record while apart. The system must decide which edits conflict.
Device clocks are unreliable: they drift, are set wrongly, and can be changed by the user.

## Options
1. **Last-write-wins by client timestamp.** Simple, but a skewed clock silently discards real work.
2. **Last-write-wins by server arrival time.** Removes clock skew but still overwrites silently.
3. **Server-assigned version numbers**, with the client sending the version it last confirmed.

## Decision
Option 3. The server owns `submission.version` (bumped on each accepted mutation) and
`field_versions` (the version that last changed each field). The client sends `base_version`. Client
timestamps are stored for display only and never decide anything.

## Consequences
- Conflicts are detected from causality (what the client had seen), not from time.
- Behavior is deterministic and testable without faking clocks.
- The client must track `serverVersion` per record and set `baseVersion` at first send (see protocol).
- Every write path, including admin actions, must go through the version bump (CLAUDE.md rule).
- Versions only order changes to one record. There is no cross-record ordering other than `server_seq`.
