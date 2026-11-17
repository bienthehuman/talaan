# Security policy

Talaan is a proof of concept and portfolio project, not a hosted service. There is no production
deployment to attack, but design flaws in the sync protocol or the way it is built are still worth
reporting.

## Reporting a vulnerability

Please do not open a public issue. Use GitHub's private vulnerability reporting on this repository
(Security tab, "Report a vulnerability"), or contact the maintainer through their GitHub profile.

Include what you found, how to reproduce it, and which commit you tested. You will get an
acknowledgement, and fixes land through the normal pull request flow with a note in the changelog.

## Known risks that are documented, not vulnerabilities

These are accepted for the PoC and listed in `docs/ARCHITECTURE.md` section 8:

- Local data in the browser is not encrypted at rest.
- Browsers may evict storage for sites that are not installed.
- Access and refresh tokens are kept in `localStorage` (revisited in phase 2).
- The `FAULT_INJECTION` switch exists for tests. The server refuses to start with it on when
  `DJANGO_DEBUG` is off.
