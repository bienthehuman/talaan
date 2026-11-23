# 0013. Form drafts in their own table; field names keep their type

Status: accepted · Date: 2026-11-23

## Context
Phase 6 adds a form builder so admins no longer write JSON (FORM_BUILDER_PLAN.md). The builder needs
somewhere to keep unfinished work, and it makes adding, removing and renaming fields easy, which makes
it easy to change what a stored field name means between versions.

Submissions are pinned to their form version (ADR 0008), so each one stays valid on its own. The risk
is across versions: if `pressure` is a number in version 1 and a choice in version 2, anything that
reads `data.pressure` over a form's history mixes different things.

## Options
Drafts:
1. **Unpublished `FormVersion` rows** (the Django admin already allows them). Version numbers are taken
   by drafts that may be abandoned, and the immutability trigger has to tell drafts from published rows.
2. **Browser storage.** Lost on another machine; left behind on a shared one after sign-out.
3. **A `form_draft` table**, at most one row per form, with a revision number.

Field names:
1. Allow any change; warn in the builder.
2. **Refuse a type change for a name, per form, across all its published versions**, enforced by the
   server at publish.

## Decision
Drafts: option 3. Publishing validates the draft, creates the next `FormVersion` and deletes the draft
in one transaction, so version numbers have no gaps and `form_version` is only published history.
Saves carry the revision last read; a stale one is `409`, never a silent overwrite.

Field names: option 2. The builder generates a name from the label and lets the admin edit it only until
the field is first published; changing the label later does not change the name.

## Consequences
- A form's data can be read across versions by field name with one type per name.
- Changing a field's type means a new field with a new name; the old name is retired, and may return
  only with its old type.
- Removing a field or a choice is allowed but shown to the admin before publish (DATA_MODEL.md
  section 5, change summary).
- Drafts never reach workers: worker endpoints read only `form_version` rows with `published_at`.
- The Django admin still edits unpublished `FormVersion` rows as before; that path is for emergencies
  and keeps the same validation, including the type rule.
