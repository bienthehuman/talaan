# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Users

- **Field workers** (primary, role `worker`): inspectors filling in inspection forms on a phone at a site,
  often outdoors (sunlight, gloves, one hand) and often without signal. Their job: start an inspection on an
  assignment, fill it in, submit it, and trust that it reached the office.
- **Office admins** (role `admin`): on a desktop, online. They review submitted inspections (approve, return
  with a reason, edit, delete, restore), publish form versions, create assignments, and read the conflict log.
- **Reviewers of the project** (equal weight right now, confirmed 2026-11-18): people judging Talaan as a
  portfolio / proof of concept from the README, the demo GIFs, or a live demo. The UI has to hold up for real
  field use and also read as a finished, considered product.

## Product Purpose

Offline-first field data platform. The PoC claim: field workers can create and edit inspection submissions
fully offline, and every change reaches the server exactly once, with no silent overwrites, even when the
network fails mid-sync. Success is a worker who never wonders whether their work was saved or sent, and an
admin who can see and act on what came in.

## Positioning

Honest sync. Most field apps show a spinner or a generic "saved". Talaan always says where a change is: saved
on this device, syncing, synced, needs your decision, or not accepted (with the reason). When two devices
change the same field, the worker chooses, field by field; nothing is overwritten without being asked.

## Operating Context

- Worker app is mobile first and installable (PWA); it works after one online sign-in. Admin app is desktop
  first and online only (`/manage/...`).
- Sync runs in the background with retries; the header carries pending count, last sync and "Sync now".
- Records move through draft → submitted → approved, or returned to the worker with a reason; admins can
  delete (soft) and restore.
- Forms are versioned JSON schemas; a submission stays on the version it started on.

## Capabilities and Constraints

- Stack: React + TypeScript + Vite, CSS Modules for components plus a global layer (ADR 0011), Dexie/IndexedDB,
  vite-plugin-pwa. Strict CSP (`'self'` only, no inline styles).
- Every behaviour, route, accessible name and copy that the Vitest and Playwright suites depend on must keep
  working. A redesign changes the look, not the contracts (docs/DESIGN_SYSTEM.md sections 3 to the end).
- A self-hosted webfont is allowed (confirmed 2026-11-18): served from our origin and precached for offline use.
- Terminology: assignment, inspection (a submission), form / form version, site, worker, admin, sync,
  pending, conflict ("Needs your decision"), returned, not accepted.

## Brand Commitments

- Name: Talaan (Filipino for "record" or "list"). Tagline: "Offline-first field data sync".
- Voice: plain words, sentence case, says what happened and what to do; never raw problem codes.
- Honest state: "Saved on this device" and "Synced" never look the same; state is never conveyed by colour
  alone (icon plus text label).

## Evidence on Hand

- Demo data from `seed_demo` (sites such as North plant and Harbour depot, a Generator inspection form).
- Demo clips in `docs/media/`. Load test results in `docs/loadtest/`.
- No customers, testimonials or production usage figures exist; do not invent them.

## Product Principles

1. Where the data is, is the headline: sync state is always visible and never ambiguous.
2. The field worker's phone is the hardest case; design for it first, then widen.
3. Nothing is lost without a choice: destructive or overwriting actions always ask, and say what they do.
4. Familiar controls, precise details: the tool should disappear into the task.

## Accessibility & Inclusion

WCAG 2.2 AA: body text ≥ 7:1 target, secondary ≥ 4.5:1, control boundaries ≥ 3:1; visible 3 px focus ring;
tap targets ≥ 44 px (default 48) on worker pages, measured in CI; axe gate with zero serious or critical
violations in light and dark; respects `prefers-reduced-motion` and `prefers-color-scheme`.
