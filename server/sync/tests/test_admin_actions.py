import uuid

import pytest

from sync.tests.helpers import COMPLETE, DEVICE_A, admin, create, push, row, submitted

pytestmark = pytest.mark.django_db


def test_approve_locks_a_submitted_record(worker, admin_user, assignment):
    record_id = submitted(worker, assignment)
    seq = row(record_id).server_seq
    result = admin(admin_user, record_id, "approve")
    assert result["status"] == "applied"
    assert (result["record"]["status"], result["record"]["version"]) == ("approved", 3)
    assert row(record_id).server_seq > seq  # admin writes are visible to pull like any other
    assert row(record_id).updated_by_id == admin_user.id


@pytest.mark.parametrize("make", ["draft", "approved"])
def test_only_a_submitted_record_can_be_approved(worker, admin_user, assignment, make):
    if make == "draft":
        record_id, _ = create(worker, assignment, COMPLETE)
    else:
        record_id = submitted(worker, assignment)
        admin(admin_user, record_id, "approve")
    result = admin(admin_user, record_id, "approve")
    assert (result["status"], result["code"]) == ("rejected", "invalid_state")


def test_return_sends_a_submitted_record_back_with_a_reason(worker, admin_user, assignment):
    record_id = submitted(worker, assignment)
    result = admin(admin_user, record_id, "return", reason="  Missing photo of the gasket ")
    assert result["record"]["status"] == "returned"
    event = row(record_id).events.get(kind="returned")
    assert event.detail["reason"] == "Missing photo of the gasket"
    assert event.detail["from_status"] == "submitted"


def test_an_approved_record_can_be_reopened(worker, admin_user, assignment):
    """The correction path for a mistaken approval (DATA_MODEL.md section 4)."""
    record_id = submitted(worker, assignment)
    admin(admin_user, record_id, "approve")
    result = admin(admin_user, record_id, "return", reason="Approved by mistake")
    assert result["record"]["status"] == "returned"
    assert row(record_id).events.get(kind="returned").detail["from_status"] == "approved"


def test_return_needs_a_reason_and_a_submitted_or_approved_record(worker, admin_user, assignment):
    record_id = submitted(worker, assignment)
    no_reason = admin(admin_user, record_id, "return", reason="   ")
    assert (no_reason["code"], no_reason["errors"][0]["field"]) == ("invalid", "reason")
    assert row(record_id).status == "submitted"

    draft_id, _ = create(worker, assignment)
    assert admin(admin_user, draft_id, "return", reason="why")["code"] == "invalid_state"


def test_after_a_return_the_worker_can_fix_and_resubmit(worker, admin_user, assignment):
    record_id = submitted(worker, assignment)
    admin(admin_user, record_id, "return", reason="Check the oil level")
    assert (
        push(worker, "update", record_id, base=3, fields={"oil_level": "low"})["status"]
        == "applied"
    )
    assert push(worker, "submit", record_id, base=4)["status"] == "applied"
    assert row(record_id).status == "submitted"


def test_restore_undoes_a_delete(worker, admin_user, assignment):
    record_id, _ = create(worker, assignment)
    admin(admin_user, record_id, "delete")
    result = admin(admin_user, record_id, "restore")
    assert (result["record"]["deleted"], result["record"]["version"]) == (False, 3)
    assert (
        push(worker, "update", record_id, base=3, fields={"notes": "back"})["status"] == "applied"
    )


def test_restore_needs_a_deleted_record(worker, admin_user, assignment):
    record_id, _ = create(worker, assignment)
    assert admin(admin_user, record_id, "restore")["code"] == "invalid_state"


def test_a_deleted_record_cannot_be_approved_returned_edited_or_deleted_again(
    worker, admin_user, assignment
):
    record_id = submitted(worker, assignment)
    admin(admin_user, record_id, "delete")
    for action, kwargs in [
        ("approve", {}),
        ("return", {"reason": "x"}),
        ("edit", {"fields": {"notes": "x"}}),
        ("delete", {}),
    ]:
        result = admin(admin_user, record_id, action, **kwargs)
        assert (result["status"], result["code"]) == ("rejected", "invalid_state"), action


def test_an_admin_edit_is_versioned_and_a_stale_worker_edit_then_conflicts(
    worker, admin_user, assignment
):
    record_id, _ = create(worker, assignment, {"oil_level": "ok"})
    edit = admin(admin_user, record_id, "edit", fields={"oil_level": "low"})
    assert edit["record"]["field_versions"]["oil_level"] == 2
    assert row(record_id).events.filter(kind="admin_edited").exists()

    stale = push(
        worker, "update", record_id, base=1, fields={"oil_level": "empty"}, device=DEVICE_A
    )
    assert (stale["status"], stale["conflict"]["kind"]) == ("conflict", "field_conflict")
    assert row(record_id).data["oil_level"] == "low"  # the admin's correction was not overwritten


def test_an_admin_edit_cannot_make_a_submitted_record_incomplete(worker, admin_user, assignment):
    record_id = submitted(worker, assignment)
    result = admin(
        admin_user, record_id, "edit", fields={"hours_run": None}
    )  # clears a required field
    assert (result["status"], result["code"]) == ("rejected", "invalid")
    assert row(record_id).data["hours_run"] == 120


def test_an_admin_edit_may_leave_a_draft_incomplete(worker, admin_user, assignment):
    record_id, _ = create(worker, assignment, {"oil_level": "ok"})
    assert admin(admin_user, record_id, "edit", fields={"notes": "n"})["status"] == "applied"


def test_an_edit_needs_fields(worker, admin_user, assignment):
    record_id, _ = create(worker, assignment)
    assert admin(admin_user, record_id, "edit", fields={})["code"] == "invalid"


@pytest.mark.parametrize("action", ["approve", "return", "restore", "delete", "edit"])
def test_a_worker_cannot_use_admin_actions(worker, assignment, action):
    record_id, _ = create(worker, assignment)
    result = admin(worker, record_id, action, reason="r", fields={"notes": "x"})
    assert (result["status"], result["code"]) == ("rejected", "forbidden")
    assert row(record_id).version == 1


def test_unknown_actions_and_records(admin_user):
    assert admin(admin_user, uuid.uuid4(), "approve")["code"] == "not_found"
    assert admin(admin_user, uuid.uuid4(), "obliterate")["code"] == "invalid"


def test_the_full_review_cycle_end_to_end(worker, admin_user, assignment):
    """create > edit > submit > return > edit > submit > approve > worker locked out."""
    record_id, _ = create(worker, assignment, COMPLETE)
    push(worker, "update", record_id, base=1, fields={"notes": "first pass"})
    push(worker, "submit", record_id, base=2)
    admin(admin_user, record_id, "return", reason="More detail please")
    push(worker, "update", record_id, base=4, fields={"notes": "more detail"})
    push(worker, "submit", record_id, base=5)
    assert admin(admin_user, record_id, "approve")["status"] == "applied"

    final = row(record_id)
    assert (final.status, final.version, final.data["notes"]) == ("approved", 7, "more detail")
    for op in ("update", "submit", "delete"):
        locked = push(
            worker, op, record_id, base=7, fields={"notes": "x"} if op == "update" else {}
        )
        assert locked["code"] == "locked", op
