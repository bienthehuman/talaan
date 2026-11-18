# 0012. Visual identity "Wayfinding Line", with a self-hosted webfont

Status: accepted · Date: 2026-11-18

## Context
v1 of the design system chose "boring and readable": system fonts, one blue accent, outlined buttons. It
met its accessibility goals (axe gate, contrast, 44 px tap targets), but in use it reads as browser defaults.
One colour does every job (links, primary buttons, focus, the current page), every secondary control has
the same heavy outline, and the only type hierarchy is bold or not bold. The most important fact for a
worker, where their data is, appears as small underlined text. The audience is now both real field users
and people judging the project, so the UI has to work in the field and look finished
([PRODUCT.md](../../PRODUCT.md)). The problems found are listed in
[REDESIGN_PLAN.md](../REDESIGN_PLAN.md).

Constraints any choice must keep:
- **Strict CSP**: `font-src`, `style-src` and `script-src` are `'self'`. No third-party font host.
- **Offline PWA**: anything the shell needs must be precached and work with no network.
- **Behaviour and tests**: accessible names, roles and flows stay; the axe and tap-target gates stay.
- **ADR 0011**: tokens on `:root`, component styles in CSS Modules.

## Options
1. **Polish v1**: keep system fonts and the blue, fix hierarchy and spacing. Least risk, little visible change.
2. **Category standard**: neutral SaaS look (white, slate, indigo, a popular sans). Familiar, and
   indistinguishable from every other field app.
3. **A visual world taken from the users' own surroundings**, limited to type, palette, density and one
   signature move, with standard controls and navigation. Candidates were weighed (inspection hang tags,
   safety signage, carbon-copy form pads, transit wayfinding, timetables and others) and sketched at phone
   size. The owner chose transit wayfinding.

## Decision
Option 3, **Wayfinding Line**:
- The **station line** (On this device → Sending → Office → Reviewed) becomes the way sync state is drawn,
  keeping every v1 label and icon (DESIGN_SYSTEM.md section 3).
- A near-black **sign band** header, a warm signage-white ground, and one teal **line colour** that is used
  only for live and tappable things. Amber, green and red are kept for sync states.
- **Barlow** and **Barlow Semi Condensed** (SIL Open Font License), **self-hosted**: woff2 files from the
  `@fontsource` packages, bundled by Vite and served from our origin, Latin subset, six weight files, about
  70 KB in total. `woff2` is added to the PWA precache `globPatterns`, so fonts work offline from the first
  install. `font-display: swap` with a metric-adjusted fallback (`size-adjust`) keeps layout shift near zero.

This amends DESIGN_SYSTEM.md v1's "System fonts" principle. All other v1 rules stay.

## Consequences
- About 70 KB more in the first download and the precache. That's acceptable for an installable app, and
  the fonts are cached once.
- The CSP does not change, because the fonts are same-origin.
- The `@fontsource` packages are new dependencies, pinned in the lockfile. Font files are build input, not
  runtime code.
- The axe and contrast checks run against the new tokens. Every token pair in DESIGN_SYSTEM.md section 2 was
  computed to meet its target before acceptance.
- Delivered in slices 5.1 to 5.6 (BUILD_PLAN.md phase 5). Until each lands, that part of the UI shows v1.
- If the font ever has to go, only `--font` and `--font-display` change; the rest of the system does not
  depend on it.
