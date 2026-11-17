import pytest
from django.db import connection


@pytest.mark.django_db
def test_health_ok_without_auth(client):
    response = client.get("/api/health/")
    assert response.status_code == 200
    assert response.json() == {"status": "ok", "database": "ok"}


@pytest.mark.django_db
def test_health_is_503_problem_when_database_is_down(client, monkeypatch):
    def boom(*args, **kwargs):
        raise RuntimeError("db down")

    monkeypatch.setattr(connection, "cursor", boom)
    response = client.get("/api/health/")
    assert response.status_code == 503
    assert response["Content-Type"].startswith("application/problem+json")
    assert response.json()["code"] == "database_unavailable"


def test_openapi_schema_is_served(client):
    response = client.get("/api/schema/")
    assert response.status_code == 200
    body = response.content.decode()
    assert "/api/health/" in body
    assert "/api/auth/token/" in body


def test_docs_page_loads_with_relaxed_csp_only_on_that_page(client):
    docs = client.get("/api/docs/")
    assert docs.status_code == 200
    assert "'unsafe-inline'" in docs["Content-Security-Policy"]

    other = client.get("/api/health/")
    assert "'unsafe-inline'" not in other["Content-Security-Policy"]
