import uuid

import pytest

from assignments.models import Assignment
from sync.tests.api_helpers import SCHEMA_HEADER, api, assert_problem, create_mut, pull, push
from sync.tests.helpers import admin, create
from sync.tests.helpers import push as service_push

pytestmark = pytest.mark.django_db

PAGE_KEYS = {"records", "next_cursor", "has_more"}


def make_records(user, assignment, count):
    return [create(user, assignment, {"notes": f"n{i}"})[0] for i in range(count)]


def test_login_and_role_are_required(api_client, worker_client, db):
    assert_problem(pull(api_client), 401, "unauthenticated")
    from accounts.models import User

    nobody = User.objects.create_user("nobody", password="pw-for-tests-123")
    assert_problem(pull(api(nobody)), 403, "forbidden")


def test_a_fresh_worker_gets_an_empty_page(worker_client):
    body = pull(worker_client).json()
    assert set(body) == PAGE_KEYS
    assert body == {"records": [], "next_cursor": 0, "has_more": False}


def test_records_come_back_ordered_by_server_seq_with_the_protocol_shape(
    worker_client, worker, assignment
):
    ids = make_records(worker, assignment, 3)
    body = pull(worker_client).json()
    assert [r["id"] for r in body["records"]] == [str(i) for i in ids]
    seqs = [r["server_seq"] for r in body["records"]]
    assert seqs == sorted(seqs)
    assert body["next_cursor"] == seqs[-1] and body["has_more"] is False
    assert set(body["records"][0]) == {
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


def test_only_records_after_the_cursor_are_returned(worker_client, worker, assignment):
    make_records(worker, assignment, 4)
    everything = pull(worker_client).json()["records"]
    cursor = everything[1]["server_seq"]
    after = pull(worker_client, cursor=cursor).json()
    assert [r["id"] for r in after["records"]] == [r["id"] for r in everything[2:]]


def test_an_exhausted_cursor_returns_nothing_and_keeps_the_cursor(
    worker_client, worker, assignment
):
    make_records(worker, assignment, 2)
    last = pull(worker_client).json()["next_cursor"]
    assert pull(worker_client, cursor=last).json() == {
        "records": [],
        "next_cursor": last,
        "has_more": False,
    }


def test_paging_walks_every_record_exactly_once(worker_client, worker, assignment):
    ids = make_records(worker, assignment, 7)
    seen, cursor, pages = [], 0, 0
    while True:
        page = pull(worker_client, cursor=cursor, limit=3).json()
        pages += 1
        seen += [r["id"] for r in page["records"]]
        cursor = page["next_cursor"]
        if not page["has_more"]:
            break
    assert seen == [str(i) for i in ids]
    assert pages == 3  # 3 + 3 + 1


def test_has_more_is_false_when_the_last_page_is_exactly_full(worker_client, worker, assignment):
    make_records(worker, assignment, 3)
    page = pull(worker_client, limit=3).json()
    assert (len(page["records"]), page["has_more"]) == (3, False)
    assert pull(worker_client, limit=2).json()["has_more"] is True


@pytest.mark.parametrize(
    "params", [{"cursor": "x"}, {"cursor": "-1"}, {"limit": "0"}, {"limit": "abc"}, {"limit": "-5"}]
)
def test_bad_cursor_or_limit_is_a_400(worker_client, params):
    body = assert_problem(pull(worker_client, **params), 400, "validation_error")
    assert set(body["errors"]) <= {"cursor", "limit"}


def test_updates_and_tombstones_are_in_the_feed(worker_client, worker, assignment, admin_user):
    keep, drop = make_records(worker, assignment, 2)
    cursor = pull(worker_client).json()["next_cursor"]

    service_push(worker, "update", keep, base=1, fields={"notes": "edited"})
    admin(admin_user, drop, "delete")

    changes = {r["id"]: r for r in pull(worker_client, cursor=cursor).json()["records"]}
    assert changes[str(keep)]["version"] == 2 and changes[str(keep)]["data"]["notes"] == "edited"
    assert changes[str(drop)]["deleted"] is True  # the tombstone reaches the device through pull


def test_a_record_pulled_twice_is_the_same_record(worker_client, worker, assignment):
    """At-least-once: re-pulling from an old cursor repeats records, unchanged."""
    make_records(worker, assignment, 2)
    assert pull(worker_client).json() == pull(worker_client).json()


def test_a_worker_never_sees_another_workers_records(
    worker_client, other_worker_client, worker, other_worker, assignment, published_version
):
    mine = make_records(worker, assignment, 2)
    theirs_assignment = Assignment.objects.create(
        form_version=published_version, worker=other_worker, site_name="Theirs"
    )
    theirs = make_records(other_worker, theirs_assignment, 2)

    assert {r["id"] for r in pull(worker_client).json()["records"]} == {str(i) for i in mine}
    assert {r["id"] for r in pull(other_worker_client).json()["records"]} == {
        str(i) for i in theirs
    }


def test_an_admin_sees_everything(
    admin_client, worker, other_worker, assignment, published_version
):
    other = Assignment.objects.create(
        form_version=published_version, worker=other_worker, site_name="Theirs"
    )
    ids = make_records(worker, assignment, 1) + make_records(other_worker, other, 1)
    assert {r["id"] for r in pull(admin_client).json()["records"]} == {str(i) for i in ids}


def test_records_stay_visible_after_their_assignment_is_cancelled(
    worker_client, worker, assignment
):
    make_records(worker, assignment, 1)
    assignment.cancel()
    assert len(pull(worker_client).json()["records"]) == 1


def test_what_push_returns_is_what_pull_returns(worker_client, assignment):
    record_id = uuid.uuid4()
    pushed = push(worker_client, create_mut(record_id, assignment)).json()["results"][0]["record"]
    pulled = pull(worker_client).json()["records"][0]
    assert pulled == pushed


def test_pull_needs_the_client_schema_header(worker_client):
    assert_problem(worker_client.get("/api/sync/pull/"), 400, "client_schema_required")
    assert pull(worker_client, headers=SCHEMA_HEADER).status_code == 200


def test_the_page_size_defaults_and_is_clamped(worker_client, worker, assignment, monkeypatch):
    from sync import views

    make_records(worker, assignment, 5)
    monkeypatch.setattr(views, "DEFAULT_PULL_LIMIT", 2)
    monkeypatch.setattr(views, "MAX_PULL_LIMIT", 3)

    default = pull(worker_client).json()
    assert (len(default["records"]), default["has_more"]) == (2, True)

    clamped = pull(worker_client, limit=1000).json()
    assert (len(clamped["records"]), clamped["has_more"]) == (3, True)  # never more than the max
