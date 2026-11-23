"""Worker invites (ADR 0014, protocol section 11): admin endpoints and public check/accept."""

import hashlib
import logging
from datetime import timedelta

import pytest
from django.db import IntegrityError, transaction
from django.utils import timezone
from rest_framework.test import APIClient
from rest_framework.throttling import ScopedRateThrottle

from accounts import invites
from accounts.models import User, WorkerInvite
from accounts.permissions import ADMIN, CATALOG, ROLE_PERMISSIONS, WORKER, WORKER_MANAGE
from core.logs import JsonFormatter
from sync.tests.api_helpers import SCHEMA_HEADER
from sync.tests.concurrency import run_together

pytestmark = pytest.mark.django_db

ADMIN_BASE = "/api/admin/invites/"
CHECK = "/api/invites/check/"
ACCEPT = "/api/invites/accept/"
GOOD_PASSWORD = "lantern-orchard-42"


def invite(admin_user, username="maria", **names):
    return invites.create(
        admin_user, username, names.get("first", "Maria"), names.get("last", "Cruz")
    )


def accept(client, token, password=GOOD_PASSWORD):
    return client.post(ACCEPT, {"token": token, "password": password}, format="json")


def expire(row):
    WorkerInvite.objects.filter(pk=row.pk).update(expires_at=timezone.now() - timedelta(seconds=1))


# --- who may call what ------------------------------------------------------------------------


def test_admin_invite_endpoints_need_login_and_worker_manage(
    api_client, worker_client, admin_client
):
    row, _ = invite(admin_client.handler._force_user)
    calls = [
        ("get", ADMIN_BASE),
        ("post", ADMIN_BASE),
        ("post", f"{ADMIN_BASE}{row.id}/new-link/"),
        ("post", f"{ADMIN_BASE}{row.id}/revoke/"),
    ]
    for method, path in calls:
        assert getattr(api_client, method)(path).status_code == 401, path
        assert getattr(worker_client, method)(path).status_code == 403, path
        assert getattr(admin_client, method)(path).status_code not in (401, 403), path


def test_worker_manage_comes_from_the_catalog(admin_client, monkeypatch):
    assert admin_client.get(ADMIN_BASE).status_code == 200
    monkeypatch.setitem(ROLE_PERMISSIONS, ADMIN, CATALOG - {WORKER_MANAGE})
    assert admin_client.get(ADMIN_BASE).status_code == 403
    assert WORKER_MANAGE not in ROLE_PERMISSIONS[WORKER]


# --- creating, listing, replacing, revoking ---------------------------------------------------


def test_create_returns_the_token_once_and_stores_only_its_hash(admin_client, admin_user):
    response = admin_client.post(
        ADMIN_BASE,
        {"username": "maria", "first_name": " Maria ", "last_name": "Cruz"},
        format="json",
    )
    assert response.status_code == 201
    body = response.json()
    token = body["token"]
    assert len(token) >= 43
    assert body["status"] == "pending"
    assert (body["username"], body["first_name"], body["created_by"]) == (
        "maria",
        "Maria",
        admin_user.username,
    )
    row = WorkerInvite.objects.get(pk=body["id"])
    assert row.token_hash == hashlib.sha256(token.encode()).hexdigest()
    stored = [str(v) for v in WorkerInvite.objects.filter(pk=row.pk).values().first().values()]
    assert not any(token in value for value in stored)
    lifetime = row.expires_at - row.created_at
    assert timedelta(days=7) - timedelta(seconds=5) < lifetime <= timedelta(days=7)
    assert not User.objects.filter(username="maria").exists()  # no user until accepted
    # The list never carries a token.
    listed = admin_client.get(ADMIN_BASE).json()["results"]
    assert [r["id"] for r in listed] == [row.id]
    assert "token" not in listed[0]


@pytest.mark.parametrize("username", ["worker1", "WORKER1"])
def test_create_refuses_a_username_a_user_has(admin_client, worker, username):
    response = admin_client.post(ADMIN_BASE, {"username": username}, format="json")
    assert response.status_code == 400
    assert "already exists" in response.json()["errors"]["username"][0]


def test_create_refuses_a_username_with_an_open_invite_even_when_expired(admin_client, admin_user):
    row, _ = invite(admin_user)
    response = admin_client.post(ADMIN_BASE, {"username": "MARIA"}, format="json")
    assert response.status_code == 400
    assert "open invite" in response.json()["errors"]["username"][0]
    expire(row)
    assert admin_client.post(ADMIN_BASE, {"username": "maria"}, format="json").status_code == 400
    invites.revoke(admin_user, row.id)
    assert admin_client.post(ADMIN_BASE, {"username": "maria"}, format="json").status_code == 201


def test_create_refuses_a_bad_username(admin_client):
    for username in ["", "has space", "x" * 151]:
        response = admin_client.post(ADMIN_BASE, {"username": username}, format="json")
        assert response.status_code == 400, username
        assert "username" in response.json()["errors"]


