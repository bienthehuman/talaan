import io
import json
import logging
import uuid

import pytest

from core import logs
from sync.tests.api_helpers import SCHEMA_HEADER, create_mut, mut, push
from sync.tests.helpers import DEVICE_A

pytestmark = pytest.mark.django_db


@pytest.fixture
def log_lines():
    """Everything logged during a test, formatted by the project's own JSON formatter."""
    stream = io.StringIO()
    handler = logging.StreamHandler(stream)
    handler.setFormatter(logs.JsonFormatter())
    handler.addFilter(logs.ContextFilter())
    root = logging.getLogger()
    old_level = root.level
    root.addHandler(handler)
    root.setLevel(logging.INFO)

    def read() -> list[dict]:
        return [json.loads(line) for line in stream.getvalue().splitlines() if line]

    yield read
    root.removeHandler(handler)
    root.setLevel(old_level)


# --- the formatter ----------------------------------------------------------------------------


def record(**extra) -> logging.LogRecord:
    r = logging.LogRecord("talaan.test", logging.INFO, __file__, 1, "hello %s", ("world",), None)
    for key, value in extra.items():
        setattr(r, key, value)
    return r


def test_a_line_is_one_json_object_with_the_message_and_known_fields():
    entry = json.loads(logs.JsonFormatter().format(record(event="x", status=200, op="update")))
    assert entry["message"] == "hello world"
    assert (entry["level"], entry["logger"]) == ("INFO", "talaan.test")
    assert (entry["event"], entry["status"], entry["op"]) == ("x", 200, "update")
    assert entry["ts"].endswith("+00:00")


def test_only_allowlisted_fields_are_ever_written():
    entry = json.loads(
        logs.JsonFormatter().format(
            record(event="x", password="hunter2", token="abc", data={"notes": "private"}, fields={})
        )
    )
    assert not {"password", "token", "data", "fields"} & set(entry)
    assert "hunter2" not in json.dumps(entry)


def test_ids_are_written_as_strings():
    entry = json.loads(logs.JsonFormatter().format(record(mutation_id=uuid.UUID(int=7))))
    assert entry["mutation_id"] == str(uuid.UUID(int=7))


def test_an_exception_is_included_as_text():
    try:
        raise ValueError("boom")
    except ValueError:
        import sys

        r = logging.LogRecord("t", logging.ERROR, __file__, 1, "failed", (), sys.exc_info())
    assert "ValueError: boom" in json.loads(logs.JsonFormatter().format(r))["exception"]


def test_the_request_context_is_attached_to_any_log_line():
    logs.clear_context()
    logs.set_context(request_id="req-1", device_id=uuid.UUID(int=1))
    r = record()
    logs.ContextFilter().filter(r)
    entry = json.loads(logs.JsonFormatter().format(r))
    assert entry["request_id"] == "req-1" and entry["device_id"] == str(uuid.UUID(int=1))
    logs.clear_context()
    assert logs.get_context() == {}


# --- requests ---------------------------------------------------------------------------------


def test_every_request_gets_an_id_in_the_response_and_one_log_line(api_client, log_lines):
    response = api_client.get("/api/health/")
    request_id = response["X-Request-ID"]
    assert len(request_id) >= 8
    [line] = [e for e in log_lines() if e.get("event") == "request"]
    assert line["request_id"] == request_id
    assert (line["method"], line["path"], line["status"]) == ("GET", "/api/health/", 200)
    assert line["duration_ms"] >= 0


def test_a_supplied_request_id_is_kept_and_a_bad_one_is_replaced(api_client, log_lines):
    kept = api_client.get("/api/health/", HTTP_X_REQUEST_ID="trace-12345678")
    assert kept["X-Request-ID"] == "trace-12345678"
    for bad in ["short", "has spaces in it here", "x" * 80, "line\nbreak-injected"]:
        got = api_client.get("/api/health/", HTTP_X_REQUEST_ID=bad)["X-Request-ID"]
        assert got != bad and len(got) == 32


def test_the_query_string_is_never_logged(admin_client, log_lines):
    admin_client.get("/api/admin/submissions/", {"status": "submitted", "secret": "hunter2"})
    text = json.dumps(log_lines())
    assert "hunter2" not in text and "secret" not in text


def test_a_failing_request_is_logged_with_its_status(api_client, log_lines):
    api_client.get("/api/no/such/thing/")
    [line] = [e for e in log_lines() if e.get("event") == "request"]
    assert line["status"] == 404


# --- sync lines carry device_id and mutation_id -----------------------------------------------


def test_each_pushed_mutation_is_logged_with_its_ids_and_outcome(
    worker_client, assignment, log_lines
):
    record_id = uuid.uuid4()
    first = create_mut(record_id, assignment, {"notes": "SECRET-NOTE"})
    second = mut("update", record_id, base=1, fields={"notes": "OTHER-SECRET"})
    push(worker_client, first, second, device=DEVICE_A)

    lines = log_lines()
    mutations = [e for e in lines if e.get("event") == "mutation"]
    assert [(m["op"], m["status"]) for m in mutations] == [
        ("create", "applied"),
        ("update", "applied"),
    ]
    assert [m["mutation_id"] for m in mutations] == [first["mutation_id"], second["mutation_id"]]
    request_ids = {e["request_id"] for e in lines}
    assert len(request_ids) == 1  # the mutations and the request line share one id
    assert all(
        m["device_id"] == str(DEVICE_A) and m["record_id"] == str(record_id) for m in mutations
    )
    request_line = next(e for e in lines if e.get("event") == "request")
    assert request_line["device_id"] == str(DEVICE_A) and "user_id" in request_line


def test_conflicts_rejections_and_replays_are_logged_by_name(worker_client, assignment, log_lines):
    record_id = uuid.uuid4()
    push(worker_client, create_mut(record_id, assignment, {"notes": "a"}))
    push(worker_client, mut("update", record_id, base=1, fields={"notes": "b"}))
    stale = mut("update", record_id, base=1, fields={"notes": "c"})
    push(worker_client, stale)
    push(worker_client, stale)  # the same mutation again: a retry

    mutations = [e for e in log_lines() if e.get("event") == "mutation"]
    conflict = next(m for m in mutations if m["status"] == "conflict")
    assert conflict["kind"] == "field_conflict"
    assert [e for e in log_lines() if e.get("event") == "replay"][0]["mutation_id"] == stale[
        "mutation_id"
    ]


def test_no_token_no_password_and_no_form_data_reach_the_logs(
    api_client, worker, worker_client, assignment, log_lines
):
    api_client.post(
        "/api/auth/token/",
        {"username": worker.username, "password": "pw-for-tests-123"},
        format="json",
    )
    token = api_client.post(
        "/api/auth/token/",
        {"username": worker.username, "password": "pw-for-tests-123"},
        format="json",
    ).json()["access"]
    api_client.credentials(HTTP_AUTHORIZATION=f"Bearer {token}")
    record_id = uuid.uuid4()
    body = {
        "device_id": str(DEVICE_A),
        "client_schema": 1,
        "app_version": "x",
        "mutations": [create_mut(record_id, assignment, {"notes": "PRIVATE-ANSWER"})],
    }
    api_client.post("/api/sync/push/", body, format="json", **SCHEMA_HEADER)
    api_client.get("/api/sync/pull/", {"cursor": 0}, **SCHEMA_HEADER)

    text = json.dumps(log_lines())
    for secret in [token, "pw-for-tests-123", "PRIVATE-ANSWER", worker.username]:
        assert secret not in text
