"""Database invariants for submissions, checked as the restricted application role.

Each test would still pass if only the application code were careful, which is why they go around
the code and talk to the database: the point is that the database refuses, whoever asks."""

import uuid

import pytest
from django.db import DatabaseError, IntegrityError, connection, transaction

from assignments.models import Assignment
from conftest import next_server_seq
from forms.models import Form, FormVersion
from forms.samples import GENERATOR_INSPECTION
from submissions.guard import write_access
from submissions.models import Submission

pytestmark = pytest.mark.django_db


def update(submission, **fields):
    """A raw UPDATE, the way code that skips the sync service would write it."""
    with write_access():
        return Submission.objects.filter(pk=submission.pk).update(**fields)


# --- creation -----------------------------------------------------------------------------------


def test_a_submission_is_created_at_version_one(make_submission):
    submission = make_submission()
    assert submission.version == 1
    assert submission.status == "draft"


def test_a_new_submission_cannot_start_above_version_one(make_submission):
    with pytest.raises(IntegrityError, match="must start at version 1"), transaction.atomic():
        make_submission(version=5)


def test_version_cannot_be_zero(make_submission):
    with pytest.raises(IntegrityError), transaction.atomic():
        make_submission(version=0)


def test_status_must_be_one_of_the_known_values(make_submission):
    with pytest.raises(IntegrityError, match="status_valid"), transaction.atomic():
        make_submission(status="finished")


def test_every_known_status_is_accepted(make_submission):
    for status in ("draft", "submitted", "approved", "returned"):
        assert make_submission(status=status).status == status


def test_server_seq_is_unique(make_submission):
    first = make_submission()
    with pytest.raises(IntegrityError, match="server_seq"), transaction.atomic():
        make_submission(server_seq=first.server_seq)


def test_the_id_is_the_primary_key_so_a_duplicate_create_fails(make_submission):
    first = make_submission()
    with pytest.raises(IntegrityError), transaction.atomic():
        make_submission(id=first.id)


def test_a_submission_must_use_its_assignments_form_version(make_submission, assignment):
    other_form = Form.objects.create(name="Other form")
    other_version = FormVersion.objects.create(form=other_form, schema=GENERATOR_INSPECTION)
    other_version.publish()
    with pytest.raises(IntegrityError, match="assignment's form version"), transaction.atomic():
        make_submission(form_version=other_version)


def test_the_form_version_match_is_checked_against_the_assignment_not_the_caller(
    make_submission, worker, published_version
):
    second = FormVersion.objects.create(form=published_version.form, schema=GENERATOR_INSPECTION)
    second.publish()
    on_second = Assignment.objects.create(form_version=second, worker=worker, site_name="Annex")
    ok = make_submission(assignment=on_second, form_version=second)
    assert ok.form_version_id == second.id


# --- the single write path, enforced by the database ----------------------------------------------


def test_an_update_that_skips_the_version_bump_is_refused(make_submission):
    submission = make_submission()
    with pytest.raises(IntegrityError, match="raise version by exactly 1"), transaction.atomic():
        update(submission, data={"oil_level": "low"})  # version and server_seq untouched


def test_an_update_that_bumps_by_more_than_one_is_refused(make_submission):
    submission = make_submission()
    with pytest.raises(IntegrityError, match="exactly 1"), transaction.atomic():
        update(submission, version=3, server_seq=next_server_seq())


def test_an_update_that_goes_backwards_is_refused(make_submission):
    submission = make_submission()
    update(submission, version=2, server_seq=next_server_seq())
    with pytest.raises(IntegrityError, match="exactly 1"), transaction.atomic():
        update(submission, version=1, server_seq=next_server_seq())


def test_an_update_that_does_not_advance_server_seq_is_refused(make_submission):
    submission = make_submission()
    with pytest.raises(IntegrityError, match="larger server_seq"), transaction.atomic():
        update(submission, version=2, server_seq=submission.server_seq)


def test_an_update_with_a_lower_server_seq_is_refused(make_submission):
    first = make_submission()
    second = make_submission()
    with pytest.raises(IntegrityError, match="larger server_seq"), transaction.atomic():
        update(second, version=2, server_seq=first.server_seq - 1)


def test_a_correct_update_is_accepted(make_submission):
    submission = make_submission()
    update(
        submission,
        version=2,
        server_seq=next_server_seq(),
        data={"oil_level": "low"},
        field_versions={"oil_level": 2},
    )
    submission.refresh_from_db()
    assert (submission.version, submission.data) == (2, {"oil_level": "low"})


def test_a_soft_delete_is_just_a_normal_versioned_update(make_submission):
    from django.utils import timezone

    submission = make_submission()
    update(submission, version=2, server_seq=next_server_seq(), deleted_at=timezone.now())
    submission.refresh_from_db()
    assert submission.deleted_at is not None


def test_the_assignment_and_form_version_are_pinned(make_submission, worker, published_version):
    submission = make_submission()
    elsewhere = Assignment.objects.create(
        form_version=published_version, worker=worker, site_name="Elsewhere"
    )
    with pytest.raises(IntegrityError, match="never change"), transaction.atomic():
        update(submission, assignment=elsewhere, version=2, server_seq=next_server_seq())


def test_the_id_cannot_be_changed(make_submission):
    submission = make_submission()
    with pytest.raises(IntegrityError, match="never change"), transaction.atomic():
        update(submission, id=uuid.uuid4(), version=2, server_seq=next_server_seq())


def test_a_submission_row_can_never_be_deleted(make_submission):
    submission = make_submission()
    with pytest.raises(DatabaseError, match="never deleted"), transaction.atomic():
        with write_access():
            Submission.objects.filter(pk=submission.pk).delete()


def test_status_changes_follow_the_same_version_rule(make_submission):
    submission = make_submission()
    with pytest.raises(IntegrityError), transaction.atomic():
        update(submission, status="approved")
    update(submission, status="submitted", version=2, server_seq=next_server_seq())
    submission.refresh_from_db()
    assert submission.status == "submitted"


# --- the sequence -----------------------------------------------------------------------------


def test_the_application_role_can_use_the_sequence_and_values_only_grow():
    values = [next_server_seq() for _ in range(5)]
    assert values == sorted(values)
    assert len(set(values)) == 5


def test_the_sequence_is_not_a_model_table_but_it_exists():
    with connection.cursor() as cursor:
        cursor.execute(
            "SELECT 1 FROM pg_class WHERE relname = 'submission_server_seq' AND relkind = 'S'"
        )
        assert cursor.fetchone() == (1,)
