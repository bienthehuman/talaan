from rest_framework.permissions import BasePermission

from .permissions import ADMIN, WORKER


class IsWorker(BasePermission):
    message = "Only workers can do this."

    def has_permission(self, request, view) -> bool:
        return bool(request.user and request.user.is_authenticated and request.user.role == WORKER)


class IsWorkerOrAdmin(BasePermission):
    message = "Your account isn't allowed to do this."

    def has_permission(self, request, view) -> bool:
        user = request.user
        return bool(user and user.is_authenticated and user.role in {WORKER, ADMIN})


class IsAdmin(BasePermission):
    message = "Only admins can do this."

    def has_permission(self, request, view) -> bool:
        return bool(request.user and request.user.is_authenticated and request.user.role == ADMIN)


def requires(permission: str) -> type[BasePermission]:
    """Permission class for one catalog permission (accounts/permissions.py). The catalog, not the
    role name, decides: a role that is later given or denied a permission needs no view change."""

    class HasPermission(BasePermission):
        message = "Your account isn't allowed to do this."

        def has_permission(self, request, view) -> bool:
            user = request.user
            return bool(user and user.is_authenticated and user.can(permission))

    HasPermission.__name__ = f"Requires[{permission}]"
    return HasPermission
