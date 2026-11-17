import pytest
from django.core.exceptions import ValidationError

from assignments.models import Assignment
from forms.models import Form, FormVersion
from forms.samples import GENERATOR_INSPECTION

pytestmark = pytest.mark.django_db


def test_an_assignment_goes_to_a_worker_with_a_published_form(published_version, worker):
    assignment = Assignment(form_version=published_version, worker=worker, site_name="Depot")
    assignment.full_clean()  # no error
    assignment.save()
    assert not assignment.is_cancelled


def test_a_draft_form_version_cannot_be_assigned(worker):
    draft = FormVersion.objects.create(
        form=Form.objects.create(name="Draft form"), schema=GENERATOR_INSPECTION
    )
    with pytest.raises(ValidationError, match="published"):
        Assignment(form_version=draft, worker=worker, site_name="Depot").full_clean()


def test_an_assignment_cannot_go_to_an_admin(published_version, admin_user):
    with pytest.raises(ValidationError, match="worker role"):
        Assignment(
            form_version=published_version, worker=admin_user, site_name="Depot"
        ).full_clean()


def test_cancelling_sets_the_time_once(assignment):
    assignment.cancel()
    first = assignment.cancelled_at
    assert first is not None
    assignment.cancel()
    assert assignment.cancelled_at == first


def test_cancelling_keeps_existing_submissions(assignment, make_submission):
    submission = make_submission()
    assignment.cancel()
    submission.refresh_from_db()
    assert submission.assignment_id == assignment.id
