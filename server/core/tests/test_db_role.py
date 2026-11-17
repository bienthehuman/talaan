"""The app and the test suite run as a least-privilege role (docs/ARCHITECTURE.md section 7)."""

import pytest
from django.conf import settings
from django.db import DatabaseError, connection, transaction

pytestmark = pytest.mark.django_db


def test_connected_as_the_app_role_not_the_owner():
    with connection.cursor() as cur:
        cur.execute("SELECT current_user")
        assert cur.fetchone()[0] == settings.DATABASES["default"]["USER"] == "talaan_app"


def test_app_role_is_not_superuser_and_cannot_create_roles_or_dbs():
    with connection.cursor() as cur:
        cur.execute(
            "SELECT rolsuper, rolcreaterole, rolcreatedb FROM pg_roles WHERE rolname = current_user"
        )
        assert cur.fetchone() == (False, False, False)


@pytest.mark.parametrize(
    "ddl",
    [
        "CREATE TABLE should_not_exist (id int)",
        "ALTER TABLE accounts_user ADD COLUMN sneaky int",
        "DROP TABLE django_session",
    ],
)
def test_app_role_cannot_run_ddl(ddl):
    with pytest.raises(DatabaseError), transaction.atomic(), connection.cursor() as cur:
        cur.execute(ddl)


def test_app_role_can_do_normal_dml(worker):
    worker.first_name = "Ana"
    worker.save()
    worker.refresh_from_db()
    assert worker.first_name == "Ana"
