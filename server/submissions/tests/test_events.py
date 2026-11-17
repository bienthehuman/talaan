"""submission_event is append-only: no UPDATE or DELETE for the application role (privileges) and
for nobody (trigger). Each layer has its own test so removing either one is caught."""

import psycopg
import pytest
from django.db import DatabaseError, connection, transaction

from submissions.models import EventKind, SubmissionEvent

pytestmark = pytest.mark.django_db

INSERT_EVENT = (
    "INSERT INTO submissions_submissionevent (submission_id, version, kind, detail, created_at) "
    "VALUES (gen_random_uuid(), 1, 'created', '{}', now())"
)


def privilege(table: str, kind: str) -> bool:
    with connection.cursor() as cursor:
        cursor.execute("SELECT has_table_privilege(current_user, %s, %s)", [table, kind])
        return cursor.fetchone()[0]


def test_events_can_be_added(make_submission, worker):
    submission = make_submission()
    event = SubmissionEvent.objects.create(
        submission=submission, version=1, kind=EventKind.CREATED, actor=worker, detail={"x": 1}
    )
    assert SubmissionEvent.objects.get(pk=event.pk).detail == {"x": 1}


def test_an_unknown_event_kind_is_refused(make_submission):
    with pytest.raises(DatabaseError, match="kind_valid"), transaction.atomic():
        SubmissionEvent.objects.create(submission=make_submission(), version=1, kind="exploded")


def test_the_application_role_has_no_update_or_delete_privilege():
    table = "submissions_submissionevent"
    assert privilege(table, "INSERT") and privilege(table, "SELECT")
    assert not privilege(table, "UPDATE")
    assert not privilege(table, "DELETE")


def test_an_update_through_the_application_role_is_refused(make_submission):
    event = SubmissionEvent.objects.create(submission=make_submission(), version=1, kind="created")
    with pytest.raises(DatabaseError, match="permission denied"), transaction.atomic():
        SubmissionEvent.objects.filter(pk=event.pk).update(kind="deleted")


def test_a_delete_through_the_application_role_is_refused(make_submission):
    event = SubmissionEvent.objects.create(submission=make_submission(), version=1, kind="created")
    with pytest.raises(DatabaseError, match="permission denied"), transaction.atomic():
        SubmissionEvent.objects.filter(pk=event.pk).delete()


def test_the_trigger_refuses_an_update_even_for_the_owner(owner_conn):
    owner_conn.execute(INSERT_EVENT)
    with pytest.raises(psycopg.errors.CheckViolation, match="append-only"):
        owner_conn.execute("UPDATE submissions_submissionevent SET kind = 'deleted'")


def test_the_trigger_refuses_a_delete_even_for_the_owner(owner_conn):
    owner_conn.execute(INSERT_EVENT)
    with pytest.raises(psycopg.errors.CheckViolation, match="append-only"):
        owner_conn.execute("DELETE FROM submissions_submissionevent")
