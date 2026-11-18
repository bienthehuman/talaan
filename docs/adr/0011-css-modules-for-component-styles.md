# 0011. CSS Modules for component styles, with global tokens and primitives

Status: accepted · Date: 2026-11-18

## Context
The client is styled with hand-written CSS: design tokens as custom properties in
`client/src/theme/tokens.css` (light and dark), and every class in one global stylesheet,
`client/src/theme/styles.css` (about 550 lines, about 60 classes). Components apply the classes with plain
`className` strings. This has worked, but nothing says where a new style goes, and every class is
global, so a later rule can silently override an earlier one in another part of the app. The UI audit
fix (#32) found such a case: `.field--choice { margin: 0 }` cancelled the `.stack` gap above Yes/No questions,
because both selectors have the same specificity and the later one won.

Constraints any choice must keep:
- **Strict CSP.** The shell is served with `style-src 'self'` (`client/nginx/security-headers.conf`).
  No inline `style=` attributes, and no `<style>` tags injected at runtime.
- **Tokens stay the source of truth** (`docs/DESIGN_SYSTEM.md` section 2): no raw colours in components,
  and dark mode works by redefining the tokens on `:root`.
- **Offline PWA.** Styles are precached with the shell, so they must be static build output.
- **Small surface.** About 60 classes; the most used are layout and form primitives (`stack` 37 uses,
  `page` 23, `row` 20, `input`, `field`, `card` 16 each), shared by many pages.

## Options
1. **Keep plain global CSS** and write down a naming convention. No change, but class names stay global, so
   collisions like the one above can only be caught by review.
2. **CSS Modules** (`*.module.css`, built into Vite). Class names are scoped to their file at build time,
   and the output is a static stylesheet. Uses the same CSS and the same `var(--token)` values. No new
   dependency. Components can move one at a time.
3. **Tailwind CSS.** Build-time, so CSP-safe, but every component's markup is rewritten into utility
   classes, and the tokens have to be mirrored into Tailwind's theme. Large churn for a small stylesheet that
   is already disciplined, and long class strings work against "boring and readable" markup.
4. **Runtime CSS-in-JS** (styled-components, Emotion). Injects `<style>` at runtime, which needs
   `'unsafe-inline'` or per-request nonces under the CSP. Rejected on security grounds alone.
5. **Zero-runtime typed CSS-in-TS** (vanilla-extract, Panda). CSP-safe, with type-checked tokens, but it
   adds a build plugin and a dependency to type about 60 classes.

## Decision
Option 2. Styles are split into two layers:

- **Global** (`client/src/theme/`): `tokens.css` (unchanged), and `styles.css` reduced to
  - base element styles and the reset (`body`, headings, `p`, `a`, `:focus-visible`);
  - accessibility utilities (`.sr-only`, `.skip-link`, `.wide-only`, `.tap-link`);
  - layout primitives shared across pages (`.page`, `.page--wide`, `.stack`, `.row`);
  - form primitives used directly by many pages (`.field`, `.input`, `.field-hint`, `.field-error`,
    `.choice`).
  A class is global only if it is one of these kinds and used by more than one component.
- **Component modules**: a class used by a single component lives in `Component.module.css` beside
  `Component.tsx` and is imported as `import styles from "./Component.module.css"`. Examples: buttons,
  badges, toasts, dialog, banner, header, tables, conflict panel, form editor, style-guide swatches.

Rules:
- Modules use only `var(--token)` values for colours, spacing, type sizes, radius and tap sizes; no raw
  values that a token covers (unchanged rule, now applied per file).
- Modules hold no `:root` or theme rules. Theming stays in `tokens.css`.
- No `:global(...)` inside modules except to style a global primitive in a module's own context, with a
  comment saying why.
- Class names in modules are camelCase (`styles.listRow`), so they read as properties.
- Tests find elements by role, label or text, not by class. A hashed module class is not a selector.

## Consequences
- A component's look is defined next to its code, and the collision class of bug goes away for component
  styles. Collisions remain possible between the few global primitives; that layer is kept small on purpose.
- Output is still one static CSS file (or one per lazy route chunk) under `'self'`: the CSP, the service
  worker precache and the dark-mode mechanism are unchanged.
- No new runtime or build dependency. Typed class names are not part of this decision; a typo in
  `styles.foo` gives `undefined` at runtime, which the existing tests and the e2e tap-target and axe checks are
  expected to catch on the affected screens.
- The migration is one refactor slice with no visual change. Known class-name dependents to update in that
  slice:
  - `components.test.tsx` finds badges with `.badge--pending` / `.badge--synced`; it should assert on the
    visible label and icon instead.
  - `e2e/tests/12-worker-experience.spec.ts` selects `label.choice` and skips `.skip-link`; both stay global,
    so the test is unaffected. Re-check it if that changes.
  - Vitest runs with `css: false`. The slice must confirm what CSS Module imports return in that mode
    (Vitest documents a stand-in object) and set `test.css` so modules resolve, if needed.
- The design system doc points here for where styles go; `CONVENTIONS.md` carries the one-line rule.
- If typed tokens or class names become worth a dependency later, option 5 can supersede this ADR without
  touching the token values.
