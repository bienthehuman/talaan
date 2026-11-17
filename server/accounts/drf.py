from rest_framework.permissions import BasePermission

from .permissions import ADMIN, WORKER


class IsWorker(BasePermission):
    message = "Only workers can do this."

    def has_permission(self, request, view) -> bool:
        return bool(request.user and request.user.is_authenticated and request.user.role == WORKER)


class IsWorkerOrAdmin(BasePermission):
    message = "Your role cannot do this."

    def has_permission(self, request, view) -> bool:
        user = request.user
        return bool(user and user.is_authenticated and user.role in {WORKER, ADMIN})
