"""Fault injection for tests (docs/protocol.md section 10).

A test asks for a failure with the `X-Fault` request header, so each fault applies to exactly the
request that carries it and nothing is stored on the server (safe with several workers). Values can
be combined, comma separated:

    fail-before          503 without running the view or touching the database
    drop-after-commit    run the view (every mutation commits), then discard the response and
                         send 503: "the server applied it but the response was lost"
    delay=<ms>           run the view, then hold the response (capped at 30 000 ms)
    expire-token[=<n>]   push only: after n mutations are applied (default 1), answer 401

The middleware is installed only when FAULT_INJECTION is on, and refuses to load unless DEBUG is on.
"""

from dataclasses import dataclass

FAULT_HEADER = "X-Fault"
MAX_DELAY_MS = 30_000
KINDS = {"fail-before", "drop-after-commit", "delay", "expire-token"}


@dataclass(frozen=True)
class Fault:
    kind: str
    arg: int | None = None


def parse_faults(header: str) -> list[Fault]:
    """Parse an X-Fault header. Raises ValueError for anything unknown, so a typo in a test fails
    loudly instead of silently injecting nothing."""
    faults = []
    for part in header.split(","):
        part = part.strip()
        if not part:
            continue
        kind, _, raw = part.partition("=")
        if kind not in KINDS:
            raise ValueError(f"Unknown fault '{kind}'. Known: {', '.join(sorted(KINDS))}.")
        arg = None
        if raw:
            if not raw.isdigit():
                raise ValueError(f"Fault '{kind}' takes a whole number, got '{raw}'.")
            arg = int(raw)
        if kind == "delay" and arg is None:
            raise ValueError("Fault 'delay' needs milliseconds, for example delay=500.")
        if kind in {"fail-before", "drop-after-commit"} and arg is not None:
            raise ValueError(f"Fault '{kind}' takes no value.")
        faults.append(Fault(kind, arg))
    return faults


def find(faults: list[Fault], kind: str) -> Fault | None:
    return next((f for f in faults if f.kind == kind), None)
