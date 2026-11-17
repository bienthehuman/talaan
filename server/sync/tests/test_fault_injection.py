import time
import uuid

import pytest
from django.core.exceptions import ImproperlyConfigured

from submissions.models import Submission
from sync import middleware
from sync.faults import MAX_DELAY_MS, Fault, parse_faults
from sync.middleware import FaultInjectionMiddleware
from sync.tests.api_helpers import SCHEMA_HEADER, api, assert_problem, create_mut, mut, pull, push
from sync.tests.helpers import row

pytestmark = pytest.mark.django_db


def fault(value):
    return {"HTTP_X_FAULT": value}


# --- parsing --------------------------------------------------------------------------------


def test_faults_parse_with_and_without_values():
    assert parse_faults("fail-before") == [Fault("fail-before")]
    assert parse_faults("delay=250") == [Fault("delay", 250)]
    assert parse_faults("expire-token") == [Fault("expire-token")]
    assert parse_faults("expire-token=2") == [Fault("expire-token", 2)]
    assert parse_faults("delay=50, drop-after-commit") == [
        Fault("delay", 50),
        Fault("drop-after-commit"),
    ]


@pytest.mark.parametrize(
    "bad",
    [
        "explode",
        "delay",
        "delay=fast",
        "delay=-1",
        "fail-before=1",
        "drop-after-commit=3",
        "expire-token=x",
    ],
)
def test_a_typo_in_a_fault_fails_loudly(bad):
    with pytest.raises(ValueError, match="fault|Fault|whole number|milliseconds"):
        parse_faults(bad)


# --- safety: it cannot be on in production -------------------------------------------------


def test_the_middleware_refuses_to_load_without_debug(settings):
    settings.DEBUG = False
    settings.FAULT_INJECTION = True
    with pytest.raises(ImproperlyConfigured, match="never be installed in production"):
        FaultInjectionMiddleware(lambda request: None)


def test_the_middleware_refuses_to_load_unless_the_switch_is_on(settings):
    settings.DEBUG = True
    settings.FAULT_INJECTION = False
    with pytest.raises(ImproperlyConfigured):
        FaultInjectionMiddleware(lambda request: None)


def test_without_the_middleware_the_header_does_nothing(worker, assignment):
    """The default stack: a client cannot inject faults by sending the header."""
    record_id = uuid.uuid4()
    for value in ("fail-before", "drop-after-commit", "expire-token", "delay=5000"):
        started = time.monotonic()
        response = push(api(worker), create_mut(uuid.uuid4(), assignment), headers=fault(value))
        assert response.status_code == 200, value
        assert time.monotonic() - started < 4
    assert record_id  # silence unused


def test_the_default_settings_do_not_install_it(settings):
    assert "sync.middleware.FaultInjectionMiddleware" not in settings.MIDDLEWARE


# --- the four faults -------------------------------------------------------------------------


def test_fail_before_answers_503_and_touches_nothing(fault_injection, worker, assignment):
    record_id = uuid.uuid4()
    response = push(api(worker), create_mut(record_id, assignment), headers=fault("fail-before"))
    assert_problem(response, 503, "fault_injected")
    assert not Submission.objects.filter(pk=record_id).exists()
    assert push(api(worker), create_mut(record_id, assignment)).status_code == 200  # retry works


def test_drop_after_commit_commits_then_answers_503(fault_injection, worker, assignment):
    record_id = uuid.uuid4()
    response = push(
        api(worker), create_mut(record_id, assignment), headers=fault("drop-after-commit")
    )
    assert_problem(response, 503, "fault_injected")
    assert Submission.objects.filter(pk=record_id).exists()


def test_delay_holds_the_response_but_still_delivers_it(fault_injection, worker, assignment):
    started = time.monotonic()
    response = push(api(worker), create_mut(uuid.uuid4(), assignment), headers=fault("delay=200"))
    assert time.monotonic() - started >= 0.19
    assert response.status_code == 200
    assert response.json()["results"][0]["status"] == "applied"


def test_delay_is_capped(fault_injection, worker, monkeypatch):
    slept = []
    monkeypatch.setattr(middleware.time, "sleep", slept.append)
    push(api(worker), headers=fault("delay=99999999"))
    assert slept == [MAX_DELAY_MS / 1000]


def test_expire_token_cuts_a_batch_short_with_a_401(fault_injection, worker, assignment):
    """Scenario 9 (server half): the token 'expires' after the first mutation of three."""
    ids = [uuid.uuid4() for _ in range(3)]
    batch = [create_mut(i, assignment) for i in ids]

    response = push(api(worker), *batch, headers=fault("expire-token"))
    assert_problem(response, 401, "unauthenticated")
    assert Submission.objects.filter(pk=ids[0]).exists()  # applied before the token expired
    assert Submission.objects.filter(pk__in=ids[1:]).count() == 0  # never reached

    # After refreshing the token the client resends the whole batch from the start.
    retry = push(api(worker), *batch).json()["results"]
    assert [r["status"] for r in retry] == ["applied"] * 3
    assert Submission.objects.filter(pk__in=ids).count() == 3
    assert row(ids[0]).version == 1  # the first mutation was replayed, not applied again


def test_expire_token_can_cut_at_any_point(fault_injection, worker, assignment):
    batch = [create_mut(uuid.uuid4(), assignment) for _ in range(4)]
    assert_problem(
        push(api(worker), *batch, headers=fault("expire-token=3")), 401, "unauthenticated"
    )
    assert Submission.objects.count() == 3


def test_expire_token_does_nothing_when_the_batch_is_already_finished(
    fault_injection, worker, assignment
):
    batch = [create_mut(uuid.uuid4(), assignment) for _ in range(2)]
    assert push(api(worker), *batch, headers=fault("expire-token=2")).status_code == 200


# --- scope --------------------------------------------------------------------------------------


def test_faults_only_apply_to_the_sync_endpoints(fault_injection, client):
    assert client.get("/api/health/", HTTP_X_FAULT="fail-before").status_code == 200


def test_pull_can_be_faulted_too(fault_injection, worker):
    assert_problem(
        pull(api(worker), headers={**SCHEMA_HEADER, **fault("fail-before")}), 503, "fault_injected"
    )
    assert pull(api(worker)).status_code == 200


def test_an_unknown_fault_is_a_400_not_silently_ignored(fault_injection, worker):
    assert_problem(push(api(worker), headers=fault("explode")), 400, "invalid_fault")


def test_faults_can_be_combined(fault_injection, worker, assignment):
    record_id = uuid.uuid4()
    started = time.monotonic()
    response = push(
        api(worker), create_mut(record_id, assignment), headers=fault("delay=120,drop-after-commit")
    )
    assert time.monotonic() - started >= 0.11
    assert response.status_code == 503
    assert Submission.objects.filter(pk=record_id).exists()


def test_a_faulted_request_that_still_reaches_the_service_follows_the_normal_rules(
    fault_injection, worker, assignment
):
    record_id = uuid.uuid4()
    push(api(worker), create_mut(record_id, assignment))
    result = push(
        api(worker),
        mut("update", record_id, base=1, fields={"notes": "x"}),
        headers=fault("delay=1"),
    )
    assert result.json()["results"][0]["status"] == "applied"
