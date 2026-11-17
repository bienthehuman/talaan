import uuid

from django.conf import settings
from django.db import models
from django.utils import timezone


class AppliedMutation(models.Model):
    """The idempotency ledger: one row per mutation ever processed (ADR 0004).

    The row is inserted first, in the same transaction as the change, with an empty `result`; the
    result is then set exactly once. Rows are never deleted. A trigger enforces both rules.
    """

    mutation_id = models.UUIDField(primary_key=True, editable=False)
    # Not a foreign key: the ledger row is written before anything else about the request.
    device_id = models.UUIDField()
    user = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.PROTECT, related_name="+")
    result = models.JSONField(default=dict)
    created_at = models.DateTimeField(default=timezone.now)

    def __str__(self) -> str:
        return str(self.mutation_id)


class Device(models.Model):
    """A browser profile that syncs. Registered on its first sync."""

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    user = models.ForeignKey(
        settings.AUTH_USER_MODEL, on_delete=models.PROTECT, related_name="devices"
    )
    last_seen_at = models.DateTimeField(default=timezone.now)
    app_version = models.CharField(max_length=64, blank=True)

    def __str__(self) -> str:
        return str(self.id)
