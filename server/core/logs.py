"""Structured logs: one JSON object per line, every line tied to its request.

Only an allowlist of fields is ever written, so a log line cannot leak a token, a password or what
somebody typed into a form by accident: nothing outside `FIELDS` is read from a log record.
"""

import json
import logging
from contextvars import ContextVar
from datetime import UTC, datetime

# What a request carries while it is being handled. Set by the middleware and the sync views, read
# by the filter below, so even a log line from deep inside the sync service has the ids.
_context: ContextVar[dict | None] = ContextVar("log_context", default=None)

FIELDS = (
    "event",
    "method",
    "path",
    "status",
    "duration_ms",
    "user_id",
    "device_id",
    "mutation_id",
    "record_id",
    "op",
    "code",
    "kind",
    "cursor",
    "count",
    "has_more",
    "lock_wait_ms",
    "lock_hold_ms",
)


def set_context(**values) -> None:
    """Add ids to every log line written for the rest of this request."""
    _context.set({**(_context.get() or {}), **{k: v for k, v in values.items() if v is not None}})


def clear_context() -> None:
    _context.set(None)


def get_context() -> dict:
    return dict(_context.get() or {})


class ContextFilter(logging.Filter):
    """Copies the request's ids onto each record, unless the record already names them."""

    def filter(self, record: logging.LogRecord) -> bool:
        for key, value in get_context().items():
            if not hasattr(record, key):
                setattr(record, key, value)
        return True


class JsonFormatter(logging.Formatter):
    def format(self, record: logging.LogRecord) -> str:
        entry: dict = {
            "ts": datetime.fromtimestamp(record.created, UTC).isoformat(timespec="milliseconds"),
            "level": record.levelname,
            "logger": record.name,
            "message": record.getMessage(),
        }
        request_id = getattr(record, "request_id", None)
        if request_id:
            entry["request_id"] = request_id
        for field in FIELDS:
            value = getattr(record, field, None)
            if value is not None:
                entry[field] = str(value) if field.endswith("_id") else value
        if record.exc_info:
            entry["exception"] = self.formatException(record.exc_info)
        return json.dumps(entry, default=str)
