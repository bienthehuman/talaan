# Roles and flows

Status: accepted. Two roles: **worker** (field, offline-capable) and **admin** (office, online).
Permissions live in code as a catalog; roles are data (a group per role). No multi-tenancy.

## 1. Flow walkthrough: roles × steps

`Y` = allowed, `-` = not allowed, `own` = only on own assignments/records.

| # | Step | Worker | Admin | Notes |
|---|---|---|---|---|
| 1 | Log in (online, first time) | Y | Y | Offline use needs one prior login |
| 2 | Publish a form version | - | Y | JSON in Django admin for the PoC |
| 3 | Create / cancel an assignment | - | Y | |
| 4 | Download assignments + form versions | own | Y | |
| 5 | Create a submission | own | - | Admin does not create field data |
| 6 | Edit fields | own, draft/returned | Y (via `_apply`) | Admin edits log `submission_event` |
| 7 | Submit | own, draft/returned | - | |
| 8 | Delete submission | own, draft/returned | Y | Soft delete |
| 9 | Sync (push/pull) | Y | pull only | |
| 10 | See and resolve own conflicts | own | - | |
| 11 | Review queue | - | Y | |
| 12 | Approve | - | Y | From `submitted` |
| 13 | Return | - | Y | From `submitted` or `approved` (reopen), with reason |
| 14 | Restore a deleted submission | - | Y | Answers `deleted_remotely` |
| 15 | Conflict log, metrics (v1) | - | Y | |
| 16 | Log out with unsent changes | confirm | n/a | Wipes local data after confirm |

## 2. Action × submission status

| Action | draft | returned | submitted | approved | deleted |
|---|---|---|---|---|---|
| Worker edit | Y | Y | locked | locked | conflict `deleted_remotely` |
| Worker submit | Y | Y | invalid_state | locked | conflict `deleted_remotely` |
| Worker delete | Y | Y | locked | locked | no-op conflict |
| Admin approve | - | - | Y | invalid_state | - |
| Admin return | - | - | Y | Y (reopen) | - |
| Admin edit | Y | Y | Y | Y | - |
| Admin delete | Y | Y | Y | Y | n/a |
| Admin restore | - | - | - | - | Y |

## 3. Permission catalog (generated from this doc)

`submission.create`, `submission.edit`, `submission.submit`, `submission.delete`,
`submission.approve`, `submission.return`, `submission.restore`, `assignment.manage`,
`form.publish`, `conflictlog.view`, `metrics.view`, `worker.manage`.

Worker: create, edit, submit, delete (all scoped to own). Admin: all except create/submit.
A test compares the catalog in code against this section so they cannot drift.

## 4. Visibility

- Worker sees only submissions on own assignments; others return `not_found`.
- Admin sees everything.
