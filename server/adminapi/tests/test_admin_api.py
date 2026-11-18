import uuid

import pytest

from accounts.permissions import ADMIN, CATALOG, CONFLICTLOG_VIEW, ROLE_PERMISSIONS
from assignments.models import Assignment
from forms.models import Form, FormVersion
from forms.samples import GENERATOR_INSPECTION
from submissions.models import Submission
from sync.tests.helpers import COMPLETE, DEVICE_B, admin, create, push, row, submitted

pytestmark = pytest.mark.django_db

BASE = "/api/admin"


@pytest.fixture
def form(published_version) -> Form:
    return published_version.form


def get(client, path, **params):
    return client.get(f"{BASE}{path}", params)


def post(client, path, body=None):
    return client.post(f"{BASE}{path}", body or {}, format="json")


# --- who may call what ------------------------------------------------------------------------


def endpoints(record_id, assignment_id, form_id, version_id):
    return [
        ("get", "/submissions/"),
        ("get", f"/submissions/{record_id}/"),
        ("get", "/workers/"),
        ("get", "/assignments/"),
        ("post", "/assignments/"),
        ("post", f"/assignments/{assignment_id}/cancel/"),
        ("get", "/forms/"),
        ("post", "/forms/"),
        ("post", f"/forms/{form_id}/versions/"),
        ("post", "/forms/check-schema/"),
        ("get", f"/form-versions/{version_id}/"),
        ("get", "/conflicts/"),
    ]


def test_every_endpoint_needs_login_and_an_admin(
    api_client, worker_client, admin_client, worker, assignment, published_version
):
    record_id = submitted(worker, assignment)
    calls = endpoints(record_id, assignment.id, published_version.form_id, published_version.id)
    for method, path in calls:
        assert getattr(api_client, method)(f"{BASE}{path}").status_code == 401, path
        assert getattr(worker_client, method)(f"{BASE}{path}").status_code == 403, path
        # An admin gets past permissions (200, 201 or a 400 for the empty body, never 401 or 403).
        assert getattr(admin_client, method)(f"{BASE}{path}").status_code not in (401, 403), path


def test_the_permission_catalog_decides_not_the_role_name(
    admin_client, worker, assignment, monkeypatch
):
    submitted(worker, assignment)
    assert get(admin_client, "/conflicts/").status_code == 200
    monkeypatch.setitem(ROLE_PERMISSIONS, ADMIN, CATALOG - {CONFLICTLOG_VIEW})
    assert get(admin_client, "/conflicts/").status_code == 403
    assert get(admin_client, "/submissions/").status_code == 200  # other permissions unaffected


# --- review queue -----------------------------------------------------------------------------


def test_the_queue_lists_newest_change_first_with_who_and_what(
    admin_client, worker, other_worker, assignment, published_version
):
    first, _ = create(worker, assignment, COMPLETE)
    second = submitted(worker, assignment)
    body = get(admin_client, "/submissions/").json()
    assert body["count"] == 2
    assert [r["id"] for r in body["results"]] == [str(second), str(first)]
    top = body["results"][0]
    assert top["status"] == "submitted"
    assert top["site_name"] == "North plant"
    assert top["form_name"] == "Generator inspection"
    assert top["worker"] == {"id": worker.id, "username": worker.username}
    assert top["deleted"] is False and top["version"] == 2


def test_the_queue_filters_by_status_worker_assignment_and_deleted(
    admin_client, worker, other_worker, assignment, published_version
):
    other_assignment = Assignment.objects.create(
        form_version=published_version, worker=other_worker, site_name="Harbour"
    )
    mine = submitted(worker, assignment)
    draft, _ = create(worker, assignment, COMPLETE)
    theirs, _ = create(other_worker, other_assignment, COMPLETE)
    gone, _ = create(worker, assignment, COMPLETE)
    admin_user = admin_client.handler._force_user
    admin(admin_user, gone, "delete")

    def ids(**params):
        return {r["id"] for r in get(admin_client, "/submissions/", **params).json()["results"]}

    assert ids() == {str(mine), str(draft), str(theirs)}  # deleted hidden by default
    assert ids(status="submitted") == {str(mine)}
    assert ids(worker=other_worker.id) == {str(theirs)}
    assert ids(assignment=assignment.id) == {str(mine), str(draft)}
    assert ids(deleted="true") == {str(gone)}
    assert ids(deleted="any") == {str(mine), str(draft), str(theirs), str(gone)}
    assert ids(status="draft", worker=worker.id) == {str(draft)}


