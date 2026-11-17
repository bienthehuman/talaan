"""RFC 7807 problem+json errors with stable `code` values (docs/protocol.md section 9)."""

from django.core.exceptions import PermissionDenied
from django.http import Http404
from rest_framework import exceptions
from rest_framework.response import Response
from rest_framework.views import exception_handler

PROBLEM_CONTENT_TYPE = "application/problem+json"

CODES: list[tuple[type[Exception], str]] = [
    (exceptions.NotAuthenticated, "unauthenticated"),
    (exceptions.AuthenticationFailed, "unauthenticated"),
    (exceptions.PermissionDenied, "forbidden"),
    (exceptions.NotFound, "not_found"),
    (exceptions.ValidationError, "validation_error"),
    (exceptions.Throttled, "rate_limited"),
    (exceptions.MethodNotAllowed, "method_not_allowed"),
    (exceptions.ParseError, "parse_error"),
    (exceptions.UnsupportedMediaType, "unsupported_media_type"),
    (exceptions.NotAcceptable, "not_acceptable"),
]

TITLES = {
    400: "Bad request",
    401: "Not authenticated",
    403: "Forbidden",
    404: "Not found",
    405: "Method not allowed",
    406: "Not acceptable",
    415: "Unsupported media type",
    426: "Upgrade required",
    429: "Too many requests",
    500: "Server error",
    503: "Service unavailable",
}


def problem(status: int, code: str, detail: str, **extra) -> dict:
    return {
        "type": "about:blank",
        "title": TITLES.get(status, "Error"),
        "status": status,
        "code": code,
        "detail": detail,
        **extra,
    }


def problem_response(status: int, code: str, detail: str, headers=None, **extra) -> Response:
    return Response(
        problem(status, code, detail, **extra),
        status=status,
        headers=headers,
        content_type=PROBLEM_CONTENT_TYPE,
    )


def _code_for(exc: Exception) -> str:
    for cls, code in CODES:
        if isinstance(exc, cls):
            return code
    return getattr(exc, "default_code", "error")


def problem_exception_handler(exc, context):
    """DRF exception handler. Unhandled exceptions return None so Django's 500 handler runs."""
    if isinstance(exc, Http404):
        exc = exceptions.NotFound()
    elif isinstance(exc, PermissionDenied):
        exc = exceptions.PermissionDenied()

    response = exception_handler(exc, context)
    if response is None:
        return None

    detail = exc.detail if isinstance(exc, exceptions.APIException) else str(exc)
    extra = {}
    if isinstance(exc, exceptions.ValidationError):
        extra["errors"] = detail
        message = "Request validation failed."
    elif isinstance(detail, (list, dict)):
        message = str(exc.default_detail)
    else:
        message = str(detail)

    headers = {}
    if isinstance(exc, exceptions.Throttled) and exc.wait is not None:
        headers["Retry-After"] = str(int(exc.wait) + 1)
        extra["retry_after"] = int(exc.wait) + 1
    if "WWW-Authenticate" in response.headers:
        headers["WWW-Authenticate"] = response.headers["WWW-Authenticate"]

    return problem_response(response.status_code, _code_for(exc), message, headers=headers, **extra)
