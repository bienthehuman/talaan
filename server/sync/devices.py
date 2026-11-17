import uuid

from django.db import transaction
from django.utils import timezone

from accounts.models import User

from .models import Device


def register_device(user: User, device_id: uuid.UUID, app_version: str) -> Device:
    """First sync registers the device; later syncs refresh it (docs/protocol.md rule 9).

    A browser profile shared by two people keeps one device id, so the device simply moves to
    whoever synced last; the ledger keeps who sent each mutation."""
    with transaction.atomic():
        device, _ = Device.objects.update_or_create(
            id=device_id,
            defaults={"user": user, "last_seen_at": timezone.now(), "app_version": app_version},
        )
    return device
