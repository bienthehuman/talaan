"""One write path (docs/BUILD_PLAN.md slice 1.2): submissions and their events are written only by
sync.services. The runtime guard refuses anything else before it reaches the database; a source scan
makes sure nobody quietly opens the gate."""

import ast
import uuid
from pathlib import Path

import pytest

from submissions.guard import DirectWriteError, GuardedQuerySet, write_access
from submissions.models import Submission, SubmissionEvent
from sync.tests.helpers import create, row

pytestmark = pytest.mark.django_db

SERVER = Path(__file__).resolve().parents[2]


@pytest.fixture
def record(worker, assignment):
    return row(create(worker, assignment)[0])


def test_reading_is_always_allowed(record):
    assert Submission.objects.filter(pk=record.pk).exists()
    assert SubmissionEvent.objects.count() >= 1


def test_the_managers_are_guarded():
    assert isinstance(Submission.objects.all(), GuardedQuerySet)
    assert isinstance(SubmissionEvent.objects.all(), GuardedQuerySet)


def test_every_direct_write_to_a_submission_is_refused(record, assignment):
    with pytest.raises(DirectWriteError):
        Submission.objects.create(
            id=uuid.uuid4(),
            assignment=assignment,
            form_version=assignment.form_version,
            server_seq=1,
        )
    with pytest.raises(DirectWriteError):
        record.data = {"hacked": True}
        record.save()
    with pytest.raises(DirectWriteError):
        Submission.objects.filter(pk=record.pk).update(status="approved")
    with pytest.raises(DirectWriteError):
        Submission.objects.filter(pk=record.pk).delete()
    with pytest.raises(DirectWriteError):
        record.delete()
    with pytest.raises(DirectWriteError):
        Submission.objects.bulk_create([Submission(id=uuid.uuid4())])
    with pytest.raises(DirectWriteError):
        Submission.objects.bulk_update([record], ["data"])
    with pytest.raises(DirectWriteError):
        Submission.objects.update_or_create(pk=record.pk, defaults={"status": "approved"})
    assert row(record.pk).status == "draft"


def test_events_cannot_be_written_directly_either(record):
    with pytest.raises(DirectWriteError):
        SubmissionEvent.objects.create(submission=record, version=1, kind="created")
    with pytest.raises(DirectWriteError):
        SubmissionEvent.objects.filter(submission=record).update(kind="deleted")


def test_the_gate_opens_only_inside_the_block_and_closes_again(record):
    with write_access():
        with write_access():  # nesting is fine
            pass
        Submission.objects.filter(pk=record.pk).count()  # reads are unaffected
    with pytest.raises(DirectWriteError):
        record.save()


def test_the_gate_closes_even_if_the_block_raises(record):
    with pytest.raises(ValueError, match="boom"), write_access():
        raise ValueError("boom")
    with pytest.raises(DirectWriteError):
        record.save()


def test_the_error_says_where_to_go():
    with pytest.raises(DirectWriteError, match="apply_mutation"):
        Submission(id=uuid.uuid4()).save()


# --- source scan: the gate is opened in one place ------------------------------------------------
# Parsed with `ast`, so only real references count, not words inside strings or comments.

SKIP_DIRS = {".venv", "migrations", "tests", "staticfiles", "__pycache__"}
GATE_NAMES = {"write_access", "check_write_access"}
WRITE_METHODS = {
    "create",
    "bulk_create",
    "bulk_update",
    "update",
    "get_or_create",
    "update_or_create",
    "delete",
}
GUARDED_MODELS = {"Submission", "SubmissionEvent"}


def application_trees():
    for path in SERVER.rglob("*.py"):
        parts = set(path.relative_to(SERVER).parts)
        if parts & SKIP_DIRS or path.name == "conftest.py":
            continue
        yield str(path.relative_to(SERVER)), ast.parse(path.read_text())


def test_only_the_sync_service_opens_the_write_gate():
    users = set()
    for name, tree in application_trees():
        for node in ast.walk(tree):
            referenced = (
                (isinstance(node, ast.Name) and node.id in GATE_NAMES)
                or (isinstance(node, ast.Attribute) and node.attr in GATE_NAMES)
                or (isinstance(node, ast.alias) and node.name in GATE_NAMES)
            )
            if referenced:
                users.add(name)
    assert users == {"submissions/guard.py", "sync/services.py"}


def test_no_application_code_writes_submissions_through_the_orm_except_the_service():
    offenders = set()
    for name, tree in application_trees():
        if name == "sync/services.py":
            continue
        for node in ast.walk(tree):
            # <Model>.objects.<write method>(...)
            if (
                isinstance(node, ast.Attribute)
                and node.attr in WRITE_METHODS
                and isinstance(node.value, ast.Attribute)
                and node.value.attr == "objects"
                and isinstance(node.value.value, ast.Name)
                and node.value.value.id in GUARDED_MODELS
            ):
                offenders.add(name)
    assert offenders == set(), f"write submissions only through sync.services: {sorted(offenders)}"


def test_the_scan_really_sees_the_service_and_would_catch_a_violation():
    """Guards against the scan silently scanning nothing, or a pattern that never matches."""
    names = {name for name, _ in application_trees()}
    assert {"sync/services.py", "submissions/guard.py", "forms/validation.py"} <= names

    violation = ast.parse(
        "Submission.objects.filter(pk=1).update(status='x')\nSubmission.objects.create()"
    )
    hits = [
        n
        for n in ast.walk(violation)
        if isinstance(n, ast.Attribute)
        and n.attr in WRITE_METHODS
        and isinstance(n.value, ast.Attribute)
        and n.value.attr == "objects"
    ]
    assert len(hits) == 1  # the direct .objects.create(); a chained .filter().update() is the
    # runtime guard's job, which test_every_direct_write_to_a_submission_is_refused covers
