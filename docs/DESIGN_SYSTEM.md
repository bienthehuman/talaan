# Design system

Status: accepted. Accepted before any screens are built. Contrast values below are targets;
the axe gate and a manual check confirm them once built.

## 1. Principles

- **Honest state.** "Saved on this device" and "Synced" must never look the same. State is never
  conveyed by colour alone: every badge has an icon and a text label.
- **Worker app is mobile first**: one-handed, gloves, sunlight. Admin app is desktop first.
- **Boring and readable.** System fonts, high contrast, no motion that carries meaning.

## 2. Tokens

CSS custom properties on `:root`, overridden for dark with `[data-theme="dark"]` and
`prefers-color-scheme` (user choice wins). No raw colours in components.

| Token | Light | Dark | Use |
|---|---|---|---|
| `--bg` | `#ffffff` | `#0f1419` | Page |
| `--surface` | `#f4f6f8` | `#1a212b` | Cards, panels |
| `--text` | `#14191f` | `#e8edf2` | Body (target ≥ 7:1 on `--bg`) |
| `--text-muted` | `#4a5563` | `#a9b4c0` | Secondary (≥ 4.5:1) |
| `--border` | `#c9d1da` | `#2f3a47` | Dividers, inputs |
| `--accent` | `#0b57d0` | `#8ab4ff` | Primary actions, focus ring |
| `--ok` | `#1b6e3c` | `#6fd39a` | Synced, approved |
| `--warn` | `#8a5300` | `#f5b84b` | Saved on device, pending |
| `--danger` | `#b3261e` | `#ff8a80` | Conflict, rejected, destructive |

Type: system font stack; base 16 px (worker app never smaller than 16 px for inputs);
scale 12/14/16/20/24/32; line height 1.5 body, 1.25 headings.
Spacing: 4 px base, steps 4/8/12/16/24/32/48. Radius 8 px. Tap targets **≥ 48 × 48 px** in the worker
app, ≥ 40 px in admin.
Focus: 3 px visible ring in `--accent` on every interactive element; never removed.

## 3. Sync state badges

| State | Label | Icon | Colour |
|---|---|---|---|
| Pending | Saved on this device | device / cloud-off | `--warn` |
| Syncing | Syncing… | spinner (static icon under reduced motion) | `--accent` |
| Synced | Synced | check | `--ok` |
| Conflict | Needs your decision | alert | `--danger` |
| Rejected | Not accepted: *reason* | block | `--danger` |

The app header shows pending count and the time of the last successful sync.

## 4. Components

Button (primary, secondary, destructive), text input, textarea, select, checkbox/radio group,
password field with show/hide, form field (label, hint, error), card, list row, badge,
toast, dialog (confirm-destructive), banner (offline, update required, storage not persisted),
empty state, skeleton/loading, error state, forbidden state, 404 page, header with sync status,
conflict row (mine / theirs / pick), table (admin review queue).

A style-guide page at `/styleguide` (non-production or admin only) renders every component in light
and dark; it is the target of the axe test.

## 5. Accessibility

- axe runs in Playwright on key screens in light and dark; zero serious or critical violations to merge.
- Full keyboard pass on login, form filler and conflict screen. Labels on every control.
- Respect `prefers-reduced-motion` and `prefers-color-scheme`.
- Error messages say what happened and what to do, in sentence case, never colour alone.

## 6. Page chrome

Favicon (SVG), `theme-color` per scheme, a title per route (`Page · Talaan`), app name Talaan and
tagline "Offline-first field data sync". 404 and error pages share the empty/error state layout.

## Worker pages (phase 2)

- **Assignments** (`/`): one card per assignment with its inspections, each with a sync badge, and a
  "New inspection" button (not shown for cancelled assignments). Everything is read from the device.
- **Inspection** (`/submissions/:id`): one control per form field, chosen by type: text input (textarea
  over 200 characters), select for enums, Yes/No radios for booleans (so "unanswered" is possible),
  numbers as text with a numeric keyboard. Required fields say "(required)" in the label.
- **Saving.** Every edit is written to the device immediately, with no Save button. A value the server
  would refuse (wrong type, out of range) is not saved; the error shows under the field and the text
  stays on screen. Submit checks required fields and names how many are missing.
- **Read only** (banner explains why): submitted, approved, or in `conflict` / `rejected`. A rejected record offers
  "Discard my changes"; a conflict has its own panel (below).

## Conflict panel (phase 3)

Shown on the inspection page instead of a banner when the server did not accept a change because someone
else got there first (`--danger` border, heading "Needs your decision", labelled region). The form
underneath is read only and shows the person's own values. Nothing is sent until they decide, and nothing is
lost until they choose to discard (always behind a confirmation).

- **Same field changed** (`field_conflict`): one group per clashing field, with "Before either of you: ...",
  then two radios, "Keep mine: ..." and "Use theirs: ...". "Apply my choices" stays disabled, with a hint
  naming what is missing, until every field has a choice. The person's other changes are listed as "will be
  sent as well". "Discard all my changes" is the other way out.
- **Deleted by an admin** (`deleted_remotely`): says what happened, that the edits are kept, and that asking
  an admin to restore the inspection sends them again automatically. The one button is "Discard my changes".
- **Own delete against newer edits** (`edited_since_base`): lists the fields others changed and offers
  "Keep the inspection" or, in the destructive style, "Delete anyway". The record is shown again in the list
  while this waits.
- The header shows "N need your decision" (a link to the list) whenever any inspection is waiting.

