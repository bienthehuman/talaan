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
| `--border` | `#c9d1da` | `#2f3a47` | Dividers, card and table lines (decorative) |
| `--control-border` | `#7d8794` | `#66737f` | Edges that identify a control: inputs, secondary buttons (≥ 3:1 on `--bg` and `--surface`, WCAG 1.4.11) |
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

**Header layout.** The first row is the brand and the account controls (user name, theme, Sign out). A worker
gets a second row, a strip with "N pending · Last sync", "N need your decision" when there is one, and Sync
now. So a phone header is two rows, and the tab order follows the rows. Below 600 px the theme button shows only
its icon (half-filled circle, sun, moon); its accessible name stays "Theme: System / Light / Dark".

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
- Toasts: an error toast is announced at once (`role="alert"`) and stays until dismissed; other toasts are
  polite (`role="status"`) and clear themselves.
- Record statuses read in sentence case everywhere ("Submitted", "Returned"); the raw value is for the API.

## 6. Page chrome

Favicon (SVG), `theme-color` per scheme, a title per route (`Page · Talaan`), app name Talaan and
tagline "Offline-first field data sync". 404 and error pages share the empty/error state layout.

## Worker pages (phase 2)

- **Assignments** (`/`): one card per assignment: its "New inspection" button first (not shown for cancelled
  assignments), then its inspections, newest first, each with a sync badge. The newest five stay in view, and
  so does any inspection in conflict, not accepted, or returned by an admin; older ones fold into a "Show N
  older inspections" disclosure. Everything is read from the device.
- **Inspection** (`/submissions/:id`): one control per form field, chosen by type: text input (textarea
  over 200 characters), select for enums, Yes/No radios for booleans (so "unanswered" is possible),
  numbers as text with a numeric keyboard. Required fields say "(required)" in the label.
- **Saving.** Every edit is written to the device immediately, with no Save button. A value the server
  would refuse (wrong type, out of range) is not saved; the error shows under the field and the text
  stays on screen. Submit checks required fields, names how many are missing, and moves focus to the first
  field to fix.
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

## Admin pages (phase 4)

Admins work online through the admin API and have no device to sync, so the header shows no pending count or
"Sync now" for them. They land on the review queue. The screens live under `/manage/...`, not `/admin/...`:
the proxy sends `/admin` to the Django admin.

- **Review queue** (`/manage/review`): a table (site, form and version, worker, status, updated, a "Review"
  link whose name includes the site). It opens on *submitted* records; filters for status, worker and
  active/deleted; 25 per page with Previous/Next. Changing a filter returns to the first page.
- **Submission** (`/manage/review/:id`): who, status and versions; the answers with the form's own field
  titles; the full history (who did what, with a return's reason). Actions appear only when they can work:
  Approve (submitted), Return to worker (submitted or approved, with a required reason), Edit answers, Delete
  (behind a confirmation), Restore (deleted records only). A refusal from the server is shown in words.
- **Edit answers** validates with the same rules as the worker form and sends only the fields that changed
  (a cleared field as `null`); a submitted or approved record must stay complete.
- A worker who opens an admin route sees "You don't have access to this page" and no admin request is made.

### Forms, assignments and the conflict log (admin)

- **Forms** (`/manage/forms`): each form with its versions and a "New version" link; "New form" asks for a
  name (unique) and opens the editor.
- **Form editor** (`/manage/forms/:id/edit`): the latest version's JSON (or a starter for a new form) beside a
  live preview built from the same schema code the worker form uses. The page says at once when the text is
  not JSON, and, after a short pause, what the server would refuse, in the server's words. "Publish version N"
  is enabled only when the server has accepted the current text, and asks first: a published version never
  changes, and inspections already started keep the version they began on. Nothing is saved until publish.
- **Assignments** (`/manage/assignments`): a form (published versions only, workers, site, optional due date)
  and a table with each assignment's inspection count and state. Cancel asks first; existing inspections stay
  and still sync, the worker just cannot start new ones.
- **Conflict log** (`/manage/conflicts`): when, worker, site, what happened in words ("Same field changed on
  two devices"), the fields, "Changed since" (yes only if the same worker changed the record on the server
  afterwards; the server cannot see a worker discarding edits on their device), and a link to the record.
  Filters: kind, changed since, worker.

## Worker experience (phase 4)

- **Sync status** (`/sync`, linked from the header's "N pending · Last sync" text): changes waiting to be
  sent, last sync, the last problem in words, and one sentence about what the engine is doing ("Trying again
  at 10:42", "Paused. Sign in again to continue."). "Retry now" starts a sync (disabled while one runs).
  Below: inspections that need a decision, what is waiting per inspection (kinds of change, how many times it
  was tried, why it failed), and whether the browser has promised to keep the data. Problem codes are never
  shown raw for the common cases.
- **Install prompt**: a banner with Install and Not now. It only appears when the browser says installing is
  possible, never when the app already runs installed, and "Not now" is remembered so it does not ask on every
  visit. The browser's own dialog is used for the actual install.
- **Storage protection**: after the first successful sync the app asks the browser to protect its data from
  being cleared when space is low, once. The sync page reports the answer ("Protected" or "Not protected"), and
  says plainly when the browser cannot tell.
- **Tap targets**: every button, link, field and choice a worker uses is at least 44 by 44 CSS pixels
  (`--tap-min`; default buttons are 48). The small button variant is 44 too. A Playwright test measures
  every control on the worker pages in the real browser, so a regression fails CI.

