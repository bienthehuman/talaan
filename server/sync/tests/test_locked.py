"""Scenario 10: a worker edits an approved submission. Rejected as `locked`, with a clear message
and nothing changed (docs/failure-scenarios.md). The service half is in test_update.py; this is the
HTTP half."""

import pytest

from sync.tests.api_helpers import mut, push
from sync.tests.helpers import admin, row, submitted

pytestmark = [pytest.mark.django_db, pytest.mark.phase1]


@pytest.fixture
def approved(worker, admin_user, assignment):
    record_id = submitted(worker, assignment)
    admin(admin_user, record_id, "approve")
    return record_id


def test_scenario_10_an_edit_of_an_approved_record_is_rejected_as_locked(worker_client, approved):
    response = push(worker_client, mut("update", approved, base=3, fields={"notes": "too late"}))
    assert response.status_code == 200  # a verdict, not a failure: the client must not retry
    result = response.json()["results"][0]
    assert (result["status"], result["code"]) == ("rejected", "locked")
    assert "approved" in result["detail"] and "can no longer be changed" in result["detail"]
    assert result["record"]["status"] == "approved"  # lets the client show why
    assert (row(approved).version, "notes" in row(approved).data) == (3, False)


def test_sending_it_again_gets_the_same_verdict_and_still_changes_nothing(worker_client, approved):
    edit = mut("update", approved, base=3, fields={"notes": "again"})
    first = push(worker_client, edit).json()
    for _ in range(3):
        assert push(worker_client, edit).json() == first  # a retry loop would be harmless too
    assert row(approved).version == 3


@pytest.mark.parametrize("op", ["update", "submit", "delete"])
def test_every_worker_op_is_locked_out_of_an_approved_record(worker_client, approved, op):
    result = push(
        worker_client, mut(op, approved, base=3, fields={"notes": "x"} if op == "update" else {})
    )
    assert result.json()["results"][0]["code"] == "locked"


def test_a_returned_record_unlocks_again(worker_client, admin_user, approved):
    admin(admin_user, approved, "return", reason="Please add detail")
    result = push(worker_client, mut("update", approved, base=4, fields={"notes": "detail"}))
    assert result.json()["results"][0]["status"] == "applied"
