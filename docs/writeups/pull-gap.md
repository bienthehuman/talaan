# The pull gap: why a cursor needs a lock

Scenario 8, guarantee 4 in `docs/protocol.md`: a device that pulls with a cursor sees every change,
exactly once.

## The problem

Each accepted change gets a `server_seq` from a Postgres sequence, and a pull asks for rows with
`server_seq > cursor`. A sequence hands out numbers in order, but transactions commit in any order:

1. Writer A draws 41. Writer B draws 42.
2. B commits first. A puller reads and sees 42, so its cursor becomes 42.
3. A commits 41. The puller asks for `> 42`. Change 41 is never delivered.

Nothing errors. A device silently misses a change forever.

## The fix

Every write takes `pg_advisory_xact_lock(4242)` before it draws a number and holds it until commit
(`sync/services.py`, ADR 0005). Drawing and committing become one step, so numbers become visible
in order and a puller never sees 42 before 41. Writes are serialised on this lock; at the PoC's
scale that is a few milliseconds per write.

## The proof

`server/sync/tests/test_pull_gap.py`. Eight writer threads create six records each while a puller
thread polls `GET /api/sync/pull/` in a loop, all against real Postgres as the app role. Each writer
sleeps up to 20 ms between drawing its number and committing, so the interleaving that is rare on a
quiet machine happens every run (it is applied with and without the lock).

- **With the lock:** every one of the 48 new numbers is seen by the puller exactly once, over three
  rounds.
- **Without the lock** (the lock statement replaced with `pass`), recorded 2026-11-18, four runs of
  the same test:

  ```
  E   assert [15595, 15598, ..., 15603, ...] == [15593, 15594, ..., 15598, ...]
  E     At index 0 diff: 15595 != 15593
  E     Right contains 11 more items, first extra item: 15630
  1 failed   (4 of 4 runs)
  ```

  The puller never saw 15593 and 15594, and 11 more later in the round.

`test_without_the_lock_a_puller_skips_changes` keeps that demonstration in the suite: it removes the
lock and requires the race to lose a change. If it ever stops losing one, the main test has stopped
proving anything. The planted-bug check (`server/scripts/mutation_check_service.py`) also removes the
lock and requires a failure.
