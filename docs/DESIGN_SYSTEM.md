# Design system

Status: accepted, v2 "Wayfinding Line" (2026-11-18). Replaces v1 (system fonts, one blue accent). Phase 5
slices bring the code in line (plan and rationale: [REDESIGN_PLAN.md](REDESIGN_PLAN.md); decision:
[ADR 0012](adr/0012-visual-identity-and-self-hosted-font.md)). Until a slice lands, the code still shows v1
for that part. Contrast values below were computed for every pair listed; the axe gate confirms them once
built.

## 1. Principles

- **Honest state.** "Saved on this device" and "Synced" must never look the same. State is never
  conveyed by colour alone: every state has an icon or mark plus a text label.
- **Worker app is mobile first**: one-handed, gloves, sunlight. Admin app is desktop first.
- **Familiar controls, precise details.** Standard web navigation, buttons, inputs and tables. The visual
  world (transit wayfinding) supplies only type, palette, density and one signature move, the station line
  (section 3). It never supplies layout, navigation or controls.
- **One accent owns live state.** The line colour (`--accent`) marks only what is tappable or moving:
  primary buttons, links, focus, the current page, the "Sending" stop. Never decoration.
- **One emphasis colour for key details.** Violet (`--emphasis`), the second line on the map, marks what
  the eye should find first: the site an inspection belongs to, the assignment header, data labels
  (table headers, record field labels) and the login tagline. It fills roughly 10 to 15 % of a screen. It is
  never tappable, never a sync state, and never the only carrier of meaning.
- **One grid.** Every size and gap is a multiple of 4 px, and layout steps are multiples of 8 px.
- **Motion only for state.** 150 to 200 ms; nothing moves that does not mean something.

## 2. Tokens

CSS custom properties on `:root`, overridden for dark with `[data-theme="dark"]` and
`prefers-color-scheme` (user choice wins). No raw colours in components. Where a style lives (global
primitive or component CSS Module) is set by [ADR 0011](adr/0011-css-modules-for-component-styles.md).

### Colour

| Token | Light | Dark | Use |
|---|---|---|---|
| `--bg` | `#f6f6f2` | `#121417` | Page ground (warm signage white) |
| `--surface` | `#ffffff` | `#1b1e23` | Cards, panels, table body, inputs |
| `--surface-2` | `#ecece6` | `#23272d` | Second neutral layer: table header, admin rail, quiet panels |
| `--text` | `#16181d` | `#e9ebee` | Body and headings (16.4:1 / 15.5:1 on `--bg`) |
| `--text-muted` | `#4c5059` | `#a8aeb7` | Secondary text (≥ 6.7:1 on every surface) |
| `--border` | `#dcdcd4` | `#2c3138` | Dividers, card and table lines (decorative) |
| `--control-border` | `#7a7f88` | `#6b727c` | Edges that identify a control (≥ 3.4:1 on every surface, WCAG 1.4.11) |
| `--accent` | `#0b737e` | `#4fc3cc` | The line: primary actions, links, focus ring, current page (5.1:1 / 8.8:1 on `--bg`) |
| `--accent-hover` | `#095c65` | `#7ad3da` | Pressed and hovered accent |
| `--accent-text` | `#ffffff` | `#0b0c0e` | Text on `--accent` (5.6:1 / 9.3:1) |
| `--emphasis` | `#6b3fd1` | `#b49cff` | Key details: site names, data labels, assignment header edge (≥ 5.4:1 / ≥ 6.5:1 on every surface, ≥ 5.5:1 / 6.1:1 on `--emphasis-soft`) |
| `--emphasis-soft` | `#f0ecfa` | `#2a2b39` | Tinted header band (10 % `--emphasis` over `--surface`); `--text` 15.3:1 / 11.7:1, `--text-muted` 7.0:1 / 6.3:1, `--accent` 4.8:1 / 6.7:1 on it |
| `--emphasis-text` | `#ffffff` | `#0b0c0e` | Text on an `--emphasis` fill (6.5:1 / 8.5:1) |
| `--pending` | `#8a5300` | `#f5b84b` | "Saved on this device" text and icon (≥ 5.3:1) |
| `--pending-mark` | `#c77700` | `#f5b84b` | Filled pending stop on the station line (non-text, ≥ 3:1) |
| `--ok` | `#1d7a46` | `#6fd39a` | Synced, approved (4.9:1 on `--bg`; do not put it on `--surface-2` in light, 4.5:1 is too tight) |
| `--danger` | `#c0352b` | `#ff8a80` | Needs your decision, not accepted, destructive (≥ 4.7:1) |
| `--band` | `#16181d` | `#0b0c0e` | Header sign band, both schemes |
| `--band-text` | `#f6f6f2` | `#e9ebee` | Text on the band (16.4:1) |
| `--band-muted` | `#b9bdc4` | `#a8aeb7` | Secondary text on the band (≥ 8.7:1) |
| `--band-edge` | `#2c3138` | `#2c3138` | Hairline under the band, so it stays distinct from a dark ground |
| `--band-control` | `#6b727c` | `#6b727c` | Edge of quiet controls on the band (3.7:1) |
| `--band-focus` | `#4fc3cc` | `#4fc3cc` | Focus ring on the band (8.5:1); the light `--accent` is too dark there |
| `--band-emphasis` | `#b49cff` | `#b49cff` | Emphasis on the band and band panels, such as the login tagline (7.7:1) |

