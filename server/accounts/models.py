from django.contrib.auth.models import AbstractUser
from django.contrib.auth.validators import UnicodeUsernameValidator
from django.db import models
from django.db.models.functions import Lower
from django.utils import timezone

from .permissions import ADMIN, WORKER, permissions_for


class User(AbstractUser):
    """Custom user from day one. Roles are data: membership of the `worker` or `admin` group."""

    @property
    def role(self) -> str | None:
        names = set(self.groups.values_list("name", flat=True))
        if ADMIN in names or self.is_superuser:
            return ADMIN
        if WORKER in names:
            return WORKER
        return None

    def can(self, permission: str) -> bool:
        return permission in permissions_for(self.role)


class WorkerInvite(models.Model):
    """A one-time link that lets someone become a worker by setting their own password (ADR 0014).
    Only the SHA-256 of the token is stored; the user is created when the invite is accepted."""

    username = models.CharField(max_length=150, validators=[UnicodeUsernameValidator()])
    first_name = models.CharField(max_length=150, blank=True)
    last_name = models.CharField(max_length=150, blank=True)
    token_hash = models.CharField(max_length=64, unique=True)
    created_by = models.ForeignKey(User, on_delete=models.PROTECT, related_name="+")
    created_at = models.DateTimeField(default=timezone.now)
    expires_at = models.DateTimeField()
    accepted_at = models.DateTimeField(null=True, blank=True)
    accepted_user = models.OneToOneField(
        User, null=True, blank=True, on_delete=models.PROTECT, related_name="invite"
    )
    revoked_at = models.DateTimeField(null=True, blank=True)

    class Meta:
        constraints = [
            # One open invite per username (case-insensitive); expired ones still hold it until
            # revoked or replaced, so the admin sees why.
            models.UniqueConstraint(
                Lower("username"),
                condition=models.Q(accepted_at__isnull=True, revoked_at__isnull=True),
                name="accounts_workerinvite_one_open_per_username",
            ),
            models.CheckConstraint(
                condition=models.Q(accepted_at__isnull=True) | models.Q(revoked_at__isnull=True),
                name="accounts_workerinvite_not_accepted_and_revoked",
            ),
            models.CheckConstraint(
                condition=models.Q(accepted_at__isnull=True, accepted_user__isnull=True)
                | models.Q(accepted_at__isnull=False, accepted_user__isnull=False),
                name="accounts_workerinvite_accepted_has_user",
            ),
        ]

    def __str__(self) -> str:
        return f"invite {self.username} ({self.status()})"

    def status(self, now=None) -> str:
        if self.accepted_at:
            return "accepted"
        if self.revoked_at:
            return "revoked"
        if self.expires_at <= (now or timezone.now()):
            return "expired"
        return "pending"
