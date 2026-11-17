from django.contrib.auth.models import AbstractUser

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
