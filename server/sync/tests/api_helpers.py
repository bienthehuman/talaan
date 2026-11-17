"""Builders for the HTTP tests: JSON bodies and clients."""

import uuid

from rest_framework.test import APIClient

from sync.tests.helpers import DEVICE_A

SCHEMA_HEADER = {"HTTP_X_CLIENT_SCHEMA": "1"}
PUSH = "/api/sync/push/"
PULL = "/api/sync/pull/"


def api(user) -> APIClient:
    client = APIClient()
    client.force_authenticate(user)
    return client


def mut(op, record_id, *, base=1, fields=None, assignment_id=None, mutation_id=None) -> dict:
    """One mutation as the JSON the client sends."""
    body = {
        "mutation_id": str(mutation_id or uuid.uuid4()),
        "record_id": str(record_id),
        "op": op,
        "base_version": base,
        "fields": {} if fields is None else fields,
    }
    if assignment_id is not None:
        body["assignment_id"] = assignment_id
    return body


def create_mut(record_id, assignment, fields=None, **kwargs) -> dict:
    fields = {"oil_level": "ok"} if fields is None else fields
    return mut("create", record_id, base=0, fields=fields, assignment_id=assignment.id, **kwargs)


def push_body(*mutations, device=DEVICE_A, client_schema=1, **extra) -> dict:
    return {
        "device_id": str(device),
        "client_schema": client_schema,
        "mutations": list(mutations),
        **extra,
    }


def push(client, *mutations, **kwargs):
    headers = kwargs.pop("headers", {})
    return client.post(PUSH, push_body(*mutations, **kwargs), format="json", **headers)


def pull(client, **params):
    headers = params.pop("headers", SCHEMA_HEADER)
    return client.get(PULL, params, **headers)


def assert_problem(response, status, code):
    assert response.status_code == status, response.content
    assert response["Content-Type"].startswith("application/problem+json")
    body = response.json()
    assert (body["status"], body["code"]) == (status, code)
    assert {"type", "title", "status", "code", "detail"} <= set(body)
    return body
