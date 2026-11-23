# Form builder plan (phase 6)

Status: **accepted** 2026-11-23 (slice 6.0). Decisions in section 6; ADR 0013 records the
hard-to-reverse ones.

## 1. Problem

An admin creates a form by writing JSON Schema by hand on `/manage/forms/<id>`
(`client/src/pages/admin/FormEditorPage.tsx`). The server check and the live preview catch mistakes,
but the admin still has to know JSON, the allowed keys, the field-name rule and how `required`
works. Most supervisors will not.

Goal: an admin with no JSON knowledge can build, check and publish a form, and the forms they make
are as safe as hand-checked JSON. Data must stay correct, private, maintainable and affordable to
keep.

## 2. What must not change

- **One stored format.** `form_version.schema` stays the JSON Schema subset in DATA_MODEL.md
  section 5. The builder edits that document; it does not add a second model that must be
  translated at sync time. Server (`jsonschema`) and client (Zod) keep reading the same document.
- **The server decides.** Every rule the builder enforces in the browser is also enforced by
  `forms/schema.py` at publish. The builder only makes the rules easy to follow.
- **Published versions stay immutable** (ADR 0008, database trigger). Submissions keep the version
  they started on.
- **Workers see only published versions.** `GET /api/form-versions` already filters on
  `published_at`; drafts must never reach a worker endpoint or a device.
- **No silent overwrites**, applied to form drafts too: two admins editing one draft must not lose
  each other's work.

## 3. Problems found while planning

1. **Field order is lost today.** `schema` is `jsonb`, and Postgres stores object keys sorted by
   length then bytes. The demo form is shown as `notes, hours_run, oil_level, coolant_ok,
   site_contact, oil_pressure_psi` (checked in the dev DB), not in the order it was written. A
   builder with "move up / move down" cannot work until order is stored explicitly.
2. **No size limits.** A schema can have any number of fields, choices and any length of title or
   description. Every device downloads every published version into IndexedDB, so this is a
   storage and payload risk.
3. **Field names can change meaning between versions.** Version 2 can reuse the name `pressure`
   with a different type or units. Each submission is valid against its own version, but reports
   that read `data.pressure` across versions then mix different things.

## 4. Design

### 4.1 Field order: `x-order`

Add one top-level key, `x-order`: a list naming every property exactly once, in display order.
JSON Schema ignores unknown `x-` keywords, so `jsonschema` validation of submissions is unchanged.

- Required on every **new** publish. Old published versions (immutable) have none; readers fall back
  to the stored key order, as today.
- The client's `parseForm` uses `x-order` when present. Installed clients that predate it ignore
  the key (Zod strips unknown keys), so nothing breaks; they show the old order until they update.
  No `X-Client-Schema` bump is needed.

### 4.2 Field names are generated and then frozen

- The builder generates the name from the label when a field is added ("Oil pressure (psi)" →
  `oil_pressure_psi`, de-duplicated with `_2`). The admin sees it as "Field ID" under an Advanced
  disclosure and may edit it **until the field first appears in a published version**.
- Changing the label later never changes the name, so data keys stay stable.
- Server rule, per form, across all its published versions: **a field name never changes type, and
  a removed name can come back only with the type it had.** Choice fields: removing a choice is
  allowed but flagged (old submissions keep the old value).

### 4.3 Change summary against the last published version

New module `forms/compat.py` compares a candidate schema with the form's latest published version
and returns a list of changes, each one `safe`, `review` or `refused`:

| Change | Level |
|---|---|
| Label, help text or order changed; optional field added; limit relaxed; choice added | safe |
| Field removed; choice removed; field made required or added as required; limit tightened | review (admin confirms) |
| Existing name given another type; removed name reused with another type | refused |

