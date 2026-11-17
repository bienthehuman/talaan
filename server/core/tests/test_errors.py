import pytest
from django.test import Client, override_settings

PROBLEM = "application/problem+json"


def assert_problem(response, status, code):
    assert response.status_code == status
    assert response["Content-Type"].startswith(PROBLEM)
    body = response.json()
    assert body["status"] == status
    assert body["code"] == code
    assert body["type"] == "about:blank"
    assert body["title"]
    assert body["detail"]
    return body


def test_unauthenticated_is_problem_json(api_client):
    response = api_client.get("/api/me/")
    assert_problem(response, 401, "unauthenticated")


@pytest.mark.django_db
def test_bad_credentials_are_401_problem(api_client):
    response = api_client.post("/api/auth/token/", {"username": "x", "password": "y"})
    assert_problem(response, 401, "unauthenticated")


def test_validation_error_lists_field_errors(api_client):
    response = api_client.post("/api/auth/token/", {})
    body = assert_problem(response, 400, "validation_error")
    assert "username" in body["errors"]
    assert "password" in body["errors"]


def test_method_not_allowed_is_problem(api_client):
    response = api_client.post("/api/health/")
    assert_problem(response, 405, "method_not_allowed")


def test_unknown_api_path_is_problem_404():
    response = Client().get("/api/nope/")
    assert_problem(response, 404, "not_found")


@override_settings(ROOT_URLCONF="core.tests.urls_boom")
def test_unhandled_exception_in_api_is_problem_500():
    response = Client(raise_request_exception=False).get("/api/boom/")
    assert_problem(response, 500, "server_error")


@override_settings(ROOT_URLCONF="core.tests.urls_boom")
def test_server_error_does_not_leak_details():
    response = Client(raise_request_exception=False).get("/api/boom/")
    assert "kaboom" not in response.content.decode()


@pytest.mark.django_db
def test_login_is_rate_limited(api_client, worker):
    # settings_test sets the login rate to 5/min
    for _ in range(5):
        api_client.post("/api/auth/token/", {"username": "worker1", "password": "wrong"})
    response = api_client.post("/api/auth/token/", {"username": "worker1", "password": "wrong"})
    body = assert_problem(response, 429, "rate_limited")
    assert int(response["Retry-After"]) >= 1
    assert body["retry_after"] >= 1
