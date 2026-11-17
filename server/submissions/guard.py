"""The runtime half of "one write path".

Submissions and their events are written only by `sync.services`. The database already refuses
anything that skips the version bump or the sequence (migration 0002); this guard fails earlier and
with a clearer message: any ORM write outside `write_access()` raises DirectWriteError before it
reaches the database. Only sync.services (and tests that deliberately build fixtures) enter it.
"""

import contextvars
from collections.abc import Iterator
from contextlib import contextmanager

from django.db import models

_allowed: contextvars.ContextVar[bool] = contextvars.ContextVar(
    "submission_writes_allowed", default=False
)


class DirectWriteError(RuntimeError):
    """Raised when code outside the sync service tries to write submissions or their events."""


def check_write_access() -> None:
    if not _allowed.get():
        raise DirectWriteError(
            "Submissions and their events are written only by sync.services "
            "(advisory lock, version bump, ledger, event). Use apply_mutation or "
            "apply_admin_action."
        )


@contextmanager
def write_access() -> Iterator[None]:
    """Allow submission writes inside the block. Used by sync.services and by test fixtures."""
    token = _allowed.set(True)
    try:
        yield
    finally:
        _allowed.reset(token)


class GuardedQuerySet(models.QuerySet):
    def update(self, **kwargs):
        check_write_access()
        return super().update(**kwargs)

    def delete(self):
        check_write_access()
        return super().delete()

    def bulk_create(self, *args, **kwargs):
        check_write_access()
        return super().bulk_create(*args, **kwargs)

    def bulk_update(self, *args, **kwargs):
        check_write_access()
        return super().bulk_update(*args, **kwargs)


class GuardedModel(models.Model):
    objects = GuardedQuerySet.as_manager()

    class Meta:
        abstract = True

    def save(self, *args, **kwargs):
        check_write_access()
        super().save(*args, **kwargs)

    def delete(self, *args, **kwargs):
        check_write_access()
        return super().delete(*args, **kwargs)
