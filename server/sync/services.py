"""The only place submissions are written (docs/protocol.md sections 3 to 6, ADRs 0001-0005).

Two entry points share one core:

* `apply_mutation`: a worker's mutation from the push protocol.
* `apply_admin_action`: approve, return, restore, delete or edit by an admin.

Both run through `_run_once`: one transaction per mutation, the idempotency ledger row inserted
first, the advisory lock taken before any state is read or a sequence value is drawn, and the result
stored in the ledger in the same transaction. Writing a submission any other way is refused twice
over: the runtime guard (submissions.guard) and the database trigger (submissions migration 0002).

Only accepted changes consume a version and a `server_seq`. Conflicts and rejections write the
ledger row and an event, and nothing else, so `server_seq` has no gaps from refused mutations.
"""

import logging
import time
import uuid
from dataclasses import dataclass, field

from django.db import IntegrityError, connection, transaction
from django.utils import timezone

from accounts.models import User
from accounts.permissions import ADMIN, WORKER
from assignments.models import Assignment
from core import logs
from forms.validation import validate_data
from submissions.guard import write_access
from submissions.models import EventKind, Status, Submission, SubmissionEvent

from . import results as r
from .models import AppliedMutation

log = logging.getLogger("talaan.sync")

# Advisory-lock key. Every sync write takes it before drawing a server_seq and holds it to commit,
# so sequence values become visible in order and a pull cursor never skips one (ADR 0005).
SEQ_LOCK = 4242

# Admin actions have no device; their ledger rows use this nil id.
ADMIN_DEVICE_ID = uuid.UUID(int=0)

# Worker ops (push protocol)
CREATE, UPDATE, SUBMIT, DELETE = "create", "update", "submit", "delete"
# Admin actions (REST, same core)
APPROVE, RETURN, RESTORE, EDIT = "approve", "return", "restore", "edit"
ADMIN_DELETE = "delete"

WORKER_PERMISSION = {
    CREATE: "submission.create",
    UPDATE: "submission.edit",
    SUBMIT: "submission.submit",
    DELETE: "submission.delete",
}
ADMIN_PERMISSION = {
    APPROVE: "submission.approve",
    RETURN: "submission.return",
    RESTORE: "submission.restore",
    ADMIN_DELETE: "submission.delete",
    EDIT: "submission.edit",
}

# Workers cannot touch a submission once it is submitted or approved (docs/ROLES.md section 2).
LOCKED_FOR_WORKERS = {Status.SUBMITTED, Status.APPROVED}


@dataclass(frozen=True)
class Mutation:
    """One mutation from the push protocol, already parsed and type-checked by the API layer."""

    mutation_id: uuid.UUID
    record_id: uuid.UUID
    op: str
    base_version: int = 0
    # A value of None clears the field.
    fields: dict = field(default_factory=dict)
    assignment_id: int | None = None


# --- entry points -------------------------------------------------------------------------------


def apply_mutation(user: User, device_id: uuid.UUID, mutation: Mutation) -> dict:
    """Apply a worker's mutation exactly once. A repeated mutation_id returns the stored result."""
    return _run_once(
        user, device_id, mutation.mutation_id, lambda: _worker_mutation(user, mutation)
    )


def apply_admin_action(
    user: User,
    record_id: uuid.UUID,
    action: str,
    *,
    reason: str = "",
    fields: dict | None = None,
) -> dict:
    """Approve, return, restore, delete or edit a submission as an admin. Same core, same rules."""
    mutation_id = uuid.uuid4()
    return _run_once(
        user,
        ADMIN_DEVICE_ID,
        mutation_id,
        lambda: _admin_action(user, mutation_id, record_id, action, reason, fields or {}),
    )


# --- the shared core ----------------------------------------------------------------------------


