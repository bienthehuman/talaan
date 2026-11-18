# Load test

What this measures, how to run it, and how to read the numbers. The results are in
[results.md](results.md). The point is to find where the write path stops scaling and to say why, not to
publish a big number.

## What is simulated

One k6 virtual user is one **device**: its own worker login (`loadtest001` to `loadtest100`, created by
`manage.py seed_loadtest`), its own device id and its own records. Each iteration is one sync cycle, as the
real client does it:

1. push a batch of 1 to 4 mutations (a quarter of them create a record, the rest edit one field or two of
   a record the device already owns, with the right `base_version`),
2. pull with the saved cursor until `has_more` is false,
3. wait `THINK` seconds (0.5 to 1.5 times the setting, random).

Devices never touch each other's records, so **there are no conflicts**: this is the write path (the one
advisory lock, ADR 0005, which every accepted change takes before it draws a `server_seq`) and the pull
path, not conflict handling. A conflicting mutation does the same work as an applied one up to the check,
and then writes less, so a conflict-heavy load would look better than this, not worse.

Two standard runs:

| Run | Devices | Think time | Question it answers |
|---|---|---|---|
| `realistic` | 50 | about 1 s | What does a field team of 50 phones, all syncing about once a second, look like? |
| `saturation` | 1, 5, 10, 25, 50, 100 | 0 | How much can the write path do, and what limits it? |

With no think time a device is a closed loop: it sends the next cycle the moment the last one returns, so
more devices means more queueing, and throughput stops rising when something saturates.

## How to run it

Needs Docker (k6 runs from the `grafana/k6:2.4.0` image; nothing to install).

```bash
bash loadtest/run.sh               # both standard runs, about 7 minutes
bash loadtest/run.sh realistic
bash loadtest/run.sh saturation
DEVICES="10 50" DURATION=30s THINK=0 LABEL=mine bash loadtest/run.sh custom
WEB_CONCURRENCY=6 bash loadtest/run.sh saturation     # a different number of gunicorn workers
```

`run.sh` brings the compose stack up, raises `THROTTLE_PUSH` (otherwise each device would be stopped by the
120-pushes-a-minute limit and the test would measure the rate limiter), switches the server to JSON logs,
seeds 100 workers, and for each step runs k6 while sampling Postgres once a second. It does **not** reset
the database, so the dataset grows from step to step; the row counts before and after are reported. For a
clean start run `docker compose down -v` first (then `bash server/scripts/migrate.sh` before host pytest).
`python3 loadtest/analyze.py <results dir>` rebuilds the table from the saved files.

## What the columns mean

- **Mutations/s, Requests/s**: what k6 sent and got back. Mutations are the unit of work; a request is a
  push or a pull.
- **Push / pull / cycle p50, p95**: latency in milliseconds as the device sees it, through nginx and
  gunicorn. A cycle is a push plus its pulls, without the think time.
- **Errors %**: failed HTTP requests. Anything above 0 means the run measured an overloaded server and the
  other numbers need that caveat.
- **Lock wait p50/p95**: time a mutation spent waiting for the advisory lock, measured in the server around
  `pg_advisory_xact_lock` and logged on each `mutation` line (`lock_wait_ms`).
- **Lock held p50/p95**: time from acquiring the lock to the end of the commit (`lock_hold_ms`). The lock is
  released by the commit, so this includes the commit's disk flush.
- **Lock busy**: the sum of all lock hold times divided by the wall-clock time of the step. Because the lock
  admits one writer at a time, this is the fraction of time the write path was occupied. Near 100% means
  writers are queueing behind each other.
- **Waiting on lock avg/max**: Postgres sessions found waiting on the advisory lock, sampled once a second
  from `pg_stat_activity` (an independent check on the numbers above).

## How to read it

A writer's time is: waiting for the lock, then holding it. If lock wait stays near zero while latency
grows, the limit is somewhere else (CPU, connections, Python). If lock busy climbs towards 100% and the
wait grows with the device count while the hold time stays flat, writes have become serial and the lock is
the bottleneck. That is a design choice with a known cost (ADR 0005), and the way out is in the README's
"what I would change at scale".

## Conditions and limits

Stated in [results.md](results.md) with the numbers: the hardware, that **k6, nginx, gunicorn and Postgres
all share one machine** (so the load generator competes with the system under test), the Postgres
configuration (stock `postgres:18` image, `fsync` on), the worker count, and the dataset size. These are
laptop-scale numbers for comparing runs, not a capacity promise for a server.
