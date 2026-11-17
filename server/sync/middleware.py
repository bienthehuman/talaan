import json
import time

from django.conf import settings
from django.core.exceptions import ImproperlyConfigured
from django.http import HttpResponse

from core.errors import PROBLEM_CONTENT_TYPE, problem

from .faults import FAULT_HEADER, MAX_DELAY_MS, find, parse_faults


def _problem(status: int, code: str, detail: str) -> HttpResponse:
    return HttpResponse(
        json.dumps(problem(status, code, detail)), status=status, content_type=PROBLEM_CONTENT_TYPE
    )


class FaultInjectionMiddleware:
    """Honours the X-Fault header on /api/sync/ requests. See sync/faults.py."""

    def __init__(self, get_response):
        if not (settings.DEBUG and settings.FAULT_INJECTION):
            raise ImproperlyConfigured(
                "FaultInjectionMiddleware needs DJANGO_DEBUG=1 and FAULT_INJECTION=1; "
                "it must never be installed in production."
            )
        self.get_response = get_response

    def __call__(self, request):
        header = request.headers.get(FAULT_HEADER)
        if not header or not request.path.startswith("/api/sync/"):
            return self.get_response(request)

        try:
            faults = parse_faults(header)
        except ValueError as exc:
            return _problem(400, "invalid_fault", str(exc))
        request.faults = faults

        if find(faults, "fail-before"):
            return _problem(503, "fault_injected", "Injected fault: fail-before.")

        response = self.get_response(request)  # the view runs and every mutation commits

        if delay := find(faults, "delay"):
            time.sleep(min(delay.arg or 0, MAX_DELAY_MS) / 1000)
        if find(faults, "drop-after-commit"):
            return _problem(
                503, "fault_injected", "Injected fault: the change was applied, the response lost."
            )
        return response