def _run_once(user: User, device_id: uuid.UUID, mutation_id: uuid.UUID, handler) -> dict:
    locked_at = None
    try:
        with transaction.atomic(), write_access():
            # The ledger row first: a concurrent duplicate blocks on this unique key until we
            # commit, then fails with IntegrityError and returns our stored result (ADR 0004).
            AppliedMutation.objects.create(mutation_id=mutation_id, device_id=device_id, user=user)
            asked_at = time.perf_counter()
            _take_sequence_lock()
            locked_at = time.perf_counter()
            result = handler()
            AppliedMutation.objects.filter(pk=mutation_id).update(result=result)
        # The lock is released by the commit, so the time it was held includes the commit itself.
        # Both numbers go on the mutation's log line (docs/loadtest/), where they show whether
        # writers are waiting for each other or for the database.
        logs.set_context(
            lock_wait_ms=round((locked_at - asked_at) * 1000, 2),
            lock_hold_ms=round((time.perf_counter() - locked_at) * 1000, 2),
        )
        return result
    except IntegrityError:
        prior = AppliedMutation.objects.filter(pk=mutation_id).first()
        if prior is None:
            raise  # a different constraint failed; never hide it as a duplicate
        if prior.user_id != user.id:
            # Someone else's mutation id. Nothing is stored and nothing about theirs is revealed.
            return r.rejected(
                mutation_id, r.MUTATION_ID_REUSE, "This mutation id was already used."
            )
        _count_replay(mutation_id)
        log.info("replay", extra={"event": "replay", "mutation_id": mutation_id})
        return prior.result


def _count_replay(mutation_id: uuid.UUID) -> None:
    """A retry of an already applied mutation, counted for /metrics. One row per mutation, so
    concurrent retries of different mutations never contend."""
    with connection.cursor() as cursor:
        cursor.execute(
            "INSERT INTO sync_replay (mutation_id, count) VALUES (%s, 1) "
            "ON CONFLICT (mutation_id) DO UPDATE SET count = sync_replay.count + 1",
            [mutation_id],
        )


def _take_sequence_lock() -> None:
    with connection.cursor() as cursor:
        cursor.execute("SELECT pg_advisory_xact_lock(%s)", [SEQ_LOCK])


def _next_server_seq() -> int:
    """Draw the next sequence value. Only call while holding the advisory lock."""
    with connection.cursor() as cursor:
        cursor.execute("SELECT nextval('submission_server_seq')")
        return cursor.fetchone()[0]


def _locked_submission(record_id: uuid.UUID) -> Submission | None:
    return (
        Submission.objects.select_for_update(of=("self",))
        .select_related("assignment", "form_version")
        .filter(pk=record_id)
        .first()
    )


def _event(user, mutation_id, sub: Submission, kind: str, detail: dict | None = None) -> None:
    SubmissionEvent.objects.create(
        submission=sub,
        version=sub.version,
        kind=kind,
        actor=user,
        mutation_id=mutation_id,
        detail=detail or {},
    )


def _reject(user, mutation_id, code, detail, *, sub=None, errors=None) -> dict:
    # A record is only attached (and an event written) when the user is allowed to see it.
    if sub is not None:
        _event(user, mutation_id, sub, EventKind.REJECTED, {"code": code})
    return r.rejected(mutation_id, code, detail, sub=sub, errors=errors)


def _conflict(user, mutation_id, sub: Submission, kind: str, fields: list[dict]) -> dict:
    _event(
        user,
        mutation_id,
        sub,
        EventKind.CONFLICT,
        {"kind": kind, "fields": [f["field"] for f in fields]},
    )
    return r.conflict(mutation_id, sub, kind, fields)


def _commit_change(
    user: User,
    mutation_id: uuid.UUID,
    sub: Submission,
    *,
    kind: str,
    fields: dict | None = None,
    status: str | None = None,
    deleted: bool | None = None,
    complete: bool = False,
    detail: dict | None = None,
) -> dict:
    """Apply one accepted change: validate, bump the version, draw a server_seq, save, record."""
    new_data = dict(sub.data)
    changed = list((fields or {}).keys())
    for name, value in (fields or {}).items():
        if value is None:
            new_data.pop(name, None)
        else:
            new_data[name] = value

    if fields or complete:
        errors = validate_data(sub.form_version.schema, new_data, complete=complete)
        if errors:
            return _reject(
                user,
                mutation_id,
                r.INVALID,
                "The data does not match the form.",
                sub=sub,
                errors=errors,
            )

    now = timezone.now()
    new_version = sub.version + 1
    field_versions = dict(sub.field_versions)
    for name in changed:
        field_versions[name] = new_version

    sub.data = new_data
    sub.field_versions = field_versions
    if status is not None:
        sub.status = status
    if deleted is True:
        sub.deleted_at = now
    elif deleted is False:
        sub.deleted_at = None
    sub.version = new_version
    sub.server_seq = _next_server_seq()
    sub.updated_by = user
    sub.updated_at = now
    sub.save()

    _event(user, mutation_id, sub, kind, {"fields": changed, **(detail or {})})
    return r.applied(mutation_id, sub)


