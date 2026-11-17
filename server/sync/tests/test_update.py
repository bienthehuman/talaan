import uuid

import pytest

from sync.tests.helpers import DEVICE_A, DEVICE_B, admin, create, push, row, submitted

pytestmark = pytest.mark.django_db


@pytest.fixture
def record(worker, assignment):
    record_id, _ = create(worker, assignment, {"oil_level": "ok", "notes": "start"})
    return record_id


def test_an_update_bumps_the_version_and_only_the_changed_fields(worker, record):
    result = push(worker, "update", record, base=1, fields={"oil_level": "low"})
    assert result["status"] == "applied"
    saved = result["record"]
    assert saved["version"] == 2
    assert saved["data"] == {"oil_level": "low", "notes": "start"}
    assert saved["field_versions"] == {"oil_level": 2, "notes": 1}  # notes was not touched


def test_server_seq_grows_with_every_applied_change(worker, record):
    first = row(record).server_seq
    push(worker, "update", record, base=1, fields={"notes": "a"})
    second = row(record).server_seq
    push(worker, "update", record, base=2, fields={"notes": "b"})
    assert first < second < row(record).server_seq


def test_edits_to_different_fields_from_two_devices_merge(worker, record):
    """Scenario 4: both applied, the server holds both values."""
    a = push(worker, "update", record, base=1, fields={"oil_level": "low"}, device=DEVICE_A)
    b = push(worker, "update", record, base=1, fields={"notes": "leak"}, device=DEVICE_B)
    assert (a["status"], b["status"]) == ("applied", "applied")
    final = row(record)
    assert final.data == {"oil_level": "low", "notes": "leak"}
    assert final.version == 3
    assert final.field_versions == {"oil_level": 2, "notes": 3}


def test_edits_to_the_same_field_conflict_and_nothing_is_overwritten(worker, record):
    """Scenario 5 (service half): the second writer gets a conflict and the first value stays."""
    push(worker, "update", record, base=1, fields={"oil_level": "low"}, device=DEVICE_A)
    result = push(worker, "update", record, base=1, fields={"oil_level": "empty"}, device=DEVICE_B)

    assert result["status"] == "conflict"
    assert result["conflict"]["kind"] == "field_conflict"
    assert result["conflict"]["fields"] == [
        {"field": "oil_level", "server_value": "low", "client_value": "empty", "server_version": 2}
    ]
    assert result["record"]["version"] == 2  # the current server copy, for the resolution screen
    assert row(record).data["oil_level"] == "low"
    assert row(record).version == 2


def test_a_conflict_applies_none_of_the_mutation(worker, record):
    """All or nothing: the clashing field blocks the non-clashing one too (ADR 0003)."""
    push(worker, "update", record, base=1, fields={"oil_level": "low"})
    result = push(
        worker, "update", record, base=1, fields={"oil_level": "empty", "notes": "changed"}
    )
    assert result["status"] == "conflict"
    assert [f["field"] for f in result["conflict"]["fields"]] == ["oil_level"]
    assert row(record).data["notes"] == "start"


def test_the_same_value_from_two_devices_is_not_a_conflict(worker, record):
    push(worker, "update", record, base=1, fields={"oil_level": "low"}, device=DEVICE_A)
    result = push(worker, "update", record, base=1, fields={"oil_level": "low"}, device=DEVICE_B)
    assert result["status"] == "applied"
    assert row(record).data["oil_level"] == "low"


def test_a_stale_base_is_fine_when_the_fields_were_not_touched(worker, record):
    push(worker, "update", record, base=1, fields={"notes": "a"})
    push(worker, "update", record, base=2, fields={"notes": "b"})
    result = push(worker, "update", record, base=1, fields={"oil_level": "empty"})  # long stale
    assert result["status"] == "applied"


def test_resolving_a_conflict_is_just_another_update(worker, record):
    push(worker, "update", record, base=1, fields={"oil_level": "low"})
    conflict = push(worker, "update", record, base=1, fields={"oil_level": "empty"})
    current = conflict["record"]["version"]
    resolved = push(worker, "update", record, base=current, fields={"oil_level": "empty"})
    assert resolved["status"] == "applied"
    assert row(record).data["oil_level"] == "empty"


