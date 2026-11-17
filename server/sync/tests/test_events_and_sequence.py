import random
import uuid

import pytest
from django.db import connection

from submissions.models import SubmissionEvent
from sync.services import SEQ_LOCK
from sync.tests.helpers import COMPLETE, DEVICE_A, DEVICE_B, admin, create, push, row, submitted

pytestmark = pytest.mark.django_db


def kinds(record_id) -> list[str]:
    return list(
        SubmissionEvent.objects.filter(submission_id=record_id).values_list("kind", flat=True)
    )


# --- events ----------------------------------------------------------------------------------


def test_every_applied_change_writes_one_event_with_actor_and_mutation(
    worker, admin_user, assignment
):
    record_id, created = create(worker, assignment, COMPLETE)
    update = push(worker, "update", record_id, base=1, fields={"notes": "n"})
    push(worker, "submit", record_id, base=2)
    admin(admin_user, record_id, "return", reason="r")
    admin(admin_user, record_id, "delete")
    admin(admin_user, record_id, "restore")

    assert kinds(record_id) == [
        "created",
        "updated",
        "submitted",
        "returned",
        "deleted",
        "restored",
    ]
    updated = SubmissionEvent.objects.get(submission_id=record_id, kind="updated")
    assert str(updated.mutation_id) == update["mutation_id"]
    assert (updated.actor_id, updated.version, updated.detail) == (
        worker.id,
        2,
        {"fields": ["notes"]},
    )
    assert (
        SubmissionEvent.objects.get(submission_id=record_id, kind="deleted").actor_id
        == admin_user.id
    )


def test_a_conflict_is_logged_with_its_kind_and_fields(worker, assignment):
    record_id, _ = create(worker, assignment)
    push(worker, "update", record_id, base=1, fields={"oil_level": "low"})
    push(worker, "update", record_id, base=1, fields={"oil_level": "empty"}, device=DEVICE_B)
    event = SubmissionEvent.objects.get(submission_id=record_id, kind="conflict")
    assert event.detail == {"kind": "field_conflict", "fields": ["oil_level"]}
    assert event.version == 2  # the version the record is at, since nothing was applied


def test_a_rejection_on_a_visible_record_is_logged(worker, admin_user, assignment):
    record_id = submitted(worker, assignment)
    push(worker, "update", record_id, base=2, fields={"notes": "x"})
    assert SubmissionEvent.objects.get(submission_id=record_id, kind="rejected").detail == {
        "code": "locked"
    }


def test_nothing_is_logged_when_there_is_no_record_the_user_may_see(
    worker, other_worker, assignment
):
    record_id, _ = create(worker, assignment)
    before = SubmissionEvent.objects.count()
    push(other_worker, "update", record_id, base=1, fields={"notes": "x"})  # not theirs
    push(worker, "update", uuid.uuid4(), base=1, fields={"notes": "x"})  # unknown
    push(worker, "create", record_id, base=0, fields={}, assignment_id=assignment.id)  # id_taken
    push(worker, "create", uuid.uuid4(), base=0, fields={"mystery": 1}, assignment_id=assignment.id)
    assert SubmissionEvent.objects.count() == before


# --- server_seq -----------------------------------------------------------------------------


def test_only_applied_changes_consume_a_sequence_value(worker, assignment):
    """Conflicts and rejections leave no gaps in the feed that pull walks."""
    record_id, first = create(worker, assignment, {"oil_level": "ok", "notes": "n"})
    seqs = [first["record"]["server_seq"]]

    for fields, base in [
        ({"notes": "a"}, 1),  # applied
        ({"notes": "clash"}, 1),  # conflict
        ({"mystery": 1}, 2),  # rejected (invalid)
        ({"oil_level": "low"}, 2),  # applied
    ]:
        result = push(worker, "update", record_id, base=base, fields=fields)
        if result["status"] == "applied":
            seqs.append(result["record"]["server_seq"])
    push(worker, "update", uuid.uuid4(), base=1, fields={"notes": "x"})  # rejected (not_found)
    last = push(worker, "update", record_id, base=3, fields={"notes": "z"})
    seqs.append(last["record"]["server_seq"])

    assert [b - a for a, b in zip(seqs, seqs[1:], strict=False)] == [1] * (len(seqs) - 1)


