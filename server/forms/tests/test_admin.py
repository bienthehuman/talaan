import pytest
from django.urls import reverse

from accounts.models import User
from forms.models import Form, FormVersion
from forms.samples import GENERATOR_INSPECTION

pytestmark = pytest.mark.django_db


@pytest.fixture
def staff_client(client):
    user = User.objects.create_superuser("boss", password="pw-for-tests-123")
    client.force_login(user)
    return client


@pytest.fixture
def draft_version():
    form = Form.objects.create(name="Pump check")
    return FormVersion.objects.create(form=form, schema=GENERATOR_INSPECTION)


def post_action(client, action, *pks):
    return client.post(
        reverse("admin:forms_formversion_changelist"),
        {"action": action, "_selected_action": [str(pk) for pk in pks]},
        follow=True,
    )


def test_publish_action_publishes_a_draft(staff_client, draft_version):
    response = post_action(staff_client, "publish_selected", draft_version.pk)
    assert "Published 1 version" in response.content.decode()
    draft_version.refresh_from_db()
    assert draft_version.is_published


def test_publish_action_reports_an_invalid_schema(staff_client):
    version = FormVersion.objects.create(
        form=Form.objects.create(name="Bad"), schema={"type": "object"}
    )
    response = post_action(staff_client, "publish_selected", version.pk)
    assert "additionalProperties" in response.content.decode()
    version.refresh_from_db()
    assert not version.is_published


def test_a_published_version_has_no_edit_form(staff_client, draft_version):
    draft_version.publish()
    url = reverse("admin:forms_formversion_change", args=[draft_version.pk])
    page = staff_client.get(url).content.decode()
    assert 'name="schema"' not in page  # shown read-only, not as a field to edit


def test_a_draft_has_an_editable_schema(staff_client, draft_version):
    url = reverse("admin:forms_formversion_change", args=[draft_version.pk])
    assert 'name="schema"' in staff_client.get(url).content.decode()


def test_bulk_delete_is_not_offered(staff_client, draft_version):
    page = staff_client.get(reverse("admin:forms_formversion_changelist")).content.decode()
    assert "delete_selected" not in page
