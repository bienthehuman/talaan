# 0009. No Background Sync API dependency

Status: accepted · Date: 2026-11-17

## Context
Syncing when the app is closed would be convenient. The Background Sync API offers that, but
support is uneven (not in Safari or Firefox) and timing is controlled by the browser.

## Options
1. **Rely on Background Sync.** Great where supported, broken elsewhere.
2. **Foreground-only sync** triggered by the app being open.
3. **Foreground sync, with Background Sync as an optional bonus.**

## Decision
Option 3, with the guarantee resting on option 2. Sync runs on the `online` event, on app start,
every 60 seconds while online, and via a manual "Sync now" button. A Web Locks lock
(`navigator.locks.request`) prevents two tabs syncing at once.

## Consequences
- Correctness never depends on a browser feature that may be missing; all paths are testable in
  Playwright.
- Changes can sit on the device until the app is opened. The UI makes this visible: pending count
  and last-sync time in the header, and "Saved on this device" never looks like "Synced".
- Web Locks are widely supported. Where missing, fall back to a single-tab warning (backlog).
- If Background Sync is added later it must call the same `syncNow()` and change no protocol rules.

## Amendment (2026-11-18, slice 2.5)
A fifth trigger was missing: **shortly after a local change** (1.5 s, only while the browser says it is online). Without it a worker who edits while connected waits up to a minute to be synced; the end-to-end scenarios found this. The guarantee is unchanged: it still rests on foreground sync and every trigger calls the same `syncNow()`.

