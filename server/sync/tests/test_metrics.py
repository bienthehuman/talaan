import uuid

import pytest

from sync.models import Device, Replay
from sync.tests.api_helpers import SCHEMA_HEADER, create_mut, mut, pull, push
from sync.tests.helpers import COMPLETE, DEVICE_B, admin, create, submitted

pytestmark = pytest.mark.django_db


def scrape(client, token: str | None = None):
    headers = {"HTTP_AUTHORIZATION": f"Bearer {token}"} if token else {}
    return client.get("/metrics", **headers)


def parse(response) -> dict[tuple[str, tuple], float]:
    out: dict[tuple[str, tuple], float] = {}
    for line in response.content.decode().splitlines():
        if not line or line.startswith("#"):
            continue
        name_labels, value = line.rsplit(" ", 1)
        name, _, rest = name_labels.partition("{")
        labels = tuple(
            sorted(p.replace('"', "").split("=", 1) for p in rest.rstrip("}").split(",") if p)
        )
        out[(name, tuple(map(tuple, labels)))] = float(value)
    return out


def value(metrics, name: str, **labels) -> float:
    return metrics.get((name, tuple(sorted(labels.items()))), 0.0)


# --- who can read it --------------------------------------------------------------------------


def test_it_does_not_exist_when_no_token_is_set_outside_debug(api_client, settings):
    settings.DEBUG = False
    settings.METRICS_TOKEN = ""
    assert scrape(api_client).status_code == 404


def test_a_token_is_required_when_one_is_set(api_client, settings):
    settings.DEBUG = False
    settings.METRICS_TOKEN = "s3cret-scrape-token"
    assert scrape(api_client).status_code == 401
    assert scrape(api_client, "wrong").status_code == 401
    assert scrape(api_client, "s3cret-scrape-token ").status_code == 401
    ok = scrape(api_client, "s3cret-scrape-token")
    assert ok.status_code == 200
    assert ok["Content-Type"].startswith("text/plain; version=0.0.4")


def test_in_debug_with_no_token_it_is_open_for_local_use(api_client, settings):
    settings.DEBUG = True
    settings.METRICS_TOKEN = ""
    assert scrape(api_client).status_code == 200


def test_a_user_login_is_not_a_scrape_credential(worker_client, settings):
    settings.DEBUG = False
    settings.METRICS_TOKEN = "s3cret-scrape-token"
    assert scrape(worker_client).status_code == 401


def test_it_is_not_part_of_the_public_api_schema(api_client):
    assert "/metrics" not in api_client.get("/api/schema/").content.decode()


# --- the numbers ------------------------------------------------------------------------------


@pytest.fixture
def open_metrics(settings):
    settings.DEBUG = True
    settings.METRICS_TOKEN = ""


def test_counters_match_known_traffic(
    api_client, worker, admin_user, other_worker, assignment, open_metrics
):
    from sync.tests.helpers import push as service_push

    record_a, _ = create(worker, assignment, {"notes": "a"})  # applied
    service_push(worker, "update", record_a, base=1, fields={"notes": "b"})  # applied
    stale = mut("update", record_a, base=1, fields={"notes": "c"})
    first = service_push(worker, "update", record_a, base=1, fields={"notes": "c"})  # conflict
    assert first["status"] == "conflict"
    record_b = submitted(worker, assignment)  # create + submit: 2 applied
    admin(admin_user, record_b, "approve")  # applied, by an admin
    late = service_push(worker, "update", record_b, base=3, fields={"notes": "late"})  # rejected
    assert late["code"] == "locked"
    del stale

    m = parse(scrape(api_client))
    assert value(m, "talaan_mutations_total", source="device", status="applied") == 4
    assert value(m, "talaan_mutations_total", source="device", status="conflict") == 1
    assert value(m, "talaan_mutations_total", source="device", status="rejected") == 1
    assert value(m, "talaan_mutations_total", source="admin", status="applied") == 1
    assert value(m, "talaan_conflicts_total", kind="field_conflict") == 1
    assert value(m, "talaan_rejections_total", code="locked") == 1
    assert value(m, "talaan_retries_total") == 0


