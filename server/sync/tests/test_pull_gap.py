"""Scenario 8: writers and a puller run at the same time; the puller must see every change.

Postgres hands out sequence numbers in order but commits happen in any order. Without a lock, a
writer holding seq 4 can commit after a writer holding seq 5. A puller that read seq 5 moves its
cursor past 4 and never sees it. The advisory lock makes draw-and-commit one step, so numbers become
visible in order (ADR 0005). `test_without_the_lock_a_puller_skips_changes` shows the failure is
real; docs/writeups/pull-gap.md records it.
"""

import random
import threading
import time

import pytest
from django.db import connection
from rest_framework.test import APIClient

from submissions.models import Submission
from sync import services
from sync.tests.concurrency import run_together
from sync.tests.helpers import create

pytestmark = [
    pytest.mark.phase1,
    pytest.mark.django_db(transaction=True),
]

WRITERS = 8
CREATES_EACH = 6


@pytest.fixture
def slow_commit(monkeypatch):
    """Hold each writer between drawing its number and committing, so interleavings that are rare
    on a quiet machine happen every run. Applies to the locked and unlocked runs alike."""
    real = services._next_server_seq

    def draw_then_dawdle():
        seq = real()
        time.sleep(random.uniform(0, 0.02))
        return seq

    monkeypatch.setattr(services, "_next_server_seq", draw_then_dawdle)


def _puller(admin_user, stop: threading.Event, seen: list[int]):
    client = APIClient()
    client.force_authenticate(admin_user)

    def poll(cursor):
        response = client.get(
            "/api/sync/pull/", {"cursor": cursor, "limit": 500}, HTTP_X_CLIENT_SCHEMA="1"
        )
        assert response.status_code == 200, response.content
        body = response.json()
        seen.extend(r["server_seq"] for r in body["records"])
        return body["next_cursor"]

    def run():
        cursor = 0
        try:
            while not stop.is_set():
                cursor = poll(cursor)
            poll(cursor)  # once more after the last writer has finished
        finally:
            connection.close()

    return run


def _writer(worker, assignment):
    def run():
        for _ in range(CREATES_EACH):
            create(worker, assignment)

    return run


def _race(worker, admin_user, assignment) -> tuple[list[int], list[int]]:
    """One round: concurrent writers and one puller. Returns (what the puller saw, new seqs)."""
    before = set(Submission.objects.values_list("server_seq", flat=True))
    stop, seen = threading.Event(), []
    puller = threading.Thread(target=_puller(admin_user, stop, seen))
    puller.start()
    try:
        run_together([_writer(worker, assignment) for _ in range(WRITERS)])
    finally:
        stop.set()
        puller.join(timeout=30)
    stored = Submission.objects.values_list("server_seq", flat=True)
    return seen, sorted(s for s in stored if s not in before)


def test_a_concurrent_puller_sees_every_change_exactly_once(
    worker, admin_user, assignment, slow_commit
):
    for _ in range(3):
        seen, new = _race(worker, admin_user, assignment)
        # `seen` accumulates over rounds only if reused; here it is per round and the puller starts
        # at cursor 0, so it also re-reads earlier rounds. Compare only this round's numbers.
        mine = [s for s in seen if s in set(new)]
        assert sorted(mine) == new  # nothing skipped, nothing seen twice
        assert len(new) == WRITERS * CREATES_EACH


def test_without_the_lock_a_puller_skips_changes(
    worker, admin_user, assignment, slow_commit, monkeypatch
):
    """The same race with the lock removed. If this stops losing a change, the test above has
    stopped proving anything."""
    monkeypatch.setattr(services, "_take_sequence_lock", lambda: None)

    skipped = 0
    for _ in range(5):
        seen, new = _race(worker, admin_user, assignment)
        skipped += len(set(new) - set(seen))
        if skipped:
            break

    assert skipped > 0, "expected the unlocked race to lose a change"
