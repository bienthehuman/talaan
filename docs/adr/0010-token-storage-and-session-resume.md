# 0010. Token storage and session resume

Status: accepted · Date: 2026-11-18

## Context
The app must open and edit offline after one sign-in, and sync must survive an access token that
expires mid-batch (scenario 9). Tokens have to be readable by the page's JavaScript, because the sync
engine sends them. Where they live, and what happens when they stop working, are the decisions.

## Options
1. **localStorage, refresh token not rotated** (as built in phase 0).
2. **localStorage with rotating refresh tokens** (and a server blacklist).
3. **Refresh token in an httpOnly cookie, access token in memory.**

## Decision
Option 1, written down, with these rules:

- **Storage.** Access and refresh tokens stay in localStorage (`talaan.session`). Any script that runs
  on the origin can read them. The mitigation is that nothing else runs: the CSP allows `'self'` only,
  no inline scripts or styles, no third-party scripts, and the build has no runtime dependency that
  loads code.
- **Expiry.** The access token lives 5 minutes, the refresh token 7 days (`JWT_*` settings). On a 401
  the engine refreshes once and repeats the cycle. Repeating is safe: the server's ledger returns the
  stored answer for every mutation it already applied (a token can expire after a batch committed).
- **Refresh fails.** If the server refuses the refresh token, the engine pauses and the app asks for
  the password again, for the same account only. Local data and the outbox are never touched. If the
  server cannot be reached, that is not a logout: the engine retries with backoff.
- **Sign-out.** Signing out removes that person's local database from the device (a shared device
  must not keep their records) and asks first when changes are unsent. Expiry is not sign-out and
  deletes nothing.

Why not rotation: with rotation each refresh invalidates the old token. If the response to a refresh is
lost (the very failure this project is built around), the device holds a dead token and must sign in
again, possibly offline in the field. It also needs the blacklist tables and extra grants for the
least-privilege role. Why not a cookie: it removes theft of the token but not use of the session by an
injected script, needs CSRF handling and a same-site deployment story, and adds server work for little
extra protection given the CSP above.

## Consequences
- A stolen refresh token works for up to 7 days. There is no server-side revoke yet (backlog: rotation
  with grace for lost responses, or a per-user token version checked on refresh).
- Local data is not encrypted at rest (ARCHITECTURE section 8); sign-out removal is the control.
- Switching to option 2 or 3 later changes `auth/refresh.ts` and the server only; the engine's contract
  (`refresh()` returns `refreshed`, `login-required` or `unreachable`) does not change.
