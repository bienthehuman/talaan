import pytest
from django.contrib.auth.models import Group
from django.core.cache import cache
from django.db import connection
from django.db.migrations.executor import MigrationExecutor
from rest_framework.test import APIClient

from accounts.models import User
from accounts.permissions import ADMIN, WORKER


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
