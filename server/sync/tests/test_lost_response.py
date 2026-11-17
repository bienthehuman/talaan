"""Scenario 2 (server half): the server applied the change but the response was lost. The client
retries the same mutation and ends up with exactly one record (docs/failure-scenarios.md)."""

import uuid

import pytest

from submissions.models import Submission, SubmissionEvent
from sync.models import AppliedMutation
from sync.tests.api_helpers import DEVICE_A, api, assert_problem, create_mut, mut, pull, push
from sync.tests.helpers import row

pytestmark = [pytest.mark.django_db, pytest.mark.phase1]

DROP = {"HTTP_X_FAULT": "drop-after-commit"}


def test_scenario_2_the_response_is_lost_and_the_retry_applies_nothing_twice(
    fault_injection, worker, assignment
):
    client = api(worker)
    record_id = uuid.uuid4()
    create_request = create_mut(record_id, assignment, {"oil_level": "ok", "notes": "first"})

    # 1. The server applies it and commits, but the client never sees the answer.
    lost = push(client, create_request, headers=DROP)
    assert_problem(lost, 503, "fault_injected")
    assert Submission.objects.filter(pk=record_id).count() == 1  # applied

    # 2. The client cannot know that, so it retries the identical mutation.
    retry = push(client, create_request)
    assert retry.status_code == 200
    result = retry.json()["results"][0]
    assert result["status"] == "applied"  # not id_taken: the ledger answers
    assert result["record"]["version"] == 1

    # 3. Exactly one submission, one ledger row, one event; the client ends in sync.
    assert Submission.objects.filter(pk=record_id).count() == 1
    assert AppliedMutation.objects.filter(pk=create_request["mutation_id"]).count() == 1
    assert SubmissionEvent.objects.filter(submission_id=record_id).count() == 1
    assert pull(client).json()["records"][0] == result["record"]


def test_a_lost_response_for_an_update_does_not_double_apply(fault_injection, worker, assignment):
    client = api(worker)
    record_id = uuid.uuid4()
    push(client, create_mut(record_id, assignment))
    update = mut("update", record_id, base=1, fields={"notes": "once"})

    assert push(client, update, headers=DROP).status_code == 503
    for _ in range(3):  # the client may retry several times
        assert push(client, update).json()["results"][0]["record"]["version"] == 2
    assert row(record_id).version == 2


def test_a_lost_response_for_a_whole_batch_replays_every_result(
    fault_injection, worker, assignment
):
    client = api(worker)
    ids = [uuid.uuid4() for _ in range(3)]
    batch = [create_mut(i, assignment) for i in ids]

    assert push(client, *batch, headers=DROP).status_code == 503
    results = push(client, *batch).json()["results"]
    assert [r["status"] for r in results] == ["applied"] * 3
    assert Submission.objects.filter(pk__in=ids).count() == 3
    assert AppliedMutation.objects.count() == 3


def test_a_lost_response_for_a_conflict_is_still_a_conflict_on_retry(
    fault_injection, worker, assignment
):
    client = api(worker)
    record_id = uuid.uuid4()
    push(client, create_mut(record_id, assignment))
    push(client, mut("update", record_id, base=1, fields={"oil_level": "low"}))
    clash = mut("update", record_id, base=1, fields={"oil_level": "empty"})

    assert push(client, clash, headers=DROP).status_code == 503
    assert push(client, clash).json()["results"][0]["status"] == "conflict"
    assert row(record_id).data["oil_level"] == "low"


def test_the_same_retry_from_a_second_tab_or_a_double_tap_is_also_harmless(
    fault_injection, worker, assignment
):
    client = api(worker)
    record_id = uuid.uuid4()
    request = create_mut(record_id, assignment)
    first = push(client, request, device=DEVICE_A).json()
    second = push(client, request, device=DEVICE_A).json()
    assert first == second
    assert Submission.objects.filter(pk=record_id).count() == 1
