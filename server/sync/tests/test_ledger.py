"""The idempotency ledger (ADR 0004): a row is inserted with an empty result, the result is set
exactly once, and rows are never deleted."""

import uuid

import psycopg
import pytest
from django.db import DatabaseError, IntegrityError, connection, transaction

from sync.models import AppliedMutation, Device

pytestmark = pytest.mark.django_db


def privilege(kind: str) -> bool:
    with connection.cursor() as cursor:
        cursor.execute(
            "SELECT has_table_privilege(current_user, 'sync_appliedmutation', %s)", [kind]
        )
        return cursor.fetchone()[0]


@pytest.fixture
def ledger_row(worker):
    return AppliedMutation.objects.create(
        mutation_id=uuid.uuid4(), device_id=uuid.uuid4(), user=worker
    )


def set_result(row, result):
    return AppliedMutation.objects.filter(pk=row.pk).update(result=result)


def test_a_row_starts_with_an_empty_result(ledger_row):
    assert ledger_row.result == {}


def test_the_result_can_be_set_once(ledger_row):
    set_result(ledger_row, {"status": "applied", "version": 2})
    ledger_row.refresh_from_db()
    assert ledger_row.result["status"] == "applied"


def test_a_recorded_result_cannot_be_changed(ledger_row):
    set_result(ledger_row, {"status": "applied"})
    with pytest.raises(IntegrityError, match="already recorded"), transaction.atomic():
        set_result(ledger_row, {"status": "conflict"})


def test_an_empty_result_cannot_be_recorded(ledger_row):
    with pytest.raises(IntegrityError, match="must not be empty"), transaction.atomic():
        set_result(ledger_row, {})


def test_only_the_result_column_can_be_set(ledger_row, other_worker):
    with pytest.raises(IntegrityError, match="only the result"), transaction.atomic():
        AppliedMutation.objects.filter(pk=ledger_row.pk).update(
            user=other_worker, result={"status": "applied"}
        )
    with pytest.raises(IntegrityError, match="only the result"), transaction.atomic():
        AppliedMutation.objects.filter(pk=ledger_row.pk).update(
            device_id=uuid.uuid4(), result={"status": "applied"}
        )


def test_a_mutation_id_can_only_be_recorded_once(ledger_row, worker):
    with pytest.raises(IntegrityError), transaction.atomic():
        AppliedMutation.objects.create(
            mutation_id=ledger_row.mutation_id, device_id=uuid.uuid4(), user=worker
        )


def test_the_application_role_cannot_delete_ledger_rows(ledger_row):
    assert privilege("INSERT") and privilege("SELECT") and privilege("UPDATE")
    assert not privilege("DELETE")
    with pytest.raises(DatabaseError, match="permission denied"), transaction.atomic():
        AppliedMutation.objects.filter(pk=ledger_row.pk).delete()


def test_the_trigger_refuses_a_delete_even_for_the_owner(owner_conn):
    owner_conn.execute(
        "INSERT INTO sync_appliedmutation (mutation_id, device_id, user_id, result, created_at) "
        "VALUES (gen_random_uuid(), gen_random_uuid(), 1, '{}', now())"
    )
    with pytest.raises(psycopg.errors.CheckViolation, match="never deleted"):
        owner_conn.execute("DELETE FROM sync_appliedmutation")


def test_a_device_is_registered_with_a_generated_id(worker):
    device = Device.objects.create(user=worker, app_version="1")
    assert device.id and device.last_seen_at
