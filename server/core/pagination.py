from rest_framework.pagination import LimitOffsetPagination


class StandardPagination(LimitOffsetPagination):
    """List contract (docs/CONVENTIONS.md): `limit` default 50, max 200;
    envelope `{count, next, previous, results}`."""

    default_limit = 50
    max_limit = 200