The band's primary button ("Sync now") is `--accent` with `--accent-text` in both schemes. Its pending
numeral uses `#f5b84b` (10:1 on the band).

### Type

Barlow (body, UI, data) and Barlow Semi Condensed (headings, the pending numeral, station and table-header
labels), self-hosted woff2, Latin subset, three files: Barlow 400 and 600, Barlow Semi Condensed 700 (about
68 KB). Bold body text uses the 600 file. `font-display: swap` with a
metric-adjusted system fallback so text does not jump. Precached by the service worker (ADR 0012).

| Token | Size | Use |
|---|---|---|
| `--text-xs` | 13 px | Station labels, table meta |
| `--text-sm` | 14 px | Hints, secondary lines |
| `--text-md` | 16 px | Body, inputs (never smaller in the worker app) |
| `--text-lg` | 18 px | Card titles, h3 |
| `--text-xl` | 22 px | h2 |
| `--text-2xl` | 28 px | h1, page title |
| `--text-3xl` | 40 px | Login title |
| `--text-num` | 52 px | Pending numeral in the band |

Line height 1.5 body, 1.15 headings. Headings use the semi-condensed face at 700. Times, counts and versions
use tabular figures (`font-variant-numeric: tabular-nums`). Uppercase only for station and table-header
labels, with 0.06 em tracking.

### Space, shape, depth, motion

- Spacing: `--space-1` 4 px through `--space-7` 48 px (4/8/12/16/24/32/48), plus `--space-8` 64 px for page
  ends. Layout gaps use the 8 px steps.
- Radius: `--radius` 8 px for controls, `--radius-lg` 12 px for cards and panels, `--radius-full` for stops
  and chips.
- Depth: cards are flat with a `--border` edge. One shadow, `--shadow-raised`, only for things that float
  (dialog, toast, the sticky action bar).
- Motion: `--dur` 160 ms, `--ease` `cubic-bezier(.2,.7,.2,1)`. Under `prefers-reduced-motion` durations
  are 0 and the "Sending" stop does not pulse.
- Tap targets: `--tap` 48 px default, `--tap-min` 44 px minimum on worker pages (section 4); admin controls
  ≥ 40 px.
- Focus: 3 px ring in `--accent` (`--band-focus` on the band), 2 px offset, on buttons, links and choices;
  never removed. Text fields, selects and the Yes/No group show focus as a highlighted border instead: a
  2 px `--accent` edge, no shadow (the edge change is ≥ 3:1).

## 3. Sync state: the station line

Every inspection travels one line with four stops:

**On this device → Sending → Office → Reviewed**

The line is the signature of the app. It replaces the look of the v1 badge but keeps its labels and
icons, so state never relies on colour or position alone. Stops sit at the same positions on every row, so
a list reads top to bottom.

| State | Label (unchanged) | Line | Icon | Colour |
|---|---|---|---|---|
| Pending | Saved on this device | stop 1 filled | device | `--pending` / `--pending-mark` |
| Syncing | Syncing… | stop 2 filled, pulses (static under reduced motion) | spinner / static arrows | `--accent` |
| Synced | Synced | stops up to 3 filled (4 when approved) | check | `--ok` |
| Conflict | Needs your decision | the line breaks before stop 3; red stop | alert | `--danger` |
| Rejected | Not accepted: *reason* | the line breaks before stop 3; red stop | block | `--danger` |

- **Full line** (inspection page, sync page): four stops with their names under them, and the label.
- **Compact line** (list rows): the four stops without names, then the label. Same positions.
- Built as `SyncBadge` (`full` and `reviewed` props), so every existing use picks up the line. The break before
  the office is shown as grey track (no coloured connector) into a red stop; stops already passed turn neutral.
- The line is drawn with CSS (no images), is `aria-hidden`, and the label carries the meaning
  (`role="status"` where it changes live). The record status ("Draft", "Returned", "Approved") stays
  separate text; the line shows where the data is, not the review outcome, except that "Reviewed" fills on
  approval.

**Header: the sign band.** A `--band` bar across the top in both schemes. Row 1: the brand mark (a ring
in the line colour) and "Talaan", then the account menu: an avatar and the user name ("Account: worker1")
that opens a panel with who is signed in, the theme as three plain choices (System, Light, Dark) and Sign
out. Signed out, the same control is "Display settings" and holds only the theme. It is a disclosure (Tab
moves through the panel; Escape or a click outside closes it), not an ARIA menu. Worker row 2: the pending count as one large numeral with "pending · Last sync 08:32" beside
it (still one link to `/sync`, accessible name unchanged), "N need your decision" as a red chip when there
is one, and Sync now as the solid primary. So a phone header is two rows, and the tab order follows the rows.
The theme is no longer a button that cycles through choices.

