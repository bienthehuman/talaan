import uuid

import pytest
from django.contrib.auth.models import Group
from django.db.models import Count

from accounts.models import User
from submissions.models import Submission
from sync.models import AppliedMutation, Device
from sync.tests.api_helpers import PUSH, api, assert_problem, create_mut, mut, push
from sync.tests.helpers import DEVICE_A, DEVICE_B, admin, create, row

pytestmark = pytest.mark.django_db

RECORD_KEYS = {
    "id",
    "assignment_id",
    "form_version_id",
    "version",
    "field_versions",
    "data",
    "status",
    "deleted",
    "server_seq",
}


def test_login_is_required(api_client, assignment):
    response = push(api_client, create_mut(uuid.uuid4(), assignment))
    assert_problem(response, 401, "unauthenticated")


def test_admins_and_users_without_a_role_cannot_push(admin_client, assignment, db):
    assert_problem(push(admin_client, create_mut(uuid.uuid4(), assignment)), 403, "forbidden")
    nobody = User.objects.create_user("nobody", password="pw-for-tests-123")
    assert_problem(push(api(nobody), create_mut(uuid.uuid4(), assignment)), 403, "forbidden")


def test_a_real_login_token_works_end_to_end(api_client, worker, assignment):
    token = api_client.post(
        "/api/auth/token/", {"username": "worker1", "password": "pw-for-tests-123"}
    ).json()["access"]
    api_client.credentials(HTTP_AUTHORIZATION=f"Bearer {token}")
    response = push(api_client, create_mut(uuid.uuid4(), assignment))
    assert response.status_code == 200
    assert response.json()["results"][0]["status"] == "applied"


def test_one_result_per_mutation_in_order(worker_client, assignment):
    ids = [uuid.uuid4() for _ in range(3)]
    mutations = [create_mut(i, assignment) for i in ids]
    response = push(worker_client, *mutations)
    assert response.status_code == 200
    results = response.json()["results"]
    assert [r["mutation_id"] for r in results] == [m["mutation_id"] for m in mutations]
    assert [r["status"] for r in results] == ["applied"] * 3
    assert [r["record"]["id"] for r in results] == [str(i) for i in ids]


def test_later_mutations_in_a_batch_see_the_earlier_ones(worker_client, assignment):
    record_id = uuid.uuid4()
    response = push(
        worker_client,
        create_mut(record_id, assignment),
        mut("update", record_id, base=1, fields={"notes": "same batch"}),
        mut("submit", record_id, base=2, fields={"coolant_ok": True, "hours_run": 3}),
    )
    assert [r["status"] for r in response.json()["results"]] == ["applied"] * 3
    assert row(record_id).status == "submitted"
    assert row(record_id).version == 3


def test_one_bad_mutation_does_not_roll_back_the_others(worker_client, assignment):
    good1, bad, good2 = uuid.uuid4(), uuid.uuid4(), uuid.uuid4()
    response = push(
        worker_client,
        create_mut(good1, assignment),
        create_mut(bad, assignment, {"mystery": 1}),
        create_mut(good2, assignment),
    )
    results = response.json()["results"]
    assert [r["status"] for r in results] == ["applied", "rejected", "applied"]
    assert Submission.objects.filter(pk__in=[good1, good2]).count() == 2
    assert not Submission.objects.filter(pk=bad).exists()


def test_an_unknown_op_is_a_rejected_result_not_a_failed_request(worker_client, assignment):
    response = push(
        worker_client, mut("teleport", uuid.uuid4()), create_mut(uuid.uuid4(), assignment)
    )
    assert response.status_code == 200
    first, second = response.json()["results"]
    assert (first["status"], first["code"]) == ("rejected", "invalid")
    assert second["status"] == "applied"


# --- contract: the response shapes in protocol.md -----------------------------------------------


def test_applied_result_shape(worker_client, assignment):
    result = push(worker_client, create_mut(uuid.uuid4(), assignment)).json()["results"][0]
    assert set(result) == {"mutation_id", "status", "record"}
    assert set(result["record"]) == RECORD_KEYS


def test_conflict_result_shape(worker_client, assignment, worker):
    record_id, _ = create(worker, assignment)
    push(worker_client, mut("update", record_id, base=1, fields={"oil_level": "low"}))
    result = push(
        worker_client, mut("update", record_id, base=1, fields={"oil_level": "empty"})
    ).json()["results"][0]
    assert set(result) == {"mutation_id", "status", "conflict", "record"}
    assert set(result["conflict"]) == {"kind", "fields"}
    assert result["conflict"]["fields"] == [
        {"field": "oil_level", "server_value": "low", "client_value": "empty", "server_version": 2}
    ]
    assert set(result["record"]) == RECORD_KEYS


def test_rejected_result_shapes(worker_client, assignment, worker):
    record_id, _ = create(worker, assignment)
    invalid = push(
        worker_client, mut("update", record_id, base=1, fields={"hours_run": "x"})
    ).json()["results"][0]
    assert set(invalid) == {"mutation_id", "status", "code", "detail", "errors", "record"}
    assert invalid["errors"][0] == {
        "field": "hours_run",
        "code": "type",
        "message": "Must be a integer.",
    }

    missing = push(worker_client, mut("update", uuid.uuid4(), fields={"notes": "x"})).json()[
        "results"
    ][0]
    assert set(missing) == {"mutation_id", "status", "code", "detail"}  # nothing is revealed
    assert (missing["status"], missing["code"]) == ("rejected", "not_found")