def test_list_filters_by_derived_status(admin_client, admin_user):
    pending, _ = invite(admin_user, "pending1")
    expired, _ = invite(admin_user, "expired1")
    expire(expired)
    revoked, _ = invite(admin_user, "revoked1")
    invites.revoke(admin_user, revoked.id)
    accepted, token = invite(admin_user, "accepted1")
    invites.accept(token, GOOD_PASSWORD)

    def ids(status):
        rows = admin_client.get(ADMIN_BASE, {"status": status}).json()["results"]
        return [(r["id"], r["status"]) for r in rows]

    assert ids("pending") == [(pending.id, "pending")]
    assert ids("expired") == [(expired.id, "expired")]
    assert ids("revoked") == [(revoked.id, "revoked")]
    assert ids("accepted") == [(accepted.id, "accepted")]
    assert len(ids("")) == 4
    assert admin_client.get(ADMIN_BASE, {"status": "open"}).status_code == 400


def test_new_link_replaces_the_token_and_restarts_the_clock(admin_client, admin_user, api_client):
    row, old = invite(admin_user)
    expire(row)
    response = admin_client.post(f"{ADMIN_BASE}{row.id}/new-link/")
    assert response.status_code == 200
    body = response.json()
    assert body["status"] == "pending" and body["token"] != old
    assert (
        api_client.post(CHECK, {"token": old}, format="json").json()["code"] == "invite_not_found"
    )
    assert api_client.post(CHECK, {"token": body["token"]}, format="json").status_code == 200


def test_new_link_and_revoke_refuse_closed_or_unknown_invites(admin_client, admin_user):
    accepted, token = invite(admin_user, "accepted1")
    invites.accept(token, GOOD_PASSWORD)
    revoked, _ = invite(admin_user, "revoked1")
    invites.revoke(admin_user, revoked.id)
    for row in (accepted, revoked):
        response = admin_client.post(f"{ADMIN_BASE}{row.id}/new-link/")
        assert response.status_code == 409 and response.json()["code"] == "invite_closed"
    response = admin_client.post(f"{ADMIN_BASE}{accepted.id}/revoke/")
    assert response.status_code == 409 and response.json()["code"] == "invite_closed"
    for action in ("new-link", "revoke"):
        assert admin_client.post(f"{ADMIN_BASE}999999/{action}/").status_code == 404


def test_revoke_kills_the_link_and_a_second_call_changes_nothing(
    admin_client, admin_user, api_client
):
    row, token = invite(admin_user)
    first = admin_client.post(f"{ADMIN_BASE}{row.id}/revoke/")
    assert first.status_code == 200 and first.json()["status"] == "revoked"
    revoked_at = WorkerInvite.objects.get(pk=row.pk).revoked_at
    assert admin_client.post(f"{ADMIN_BASE}{row.id}/revoke/").status_code == 200
    assert WorkerInvite.objects.get(pk=row.pk).revoked_at == revoked_at
    response = accept(api_client, token)
    assert response.status_code == 410 and response.json()["code"] == "invite_revoked"


# --- check and accept (public) ----------------------------------------------------------------


def test_check_greets_the_invitee(api_client, admin_user):
    row, token = invite(admin_user)
    response = api_client.post(CHECK, {"token": token}, format="json")
    assert response.status_code == 200
    body = response.json()
    assert (body["username"], body["first_name"], body["last_name"]) == ("maria", "Maria", "Cruz")
    assert set(body) == {"username", "first_name", "last_name", "expires_at"}


def test_accept_makes_a_worker_who_can_sign_in_and_pull(api_client, admin_user, admin_client):
    row, token = invite(admin_user)
    response = accept(api_client, token)
    assert response.status_code == 201
    assert response.json() == {"username": "maria"}
    user = User.objects.get(username="maria")
    assert user.role == WORKER and user.is_active and not user.is_staff
    assert (user.first_name, user.last_name) == ("Maria", "Cruz")
    row.refresh_from_db()
    assert row.accepted_user == user and row.status() == "accepted"
    assert {"id": user.id, "username": "maria", "first_name": "Maria", "last_name": "Cruz"} in (
        admin_client.get("/api/admin/workers/").json()
    )

    login = api_client.post(
        "/api/auth/token/", {"username": "maria", "password": GOOD_PASSWORD}, format="json"
    )
    assert login.status_code == 200
    client = APIClient()
    client.credentials(HTTP_AUTHORIZATION=f"Bearer {login.json()['access']}")
    assert client.get("/api/sync/pull/", **SCHEMA_HEADER).status_code == 200


