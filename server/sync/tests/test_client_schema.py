"""Scenario 11: a client below the minimum protocol version gets 426 and keeps its local data
(docs/protocol.md section 2)."""

import uuid

import pytest

from submissions.models import Submission
from sync.models import AppliedMutation
from sync.tests.api_helpers import (
    PULL,
    PUSH,
    SCHEMA_HEADER,
    api,
    assert_problem,
    create_mut,
    push,
    push_body,
)

pytestmark = [pytest.mark.django_db, pytest.mark.phase1]


@pytest.fixture(autouse=True)
def minimum_is_two(settings):
    settings.MIN_CLIENT_SCHEMA = 2


def test_scenario_11_an_old_client_gets_426_and_nothing_is_applied(worker_client, assignment):
    response = push(worker_client, create_mut(uuid.uuid4(), assignment), client_schema=1)
    body = assert_problem(response, 426, "client_too_old")
    assert "Update the app" in body["detail"]
    assert (Submission.objects.count(), AppliedMutation.objects.count()) == (0, 0)


def test_the_minimum_itself_and_newer_versions_are_accepted(worker_client, assignment):
    for schema in (2, 3, 99):
        assert push(worker_client, client_schema=schema).status_code == 200


def test_an_old_client_whose_body_has_a_different_shape_still_gets_426(worker_client):
    """Validation must not hide the 426: an old client may send a body this server cannot parse."""
    response = worker_client.post(PUSH, {"client_schema": 1, "legacy": "shape"}, format="json")
    assert_problem(response, 426, "client_too_old")


def test_a_missing_or_invalid_client_schema_is_a_400(worker_client):
    body = push_body()
    del body["client_schema"]
    assert_problem(worker_client.post(PUSH, body, format="json"), 400, "client_schema_required")
    body["client_schema"] = "one"
    assert_problem(worker_client.post(PUSH, body, format="json"), 400, "client_schema_required")
    body["client_schema"] = True  # a boolean is not a version number
    assert_problem(worker_client.post(PUSH, body, format="json"), 400, "client_schema_required")


@pytest.mark.parametrize("url", [PULL, "/api/assignments/", "/api/form-versions/"])
def test_the_other_endpoints_check_the_header(worker_client, url):
    assert_problem(worker_client.get(url, HTTP_X_CLIENT_SCHEMA="1"), 426, "client_too_old")
    assert worker_client.get(url, HTTP_X_CLIENT_SCHEMA="2").status_code == 200
    assert_problem(worker_client.get(url), 400, "client_schema_required")


def test_authentication_comes_first_so_a_logged_out_client_learns_to_log_in(api_client):
    assert_problem(api_client.get(PULL, **SCHEMA_HEADER), 401, "unauthenticated")


def test_the_default_minimum_accepts_the_current_protocol(settings, worker):
    settings.MIN_CLIENT_SCHEMA = 1
    assert push(api(worker), client_schema=1).status_code == 200