def test_another_workers_record_is_not_found_over_http(
    worker_client, other_worker_client, assignment, worker
):
    record_id, _ = create(worker, assignment)
    result = push(other_worker_client, mut("update", record_id, fields={"notes": "x"})).json()[
        "results"
    ][0]
    assert result["code"] == "not_found"
    assert row(record_id).data == {"oil_level": "ok"}


# --- batch limits and malformed bodies ---------------------------------------------------------


def test_fifty_mutations_are_accepted(worker_client, assignment):
    response = push(worker_client, *[create_mut(uuid.uuid4(), assignment, {}) for _ in range(50)])
    assert response.status_code == 200
    assert len(response.json()["results"]) == 50


def test_more_than_fifty_is_refused_whole(worker_client, assignment):
    response = push(worker_client, *[create_mut(uuid.uuid4(), assignment, {}) for _ in range(51)])
    assert_problem(response, 400, "batch_too_large")
    assert Submission.objects.count() == 0
    assert AppliedMutation.objects.count() == 0


def test_an_empty_batch_is_fine(worker_client):
    response = push(worker_client)
    assert (response.status_code, response.json()) == (200, {"results": []})


@pytest.mark.parametrize(
    "body",
    [
        {},
        {"client_schema": 1, "mutations": []},  # no device_id
        {"client_schema": 1, "device_id": "not-a-uuid", "mutations": []},
        {"client_schema": 1, "device_id": str(DEVICE_A), "mutations": "nope"},
        {"client_schema": 1, "device_id": str(DEVICE_A), "mutations": [{"op": "update"}]},
        {
            "client_schema": 1,
            "device_id": str(DEVICE_A),
            "mutations": [{**mut("update", uuid.uuid4()), "mutation_id": "bad"}],
        },
        {
            "client_schema": 1,
            "device_id": str(DEVICE_A),
            "mutations": [{**mut("update", uuid.uuid4()), "base_version": -1}],
        },
        {
            "client_schema": 1,
            "device_id": str(DEVICE_A),
            "mutations": [{**mut("update", uuid.uuid4()), "fields": [1, 2]}],
        },
    ],
)
def test_malformed_bodies_are_a_400_and_apply_nothing(worker_client, body):
    response = worker_client.post(PUSH, body, format="json")
    assert response.status_code in {400}, response.content
    assert response.json()["code"] in {"validation_error", "client_schema_required"}
    assert AppliedMutation.objects.count() == 0


# --- retries and devices ----------------------------------------------------------------------


def test_sending_the_same_body_twice_changes_nothing_the_second_time(worker_client, assignment):
    record_id = uuid.uuid4()
    batch = [
        create_mut(record_id, assignment),
        mut("update", record_id, base=1, fields={"notes": "a"}),
    ]
    first = push(worker_client, *batch).json()
    again = push(worker_client, *batch).json()
    assert again == first
    assert row(record_id).version == 2
    assert Submission.objects.filter(pk=record_id).count() == 1
    assert (
        AppliedMutation.objects.values("mutation_id")
        .annotate(n=Count("pk"))
        .filter(n__gt=1)
        .count()
        == 0
    )


def test_the_first_push_registers_the_device(worker_client, worker):
    push(worker_client, app_version="web-1.2.3")
    device = Device.objects.get(pk=DEVICE_A)
    assert (device.user_id, device.app_version) == (worker.id, "web-1.2.3")


def test_later_pushes_refresh_the_device(worker_client):
    push(worker_client, app_version="1")
    first = Device.objects.get(pk=DEVICE_A).last_seen_at
    push(worker_client, app_version="2")
    device = Device.objects.get(pk=DEVICE_A)
    assert device.app_version == "2"
    assert device.last_seen_at >= first
    assert Device.objects.count() == 1


def test_a_shared_browser_moves_the_device_to_whoever_synced_last(
    worker_client, other_worker_client, worker, other_worker
):
    push(worker_client)
    push(other_worker_client)
    assert Device.objects.get(pk=DEVICE_A).user_id == other_worker.id


def test_two_devices_are_two_rows(worker_client):
    push(worker_client, device=DEVICE_A)
    push(worker_client, device=DEVICE_B)
    assert Device.objects.count() == 2


def test_admin_actions_are_visible_to_a_later_push(worker_client, admin_user, assignment, worker):
    """An admin deletes while the worker is offline; the worker's next push gets the conflict."""
    record_id, _ = create(worker, assignment)
    admin(admin_user, record_id, "delete")
    result = push(worker_client, mut("update", record_id, fields={"notes": "x"})).json()["results"][
        0
    ]
    assert (result["status"], result["conflict"]["kind"]) == ("conflict", "deleted_remotely")


def test_the_push_rate_is_limited_per_user(worker_client, other_worker_client, monkeypatch):
    from rest_framework.throttling import ScopedRateThrottle

    monkeypatch.setitem(ScopedRateThrottle.THROTTLE_RATES, "push", "2/min")
    assert push(worker_client).status_code == 200
    assert push(worker_client).status_code == 200
    limited = push(worker_client)
    body = assert_problem(limited, 429, "rate_limited")
    assert int(limited["Retry-After"]) >= 1 and body["retry_after"] >= 1
    assert push(other_worker_client).status_code == 200  # another user has their own allowance


def test_group_membership_decides_the_role_not_a_flag(worker_client, assignment, worker):
    worker.groups.clear()
    assert_problem(push(worker_client, create_mut(uuid.uuid4(), assignment)), 403, "forbidden")
    worker.groups.add(Group.objects.get(name="worker"))
    assert push(worker_client, create_mut(uuid.uuid4(), assignment)).status_code == 200
