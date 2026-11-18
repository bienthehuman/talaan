"""Scenario 4, server half: two devices of one worker edit different fields. Both edits are applied
and the server holds both values. (The browser half is e2e/tests/04-merge.spec.ts.)"""

import uuid

import pytest

from sync.tests.api_helpers import DEVICE_A, create_mut, mut, pull, push
from sync.tests.helpers import DEVICE_B

pytestmark = [pytest.mark.phase3, pytest.mark.django_db]


def test_two_devices_edit_different_fields_and_both_are_kept(worker_client, assignment):
    record_id = uuid.uuid4()
    created = push(worker_client, create_mut(record_id, assignment, {"oil_level": "ok"})).json()
    assert created["results"][0]["record"]["version"] == 1

    # Both devices start from version 1 and have not seen each other's edit.
    on_a = push(
        worker_client, mut("update", record_id, base=1, fields={"hours_run": 10}), device=DEVICE_A
    ).json()["results"][0]
    on_b = push(
        worker_client, mut("update", record_id, base=1, fields={"notes": "leak"}), device=DEVICE_B
    ).json()["results"][0]

    assert (on_a["status"], on_a["record"]["version"]) == ("applied", 2)
    assert (on_b["status"], on_b["record"]["version"]) == ("applied", 3)  # merged, not conflicted
    held = on_b["record"]
    assert held["data"] == {"oil_level": "ok", "hours_run": 10, "notes": "leak"}
    assert held["field_versions"] == {"oil_level": 1, "hours_run": 2, "notes": 3}

    # Each device reads the merged record on its next pull.
    pulled = next(
        r for r in pull(worker_client, cursor=0).json()["records"] if r["id"] == str(record_id)
    )
    assert pulled["data"] == held["data"]
