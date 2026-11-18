# Redesign plan: Wayfinding Line

Status: **accepted** (2026-11-18). Tracked as phase 5 in [BUILD_PLAN.md](BUILD_PLAN.md). The rules live in
[DESIGN_SYSTEM.md](DESIGN_SYSTEM.md) v2 and [ADR 0012](adr/0012-visual-identity-and-self-hosted-font.md);
this file keeps the reasons.
Product context: [PRODUCT.md](../PRODUCT.md). Sketches: `.impeccable/mocks/decision/assigned.html` (local only).

## 1. Why

The app works and is accessible, but it reads like browser defaults. Problems seen in screenshots at
phone (Pixel 7) and desktop (1366 px) widths, light and dark:

| Area | Problem |
|---|---|
| Whole app | One blue does everything: links, primary buttons, focus, active state. Every secondary control has the same heavy 2 px grey outline, so nothing leads. The only type hierarchy is "bold or not". Dates are long US numerals with seconds (`11/18/2026, 8:12:29 PM`). |
| Header | Admin nav is centred, underlined links with no current-page marker. On a phone it wraps into three rows (brand, nav, account) before any content. For workers, "Sync now" has the same weight as "Sign out", and the most important fact (pending count) is small underlined link text. |
| Assignments (worker) | Each inspection takes two rows: an underlined "Draft inspection · 11/18/2026" link, then a badge. Items look identical (no time, no distinguishing detail). "New inspection", the main action, is styled secondary. Cancelled assignments look the same as active ones. |
| Inspection form | "Submit inspection" and a solid red "Delete" sit side by side at equal weight. Yes/No are small native radios. Nothing near the fields says the edits are saved. |
| Sync status | "Retry now" is primary even when nothing is waiting. Empty states ("Nothing needs a decision") are set larger than the section headings. |
| Review queue | Status is plain text. The "Review" link sits far right on the row. The table is sparse, with much empty canvas. |
| Review detail | Delete (solid red) sits next to Approve. Answers are a long stack of label/value pairs. History leaks raw field keys (`oil_level, hours_run`). |
| Admin on phone | Form controls have different widths (Worker narrow, Site two-thirds). The assignments table overflows (the "Inspections" column is cut off). |

## 2. Direction: Wayfinding Line

Transit wayfinding gives four things, and only these: **type, palette, density, and one signature move**.
Navigation, controls and layout stay standard web patterns (PRODUCT.md principle 4).

- **Signature move: the station line.** Every inspection travels one line: **On this device → Sending →
  Office → Reviewed**. Each record shows the line with its current stop filled; the header band shows the
  device's own line. It *replaces* the look of the sync badge but keeps its text label and icon, so state is
  never colour-only (DESIGN_SYSTEM.md section 3). A conflict or refusal shows as a red stop where the line
  breaks. Stations sit at the same positions on every row, so a list can be scanned top to bottom.
- **Sign band.** A near-black enamel band holds the brand, the pending count as one large numeral, last
  sync, and Sync now as the solid primary. Same band in light and dark.
- **Palette** (every pair contrast-checked; the full table is DESIGN_SYSTEM.md section 2):

  | Role | Light | Notes |
  |---|---|---|
  | Band / ink | `#16181d` | Header band, headings |
  | Ground | `#f6f6f2` | Warm signage white; cards on `#ffffff` |
  | Line (accent) | `#0b737e` teal | Only live and tappable things: primary buttons, links, focus, current nav item |
  | On device | amber `#c77700` (text `#8a5300`) | Pending |
  | Synced / approved | green `#1d7a46` | |
  | Decision / refused | red `#c0352b` | |

  Dark mode keeps the band, lifts the ground to `#121417`, and uses tuned tints of the same hues.
- **Type.** Barlow (body, UI, data) plus Barlow Semi Condensed (headings, the big numeral, station labels),
  self-hosted woff2, Latin subset, 3 files (about 68 KB), precached by the service worker so it works
  offline. A fixed scale, ratio about 1.2: 13 / 14 / 16 / 18 / 22 / 28 / 40 (numeral 52). Inputs stay at
  16 px or larger. Tabular figures for times and counts.
- **Borrowed disciplines** (from the challengers the direction beat): one 8 px cell grid that everything
  snaps to; one accent reserved for live state; stations at identical positions on every record; scale
  contrast in place of boxes for the one number that matters; dense admin tables with a fixed code cell
  (site and short id).
- **Motion.** 150 to 200 ms state transitions only (stop fill, button press, toast). The "Sending" stop
  pulses while a sync runs, and holds still under `prefers-reduced-motion`.

## 3. What must not change

- Every behaviour, route, data flow and the sync engine. No changes in `src/db/`, `src/sync/engine*`, or the
  server.
- Accessible names, roles and headings that tests rely on ("Sign in", "Sync now", "New inspection",
  "Needs your decision", "Show N older inspections", "N pending · Last sync", "Assignments", "Review" and so
  on). Before slice 5.3 I'll make an inventory of names used in `e2e/` and `src/**/*.test.tsx`. Where a
  copy change is worth it, the tests change in the same PR and the PR says so.