@pytest.mark.parametrize(
    ("setup", "code", "status"),
    [
        ("unknown", "invite_not_found", 404),
        ("expired", "invite_expired", 410),
        ("used", "invite_used", 410),
        ("revoked", "invite_revoked", 410),
    ],
)
def test_unusable_links_are_refused_and_create_nobody(api_client, admin_user, setup, code, status):
    row, token = invite(admin_user)
    if setup == "unknown":
        token = token[:-2] + "xx"
    elif setup == "expired":
        expire(row)
    elif setup == "used":
        invites.accept(token, GOOD_PASSWORD)
    elif setup == "revoked":
        invites.revoke(admin_user, row.id)
    users_before = User.objects.count()
    for path, body in ((CHECK, {"token": token}), (ACCEPT, {"token": token, "password": "x" * 20})):
        response = api_client.post(path, body, format="json")
        assert response.status_code == status, path
        assert response.json()["code"] == code, path
        assert response.json()["detail"]
    assert User.objects.count() == users_before


@pytest.mark.parametrize("password", ["short", "12345678901", "password123", "maria1234"])
def test_a_weak_password_is_refused_and_the_invite_stays_open(api_client, admin_user, password):
    row, token = invite(admin_user)
    response = accept(api_client, token, password)
    assert response.status_code == 400
    assert response.json()["errors"]["password"]
    assert not User.objects.filter(username="maria").exists()
    row.refresh_from_db()
    assert row.status() == "pending"


def test_a_username_taken_after_the_invite_is_a_conflict(api_client, admin_user):
    row, token = invite(admin_user)
    User.objects.create_user(username="Maria", password="whatever-123-abc")
    response = accept(api_client, token)
    assert response.status_code == 409 and response.json()["code"] == "username_taken"
    row.refresh_from_db()
    assert row.status() == "pending"
    assert User.objects.filter(username__iexact="maria").count() == 1


def test_public_endpoints_ignore_auth_headers_and_are_not_cached(api_client, admin_user):
    _, token = invite(admin_user)
    api_client.credentials(HTTP_AUTHORIZATION="Bearer not-a-real-token")
    response = api_client.post(CHECK, {"token": token}, format="json")
    assert response.status_code == 200
    assert response["Cache-Control"] == "no-store"
    assert accept(api_client, "nope")["Cache-Control"] == "no-store"


def test_public_endpoints_are_throttled(api_client, monkeypatch):
    monkeypatch.setitem(ScopedRateThrottle.THROTTLE_RATES, "invite", "2/min")
    codes = [api_client.post(CHECK, {"token": "nope"}, format="json").status_code for _ in range(3)]
    assert codes == [404, 404, 429]
    assert accept(api_client, "nope").status_code == 429  # one budget for check and accept


def test_tokens_and_passwords_never_reach_the_logs(api_client, admin_client, admin_user, caplog):
    caplog.set_level(logging.INFO)
    created = admin_client.post(ADMIN_BASE, {"username": "maria"}, format="json").json()
    renewed = admin_client.post(f"{ADMIN_BASE}{created['id']}/new-link/").json()
    api_client.post(CHECK, {"token": renewed["token"]}, format="json")
    assert accept(api_client, renewed["token"]).status_code == 201
    formatter = JsonFormatter()
    lines = [formatter.format(r) for r in caplog.records]
    for secret in (created["token"], renewed["token"], GOOD_PASSWORD):
        assert not any(secret in line for line in lines)
        assert not any(secret in str(r.__dict__) for r in caplog.records)
    events = [(r.event, r.invite_id) for r in caplog.records if getattr(r, "invite_id", None)]
    assert events == [
        ("invite_created", created["id"]),
        ("invite_reissued", created["id"]),
        ("invite_accepted", created["id"]),
    ]


@pytest.mark.django_db(transaction=True)
def test_two_accepts_of_one_link_make_exactly_one_user():
    admin_user = User.objects.create_user(username="admin9", password="pw-for-tests-123")
    _, token = invite(admin_user)

    def attempt(password):
        return lambda: accept(APIClient(), token, password)

    results = run_together([attempt(GOOD_PASSWORD), attempt("another-lantern-77")])
    statuses = sorted(r.status_code for r in results)
    assert statuses == [201, 410]
    assert [r.json()["code"] for r in results if r.status_code == 410] == ["invite_used"]
    assert User.objects.filter(username="maria").count() == 1


# --- database guards (as the app role) --------------------------------------------------------


def test_the_database_allows_one_open_invite_per_username(admin_user):
    invite(admin_user)
    with pytest.raises(IntegrityError), transaction.atomic():
        WorkerInvite.objects.create(
            username="MARIA",
            token_hash="b" * 64,
            created_by=admin_user,
            expires_at=timezone.now(),
        )


def test_the_database_refuses_an_invite_both_accepted_and_revoked(admin_user):
    row, token = invite(admin_user)
    invites.accept(token, GOOD_PASSWORD)
    with pytest.raises(IntegrityError), transaction.atomic():
        WorkerInvite.objects.filter(pk=row.pk).update(revoked_at=timezone.now())
    with pytest.raises(IntegrityError), transaction.atomic():
        WorkerInvite.objects.filter(pk=row.pk).update(accepted_user=None)
