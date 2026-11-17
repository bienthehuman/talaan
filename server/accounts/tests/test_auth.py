import pytest
from django.contrib.auth.models import Group
from django.core.management import call_command
from django.core.management.base import CommandError

from accounts.models import User

pytestmark = pytest.mark.django_db


def test_login_returns_tokens_and_me_reports_role(api_client, worker):
    response = api_client.post(
        "/api/auth/token/", {"username": "worker1", "password": "pw-for-tests-123"}
    )
    assert response.status_code == 200
    tokens = response.json()
    assert set(tokens) == {"access", "refresh"}

    api_client.credentials(HTTP_AUTHORIZATION=f"Bearer {tokens['access']}")
    me = api_client.get("/api/me/")
    assert me.status_code == 200
    body = me.json()
    assert body["username"] == "worker1"
    assert body["role"] == "worker"
    assert "submission.create" in body["permissions"]
    assert "submission.approve" not in body["permissions"]


def test_refresh_issues_a_new_access_token(api_client, worker):
    tokens = api_client.post(
        "/api/auth/token/", {"username": "worker1", "password": "pw-for-tests-123"}
    ).json()
    response = api_client.post("/api/auth/token/refresh/", {"refresh": tokens["refresh"]})
    assert response.status_code == 200
    assert "access" in response.json()


def test_garbage_token_is_401_problem(api_client):
    api_client.credentials(HTTP_AUTHORIZATION="Bearer not-a-token")
    response = api_client.get("/api/me/")
    assert response.status_code == 401
    assert response.json()["code"] == "unauthenticated"


def test_admin_role_and_permissions(admin_user):
    assert admin_user.role == "admin"
    assert admin_user.can("submission.approve")
    assert not admin_user.can("submission.create")


def test_user_without_group_has_no_role_or_permissions(db):
    user = User.objects.create_user("nobody", password="pw-for-tests-123")
    assert user.role is None
    assert not user.can("submission.edit")


def test_role_groups_exist_from_migration():
    assert set(Group.objects.values_list("name", flat=True)) >= {"worker", "admin"}


def test_seed_demo_refuses_outside_debug(settings):
    settings.DEBUG = False
    with pytest.raises(CommandError):
        call_command("seed_demo")


def test_seed_demo_creates_admin_and_two_workers(settings):
    settings.DEBUG = True
    call_command("seed_demo", stdout=None)
    assert User.objects.get(username="admin").role == "admin"
    assert User.objects.get(username="worker1").role == "worker"
    assert User.objects.get(username="worker2").role == "worker"
    call_command("seed_demo")  # idempotent
    assert User.objects.filter(username__in=["admin", "worker1", "worker2"]).count() == 3


def test_seed_demo_publishes_a_form_and_assigns_it_to_each_worker(settings):
    from assignments.models import Assignment
    from forms.models import Form

    settings.DEBUG = True
    call_command("seed_demo")
    call_command("seed_demo")  # idempotent: nothing is duplicated
    form = Form.objects.get(name="Generator inspection")
    assert form.versions.count() == 1
    assert form.versions.get().is_published
    assert Assignment.objects.filter(worker__username="worker1").count() == 1
    assert Assignment.objects.filter(worker__username="worker2").count() == 1
    assert {a.site_name for a in Assignment.objects.all()} == {"North plant", "Harbour depot"}