@pytest.mark.parametrize(
    "params", [{"status": "nope"}, {"deleted": "maybe"}, {"worker": "abc"}, {"assignment": "x"}]
)
def test_bad_filters_are_400_not_500(admin_client, params):
    assert get(admin_client, "/submissions/", **params).status_code == 400


def test_the_queue_is_paged(admin_client, worker, assignment):
    for _ in range(5):
        create(worker, assignment, COMPLETE)
    page = get(admin_client, "/submissions/", limit=2).json()
    assert (page["count"], len(page["results"])) == (5, 2)
    assert page["next"] is not None
    assert len(get(admin_client, "/submissions/", limit=2, offset=4).json()["results"]) == 1


def test_the_queue_does_not_query_per_row(
    admin_client, worker, assignment, django_assert_max_num_queries
):
    for _ in range(8):
        create(worker, assignment, COMPLETE)
    with django_assert_max_num_queries(6):
        assert get(admin_client, "/submissions/").json()["count"] == 8


def test_the_detail_has_data_schema_and_history_in_order(
    admin_client, admin_user, worker, assignment
):
    record_id = submitted(worker, assignment)
    admin(admin_user, record_id, "approve")
    body = get(admin_client, f"/submissions/{record_id}/").json()
    assert body["data"] == COMPLETE
    assert body["schema"]["title"] == "Generator inspection"
    assert body["status"] == "approved"
    kinds = [(e["kind"], e["actor"]["username"], e["version"]) for e in body["events"]]
    assert kinds == [
        ("created", worker.username, 1),
        ("submitted", worker.username, 2),
        ("approved", admin_user.username, 3),
    ]
    assert get(admin_client, f"/submissions/{uuid.uuid4()}/").status_code == 404


# --- assignments ------------------------------------------------------------------------------


def make_assignment(admin_client, version, worker, **extra):
    return post(
        admin_client,
        "/assignments/",
        {"form_version_id": version.id, "worker_id": worker.id, "site_name": "East yard", **extra},
    )


def test_an_assignment_can_be_created_and_the_worker_receives_it(
    admin_client, worker_client, worker, published_version
):
    response = make_assignment(admin_client, published_version, worker, due_date="2026-12-01")
    assert response.status_code == 201
    body = response.json()
    assert (body["site_name"], body["due_date"], body["cancelled"]) == (
        "East yard",
        "2026-12-01",
        False,
    )
    assert body["form_name"] == "Generator inspection" and body["submissions"] == 0
    mine = worker_client.get("/api/assignments/", HTTP_X_CLIENT_SCHEMA="1").json()["results"]
    assert [a["site_name"] for a in mine] == ["East yard"]


@pytest.mark.parametrize(
    ("change", "field"),
    [
        ({"form_version_id": 999999}, "form_version_id"),
        ({"worker_id": 999999}, "worker_id"),
        ({"site_name": "   "}, "site_name"),
    ],
)
def test_a_bad_assignment_is_a_field_error(admin_client, worker, published_version, change, field):
    body = {"form_version_id": published_version.id, "worker_id": worker.id, "site_name": "X"}
    response = post(admin_client, "/assignments/", {**body, **change})
    assert response.status_code == 400
    assert field in response.json()["errors"]
    assert Assignment.objects.count() == 0


def test_only_a_published_version_goes_to_a_worker_with_the_worker_role(
    admin_client, admin_user, worker, form
):
    draft = FormVersion.objects.create(form=form, schema=GENERATOR_INSPECTION)
    unpublished = make_assignment(admin_client, draft, worker)
    assert unpublished.status_code == 400 and "form_version" in unpublished.json()["errors"]
    published = FormVersion.objects.create(form=form, schema=GENERATOR_INSPECTION)
    published.publish()
    to_admin = make_assignment(admin_client, published, admin_user)
    assert to_admin.status_code == 400 and "worker" in to_admin.json()["errors"]


