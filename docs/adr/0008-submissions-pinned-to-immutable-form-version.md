# 0008. Submissions pinned to an immutable form version

Status: accepted · Date: 2026-11-17

## Context
Forms change while workers are offline. A worker may start a submission on one version of a form
and sync after an admin has published a newer one. Validating against the wrong schema would reject
good work or accept bad data.

## Options
1. **Always validate against the latest form.** Breaks in-progress work when forms change.
2. **Migrate submissions to new versions automatically.** Needs a field mapping per change.
3. **Pin each submission to the `form_version` it started on; published versions are immutable.**

## Decision
Option 3. `submission.form_version_id` is set at creation from the assignment. Published
`form_version` rows cannot be changed (database trigger). Changes mean a new version.

## Consequences
- Schema changes never break offline work; no client/server schema negotiation is needed.
- Validation always uses the pinned schema, on both client (Zod) and server (JSON Schema).
- Several versions of one form can coexist in the data. Admin views must show the version.
- Moving a submission to a newer version is **not supported** in the PoC (backlog).
- A mistake in a published version is corrected by publishing a new one and re-assigning.
