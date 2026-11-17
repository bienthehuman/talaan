import datetime

import pytest

from accounts.models import User
from assignments.models import Assignment
from forms.models import Form, FormVersion
from forms.samples import GENERATOR_INSPECTION
from sync.tests.api_helpers import SCHEMA_HEADER, api, assert_problem

pytestmark = pytest.mark.django_db

ASSIGNMENTS = "/api/assignments/"
VERSIONS = "/api/form-versions/"


def get(client, url, headers=SCHEMA_HEADER):
    return client.get(url, **headers)


@pytest.mark.parametrize("url", [ASSIGNMENTS, VERSIONS])
def test_login_role_and_schema_header_are_required(url, api_client, worker_client, db):
    assert_problem(get(api_client, url), 401, "unauthenticated")
    nobody = User.objects.create_user("nobody", password="pw-for-tests-123")
    assert_problem(get(api(nobody), url), 403, "forbidden")
    assert_problem(worker_client.get(url), 400, "client_schema_required")
    assert_problem(
        get(worker_client, url, {"HTTP_X_CLIENT_SCHEMA": "abc"}), 400, "client_schema_required"
    )


def test_a_worker_gets_their_assignments_in_the_protocol_shape(worker_client, assignment):
    assignment.due_date = datetime.date(2026, 12, 1)
    assignment.save()
    results = get(worker_client, ASSIGNMENTS).json()["results"]
    assert results == [
        {
            "id": assignment.id,
            "form_version_id": assignment.form_version_id,
            "form_name": "Generator inspection",
            "site_name": "North plant",
            "due_date": "2026-12-01",
            "cancelled": False,
        }
    ]


def test_cancelled_assignments_are_marked_not_hidden(worker_client, assignment):
    assignment.cancel()
    assert get(worker_client, ASSIGNMENTS).json()["results"][0]["cancelled"] is True


def test_a_worker_sees_only_their_own_assignments(
    worker_client, other_worker_client, assignment, other_worker, published_version
):
    theirs = Assignment.objects.create(
        form_version=published_version, worker=other_worker, site_name="Theirs"
    )
    assert [a["id"] for a in get(worker_client, ASSIGNMENTS).json()["results"]] == [assignment.id]
    assert [a["id"] for a in get(other_worker_client, ASSIGNMENTS).json()["results"]] == [theirs.id]


def test_an_admin_sees_every_assignment(admin_client, assignment, other_worker, published_version):
    Assignment.objects.create(form_version=published_version, worker=other_worker, site_name="B")
    assert len(get(admin_client, ASSIGNMENTS).json()["results"]) == 2


def test_the_form_versions_a_worker_needs_come_with_their_schema(
    worker_client, assignment, published_version
):
    results = get(worker_client, VERSIONS).json()["results"]
    assert len(results) == 1
    version = results[0]
    assert set(version) == {"id", "form_id", "form_name", "number", "schema", "published_at"}
    assert (version["id"], version["number"]) == (published_version.id, 1)
    assert version["schema"] == GENERATOR_INSPECTION  # exactly what validates on the server


def test_a_worker_only_gets_versions_they_have_an_assignment_for(
    worker_client, assignment, published_version
):
    other_form = Form.objects.create(name="Unrelated")
    unrelated = FormVersion.objects.create(form=other_form, schema=GENERATOR_INSPECTION)
    unrelated.publish()
    ids = [v["id"] for v in get(worker_client, VERSIONS).json()["results"]]
    assert ids == [published_version.id]


def test_drafts_are_never_listed(admin_client, published_version):
    draft = FormVersion.objects.create(form=published_version.form, schema=GENERATOR_INSPECTION)
    ids = [v["id"] for v in get(admin_client, VERSIONS).json()["results"]]
    assert draft.id not in ids and published_version.id in ids


def test_an_old_version_stays_listed_while_a_newer_one_is_published(
    worker_client, assignment, published_version
):
    newer = FormVersion.objects.create(form=published_version.form, schema=GENERATOR_INSPECTION)
    newer.publish()
    ids = {v["id"] for v in get(worker_client, VERSIONS).json()["results"]}
    assert published_version.id in ids  # the worker's submissions stay pinned to it