def test_editing_a_record_an_admin_deleted_is_a_deleted_remotely_conflict(
    worker, admin_user, record
):
    """Scenario 6 (service half): the worker's edit is not applied; the worker decides."""
    admin(admin_user, record, "delete")
    result = push(worker, "update", record, base=1, fields={"oil_level": "low"})
    assert result["status"] == "conflict"
    assert result["conflict"]["kind"] == "deleted_remotely"
    assert result["record"]["deleted"] is True
    assert row(record).data["oil_level"] == "ok"


@pytest.mark.parametrize("action", ["approve", "stay_submitted"])
def test_a_locked_record_rejects_edits(worker, admin_user, assignment, action):
    """Scenario 10 (service half): approved and submitted records are locked to workers."""
    record_id = submitted(worker, assignment)
    if action == "approve":
        admin(admin_user, record_id, "approve")
    result = push(worker, "update", record_id, base=2, fields={"notes": "too late"})
    assert (result["status"], result["code"]) == ("rejected", "locked")
    assert result["record"]["status"] in {"approved", "submitted"}  # so the client can show why
    assert "notes" not in row(record_id).data


def test_a_returned_record_can_be_edited_again(worker, admin_user, assignment):
    record_id = submitted(worker, assignment)
    admin(admin_user, record_id, "return", reason="Photo of the gasket is missing")
    result = push(worker, "update", record_id, base=3, fields={"notes": "fixed"})
    assert result["status"] == "applied"
    assert result["record"]["status"] == "returned"


def test_unknown_and_foreign_records_look_the_same(worker, other_worker, assignment, record):
    unknown = push(worker, "update", uuid.uuid4(), base=1, fields={"notes": "x"})
    foreign = push(other_worker, "update", record, base=1, fields={"notes": "x"})
    for result in (unknown, foreign):
        assert (result["status"], result["code"]) == ("rejected", "not_found")
        assert "record" not in result
    assert row(record).data["notes"] == "start"


def test_an_admin_cannot_push_worker_mutations(admin_user, record):
    result = push(admin_user, "update", record, base=1, fields={"notes": "x"})
    assert (result["status"], result["code"]) == ("rejected", "forbidden")


@pytest.mark.parametrize(
    ("fields", "field", "code"),
    [
        ({"mystery": 1}, "mystery", "unknown_field"),
        ({"oil_level": "overflowing"}, "oil_level", "enum"),
        ({"hours_run": 1.5}, "hours_run", "type"),
    ],
)
def test_invalid_data_is_rejected_whole(worker, record, fields, field, code):
    result = push(worker, "update", record, base=1, fields={"notes": "fine", **fields})
    assert (result["status"], result["code"]) == ("rejected", "invalid")
    assert any(e["field"] == field and e["code"] == code for e in result["errors"])
    assert row(record).data == {"oil_level": "ok", "notes": "start"}  # nothing half-applied
    assert row(record).version == 1


def test_an_update_with_no_fields_is_rejected(worker, record):
    result = push(worker, "update", record, base=1, fields={})
    assert (result["status"], result["code"]) == ("rejected", "invalid")


@pytest.mark.parametrize("base", [-1, 7])
def test_a_base_version_the_record_never_had_is_rejected(worker, record, base):
    result = push(worker, "update", record, base=base, fields={"notes": "x"})
    assert (result["status"], result["code"]) == ("rejected", "invalid")
    assert "base_version" in result["detail"]


def test_a_draft_may_stay_incomplete(worker, record):
    result = push(worker, "update", record, base=1, fields={"notes": "still no hours or coolant"})
    assert result["status"] == "applied"  # `required` is only enforced on submit


def test_null_clears_a_field_and_the_clear_is_versioned(worker, record):
    result = push(worker, "update", record, base=1, fields={"notes": None})
    assert result["status"] == "applied"
    assert "notes" not in result["record"]["data"]
    assert (
        result["record"]["field_versions"]["notes"] == 2
    )  # still tracked, so conflicts are caught

    stale = push(worker, "update", record, base=1, fields={"notes": "typed on another device"})
    assert stale["status"] == "conflict"  # the clear happened after this device's base


def test_clearing_a_field_that_is_already_empty_is_not_a_conflict(worker, record):
    push(worker, "update", record, base=1, fields={"notes": None})
    again = push(worker, "update", record, base=1, fields={"notes": None})
    assert again["status"] == "applied"
