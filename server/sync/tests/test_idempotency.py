"""Idempotency (ADR 0004): every mutation takes effect at most once, whatever happens to the
response, and a repeat returns exactly what was stored."""

import uuid

import pytest
from django.db import IntegrityError

from submissions.models import SubmissionEvent
from sync import services
from sync.models import AppliedMutation
from sync.services import ADMIN_DEVICE_ID
from sync.tests.helpers import DEVICE_A, admin, create, mutation, push, row

pytestmark = pytest.mark.django_db


@pytest.fixture
def record(worker, assignment):
    record_id, _ = create(worker, assignment, {"oil_level": "ok", "notes": "start"})
    return record_id


def test_replaying_an_applied_mutation_returns_the_stored_result_and_changes_nothing(
    worker, record
):
    m = mutation("update", record, base=1, fields={"notes": "once"})
    first = services.apply_mutation(worker, DEVICE_A, m)
    events = SubmissionEvent.objects.count()

    again = services.apply_mutation(worker, DEVICE_A, m)
    assert again == first
    assert row(record).version == 2  # not 3
    assert SubmissionEvent.objects.count() == events
    assert AppliedMutation.objects.filter(pk=m.mutation_id).count() == 1


def test_a_replay_is_a_snapshot_even_after_the_record_moved_on(worker, record):
    m = mutation("update", record, base=1, fields={"notes": "mine"})
    first = services.apply_mutation(worker, DEVICE_A, m)
    push(worker, "update", record, base=2, fields={"notes": "later"})
    replay = services.apply_mutation(worker, DEVICE_A, m)
    assert replay == first
    assert replay["record"]["version"] == 2
    assert row(record).data["notes"] == "later"  # the replay did not re-apply or revert anything


def test_a_replayed_conflict_stays_a_conflict(worker, record):
    push(worker, "update", record, base=1, fields={"oil_level": "low"})
    clash = mutation("update", record, base=1, fields={"oil_level": "empty"})
    first = services.apply_mutation(worker, DEVICE_A, clash)
    assert first["status"] == "conflict"

    # The record changes so that the same mutation would now be accepted...
    push(worker, "update", record, base=2, fields={"oil_level": "empty"})
    # ...but a retry must return the stored verdict, never a different one.
    assert services.apply_mutation(worker, DEVICE_A, clash) == first
    assert row(record).version == 3


def test_a_replayed_rejection_stays_a_rejection(worker, record):
    bad = mutation("update", record, base=1, fields={"mystery": 1})
    first = services.apply_mutation(worker, DEVICE_A, bad)
    assert first["status"] == "rejected"
    assert services.apply_mutation(worker, DEVICE_A, bad) == first
    assert row(record).version == 1


def test_a_replayed_create_does_not_create_twice(worker, assignment):
    record_id = uuid.uuid4()
    m = mutation(
        "create", record_id, base=0, fields={"oil_level": "ok"}, assignment_id=assignment.id
    )
    first = services.apply_mutation(worker, DEVICE_A, m)
    assert services.apply_mutation(worker, DEVICE_A, m) == first
    assert row(record_id).version == 1  # not id_taken, and not a second record


def test_the_ledger_records_the_result_the_client_received(worker, record):
    m = mutation("update", record, base=1, fields={"notes": "x"})
    result = services.apply_mutation(worker, DEVICE_A, m)
    entry = AppliedMutation.objects.get(pk=m.mutation_id)
    assert entry.result == result
    assert (entry.user_id, entry.device_id) == (worker.id, DEVICE_A)


def test_two_different_mutations_with_the_same_content_both_apply(worker, record):
    push(worker, "update", record, base=1, fields={"notes": "same"})
    push(worker, "update", record, base=2, fields={"notes": "same"})
    assert row(record).version == 3  # idempotency is by mutation_id, never by content


def test_another_users_mutation_id_is_refused_and_reveals_nothing(
    worker, other_worker, record, assignment
):
    m = mutation("update", record, base=1, fields={"notes": "mine"})
    mine = services.apply_mutation(worker, DEVICE_A, m)

    theirs = services.apply_mutation(other_worker, DEVICE_A, m)  # same mutation_id, other user
    assert (theirs["status"], theirs["code"]) == ("rejected", "mutation_id_reuse")
    assert "record" not in theirs
    assert AppliedMutation.objects.get(pk=m.mutation_id).user_id == worker.id  # untouched
    assert services.apply_mutation(worker, DEVICE_A, m) == mine


def test_a_failure_that_is_not_a_duplicate_is_not_hidden(worker, record, monkeypatch):
    """The handler re-reads the ledger after an IntegrityError. If the row is absent, some other
    constraint failed, and it must surface instead of being mistaken for a replay."""

    def boom(*args, **kwargs):
        raise IntegrityError("some other constraint")

    monkeypatch.setattr(services, "_update", boom)
    m = mutation("update", record, base=1, fields={"notes": "x"})
    with pytest.raises(IntegrityError, match="some other constraint"):
        services.apply_mutation(worker, DEVICE_A, m)
    # The whole transaction rolled back, so the client can retry the same mutation later.
    assert not AppliedMutation.objects.filter(pk=m.mutation_id).exists()
    assert row(record).version == 1


def test_a_retry_after_a_rolled_back_attempt_applies_normally(worker, record, monkeypatch):
    m = mutation("update", record, base=1, fields={"notes": "retry me"})
    with monkeypatch.context() as patch:
        patch.setattr(
            services, "_update", lambda *a, **k: (_ for _ in ()).throw(IntegrityError("x"))
        )
        with pytest.raises(IntegrityError):
            services.apply_mutation(worker, DEVICE_A, m)
    result = services.apply_mutation(worker, DEVICE_A, m)
    assert result["status"] == "applied"
    assert row(record).version == 2


def test_admin_actions_also_leave_a_ledger_row(admin_user, worker, assignment):
    record_id, _ = create(worker, assignment)
    result = admin(admin_user, record_id, "delete")
    entry = AppliedMutation.objects.get(pk=result["mutation_id"])
    assert (entry.user_id, entry.device_id) == (admin_user.id, ADMIN_DEVICE_ID)
    assert entry.result == result
