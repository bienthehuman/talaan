"""Scenario 3: the same batch sent twice at the same moment (two tabs, a retry racing the original).
Real threads, real Postgres, the least-privilege app role."""

import uuid
from functools import partial

import pytest

from submissions.models import Submission, SubmissionEvent
from sync.models import AppliedMutation
from sync.services import apply_mutation
from sync.tests.concurrency import run_together
from sync.tests.helpers import COMPLETE, DEVICE_A, DEVICE_B, mutation

pytestmark = [
    pytest.mark.phase1,
    pytest.mark.django_db(transaction=True),
]

ROUNDS = 15


def _batch(assignment):
    record_id = uuid.uuid4()
    return record_id, [
        mutation(
            "create", record_id, base=0, fields={"oil_level": "ok"}, assignment_id=assignment.id
        ),
        mutation("update", record_id, base=1, fields={"hours_run": 120, "coolant_ok": True}),
        mutation("submit", record_id, base=2),
    ]


def _send(user, device, batch):
    return [apply_mutation(user, device, m) for m in batch]


def test_a_batch_sent_twice_at_once_is_applied_once(worker, assignment):
    for _ in range(ROUNDS):
        record_id, batch = _batch(assignment)
        first, second = run_together(
            [partial(_send, worker, DEVICE_A, batch), partial(_send, worker, DEVICE_B, batch)]
        )

        assert first == second  # both senders were told exactly the same thing
        assert [r["status"] for r in first] == ["applied"] * 3
        assert [r["record"]["version"] for r in first] == [1, 2, 3]

        # One ledger row per mutation, one event per applied change, version 3 and no more.
        ids = [m.mutation_id for m in batch]
        assert AppliedMutation.objects.filter(mutation_id__in=ids).count() == 3
        assert SubmissionEvent.objects.filter(submission_id=record_id).count() == 3
        stored = Submission.objects.get(pk=record_id)
        assert (stored.version, stored.status, stored.data) == (3, "submitted", COMPLETE)


def test_many_senders_of_one_mutation_all_get_the_stored_answer(worker, assignment):
    record_id, batch = _batch(assignment)
    create = batch[0]
    results = run_together([lambda: apply_mutation(worker, DEVICE_A, create) for _ in range(8)])

    assert all(r == results[0] for r in results)
    assert results[0]["status"] == "applied"
    assert AppliedMutation.objects.filter(mutation_id=create.mutation_id).count() == 1
    assert SubmissionEvent.objects.filter(submission_id=record_id).count() == 1


def test_a_conflict_is_also_answered_once_and_the_same_way(worker, assignment):
    """A duplicate of a refused mutation gets the stored refusal, not a second judgement."""
    record_id, batch = _batch(assignment)
    _send(worker, DEVICE_A, batch[:1])
    apply_mutation(worker, DEVICE_B, mutation("update", record_id, base=1, fields={"notes": "b"}))
    stale = mutation("update", record_id, base=1, fields={"notes": "a"})

    results = run_together([lambda: apply_mutation(worker, DEVICE_A, stale) for _ in range(5)])

    assert all(r == results[0] for r in results)
    assert results[0]["status"] == "conflict"
    assert Submission.objects.get(pk=record_id).data["notes"] == "b"
    assert AppliedMutation.objects.filter(mutation_id=stale.mutation_id).count() == 1
