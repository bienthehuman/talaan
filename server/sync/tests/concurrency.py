"""Helpers for the tests that use real threads against real Postgres."""

import threading
from concurrent.futures import ThreadPoolExecutor

from django.db import connection


def run_together(jobs, *, timeout=60):
    """Run each callable in its own thread, released at the same instant. Returns the results in
    job order and re-raises the first exception. Each thread closes its own DB connection."""
    barrier = threading.Barrier(len(jobs))

    def wrap(job):
        def run():
            try:
                barrier.wait(timeout=timeout)
                return job()
            finally:
                connection.close()

        return run

    with ThreadPoolExecutor(max_workers=len(jobs)) as pool:
        futures = [pool.submit(wrap(job)) for job in jobs]
        return [f.result(timeout=timeout) for f in futures]
