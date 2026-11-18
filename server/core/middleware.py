import logging
import re
import time
import uuid

from . import logs

log = logging.getLogger("talaan.request")

# A caller (the proxy, a test) may supply its own id; anything else is replaced, so a log line
# can never be forged or flooded through this header.
VALID_REQUEST_ID = re.compile(r"^[A-Za-z0-9._-]{8,64}$")
HEADER = "X-Request-ID"


class RequestLogMiddleware:
    """Gives every request an id, returns it in `X-Request-ID`, and writes one log line for it."""

    def __init__(self, get_response):
        self.get_response = get_response

    def __call__(self, request):
        supplied = request.headers.get(HEADER, "")
        request_id = supplied if VALID_REQUEST_ID.match(supplied) else uuid.uuid4().hex
        logs.clear_context()
        logs.set_context(request_id=request_id)
        started = time.monotonic()
        status = 500
        try:
            response = self.get_response(request)
            status = response.status_code
            response[HEADER] = request_id
            return response
        finally:
            log.info(
                "request",
                extra={
                    "event": "request",
                    "method": request.method,
                    "path": request.path,  # never the query string
                    "status": status,
                    "duration_ms": round((time.monotonic() - started) * 1000, 1),
                },
            )
            logs.clear_context()