def test_assignments_filter_and_count_submissions(
    admin_client, worker, other_worker, assignment, published_version
):
    create(worker, assignment, COMPLETE)
    create(worker, assignment, COMPLETE)
    other = Assignment.objects.create(
        form_version=published_version, worker=other_worker, site_name="Z"
    )
    other.cancel()

    everything = get(admin_client, "/assignments/").json()["results"]
    assert {a["site_name"]: a["submissions"] for a in everything} == {"North plant": 2, "Z": 0}
    assert [
        a["site_name"]
        for a in get(admin_client, "/assignments/", cancelled="true").json()["results"]
    ] == ["Z"]
    assert [
        a["site_name"]
        for a in get(admin_client, "/assignments/", cancelled="false").json()["results"]
    ] == ["North plant"]
    assert [
        a["site_name"]
        for a in get(admin_client, "/assignments/", worker=worker.id).json()["results"]
    ] == ["North plant"]


def test_cancelling_keeps_the_submissions_and_a_second_cancel_changes_nothing(
    admin_client, worker, assignment
):
    record_id = submitted(worker, assignment)
    first = post(admin_client, f"/assignments/{assignment.id}/cancel/").json()
    assert first["cancelled"] is True
    stamp = Assignment.objects.get(pk=assignment.id).cancelled_at
    second = post(admin_client, f"/assignments/{assignment.id}/cancel/").json()
    assert second["cancelled"] is True
    assert Assignment.objects.get(pk=assignment.id).cancelled_at == stamp
    assert Submission.objects.filter(pk=record_id).exists()  # the work stays
    assert post(admin_client, "/assignments/99999/cancel/").status_code == 404


def test_a_cancelled_assignment_takes_no_new_inspections(admin_client, worker, assignment):
    post(admin_client, f"/assignments/{assignment.id}/cancel/")
    result = push(worker, "create", uuid.uuid4(), base=0, fields={}, assignment_id=assignment.id)
    assert (result["status"], result["code"]) == ("rejected", "invalid_state")


def test_only_active_workers_are_offered(admin_client, worker, other_worker, admin_user):
    other_worker.is_active = False
    other_worker.save()
    names = [w["username"] for w in get(admin_client, "/workers/").json()]
    assert names == [worker.username]


# --- forms ------------------------------------------------------------------------------------


def test_a_form_can_be_created_once_per_name(admin_client):
    created = post(admin_client, "/forms/", {"name": "Roof check"})
    assert created.status_code == 201 and created.json()["versions"] == []
    assert post(admin_client, "/forms/", {"name": "Roof check"}).status_code == 400
    assert post(admin_client, "/forms/", {"name": "  "}).status_code == 400


def test_publishing_a_version_numbers_it_and_makes_it_immutable(admin_client, form):
    before = FormVersion.objects.filter(form=form).count()
    response = post(admin_client, f"/forms/{form.id}/versions/", {"schema": GENERATOR_INSPECTION})
    assert response.status_code == 201
    body = response.json()
    assert body["number"] == before + 1 and body["published_at"] is not None
    assert body["schema"] == GENERATOR_INSPECTION and body["form_name"] == form.name
    version = FormVersion.objects.get(pk=body["id"])
    assert version.is_published
    version.schema = {**GENERATOR_INSPECTION, "title": "Changed"}
    with pytest.raises(Exception, match="published"):
        version.save()


def test_an_invalid_schema_is_refused_with_the_reasons_and_nothing_is_created(admin_client, form):
    before = FormVersion.objects.count()
    bad = {"type": "object", "properties": {"a": {"type": "array"}}}
    response = post(admin_client, f"/forms/{form.id}/versions/", {"schema": bad})
    assert response.status_code == 400
    assert response.json()["errors"]["schema"]  # a list of sentences
    assert FormVersion.objects.count() == before
    assert post(admin_client, "/forms/99999/versions/", {"schema": bad}).status_code == 404


def test_the_forms_list_shows_versions_and_a_version_shows_its_schema(
    admin_client, form, published_version
):
    listed = get(admin_client, "/forms/").json()["results"]
    entry = next(f for f in listed if f["id"] == form.id)
    assert [v["number"] for v in entry["versions"]] == [1]
    detail = get(admin_client, f"/form-versions/{published_version.id}/").json()
    assert detail["schema"] == GENERATOR_INSPECTION and detail["number"] == 1


