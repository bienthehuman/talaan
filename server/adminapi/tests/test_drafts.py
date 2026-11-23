"""Form drafts (slice 6.2, ADR 0013, protocol.md section 11)."""

import copy
from functools import partial

import pytest

from forms.models import Form, FormDraft, FormVersion
from forms.samples import GENERATOR_INSPECTION
from sync.tests.api_helpers import SCHEMA_HEADER, api, assert_problem, pull
from sync.tests.concurrency import run_together

pytestmark = pytest.mark.django_db

BASE = "/api/admin"
MARKER = "Draft-only title 7f3c"  # appears nowhere but in the draft


def url(form, rest=""):
    return f"{BASE}/forms/{form.id}/draft/{rest}"


def put(client, form, schema, revision):
    return client.put(url(form), {"schema": schema, "revision": revision}, format="json")


def publish(client, form, revision):
    return client.post(url(form, "publish/"), {"revision": revision}, format="json")


def next_version(title=MARKER, **extra_fields):
    s = copy.deepcopy(GENERATOR_INSPECTION)
    s["title"] = title
    s["properties"].update(extra_fields)
    s["x-order"] = list(s["properties"])
    return s


@pytest.fixture
def form(published_version) -> Form:
    return published_version.form


def test_a_draft_is_started_saved_and_read_back(admin_client, form, published_version, admin_user):
    assert_problem(admin_client.get(url(form)), 404, "not_found")
    started = put(admin_client, form, {"title": "half done"}, 0)  # a draft may be invalid
    assert started.status_code == 201, started.content
    body = started.json()
    assert body["revision"] == 1 and body["schema"] == {"title": "half done"}
    assert body["based_on_version"] == published_version.number
    assert body["updated_by"] == admin_user.username

    saved = put(admin_client, form, next_version(), 1)
    assert saved.status_code == 200 and saved.json()["revision"] == 2
    assert admin_client.get(url(form)).json()["schema"] == next_version()


def test_a_stale_save_is_refused_with_the_current_draft_and_changes_nothing(admin_client, form):
    put(admin_client, form, {"title": "first"}, 0)
    put(admin_client, form, {"title": "second"}, 1)
    stale = put(admin_client, form, {"title": "lost?"}, 1)
    assert_problem(stale, 409, "stale_draft")
    assert stale.json()["draft"]["schema"] == {"title": "second"}
    assert stale.json()["draft"]["revision"] == 2
    again = put(admin_client, form, {"title": "another start"}, 0)  # one already exists
    assert_problem(again, 409, "stale_draft")
    assert FormDraft.objects.get(form=form).schema == {"title": "second"}


def test_saving_a_draft_that_was_published_meanwhile_is_stale(admin_client, form):
    put(admin_client, form, next_version(), 0)
    assert publish(admin_client, form, 1).status_code == 201
    stale = put(admin_client, form, next_version("late"), 1)
    assert_problem(stale, 409, "stale_draft")
    assert stale.json()["draft"] is None


@pytest.mark.parametrize(
    ("schema", "fragment"),
    [
        (["not", "an", "object"], "JSON object"),
        ({"description": "x" * (128 * 1024)}, "at most 128 KB"),
    ],
)
def test_a_draft_must_be_an_object_of_bounded_size(admin_client, form, schema, fragment):
    response = put(admin_client, form, schema, 0)
    assert response.status_code == 400
    assert fragment in str(response.json()["errors"]["schema"])
    assert not FormDraft.objects.filter(form=form).exists()


def test_publishing_creates_the_next_version_and_removes_the_draft(admin_client, form):
    put(admin_client, form, next_version(), 0)
    response = publish(admin_client, form, 1)
    assert response.status_code == 201, response.content
    body = response.json()
    assert body["number"] == 2 and body["schema"] == next_version()
    assert FormVersion.objects.get(pk=body["id"]).is_published
    assert not FormDraft.objects.filter(form=form).exists()


def test_a_refused_draft_stays_and_nothing_is_published(admin_client, form):
    bad = next_version(hours_run={"type": "string", "title": "Hours run"})  # type change
    put(admin_client, form, bad, 0)
    before = FormVersion.objects.count()
    response = publish(admin_client, form, 1)
    assert response.status_code == 400
    assert any("hours_run" in e for e in response.json()["errors"]["schema"])
    assert FormVersion.objects.count() == before
    assert FormDraft.objects.get(form=form).revision == 1


def test_publishing_a_stale_revision_is_refused(admin_client, form):
    put(admin_client, form, next_version(), 0)
    put(admin_client, form, next_version("newer"), 1)
    before = FormVersion.objects.count()
    assert_problem(publish(admin_client, form, 1), 409, "stale_draft")
    assert_problem(
        publish(admin_client, Form.objects.create(name="No draft"), 1), 409, "stale_draft"
    )
    assert FormVersion.objects.count() == before


def test_publish_is_all_or_nothing(admin_client, form, monkeypatch):
    """If removing the draft fails, the new version is rolled back with it."""
    put(admin_client, form, next_version(), 0)
    before = FormVersion.objects.count()

    def boom(self, *args, **kwargs):
        raise RuntimeError("disk full")

    monkeypatch.setattr(FormDraft, "delete", boom)
    admin_client.raise_request_exception = False
    assert publish(admin_client, form, 1).status_code == 500
    assert FormVersion.objects.count() == before
    assert FormDraft.objects.filter(form=form, revision=1).exists()


def test_a_draft_never_reaches_a_worker(admin_client, worker_client, form, assignment):
    put(admin_client, form, next_version(), 0)
    responses = [
        worker_client.get("/api/form-versions/", **SCHEMA_HEADER),
        worker_client.get("/api/assignments/", **SCHEMA_HEADER),
        pull(worker_client),
    ]
    for response in responses:
        assert response.status_code == 200
        assert MARKER not in response.content.decode()
    for response in (
        worker_client.get(url(form)),
        put(worker_client, form, {}, 1),
        publish(worker_client, form, 1),
    ):
        assert response.status_code == 403


def test_admin_api_responses_are_not_cached(admin_client, form):
    put(admin_client, form, next_version(), 0)
    for path in (url(form), f"{BASE}/forms/", f"{BASE}/submissions/"):
        assert admin_client.get(path)["Cache-Control"] == "no-store", path
    assert "no-store" not in admin_client.get("/api/health/").get("Cache-Control", "")


@pytest.mark.django_db(transaction=True)
def test_two_admins_saving_the_same_revision_at_once_cannot_both_win(admin_user):
    """Compare-and-set: of two saves of one revision, exactly one is applied."""
    for round_ in range(10):
        form = Form.objects.create(name=f"Race {round_}")

        def save(form, schema, revision):
            return put(api(admin_user), form, schema, revision).status_code

        a, b = partial(save, form, {"by": "a"}), partial(save, form, {"by": "b"})
        starts = run_together([partial(a, 0), partial(b, 0)])
        assert sorted(starts) == [201, 409]
        saves = run_together([partial(a, 1), partial(b, 1)])
        assert sorted(saves) == [200, 409]
        assert FormDraft.objects.get(form=form).revision == 2