def _field_clashes(sub: Submission, fields: dict, base_version: int) -> list[dict]:
    """Fields changed on the server since the client's base AND to a different value (protocol 6).
    Two people entering the same answer is not a conflict."""
    clashes = []
    for name, value in fields.items():
        server_version = sub.field_versions.get(name, 0)
        server_value = sub.data.get(name)
        if server_version > base_version and server_value != value:
            clashes.append(
                {
                    "field": name,
                    "server_value": server_value,
                    "client_value": value,
                    "server_version": server_version,
                }
            )
    return clashes


def _bad_base(user, m: Mutation, sub: Submission) -> dict | None:
    if m.base_version < 0 or m.base_version > sub.version:
        return _reject(
            user,
            m.mutation_id,
            r.INVALID,
            f"base_version {m.base_version} is not a version this record has "
            f"(it is at {sub.version}).",
            sub=sub,
        )
    return None


# --- worker mutations ---------------------------------------------------------------------------


def _worker_mutation(user: User, m: Mutation) -> dict:
    permission = WORKER_PERMISSION.get(m.op)
    if permission is None:
        return r.rejected(m.mutation_id, r.INVALID, f"Unknown op '{m.op}'.")
    if user.role != WORKER or not user.can(permission):
        return r.rejected(m.mutation_id, r.FORBIDDEN, "Your role cannot do this.")

    if m.op == CREATE:
        return _create(user, m)

    sub = _locked_submission(m.record_id)
    # Unknown and someone else's are indistinguishable on purpose.
    if sub is None or sub.assignment.worker_id != user.id:
        return r.rejected(m.mutation_id, r.NOT_FOUND, "No such record.")
    return {UPDATE: _update, SUBMIT: _submit, DELETE: _delete}[m.op](user, m, sub)


def _create(user: User, m: Mutation) -> dict:
    # Holding the advisory lock, so nobody can create this id between the check and the insert.
    if Submission.objects.filter(pk=m.record_id).exists():
        return r.rejected(m.mutation_id, r.ID_TAKEN, "A record with this id already exists.")

    assignment = None
    if m.assignment_id is not None:
        assignment = (
            Assignment.objects.select_related("form_version")
            .filter(pk=m.assignment_id, worker=user)
            .first()
        )
    if assignment is None:
        return r.rejected(
            m.mutation_id, r.UNKNOWN_FORM_VERSION, "No such assignment for this user."
        )
    if assignment.is_cancelled:
        return r.rejected(m.mutation_id, r.INVALID_STATE, "This assignment was cancelled.")

    data = {name: value for name, value in m.fields.items() if value is not None}
    errors = validate_data(assignment.form_version.schema, data, complete=False)
    if errors:
        return r.rejected(
            m.mutation_id, r.INVALID, "The data does not match the form.", errors=errors
        )

    now = timezone.now()
    sub = Submission(
        id=m.record_id,
        assignment=assignment,
        form_version=assignment.form_version,
        data=data,
        status=Status.DRAFT,
        version=1,
        field_versions={name: 1 for name in data},
        server_seq=_next_server_seq(),
        updated_by=user,
        created_at=now,
        updated_at=now,
    )
    sub.save(force_insert=True)
    _event(user, m.mutation_id, sub, EventKind.CREATED, {"fields": list(data)})
    return r.applied(m.mutation_id, sub)


def _update(user: User, m: Mutation, sub: Submission) -> dict:
    if sub.status in LOCKED_FOR_WORKERS:
        return _reject(
            user, m.mutation_id, r.LOCKED, f"The record is {sub.status} and locked.", sub=sub
        )
    if sub.deleted_at:
        return _conflict(user, m.mutation_id, sub, r.DELETED_REMOTELY, [])
    if (bad := _bad_base(user, m, sub)) is not None:
        return bad
    if not m.fields:
        return _reject(
            user, m.mutation_id, r.INVALID, "An update needs at least one field.", sub=sub
        )
    if clashes := _field_clashes(sub, m.fields, m.base_version):
        return _conflict(user, m.mutation_id, sub, r.FIELD_CONFLICT, clashes)
    return _commit_change(user, m.mutation_id, sub, kind=EventKind.UPDATED, fields=m.fields)


