import uuid

import pytest

from assignments.models import Assignment
from submissions.models import Submission, SubmissionEvent
from sync.tests.helpers import create, push, row

pytestmark = pytest.mark.django_db


def test_create_is_applied_at_version_one(worker, assignment):
    record_id, result = create(worker, assignment, {"oil_level": "ok", "notes": "All good"})
    record = result["record"]
    assert record["id"] == str(record_id)
    assert record["version"] == 1
    assert record["status"] == "draft"
    assert record["deleted"] is False
    assert record["data"] == {"oil_level": "ok", "notes": "All good"}
    assert record["field_versions"] == {"oil_level": 1, "notes": 1}

    stored = row(record_id)
    assert stored.updated_by_id == worker.id
    assert stored.assignment_id == assignment.id
    assert (
        stored.form_version_id == assignment.form_version_id
    )  # pinned to the assignment's version


def test_a_draft_can_start_empty_or_incomplete(worker, assignment):
    _, empty = create(worker, assignment, {})
    assert empty["record"]["data"] == {}
    _, partial = create(worker, assignment, {"notes": "only a note, required fields come later"})
    assert partial["status"] == "applied"


def test_null_values_on_create_are_ignored(worker, assignment):
    _, result = create(worker, assignment, {"oil_level": "low", "notes": None})
    assert result["record"]["data"] == {"oil_level": "low"}
    assert "notes" not in result["record"]["field_versions"]


def test_a_second_create_for_the_same_id_is_id_taken(worker, assignment):
    record_id, _ = create(worker, assignment)
    again = push(worker, "create", record_id, base=0, fields={}, assignment_id=assignment.id)
    assert (again["status"], again["code"]) == ("rejected", "id_taken")
    assert row(record_id).version == 1


def test_an_id_that_belongs_to_another_worker_is_id_taken(
    worker, other_worker, assignment, published_version
):
    record_id, _ = create(worker, assignment)
    theirs = Assignment.objects.create(
        form_version=published_version, worker=other_worker, site_name="Other"
    )
    clash = push(other_worker, "create", record_id, base=0, fields={}, assignment_id=theirs.id)
    assert (clash["status"], clash["code"]) == ("rejected", "id_taken")
    assert "record" not in clash  # nothing about the other worker's record is revealed


@pytest.mark.parametrize("assignment_id", [None, 999_999])
def test_an_unknown_or_missing_assignment_is_refused(worker, assignment_id):
    result = push(worker, "create", uuid.uuid4(), base=0, fields={}, assignment_id=assignment_id)
    assert (result["status"], result["code"]) == ("rejected", "unknown_form_version")


def test_an_assignment_that_belongs_to_someone_else_is_refused(
    worker, other_worker, published_version
):
    theirs = Assignment.objects.create(
        form_version=published_version, worker=other_worker, site_name="Theirs"
    )
    result = push(worker, "create", uuid.uuid4(), base=0, fields={}, assignment_id=theirs.id)
    assert (result["status"], result["code"]) == ("rejected", "unknown_form_version")


def test_a_cancelled_assignment_takes_no_new_records(worker, assignment):
    assignment.cancel()
    result = push(worker, "create", uuid.uuid4(), base=0, fields={}, assignment_id=assignment.id)
    assert (result["status"], result["code"]) == ("rejected", "invalid_state")
    assert "cancelled" in result["detail"]


@pytest.mark.parametrize(
    ("fields", "field", "code"),
    [
        ({"mystery": 1}, "mystery", "unknown_field"),
        ({"oil_level": "overflowing"}, "oil_level", "enum"),
        ({"hours_run": "many"}, "hours_run", "type"),
        ({"hours_run": -5}, "hours_run", "minimum"),
        ({"coolant_ok": "yes"}, "coolant_ok", "type"),
        ({"oil_pressure_psi": 500}, "oil_pressure_psi", "maximum"),
    ],
)
def test_invalid_data_is_rejected_and_nothing_is_created(worker, assignment, fields, field, code):
    record_id = uuid.uuid4()
    result = push(worker, "create", record_id, base=0, fields=fields, assignment_id=assignment.id)
    assert (result["status"], result["code"]) == ("rejected", "invalid")
    assert any(e["field"] == field and e["code"] == code for e in result["errors"]), result
    assert not Submission.objects.filter(pk=record_id).exists()
    assert SubmissionEvent.objects.count() == 0


def test_an_admin_cannot_create_submissions(admin_user, assignment):
    result = push(
        admin_user, "create", uuid.uuid4(), base=0, fields={}, assignment_id=assignment.id
    )
    assert (result["status"], result["code"]) == ("rejected", "forbidden")


def test_an_unknown_op_is_rejected(worker, assignment):
    result = push(worker, "teleport", uuid.uuid4(), fields={})
    assert (result["status"], result["code"]) == ("rejected", "invalid")
