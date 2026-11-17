import pytest
from django.core.exceptions import ValidationError
from django.db import DatabaseError, IntegrityError, transaction

from forms.models import Form, FormVersion
from forms.samples import GENERATOR_INSPECTION

pytestmark = pytest.mark.django_db


@pytest.fixture
def form():
    return Form.objects.create(name="Pump check")


def draft(form, schema=None):
    return FormVersion.objects.create(form=form, schema=schema or GENERATOR_INSPECTION)


def test_versions_are_numbered_per_form(form):
    other = Form.objects.create(name="Roof check")
    assert [draft(form).number, draft(form).number, draft(other).number] == [1, 2, 1]


def test_a_form_version_number_is_unique_per_form(form):
    draft(form)
    with pytest.raises(IntegrityError), transaction.atomic():
        FormVersion.objects.create(form=form, number=1, schema=GENERATOR_INSPECTION)


def test_publishing_sets_the_time_and_is_idempotent(form):
    version = draft(form)
    assert not version.is_published
    version.publish()
    first = version.published_at
    assert first is not None
    version.publish()  # nothing to do, and the database would refuse a second write
    version.refresh_from_db()
    assert version.published_at == first


def test_publishing_an_invalid_schema_is_refused(form):
    version = draft(form, schema={"type": "object"})
    with pytest.raises(ValidationError):
        version.publish()
    version.refresh_from_db()
    assert not version.is_published


def test_a_draft_can_still_be_edited(form):
    version = draft(form)
    version.schema = {**GENERATOR_INSPECTION, "title": "Renamed"}
    version.save()
    version.refresh_from_db()
    assert version.schema["title"] == "Renamed"


# --- database invariant: a published version is immutable, for the application role ----------


def test_the_database_refuses_to_change_a_published_schema(form):
    version = draft(form)
    version.publish()
    with pytest.raises(IntegrityError, match="published and immutable"), transaction.atomic():
        FormVersion.objects.filter(pk=version.pk).update(schema={"type": "object"})


def test_the_database_refuses_to_unpublish(form):
    version = draft(form)
    version.publish()
    with pytest.raises(IntegrityError, match="immutable"), transaction.atomic():
        FormVersion.objects.filter(pk=version.pk).update(published_at=None)


def test_the_database_refuses_to_delete_a_published_version(form):
    version = draft(form)
    version.publish()
    with pytest.raises(DatabaseError, match="immutable"), transaction.atomic():
        FormVersion.objects.filter(pk=version.pk).delete()


def test_an_unpublished_draft_can_be_deleted(form):
    version = draft(form)
    version.delete()
    assert not FormVersion.objects.filter(pk=version.pk).exists()


def test_number_must_be_positive(form):
    with pytest.raises(IntegrityError), transaction.atomic():
        FormVersion.objects.create(form=form, number=0, schema=GENERATOR_INSPECTION)