The existing check endpoint returns these with the validation problems, and publish refuses a
`refused` change. The editor shows the summary next to the Publish button, and the confirm dialog
lists every `review` item in plain words ("Workers will no longer see *Notes*. Inspections already
started keep it.").

### 4.4 Server-side drafts

New table `form_draft`: one row per form at most (`form_id` unique, `schema` JSONB, `revision` int,
`based_on_version_id`, `updated_by`, `updated_at`).

- `GET/PUT /api/admin/forms/<id>/draft/`; PUT carries `revision` and gets **409** when someone saved
  in between (the editor then offers to load their version). Autosave every few seconds of quiet.
- `POST /api/admin/forms/<id>/draft/publish/` validates, creates the next `FormVersion` and deletes
  the draft in one transaction. Version numbers are given only at publish, so abandoned drafts
  leave no gaps.
- Drafts may be incomplete or invalid; only publish validates. Drafts are visible only with
  `form.publish`.
- A draft table rather than unpublished `FormVersion` rows keeps `form_version` a clean, immutable
  history and keeps the immutability trigger simple. The Django admin keeps working on
  `FormVersion` as today (JSON, for emergencies).
- Why not browser storage: admin machines may be shared, and a draft left in `localStorage`
  survives sign-out. Server drafts leave nothing on the device.

### 4.5 Limits (checked at publish)

Proposed: at most 100 fields; title 200 characters; description 500; at most 50 choices of 100
characters each; `maxLength` at most 10,000; whole schema at most 64 KB. Exact numbers are a
decision to check in slice 6.1. Already published versions are not re-checked.

### 4.6 Privacy and safety

- Labels, help text and choices are shown as plain text (React escapes them). No Markdown or HTML,
  so a form cannot carry a script or a tracking image to every device.
- The builder shows a hint: form text reaches every assigned worker's device; do not put names,
  phone numbers or other personal details in it.
- Schema content is never logged (the log allowlist in `core/logs.py` stays as it is); events log
  form id and version number only.
- Preview answers are never saved or sent.
- Draft responses send `Cache-Control: no-store` (the admin API sets no cache header today; worth
  adding for all of `/api/admin/` in slice 6.2).

### 4.7 The builder screen

Same page, two tabs: **Builder** (default) and **JSON** (advanced, today's editor). Both edit the
same draft; switching tabs converts losslessly, and JSON that the builder cannot represent stays in
the JSON tab with a message saying why.

- Field list as cards. Each card: label, help text, Required switch, type, and type settings.
- Types in plain words, mapping onto the existing schema (no new field types in this phase):

  | Builder type | Schema |
  |---|---|
  | Short text | `string`, `maxLength` ≤ 200 |
  | Long text | `string`, `maxLength` > 200 (rendered as a textarea, as today) |
  | Choice | `string` + `enum` (choices editor: add, rename, reorder, remove) |
  | Yes / No | `boolean` |
  | Whole number | `integer` + optional min / max |
  | Number | `number` + optional min / max |

- Reorder with Move up / Move down buttons (keyboard and screen reader friendly; drag can come
  later). Duplicate and Remove on each card.
- Live worker preview beside the list (exists), and the change summary (4.3) above Publish.
- Problems shown on the card they belong to, in plain words, with the server's message as the
  final word.
- "Start from a copy" of another form's latest version when creating a form.
- Design system v2, CSS Modules, 44 px tap targets, axe-clean; usable on a tablet.

### 4.8 Keeping the builder honest

- Pure functions in `client/src/forms/builder.ts` (`schemaToModel`, `modelToSchema`, `fieldName`,
  move/add/remove). Seeded randomized round-trip tests: any valid schema → model → schema gives an
  equal document; any model the builder can produce passes `forms/schema.py` (shared fixtures run on
  both sides).
- `compat.py` and the new schema rules get entries in `mutation_check_service.py`.
- E2E: an admin builds a form without touching JSON, publishes, assigns it; a worker fills it
  offline, syncs, and the fields appear in the order built.

## 5. Slices

| Slice | Content |
|---|---|
| 6.0 | Docs: accept this plan; DATA_MODEL section 5 (`x-order`, limits, name rules), protocol section 11 (draft endpoints, change summary), ADR 0013 (drafts table, frozen field names) |
| 6.1 | Server schema rules: `x-order`, limits, `compat.py` with the per-form name/type rule; check endpoint returns the change summary; publish refuses `refused` changes |
| 6.2 | Server drafts: `form_draft` model and migration, GET/PUT with revision (409), publish-from-draft in one transaction, tests that drafts never reach worker endpoints |
| 6.3 | Client model: `builder.ts` and round-trip tests; `parseForm` honours `x-order` (fixes the order bug for new versions) |
| 6.4 | Builder UI: Builder / JSON tabs, field cards, choices editor, reorder, preview, change summary, autosave with conflict message |
| 6.5 | E2E and polish: build-without-JSON scenario, keyboard-only build, axe and tap-size checks, README screenshot |

Order: 6.1 and 6.2 first (the server rules make everything after them safe), then 6.3, 6.4, 6.5.

## 6. Decisions

1. Drafts live in a separate `form_draft` table, not as unpublished `FormVersion` rows (ADR 0013).
2. Changing a field's type under the same name is **refused**, not warned (ADR 0013).
3. The limits in 4.5 are accepted as proposed; slice 6.1 may adjust a number if a real form needs
   it, and records the change here and in DATA_MODEL.md.
4. Old published versions keep their stored order (they are immutable). The demo seed form gets
   `x-order` in slice 6.1; any other affected form is fixed by publishing a new version.

## 7. Out of scope (backlog)

New field types (date, photo, location, signature), conditional fields ("show if"), sections and
repeating groups, translations, drag-and-drop reorder. Each new type needs server validation, Zod,
conflict handling and an e2e scenario, so each is its own slice.
