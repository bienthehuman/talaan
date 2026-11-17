import pytest

from sync.tests.helpers import COMPLETE, DEVICE_B, admin, create, push, row, submitted

pytestmark = pytest.mark.django_db


# --- submit -----------------------------------------------------------------------------------


def test_submitting_a_complete_record_moves_it_to_submitted(worker, assignment):
    record_id, _ = create(worker, assignment, COMPLETE)
    result = push(worker, "submit", record_id, base=1)
    assert result["status"] == "applied"
    assert (result["record"]["status"], result["record"]["version"]) == ("submitted", 2)


def test_submit_requires_every_required_field(worker, assignment):
    record_id, _ = create(worker, assignment, {"oil_level": "ok"})  # hours_run, coolant_ok missing
    result = push(worker, "submit", record_id, base=1)
    assert (result["status"], result["code"]) == ("rejected", "invalid")
    missing = {e["field"] for e in result["errors"] if e["code"] == "required"}
    assert missing == {"coolant_ok", "hours_run"}
    assert row(record_id).status == "draft"
    assert row(record_id).version == 1


def test_final_values_can_travel_with_the_submit(worker, assignment):
    record_id, _ = create(worker, assignment, {"oil_level": "ok"})
    result = push(worker, "submit", record_id, base=1, fields={"coolant_ok": True, "hours_run": 9})
    assert result["status"] == "applied"
    assert result["record"]["data"] == {"oil_level": "ok", "coolant_ok": True, "hours_run": 9}
    assert result["record"]["field_versions"]["hours_run"] == 2


def test_a_submitted_record_cannot_be_submitted_again(worker, assignment):
    record_id = submitted(worker, assignment)
    result = push(worker, "submit", record_id, base=2)
    assert (result["status"], result["code"]) == ("rejected", "invalid_state")


def test_an_approved_record_is_locked_for_submit(worker, admin_user, assignment):
    record_id = submitted(worker, assignment)
    admin(admin_user, record_id, "approve")
    result = push(worker, "submit", record_id, base=3)
    assert (result["status"], result["code"]) == ("rejected", "locked")


def test_submitting_a_record_that_was_deleted_is_a_conflict(worker, admin_user, assignment):
    record_id, _ = create(worker, assignment, COMPLETE)
    admin(admin_user, record_id, "delete")
    result = push(worker, "submit", record_id, base=1)
    assert (result["status"], result["conflict"]["kind"]) == ("conflict", "deleted_remotely")
    assert row(record_id).status == "draft"


def test_a_field_sent_with_submit_can_conflict(worker, assignment):
    record_id, _ = create(worker, assignment, COMPLETE)
    push(worker, "update", record_id, base=1, fields={"hours_run": 200}, device=DEVICE_B)
    result = push(worker, "submit", record_id, base=1, fields={"hours_run": 300})
    assert (result["status"], result["conflict"]["kind"]) == ("conflict", "field_conflict")
    assert row(record_id).status == "draft"


def test_a_failed_submit_leaves_the_record_untouched(worker, assignment):
    record_id, _ = create(worker, assignment, {"oil_level": "ok"})
    before = row(record_id)
    push(worker, "submit", record_id, base=1, fields={"hours_run": "not a number"})
    after = row(record_id)
    assert (after.version, after.data, after.status, after.server_seq) == (
        before.version,
        before.data,
        before.status,
        before.server_seq,
    )


# --- delete -----------------------------------------------------------------------------------


def test_delete_is_a_versioned_tombstone(worker, assignment):
    record_id, _ = create(worker, assignment)
    before = row(record_id).server_seq
    result = push(worker, "delete", record_id, base=1)
    assert result["status"] == "applied"
    assert (result["record"]["deleted"], result["record"]["version"]) == (True, 2)
    stored = row(record_id)
    assert stored.deleted_at is not None
    assert stored.server_seq > before  # so the tombstone reaches other devices through pull
    assert stored.data == {"oil_level": "ok"}  # the row and its data stay


def test_a_delete_is_refused_once_the_record_is_locked(worker, admin_user, assignment):
    record_id = submitted(worker, assignment)
    assert push(worker, "delete", record_id, base=2)["code"] == "locked"
    admin(admin_user, record_id, "approve")
    assert push(worker, "delete", record_id, base=3)["code"] == "locked"


def test_deleting_a_deleted_record_is_a_conflict(worker, assignment):
    record_id, _ = create(worker, assignment)
    push(worker, "delete", record_id, base=1)
    again = push(worker, "delete", record_id, base=2)
    assert (again["status"], again["conflict"]["kind"]) == ("conflict", "deleted_remotely")


def test_a_delete_never_removes_newer_work(worker, assignment):
    """A delete from a device that has not seen another device's edit is a conflict."""
    record_id, _ = create(worker, assignment, {"oil_level": "ok", "notes": "start"})
    push(worker, "update", record_id, base=1, fields={"notes": "edited elsewhere"}, device=DEVICE_B)
    result = push(worker, "delete", record_id, base=1)
    assert result["status"] == "conflict"
    assert result["conflict"]["kind"] == "edited_since_base"
    assert result["conflict"]["fields"] == [
        {"field": "notes", "server_value": "edited elsewhere", "server_version": 2}
    ]
    assert row(record_id).deleted_at is None


def test_a_delete_succeeds_once_the_device_has_caught_up(worker, assignment):
    record_id, _ = create(worker, assignment)
    push(worker, "update", record_id, base=1, fields={"notes": "elsewhere"}, device=DEVICE_B)
    result = push(worker, "delete", record_id, base=2)
    assert result["status"] == "applied"


def test_a_status_change_alone_does_not_block_a_delete(worker, admin_user, assignment):
    """Returning a record changes its status, not its answers, so it is not 'newer work'."""
    record_id = submitted(worker, assignment)
    admin(admin_user, record_id, "return", reason="Redo")
    assert push(worker, "delete", record_id, base=1)["status"] == "applied"
