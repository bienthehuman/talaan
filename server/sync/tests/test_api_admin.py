import uuid

import pytest

from submissions.models import Submission
from sync.tests.api_helpers import assert_problem, create_mut, push
from sync.tests.helpers import COMPLETE, create, row, submitted

pytestmark = pytest.mark.django_db


def url(record_id) -> str:
    return f"/api/admin/submissions/{record_id}/actions/"


def act(client, record_id, action, **body):
    return client.post(url(record_id), {"action": action, **body}, format="json")


# --- who may call it --------------------------------------------------------------------------


def test_a_logged_out_caller_gets_401(api_client, worker, assignment):
    record_id = submitted(worker, assignment)
    assert_problem(act(api_client, record_id, "approve"), 401, "unauthenticated")


def test_a_worker_gets_403_and_nothing_changes(worker_client, worker, assignment):
    record_id = submitted(worker, assignment)
    assert_problem(act(worker_client, record_id, "approve"), 403, "forbidden")
    assert row(record_id).status == "submitted"


# --- each action, over HTTP -------------------------------------------------------------------


def test_approve(admin_client, worker, assignment):
    record_id = submitted(worker, assignment)
    body = act(admin_client, record_id, "approve").json()
    assert body["status"] == "applied"
    assert (body["record"]["status"], body["record"]["version"]) == ("approved", 3)
    assert row(record_id).events.filter(kind="approved").count() == 1


def test_return_needs_a_reason(admin_client, worker, assignment):
    record_id = submitted(worker, assignment)
    refused = act(admin_client, record_id, "return").json()
    assert (refused["status"], refused["code"]) == ("rejected", "invalid")
    assert row(record_id).status == "submitted"
    ok = act(admin_client, record_id, "return", reason="Redo the oil check").json()
    assert ok["record"]["status"] == "returned"
    assert row(record_id).events.get(kind="returned").detail["reason"] == "Redo the oil check"


def test_delete_then_restore(admin_client, worker, assignment):
    record_id, _ = create(worker, assignment, COMPLETE)
    deleted = act(admin_client, record_id, "delete").json()
    assert (deleted["status"], deleted["record"]["deleted"]) == ("applied", True)
    assert row(record_id).deleted_at is not None
    restored = act(admin_client, record_id, "restore").json()
    assert (restored["record"]["deleted"], restored["record"]["version"]) == (False, 3)


def test_edit_changes_fields(admin_client, worker, assignment):
    record_id, _ = create(worker, assignment, COMPLETE)
    body = act(admin_client, record_id, "edit", fields={"hours_run": 999, "notes": None}).json()
    assert body["status"] == "applied"
    assert body["record"]["data"]["hours_run"] == 999
    assert row(record_id).events.filter(kind="admin_edited").count() == 1


# --- refusals are results, not errors ---------------------------------------------------------


def test_an_unknown_action_is_a_rejected_result(admin_client, worker, assignment):
    record_id = submitted(worker, assignment)
    body = act(admin_client, record_id, "explode").json()
    assert (body["status"], body["code"]) == ("rejected", "invalid")


def test_an_unknown_record_is_not_found(admin_client):
    body = act(admin_client, uuid.uuid4(), "delete").json()
    assert (body["status"], body["code"]) == ("rejected", "not_found")


def test_an_action_the_record_cannot_take_is_invalid_state(admin_client, worker, assignment):
    record_id, _ = create(worker, assignment, COMPLETE)  # a draft cannot be approved
    body = act(admin_client, record_id, "approve").json()
    assert (body["status"], body["code"]) == ("rejected", "invalid_state")


def test_an_edit_without_fields_is_refused(admin_client, worker, assignment):
    record_id, _ = create(worker, assignment, COMPLETE)
    body = act(admin_client, record_id, "edit").json()
    assert (body["status"], body["code"]) == ("rejected", "invalid")


def test_a_malformed_body_is_a_400_and_a_malformed_id_a_404(admin_client, worker, assignment):
    record_id = submitted(worker, assignment)
    assert_problem(admin_client.post(url(record_id), {}, format="json"), 400, "validation_error")
    assert_problem(
        admin_client.post(url(record_id), {"action": "edit", "fields": [1]}, format="json"),
        400,
        "validation_error",
    )
    assert admin_client.post("/api/admin/submissions/not-a-uuid/actions/", {}).status_code == 404


# --- it is the same write path ----------------------------------------------------------------


def test_the_worker_sees_the_admin_change_through_pull(admin_client, worker_client, assignment):
    record_id = uuid.uuid4()
    push(worker_client, create_mut(record_id, assignment, COMPLETE))
    act(admin_client, record_id, "delete")

    from sync.tests.api_helpers import pull

    records = pull(worker_client, cursor=0).json()["records"]
    mine = next(r for r in records if r["id"] == str(record_id))
    assert mine["deleted"] is True and mine["version"] == 2


def test_an_admin_action_leaves_a_ledger_row_under_the_admin_device(
    admin_client, admin_user, worker, assignment
):
    from sync.models import AppliedMutation
    from sync.services import ADMIN_DEVICE_ID

    record_id = submitted(worker, assignment)
    body = act(admin_client, record_id, "approve").json()
    ledger = AppliedMutation.objects.get(mutation_id=body["mutation_id"])
    assert (ledger.user_id, ledger.device_id) == (admin_user.id, ADMIN_DEVICE_ID)
    assert Submission.objects.get(pk=record_id).updated_by_id == admin_user.id


def test_a_worker_who_is_not_the_owner_cannot_use_it_either(
    other_worker_client, worker, assignment
):
    record_id = submitted(worker, assignment)
    assert_problem(act(other_worker_client, record_id, "approve"), 403, "forbidden")
