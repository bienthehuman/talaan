import os
import uuid

import psycopg
import pytest
from django.conf import settings
from django.contrib.auth.models import Group
from django.core.cache import cache
from django.db import connection
from django.db.migrations.executor import MigrationExecutor
from rest_framework.test import APIClient

from accounts.models import User
from accounts.permissions import ADMIN, WORKER
from assignments.models import Assignment
from forms.models import Form, FormVersion
from forms.samples import GENERATOR_INSPECTION
from submissions.guard import write_access
from submissions.models import Submission


@pytest.fixture(scope="session")
def django_db_setup(django_db_blocker):
    """Use the pre-migrated test database as the least-privilege app role.

    pytest-django would normally create and migrate a throwaway database, which needs DDL rights
    the app role deliberately lacks. Migrations run as the owner role (scripts/migrate.sh), so
    here we only verify nothing is pending.
    """
    with django_db_blocker.unblock():
        executor = MigrationExecutor(connection)
        pending = executor.migration_plan(executor.loader.graph.leaf_nodes())
        if pending:
            pytest.exit(
                "Test database has unapplied migrations. Run: bash server/scripts/migrate.sh",
                returncode=3,
            )


@pytest.fixture(autouse=True)
def _clear_cache():
    cache.clear()
    yield
    cache.clear()


def _make_user(username: str, role: str, password: str = "pw-for-tests-123") -> User:
    user = User.objects.create_user(username=username, password=password, is_staff=role == ADMIN)
    user.groups.add(Group.objects.get(name=role))
    return user


@pytest.fixture
def worker(db) -> User:
    return _make_user("worker1", WORKER)


@pytest.fixture
def admin_user(db) -> User:
    return _make_user("admin1", ADMIN)


@pytest.fixture
def api_client() -> APIClient:
    return APIClient()


@pytest.fixture
def worker_client(worker) -> APIClient:
    client = APIClient()
    client.force_authenticate(worker)
    return client


@pytest.fixture
def other_worker(db) -> User:
    return _make_user("worker2", WORKER)


@pytest.fixture
def published_version(db) -> FormVersion:
    form = Form.objects.create(name="Generator inspection")
    version = FormVersion.objects.create(form=form, schema=GENERATOR_INSPECTION)
    version.publish()
    return version


@pytest.fixture
def assignment(published_version, worker) -> Assignment:
    return Assignment.objects.create(
        form_version=published_version, worker=worker, site_name="North plant"
    )


def next_server_seq() -> int:
    """Tests that build rows by hand need a sequence value. Production code takes it under the
    advisory lock in sync.services; this is only for setting up fixtures."""
    with connection.cursor() as cursor:
        cursor.execute("SELECT nextval('submission_server_seq')")
        return cursor.fetchone()[0]


@pytest.fixture
def make_submission(assignment):
    """Build a submission row directly. Fixture setup only: the guard test in slice 1.2 keeps
    application code from doing this."""

    def factory(**overrides) -> Submission:
        values = {
            "id": uuid.uuid4(),
            "assignment": assignment,
            "form_version": assignment.form_version,
            "data": {"oil_level": "ok"},
            "field_versions": {"oil_level": 1},
            "server_seq": next_server_seq(),
        }
        values.update(overrides)
        with write_access():
            return Submission.objects.create(**values)

    return factory


@pytest.fixture
def owner_conn():
    """A connection as the schema OWNER role, inside a transaction that is always rolled back.

    The application role has some privileges revoked, which would hide the database triggers behind
    them. The owner has the privileges, so a failure here proves the trigger itself. Foreign keys
    are deferred, so a test can insert a row without building its parents."""
    cfg = settings.DATABASES["default"]
    conn = psycopg.connect(
        host=cfg["HOST"],
        port=cfg["PORT"],
        dbname=cfg["NAME"],
        user=os.environ.get("POSTGRES_OWNER_USER", "talaan_owner"),
        password=os.environ.get("POSTGRES_OWNER_PASSWORD", "talaan_owner_dev"),
    )
    conn.execute("SET CONSTRAINTS ALL DEFERRED")
    try:
        yield conn
    finally:
        conn.rollback()
        conn.close()


@pytest.fixture
def admin_client(admin_user) -> APIClient:
    client = APIClient()
    client.force_authenticate(admin_user)
    return client


@pytest.fixture
def other_worker_client(other_worker) -> APIClient:
    client = APIClient()
    client.force_authenticate(other_worker)
    return client


@pytest.fixture
def fault_injection(settings):
    """Put the fault-injection middleware in the stack, as FAULT_INJECTION=1 does in development.
    Create API clients *after* this fixture so they pick the middleware up."""
    settings.DEBUG = True
    settings.FAULT_INJECTION = True
    settings.MIDDLEWARE = [*settings.MIDDLEWARE, "sync.middleware.FaultInjectionMiddleware"]