def test_a_retry_is_counted_once_per_resend_and_per_distinct_mutation(
    api_client, worker_client, worker, assignment, open_metrics
):
    record_id = uuid.uuid4()
    body = create_mut(record_id, assignment, {"notes": "x"})
    other = mut("update", record_id, base=1, fields={"notes": "y"})
    push(worker_client, body, other)
    for _ in range(3):
        push(worker_client, body)  # resent three times
    push(worker_client, other)  # another mutation, resent once

    m = parse(scrape(api_client))
    assert value(m, "talaan_retries_total") == 4
    assert value(m, "talaan_retried_mutations_total") == 2
    assert value(m, "talaan_mutations_total", source="device", status="applied") == 2  # not 6
    assert Replay.objects.get(pk=body["mutation_id"]).count == 3


def test_someone_elses_mutation_id_is_not_counted_as_a_retry(
    api_client, worker_client, other_worker_client, assignment, open_metrics
):
    body = create_mut(uuid.uuid4(), assignment, {"notes": "x"})
    push(worker_client, body)
    push(other_worker_client, body)  # mutation_id_reuse, not a retry
    assert value(parse(scrape(api_client)), "talaan_retries_total") == 0


def test_pull_lag_is_how_many_records_a_device_still_has_to_fetch(
    api_client, worker, worker_client, other_worker, assignment, open_metrics, published_version
):
    from assignments.models import Assignment

    for _ in range(3):
        create(worker, assignment, COMPLETE)
    elsewhere = Assignment.objects.create(
        form_version=published_version, worker=other_worker, site_name="Z"
    )
    create(other_worker, elsewhere, COMPLETE)  # not this worker's: never counts as their lag

    device = uuid.uuid4()
    header = {**SCHEMA_HEADER, "HTTP_X_DEVICE_ID": str(device)}
    first = worker_client.get("/api/sync/pull/", {"cursor": 0, "limit": 1}, **header).json()
    m = parse(scrape(api_client))
    assert value(m, "talaan_pull_lag_records_max") == 2
    assert value(m, "talaan_pull_lag_records_total") == 2
    assert value(m, "talaan_devices_behind") == 1
    assert value(m, "talaan_devices") == 1

    worker_client.get("/api/sync/pull/", {"cursor": first["next_cursor"]}, **header)
    m = parse(scrape(api_client))
    assert value(m, "talaan_pull_lag_records_max") == 0
    assert value(m, "talaan_devices_behind") == 0
    assert value(m, "talaan_pull_age_seconds_max") >= 0

    create(worker, assignment, COMPLETE)  # a new change appears after the device caught up
    assert value(parse(scrape(api_client)), "talaan_pull_lag_records_max") == 1


def test_pulls_without_a_usable_device_id_leave_no_trace(
    api_client, worker_client, admin_client, assignment, open_metrics
):
    pull(worker_client, cursor=0)
    worker_client.get(
        "/api/sync/pull/", {"cursor": 0}, HTTP_X_DEVICE_ID="not-a-uuid", **SCHEMA_HEADER
    )
    admin_client.get(
        "/api/sync/pull/", {"cursor": 0}, HTTP_X_DEVICE_ID=str(uuid.uuid4()), **SCHEMA_HEADER
    )
    assert Device.objects.count() == 0  # an admin has no device to track


def test_a_device_that_pushed_keeps_its_app_version_when_it_pulls(
    worker_client, assignment, open_metrics
):
    push(
        worker_client,
        create_mut(uuid.uuid4(), assignment, {"notes": "x"}),
        device=DEVICE_B,
        app_version="1.2.3",
    )
    worker_client.get(
        "/api/sync/pull/", {"cursor": 0}, HTTP_X_DEVICE_ID=str(DEVICE_B), **SCHEMA_HEADER
    )
    device = Device.objects.get(pk=DEVICE_B)
    assert device.app_version == "1.2.3" and device.last_pull_cursor is not None


def test_server_seq_and_submission_gauges(api_client, worker, admin_user, assignment, open_metrics):
    draft, _ = create(worker, assignment, COMPLETE)
    sent = submitted(worker, assignment)
    admin(admin_user, draft, "delete")
    m = parse(scrape(api_client))
    assert value(m, "talaan_server_seq") >= 3
    assert value(m, "talaan_submissions", status="draft", deleted="true") == 1
    assert value(m, "talaan_submissions", status="submitted", deleted="false") == 1
    del sent