def test_server_seq_is_unique_across_records(worker, assignment):
    seqs = [create(worker, assignment)[1]["record"]["server_seq"] for _ in range(5)]
    assert len(set(seqs)) == 5
    assert seqs == sorted(seqs)


def lock_held() -> bool:
    with connection.cursor() as cursor:
        cursor.execute(
            "SELECT count(*) FROM pg_locks WHERE locktype = 'advisory' AND objid = %s "
            "AND pid = pg_backend_pid() AND granted",
            [SEQ_LOCK],
        )
        return cursor.fetchone()[0] > 0


def test_the_advisory_lock_is_taken_for_applied_changes(worker, assignment):
    assert not lock_held()
    create(worker, assignment)
    assert lock_held()  # held until the transaction ends, here the whole test


@pytest.mark.parametrize("kind", ["not_found", "forbidden", "invalid_op"])
def test_the_advisory_lock_is_taken_before_anything_else_even_when_the_mutation_fails(
    worker, admin_user, kind
):
    """Every path takes the lock first, so no read of record state ever races a writer."""
    assert not lock_held()
    if kind == "not_found":
        push(worker, "update", uuid.uuid4(), base=1, fields={"notes": "x"})
    elif kind == "forbidden":
        push(admin_user, "update", uuid.uuid4(), base=1, fields={"notes": "x"})
    else:
        push(worker, "teleport", uuid.uuid4())
    assert lock_held()


# --- invariants under a long, mixed history -----------------------------------------------------


def test_invariants_hold_over_a_random_history(worker, admin_user, assignment):
    """A seeded random walk over every op from two devices that sometimes lag behind. Whatever the
    mix of outcomes, the bookkeeping must stay consistent."""
    rng = random.Random(20261117)
    record_id, created = create(worker, assignment, {"oil_level": "ok", "notes": "n"})
    seen = {DEVICE_A: 1, DEVICE_B: 1}  # the version each device last confirmed
    applied = 0
    last_seq = created["record"]["server_seq"]

    for _ in range(150):
        device = rng.choice([DEVICE_A, DEVICE_B])
        op = rng.choice(["update", "update", "update", "submit", "delete"])
        base = seen[device] if rng.random() < 0.7 else rng.randint(0, row(record_id).version)
        fields = (
            {
                rng.choice(["oil_level", "notes", "hours_run"]): rng.choice(
                    ["low", "ok", "x", 7, None]
                )
            }
            if op == "update"
            else {}
        )
        result = push(worker, op, record_id, base=base, fields=fields, device=device)

        if result["status"] == "applied":
            applied += 1
            assert result["record"]["server_seq"] > last_seq
            last_seq = result["record"]["server_seq"]
        if "record" in result:
            seen[device] = result["record"]["version"]  # the device catches up from every answer

        if rng.random() < 0.1:  # occasionally an admin rescues or reopens the record
            current = row(record_id)
            if current.deleted_at:
                admin(admin_user, record_id, "restore")
            elif current.status == "submitted":
                admin(admin_user, record_id, "return", reason="again")

    final = row(record_id)
    assert final.version >= 1 + applied  # applied worker changes plus any admin actions
    assert all(1 <= v <= final.version for v in final.field_versions.values())
    assert set(final.data) <= set(final.field_versions)  # every answer is version-tracked
    assert set(final.data) <= {"oil_level", "notes", "hours_run"}
    events = SubmissionEvent.objects.filter(submission_id=record_id)
    applied_kinds = events.exclude(kind__in=["conflict", "rejected"]).count()
    assert applied_kinds == final.version  # one event per version, including the create