**Admin navigation.** Desktop: a left rail on `--surface-2` with Review, Forms, Assignments, Conflict log;
the current page has `aria-current="page"`, an accent bar and bold text. Below 900 px: the same links as a
scrolling tab row under the band. Plain text links, no underline in the nav (the current-page bar and the
hover state carry it); links in body text stay underlined.

## 4. Components

Button (primary, secondary, quiet, destructive, danger), text input, textarea, select, checkbox/radio group,
Yes/No segmented choice, password field with show/hide, form field (label, hint, error), card, list row,
station line (full and compact), status chip, toast, dialog (confirm-destructive), banner (offline,
update required, storage not persisted), empty state, skeleton/loading, error state, forbidden state,
404 page, sign band header, admin rail, sticky action bar, conflict row (mine / theirs / pick), table
(admin), definition grid (answers).

- **Buttons.** *Primary*: solid `--accent`, one per view (the action the screen is for). *Secondary*:
  `--surface` with a 1.5 px `--control-border` edge. *Quiet*: no edge, accent text, for low-stakes actions
  (Show, Cancel, Not now). *Destructive*: secondary shape with `--danger` text and edge in page flow. *Danger*:
  solid `--danger`, only to confirm inside a dialog. Destructive actions never sit next to the primary action: they go
  below the content or in their own group. All states (hover, active, focus, disabled, busy) are defined.
- **Yes/No.** Two segments, each ≥ 48 px tall, still native radios underneath (unanswered stays possible).
- **Status chip.** Record status in admin tables ("Submitted", "Returned"), with a dot plus text; tinted
  ground, never colour alone.
- **Empty state.** Body size, muted text, one line on what will appear here and, when there is one, the
  action that creates it. Never larger than the section heading.
- **Loading.** Skeleton rows in the shape of the content; no centred spinner.
- **Dates.** One formatter: "Today 08:41", "Yesterday 16:02", "15 Nov", "15 Nov 2025" for another year; the
  full timestamp in a `title` and in record history.
- **Tables.** Dense (40 px rows), `--surface-2` header with uppercase semi-condensed labels, tabular numbers,
  the whole row clickable as well as its named link (`row-link`). Below 600 px a table can become a list of
  cards (`<Table stack>`, cells carry `data-label`; empty cells are hidden). The table roles survive, which the
  mobile e2e project checks.

- **Button groups** (`actions`): right-aligned, with the most important action last, at the far right
  (Cancel, then Delete; Previous, then Next). A leading count or hint stays on the left. Dialogs are centred
  on the screen both ways.
- **Password fields**: the familiar eye button inside the field's right edge ("Show password" / "Hide
  password", `aria-pressed`).
- **Selects**: our chevron and the same inner spacing as text fields. Where the browser supports a
  customizable select (`appearance: base-select`), the open list matches too (surface, radius, shadow, tinted
  selected option); elsewhere it is the system list. **Date fields** use our calendar icon; the calendar
  itself stays the system one, which is the best picker on a phone and works with assistive technology.

Every control a worker taps is at least `--tap-min` (44 px; default 48), measured in CI (section 2 and
"Worker experience" below).

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

Favicon (SVG: the line-colour ring on the band colour), `theme-color` per scheme matching the band
(`#16181d` light, `#0b0c0e` dark), a title per route (`Page · Talaan`), app name Talaan and tagline
"Offline-first field data sync". 404 and error pages share the empty/error state layout. The login page
puts the band at full height above the form on a phone (brand, tagline, the station line as an
illustration of the promise) and beside it on desktop.

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

## Page layouts (phase 5)

Layout changes that come with v2. Behaviour, copy and accessible names in the sections above stay as they
are unless a line here says otherwise.

- **Assignments** (worker): assignment card with the site as the title, the form and due date under it, and
  "New inspection" as the card's primary button. Each inspection is one row: its status and short time as
  the link text, then the compact station line with its label. Cancelled assignments are muted with a
  "Cancelled" chip.
- **Inspection** (worker): a title block (form, site, full station line). Under it, one line saying where
  the edits are ("Saved on this device · 08:41"). "Submit inspection" sits in a sticky bottom action bar on a
  phone. "Delete" moves out of that row to a destructive secondary button below the form, still behind its
  confirmation.
- **Sync status** (worker): the summary is the device's own line with the pending numeral. "Retry now" is
  primary only when something is waiting, and secondary otherwise. Empty sections use the quiet empty state.
- **Review queue** (admin): dense table, status chips, short dates, and the whole row opens the record (the
  "Review" link stays as its named target).
- **Submission** (admin): two columns from 900 px. On the left, the answers as a definition grid (two
  columns) and the history as a timeline. On the right, a sticky action panel: Approve as primary, Return and
  Edit as secondary, and Delete or Restore in a separate group below. History lists field *titles*, not keys.
  One column on a phone, with actions first.
- **Assignments** (admin): the "New assignment" form in a side panel from 900 px (fields share one width),
  and the table beside it. Below 600 px the table becomes cards.
- **Forms, form editor, conflict log** (admin): same table and panel vocabulary; the editor keeps its split
  view (JSON | preview) with the publish action in the panel header.

