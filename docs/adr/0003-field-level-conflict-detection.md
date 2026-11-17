# 0003. Field-level conflict detection, all-or-nothing per mutation

Status: accepted · Date: 2026-11-17

## Context
Two people often change different parts of one inspection. Whole-record conflicts would force
needless manual resolution. Applying part of a worker's edit would produce states the worker never
saw.

## Options
1. **Record-level:** any change since `base_version` conflicts.
2. **Field-level, partial apply:** apply non-conflicting fields, report the rest.
3. **Field-level, all-or-nothing:** a mutation with any conflicting field is rejected whole.
4. **CRDTs or operational transform.** Automatic merge, but heavy and hard to explain or audit.

## Decision
Option 3. A field conflicts when `field_versions[f] > base_version` **and** the server value differs
from the client value. Identical values are not a conflict. A conflicting mutation applies nothing.

## Consequences
- Different-field edits merge automatically (scenario 4); same-field edits go to a manual
  resolution screen (scenario 5).
- The server never half-applies an edit, which keeps results simple to explain and test.
- Resolution is a new mutation with a new `mutation_id` and the server's current version as
  `base_version`. It gets idempotency and validation for free; no special endpoint.
- Free-text fields can still conflict on near-identical edits. Smarter merging is out of scope.
- A single conflicting field blocks the whole mutation, so the worker may need to re-confirm
  unrelated fields. Non-conflicting local fields are carried over automatically to limit this.
