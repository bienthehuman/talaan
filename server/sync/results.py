"""The outcome of one mutation, as stored in the ledger and returned to the client
(docs/protocol.md section 4). Plain JSON-serialisable dicts: the ledger stores them verbatim and a
replayed mutation returns exactly what was stored."""

from submissions.models import Submission

# Result statuses
APPLIED = "applied"
CONFLICT = "conflict"
REJECTED = "rejected"

# Conflict kinds
FIELD_CONFLICT = "field_conflict"
DELETED_REMOTELY = "deleted_remotely"
EDITED_SINCE_BASE = "edited_since_base"

# Rejected codes
LOCKED = "locked"
NOT_FOUND = "not_found"
ID_TAKEN = "id_taken"
INVALID = "invalid"
INVALID_STATE = "invalid_state"
UNKNOWN_FORM_VERSION = "unknown_form_version"
MUTATION_ID_REUSE = "mutation_id_reuse"
FORBIDDEN = "forbidden"


def record_payload(sub: Submission) -> dict:
    """The server's copy of a record: what a client needs to update its shadow."""
    return {
        "id": str(sub.id),
        "assignment_id": sub.assignment_id,
        "form_version_id": sub.form_version_id,
        "version": sub.version,
        "field_versions": dict(sub.field_versions),
        "data": dict(sub.data),
        "status": sub.status,
        "deleted": sub.deleted_at is not None,
        "server_seq": sub.server_seq,
    }


def applied(mutation_id, sub: Submission) -> dict:
    return {"mutation_id": str(mutation_id), "status": APPLIED, "record": record_payload(sub)}


def conflict(mutation_id, sub: Submission, kind: str, fields: list[dict]) -> dict:
    return {
        "mutation_id": str(mutation_id),
        "status": CONFLICT,
        "conflict": {"kind": kind, "fields": fields},
        "record": record_payload(sub),
    }


def rejected(
    mutation_id,
    code: str,
    detail: str,
    *,
    sub: Submission | None = None,
    errors: list[dict] | None = None,
) -> dict:
    result: dict = {
        "mutation_id": str(mutation_id),
        "status": REJECTED,
        "code": code,
        "detail": detail,
    }
    if errors:
        result["errors"] = errors
    if sub is not None:
        result["record"] = record_payload(sub)
    return result