def test_checking_a_schema_reports_problems_without_saving(admin_client):
    before = FormVersion.objects.count()
    ok = post(admin_client, "/forms/check-schema/", {"schema": GENERATOR_INSPECTION}).json()
    assert ok == {"valid": True, "errors": []}
    bad = post(admin_client, "/forms/check-schema/", {"schema": {"type": "string"}}).json()
    assert bad["valid"] is False and bad["errors"]
    assert FormVersion.objects.count() == before


# --- conflict log -----------------------------------------------------------------------------


def two_device_conflict(worker, assignment):
    record_id, _ = create(worker, assignment, {"notes": "start"})
    push(worker, "update", record_id, base=1, fields={"notes": "A"})
    return record_id, push(
        worker, "update", record_id, base=1, fields={"notes": "B"}, device=DEVICE_B
    )


def test_a_conflict_is_logged_with_what_clashed_and_who(admin_client, worker, assignment):
    record_id, result = two_device_conflict(worker, assignment)
    assert result["status"] == "conflict"
    [entry] = get(admin_client, "/conflicts/").json()["results"]
    assert entry["kind"] == "conflict" and entry["reason"] == "field_conflict"
    assert entry["fields"] == ["notes"]
    assert entry["submission_id"] == str(record_id)
    assert entry["worker"]["username"] == worker.username
    assert entry["site_name"] == "North plant" and entry["form_name"] == "Generator inspection"
    assert entry["mutation_id"] == result["mutation_id"]
    assert entry["changed_since"] is False


def test_the_log_says_when_the_worker_has_changed_the_record_since(
    admin_client, worker, assignment
):
    record_id, _ = two_device_conflict(worker, assignment)
    assert get(admin_client, "/conflicts/").json()["results"][0]["changed_since"] is False
    push(worker, "update", record_id, base=2, fields={"notes": "B, resolved"})
    assert get(admin_client, "/conflicts/").json()["results"][0]["changed_since"] is True
    only_open = get(admin_client, "/conflicts/", changed_since="false").json()["results"]
    assert only_open == []


def test_a_change_by_someone_else_does_not_count_as_the_worker_resolving_it(
    admin_client, admin_user, worker, assignment
):
    record_id, _ = two_device_conflict(worker, assignment)
    admin(admin_user, record_id, "delete")  # an admin acts; the worker has not
    assert get(admin_client, "/conflicts/").json()["results"][0]["changed_since"] is False


def test_rejections_are_logged_and_admin_refusals_are_not(
    admin_client, admin_user, worker, assignment
):
    record_id = submitted(worker, assignment)
    admin(admin_user, record_id, "approve")
    push(worker, "update", record_id, base=3, fields={"notes": "late"})  # locked
    draft, _ = create(worker, assignment, COMPLETE)
    admin(
        admin_user, draft, "approve"
    )  # refused: a draft cannot be approved (an admin's own event)

    [entry] = get(admin_client, "/conflicts/").json()["results"]
    assert (entry["kind"], entry["reason"]) == ("rejected", "locked")
    assert row(draft).events.filter(kind="rejected").count() == 1  # it exists, just not in the log


def test_the_log_filters_pages_and_rejects_bad_filters(
    admin_client, worker, other_worker, assignment, published_version
):
    two_device_conflict(worker, assignment)
    record_id = submitted(worker, assignment)
    push(worker, "update", record_id, base=2, fields={"notes": "x"})  # locked: submitted
    assert get(admin_client, "/conflicts/").json()["count"] == 2
    assert [
        e["kind"] for e in get(admin_client, "/conflicts/", kind="rejected").json()["results"]
    ] == ["rejected"]
    assert get(admin_client, "/conflicts/", worker=other_worker.id).json()["count"] == 0
    assert get(admin_client, "/conflicts/", limit=1).json()["next"] is not None
    assert get(admin_client, "/conflicts/", kind="nope").status_code == 400
    # newest first
    kinds = [e["kind"] for e in get(admin_client, "/conflicts/").json()["results"]]
    assert kinds == ["rejected", "conflict"]
