"""Scenario 7: many writers hit one record at the same moment. Real threads, real Postgres."""

import uuid

import pytest

from submissions.models import Submission, SubmissionEvent
from sync.services import apply_mutation
from sync.tests.concurrency import run_together
from sync.tests.helpers import DEVICE_A, create, mutation

pytestmark = [
    pytest.mark.phase1,
    pytest.mark.django_db(transaction=True),
]

WRITERS = 20


def _update(user, record_id, fields, *, base=1):
    m = mutation("update", record_id, base=base, fields=fields)
    return lambda: apply_mutation(user, DEVICE_A, m)


def test_twenty_concurrent_updates_give_versions_2_to_21_with_no_gaps(worker, assignment):
    record_id, _ = create(worker, assignment)  # version 1
    # Same value from every writer: none of them contradicts another, so all 20 are accepted.
    results = run_together([_update(worker, record_id, {"notes": "same"}) for _ in range(WRITERS)])

    assert {r["status"] for r in results} == {"applied"}
    assert sorted(r["record"]["version"] for r in results) == list(range(2, WRITERS + 2))
    stored = Submission.objects.get(pk=record_id)
    assert stored.version == WRITERS + 1
    updated = SubmissionEvent.objects.filter(submission=stored, kind="updated")
    assert sorted(e.version for e in updated) == list(range(2, WRITERS + 2))


def test_concurrent_edits_to_one_field_lose_nothing_silently(worker, assignment):
    """All 20 started from version 1 and disagree. One wins; the other 19 are told, not dropped."""
    record_id, _ = create(worker, assignment)
    results = run_together(
        [_update(worker, record_id, {"notes": f"writer {i}"}) for i in range(WRITERS)]
    )

    applied = [r for r in results if r["status"] == "applied"]
    conflicts = [r for r in results if r["status"] == "conflict"]
    assert (len(applied), len(conflicts)) == (1, WRITERS - 1)
    winner = applied[0]["record"]["data"]["notes"]
    assert Submission.objects.get(pk=record_id).data["notes"] == winner
    for c in conflicts:
        assert c["conflict"]["kind"] == "field_conflict"
        assert c["conflict"]["fields"][0]["server_value"] == winner
    assert Submission.objects.get(pk=record_id).version == 2


def test_concurrent_edits_to_different_fields_all_merge(worker, assignment):
    record_id, _ = create(worker, assignment)
    edits = {
        "site_contact": "Ana",
        "oil_pressure_psi": 41.5,
        "coolant_ok": True,
        "hours_run": 12,
        "notes": "n",
    }
    results = run_together([_update(worker, record_id, {k: v}) for k, v in edits.items()])

    assert {r["status"] for r in results} == {"applied"}
    stored = Submission.objects.get(pk=record_id)
    assert stored.version == 1 + len(edits)
    assert {k: stored.data[k] for k in edits} == edits
    assert sorted(stored.field_versions[k] for k in edits) == list(range(2, 2 + len(edits)))


def test_concurrent_creates_of_one_id_make_exactly_one_record(worker, assignment):
    record_id = uuid.uuid4()
    jobs = [
        (
            lambda i=i: apply_mutation(
                worker,
                DEVICE_A,
                mutation(
                    "create",
                    record_id,
                    base=0,
                    fields={"notes": str(i)},
                    assignment_id=assignment.id,
                ),
            )
        )
        for i in range(10)
    ]
    results = run_together(jobs)

    assert sorted(r["status"] for r in results) == ["applied"] + ["rejected"] * 9
    assert {r["code"] for r in results if r["status"] == "rejected"} == {"id_taken"}
    assert Submission.objects.filter(pk=record_id).count() == 1
