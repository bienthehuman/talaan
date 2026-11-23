# 0014. Workers join through a one-time invite link

Status: accepted · Date: 2026-11-23

## Context
Talaan has no sign-up. Outside debug (`seed_demo` refuses), the only way to add a worker is the Django
admin: create a user, then add them to the `worker` group by hand. A user left without the group can sign
in but has no role. Admins need a supported way to add workers from the app, and an admin should never
have to choose or know a worker's password.

## Options
1. **Admin creates the user with a first password** and hands it over. Simple, but the admin knows the
   password, and making the worker change it needs a flag, an endpoint and a screen anyway.
2. **Open sign-up** with admin approval. Anyone can create accounts; more to review and to abuse.
3. **Invite link.** The admin records who is joining; the server issues a secret, single-use link valid
   for 7 days; the invitee opens it and sets their own password, and only then is the user created.

## Decision
Option 3, with invites in their own table (`worker_invite`, DATA_MODEL.md section 1).

- The admin enters username, first and last name. The invitee chooses only the password; the username is
  shown to them and cannot be changed.
- The token is 32 random bytes (`secrets.token_urlsafe`). Only its SHA-256 is stored, so a database
  read does not yield working links. The token is shown once, in the response that creates it; a lost
  link is replaced with "new link", which issues a new token and expiry and kills the old one.
- The link is `/invite#<token>`. The token is in the fragment, which browsers never send, so it does not
  reach nginx or Django request logs (`path` is a log field) or a `Referer`. The invite page sends it in
  a POST body.
- Lifetime 7 days from issue, by the server clock. Accepting is single use: with the invite row locked,
  the server checks it is open and unexpired, validates the password with Django's validators, creates
  the user in the `worker` group and marks the invite accepted, in one transaction.
- No email: the admin copies the link and sends it however they reach their workers. Email delivery is
  a backlog item.
- Admin endpoints need a new catalog permission `worker.manage` (admin only). The public endpoints take
  no auth and are throttled per client address like login.

## Consequences
- No user exists until the invitee sets a password, so there are no half-made accounts, and an
  unused invite expires on its own.
- Admins cannot recover a link, only replace it. That is deliberate: a stored link would be a stored
  credential.
- Invite rows are kept after use or revocation as a record of who invited whom.
- Deactivating a worker and resetting a password are not part of this. Deactivation needs server-side
  refresh token revocation first (backlog), or a deactivated worker keeps syncing until the refresh token
  expires.