def _submit(user: User, m: Mutation, sub: Submission) -> dict:
    if sub.status == Status.APPROVED:
        return _reject(user, m.mutation_id, r.LOCKED, "The record is approved and locked.", sub=sub)
    if sub.status == Status.SUBMITTED:
        return _reject(
            user, m.mutation_id, r.INVALID_STATE, "The record is already submitted.", sub=sub
        )
    if sub.deleted_at:
        return _conflict(user, m.mutation_id, sub, r.DELETED_REMOTELY, [])
    if (bad := _bad_base(user, m, sub)) is not None:
        return bad
    # Only the fields sent with the submit are checked for conflicts; the rest of the record is
    # submitted as the server holds it (a merge of what every device entered).
    if clashes := _field_clashes(sub, m.fields, m.base_version):
        return _conflict(user, m.mutation_id, sub, r.FIELD_CONFLICT, clashes)
    return _commit_change(
        user,
        m.mutation_id,
        sub,
        kind=EventKind.SUBMITTED,
        fields=m.fields,
        status=Status.SUBMITTED,
        complete=True,
    )


def _delete(user: User, m: Mutation, sub: Submission) -> dict:
    if sub.status in LOCKED_FOR_WORKERS:
        return _reject(
            user, m.mutation_id, r.LOCKED, f"The record is {sub.status} and locked.", sub=sub
        )
    if sub.deleted_at:
        return _conflict(user, m.mutation_id, sub, r.DELETED_REMOTELY, [])
    if (bad := _bad_base(user, m, sub)) is not None:
        return bad
    # Never delete over newer work: anything changed after the worker's base blocks the delete.
    newer = [
        {"field": name, "server_value": sub.data.get(name), "server_version": version}
        for name, version in sub.field_versions.items()
        if version > m.base_version
    ]
    if newer:
        return _conflict(user, m.mutation_id, sub, r.EDITED_SINCE_BASE, newer)
    return _commit_change(user, m.mutation_id, sub, kind=EventKind.DELETED, deleted=True)


# --- admin actions ------------------------------------------------------------------------------


def _admin_action(
    user: User, mutation_id: uuid.UUID, record_id: uuid.UUID, action: str, reason: str, fields: dict
) -> dict:
    permission = ADMIN_PERMISSION.get(action)
    if permission is None:
        return r.rejected(mutation_id, r.INVALID, f"Unknown action '{action}'.")
    if user.role != ADMIN or not user.can(permission):
        return r.rejected(mutation_id, r.FORBIDDEN, "Your role cannot do this.")

    sub = _locked_submission(record_id)
    if sub is None:
        return r.rejected(mutation_id, r.NOT_FOUND, "No such record.")

    def refuse(detail: str) -> dict:
        return _reject(user, mutation_id, r.INVALID_STATE, detail, sub=sub)

    if action == RESTORE:
        if not sub.deleted_at:
            return refuse("The record is not deleted.")
        return _commit_change(user, mutation_id, sub, kind=EventKind.RESTORED, deleted=False)

    if sub.deleted_at:
        return refuse("The record is deleted. Restore it first.")

    if action == APPROVE:
        if sub.status != Status.SUBMITTED:
            return refuse(f"Only a submitted record can be approved (this one is {sub.status}).")
        return _commit_change(
            user, mutation_id, sub, kind=EventKind.APPROVED, status=Status.APPROVED
        )

    if action == RETURN:
        if sub.status not in LOCKED_FOR_WORKERS:
            return refuse(f"Only a submitted or approved record can be returned ({sub.status}).")
        if not reason.strip():
            return _reject(
                user,
                mutation_id,
                r.INVALID,
                "A reason is required.",
                sub=sub,
                errors=[
                    {"field": "reason", "code": "required", "message": "A reason is required."}
                ],
            )
        return _commit_change(
            user,
            mutation_id,
            sub,
            kind=EventKind.RETURNED,
            status=Status.RETURNED,
            detail={"reason": reason.strip(), "from_status": sub.status},
        )

    if action == ADMIN_DELETE:
        return _commit_change(user, mutation_id, sub, kind=EventKind.DELETED, deleted=True)

    # EDIT: an admin may correct any live record; a submitted or approved one must stay complete.
    if not fields:
        return _reject(user, mutation_id, r.INVALID, "An edit needs at least one field.", sub=sub)
    return _commit_change(
        user,
        mutation_id,
        sub,
        kind=EventKind.ADMIN_EDITED,
        fields=fields,
        complete=sub.status in LOCKED_FOR_WORKERS,
    )