- WCAG gates: axe (light and dark), tap targets ≥ 44 px measured by `12-worker-experience`, 3 px focus ring,
  contrast targets (body ≥ 7:1, secondary ≥ 4.5:1, control edges ≥ 3:1).
- ADR 0011 (CSS Modules plus global layer), strict CSP (no inline `style=`), `modules.test.ts`.

## 4. Slices (one branch and PR each, in order)

| Slice | Content | Done when |
|---|---|---|
| **5.0 docs** | This plan accepted. DESIGN_SYSTEM.md v2 (tokens, type, station line, header, components). ADR 0012: visual identity and a self-hosted webfont (amends the "system fonts" principle). PRODUCT.md committed. | User accepts the docs PR |
| **5.1 foundation** | `tokens.css` v2 (colour roles, type scale, 8 px grid, radius, elevation, motion), fonts under `src/theme/fonts/` with `font-display: swap` and size-adjusted fallbacks, `woff2` added to the PWA `globPatterns`, global primitives restyled, `theme-color` meta updated. No markup changes. | All checks green; the app is already visibly calmer |
| **5.2 components** | Button (primary solid teal, secondary, quiet, danger: outline in page flow, solid only inside the confirm dialog), inputs and selects, Yes/No as large segmented choices (still radios), new `StationLine` (replaces the SyncBadge visuals, same labels), Banner, Toast, Dialog, Table, empty/loading/error states (quiet, body size), skeleton rows. `/styleguide` shows each in light and dark. | Styleguide axe-clean; unit tests green |
| **5.3 shell** | Sign band header. Worker: numeral pending, last sync, Sync now primary, a "N need your decision" chip, account controls grouped and quieter. Admin: left rail on desktop and a top tab row on a phone, with `aria-current` marking the page. The phone header is at most two rows. | e2e green on desktop and mobile |
| **5.4 worker pages** | Assignments (assignment card: site, form, due date, primary "New inspection"; one row per inspection: title, short local time, station line; cancelled assignments muted with a label). Inspection (title block with site and station line, a "Saved on this device 08:41" line, sticky bottom bar with Submit, Delete moved to a quiet action below the form behind its confirmation). Sync status (device line diagram as the summary, Retry primary only when something is waiting). Conflict panel restyle. Login (band with the tagline). 404 and error states. | e2e plus the tap-target test green; phone screenshots reviewed |
| **5.5 admin pages** | Review queue (dense table, status badges, short dates, whole row clickable as well as the named link). Review detail (two columns: answers grid plus history timeline on the left, sticky action panel on the right with Delete separated; field titles instead of keys in history). Forms and form editor (split view polish). Assignments (create form in a side panel, consistent field widths, the table becomes a card list below 600 px). Conflict log. | e2e green; desktop and phone screenshots reviewed |
| **5.6 polish and proof** | Impeccable audit and critique pass, dark-mode tuning, reduced-motion check, date formatting helper used everywhere, README screenshots and re-recorded demo GIFs (`scripts/demo.sh`). Tag `v1.1.0`. | Full `scripts/e2e.sh` plus demo green; before/after screenshots in the PR |

Each PR runs `npm run typecheck && npm run lint && npm run format:check && npm test` and `bash
scripts/e2e.sh`, and includes before/after screenshots at 390 px and 1366 px in light and dark. Slices 5.1
to 5.6 do not touch engine or apply code, so the client `mutation_check.py` is not needed. If a slice does
touch them, it runs.

## 5. Decisions (resolved in slice 5.0)

1. **Webfont.** Barlow and Barlow Semi Condensed (SIL OFL) from `@fontsource/barlow` and
   `@fontsource/barlow-semi-condensed`, bundled (same origin, CSP unchanged). ADR 0012.
2. **Header account controls.** "Sign out" and the theme button stay visible buttons, quieter on the band;
   no menu (it would cost a tap and change tests).
3. **One design authority.** `docs/DESIGN_SYSTEM.md` is the source of truth (repo rule). No root
   `DESIGN.md`. `PRODUCT.md` holds product context for design work.
4. **Delete placement.** Out of the primary action row on the inspection and review pages: a destructive
   secondary button below the content, still behind its confirmation.
5. **Dates.** One formatter: "Today 08:41", "Yesterday 16:02", "15 Nov"; full timestamp in `title` and in
   record history.
6. **Retry now** keeps showing at all times (tests and the spec rely on it); it is primary only when something
   is waiting.

## 6. Risks

- **Station line overload.** If it reads as decoration, cut it to the header and the inspection page and
  keep a compact stop on list rows. Decide after 5.4 screenshots.
- **Test churn.** Mitigated by the name inventory and keeping accessible names; layout-only changes should
  not touch tests.
- **Dark mode band.** The near-black band on a dark ground needs its own edge (a hairline or tint) to stay
  distinct; checked in 5.1.
