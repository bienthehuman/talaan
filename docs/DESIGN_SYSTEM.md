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
