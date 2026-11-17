"""Small builders so each test reads like the scenario it checks."""

import uuid

from submissions.models import Submission
from sync.services import Mutation, apply_admin_action, apply_mutation

DEVICE_A = uuid.UUID(int=0xA)
DEVICE_B = uuid.UUID(int=0xB)

COMPLETE = {"oil_level": "ok", "coolant_ok": True, "hours_run": 120}  # satisfies `required`


def mutation(op, record_id, *, base=1, fields=None, assignment_id=None, mutation_id=None):
    return Mutation(
        mutation_id=mutation_id or uuid.uuid4(),
        record_id=record_id,
        op=op,
        base_version=base,
        fields={} if fields is None else fields,
        assignment_id=assignment_id,
    )


def push(user, op, record_id, *, device=DEVICE_A, **kwargs) -> dict:
    return apply_mutation(user, device, mutation(op, record_id, **kwargs))


def create(user, assignment, fields=None, *, record_id=None, device=DEVICE_A):
    """Create a record and return (record_id, result). Fails the test if it is not applied."""
    record_id = record_id or uuid.uuid4()
    result = push(
        user,
        "create",
        record_id,
        base=0,
        fields={"oil_level": "ok"} if fields is None else fields,
        assignment_id=assignment.id,
        device=device,
    )
    assert result["status"] == "applied", result
    return record_id, result


def submitted(user, assignment):
    """A record that has been created and submitted (version 2). Returns its id."""
    record_id, _ = create(user, assignment, COMPLETE)
    result = push(user, "submit", record_id, base=1)
    assert result["status"] == "applied", result
    return record_id


def admin(user, record_id, action, **kwargs) -> dict:
    return apply_admin_action(user, record_id, action, **kwargs)


def row(record_id) -> Submission:
    return Submission.objects.get(pk=record_id)
