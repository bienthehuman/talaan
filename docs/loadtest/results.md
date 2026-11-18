# Load test results

Run on 2026-11-18 with the commands in [README.md](README.md). Raw k6 summaries, Postgres samples and the
per-step tables are in `loadtest/results/`; the server logs they were derived from are not committed (they
are large) but `run.sh` recreates them.

## Conditions

| | |
|---|---|
| Machine | AMD Ryzen 5 7430U laptop, 12 threads, 7.5 GB RAM, WSL2 (Linux 6.6), Docker 29.9.3 |
| Everything on one machine | k6, nginx, gunicorn, Postgres and the desktop all share the same CPU and memory. The load generator competes with the system under test. |
| App server | gunicorn with 3 sync workers (`WEB_CONCURRENCY`), Django in DEBUG=1 (the dev compose stack), JSON logs on stdout, push rate limit raised so it is not the limiter |
| Database | stock `postgres:18` image (18.6), `shared_buffers=128MB`, `max_connections=100`, `fsync=on`, `synchronous_commit=on` unless stated |
| Load tool | k6 2.4.0 (`grafana/k6:2.4.0`), `devices.js`: one virtual user is one device with its own login, device id and records; a sync cycle is push 1 to 4 mutations then pull until caught up; no conflicts |
| Dataset | started from 0 submissions; **it grows during the runs**, from about 750 submissions and 3,700 ledger rows at the end of the first run to about 6,200 and 59,000 at the end of the last. Row counts before and after each set are below. |
| Repetition | **each configuration ran once**, for 45 to 60 seconds. I did not repeat runs, so a difference below roughly 10% is inside the noise and nothing here has a confidence interval. |

These are laptop numbers for understanding the shape of the system and comparing configurations. They are not a capacity promise for a server.

## 1. What a field team looks like

50 devices, each syncing about every 10 seconds (60 s per step):

Think time 10 s between sync cycles, 60s per step, 3 gunicorn workers.

| Devices | Mutations/s | Requests/s | Push p50 ms | Push p95 ms | Pull p95 ms | Cycle p95 ms | Errors % | Lock wait p50/p95 ms | Lock held p50/p95 ms | Lock busy | Waiting on lock avg/max |
|---|---|---|---|---|---|---|---|---|---|---|---|
| 50 | 6.6 | 8.7 | 24 | 40 | 13 | 51 | 0.00 | 0.2 / 6.0 | 6.9 / 8.2 | 5% | 0.0 / 0 |

Dataset before: submissions=5269 events=53413 ledger=53413 users=103
Dataset after: submissions=5476 events=53874 ledger=53874 users=103

About 7 mutations a second, push p95 40 ms, the lock busy 5% of the time, no errors. This is the load the
app is designed for (its own timer is 60 s, plus a sync 1.5 s after each local change), and it is far from
any limit.

## 2. A heavy team: 50 devices syncing about once a second

(60 s per step.) That is roughly ten times the field rate above.

Think time 1 s between sync cycles, 60s per step, 3 gunicorn workers.

| Devices | Mutations/s | Requests/s | Push p50 ms | Push p95 ms | Pull p95 ms | Cycle p95 ms | Errors % | Lock wait p50/p95 ms | Lock held p50/p95 ms | Lock busy | Waiting on lock avg/max |
|---|---|---|---|---|---|---|---|---|---|---|---|
| 50 | 90.5 | 81.9 | 66 | 180 | 139 | 299 | 0.00 | 6.8 / 15.4 | 7.6 / 9.7 | 73% | 0.8 / 2 |

Dataset before: submissions=5476 events=53874 ledger=53874 users=103
Dataset after: submissions=6226 events=59444 ledger=59444 users=103

About 90 mutations a second. Still no errors, push p95 180 ms, pull p95 139 ms, but the lock is already busy
73% of the time.

## 3. Saturation: no pause between cycles

Each device sends its next cycle the moment the last one returns (45 s per step, 3 workers):

Think time 0 s between sync cycles, 45s per step, 3 gunicorn workers.

| Devices | Mutations/s | Requests/s | Push p50 ms | Push p95 ms | Pull p95 ms | Cycle p95 ms | Errors % | Lock wait p50/p95 ms | Lock held p50/p95 ms | Lock busy | Waiting on lock avg/max |
|---|---|---|---|---|---|---|---|---|---|---|---|
| 1 | 65.0 | 54.8 | 25 | 40 | 11 | 51 | 0.00 | 0.2 / 0.3 | 6.4 / 8.0 | 43% | 0.0 / 0 |
| 5 | 115.9 | 99.1 | 67 | 111 | 58 | 152 | 0.00 | 7.6 / 15.8 | 7.8 / 10.3 | 94% | 1.0 / 2 |
| 10 | 117.0 | 100.1 | 115 | 173 | 123 | 264 | 0.00 | 7.5 / 15.5 | 7.7 / 9.7 | 94% | 1.0 / 2 |
| 25 | 111.7 | 99.3 | 256 | 352 | 313 | 568 | 0.00 | 7.6 / 15.6 | 7.8 / 9.8 | 90% | 0.9 / 2 |
| 50 | 101.2 | 91.8 | 519 | 774 | 727 | 1118 | 0.00 | 8.7 / 15.9 | 7.7 / 9.6 | 81% | 1.1 / 2 |
| 100 | 81.0 | 82.7 | 1029 | 1656 | 1611 | 2345 | 0.00 | 10.6 / 17.0 | 7.9 / 10.0 | 67% | 0.9 / 2 |

Dataset before: submissions=749 events=3739 ledger=3739 users=103
Dataset after: submissions=3242 events=30564 ledger=30564 users=103

What the table says:

- **Throughput stops rising at about 5 devices, at roughly 115 to 120 mutations per second.** At 5 devices
  the lock is busy 94% of the time. The lock admits one writer at a time and each holds it for about 7.8 ms
  (p50), so the ceiling is about 1000 / 7.8 = 128 mutations a second; the measured plateau is roughly 90% of that.
- **Lock hold time does not change with load** (7.7 to 7.9 ms p50 from 5 devices up). The work under the lock
  costs the same; what grows is the number of writers in line for it.
- **The wait at the lock is capped by the worker count, not by the device count.** Only 3 gunicorn workers
  exist, so at most 2 writers can be waiting (the sampled maximum is 2). The queue that grows with devices
  is in front of gunicorn: latency rises about linearly with devices, as it must in a closed loop.
- **Beyond about 25 devices throughput falls** (101 mutations/s at 50, 81 at 100) and the lock is idle more
  often (81%, then 67% busy). Something other than the lock is now the limit: probably CPU shared with k6,
  nginx and Postgres on one laptop, and pulls that queue for the same 3 workers. I did not isolate this,
  and the dataset also grew from 750 to 3,200 submissions during this set, which I did not separate from
  the device count. Treat the decline as a property of this setup, not of the design.

## 4. Is it really the lock? More workers

If the three workers were the limit, six would raise throughput. 10 and 50 devices, no pause, 6 workers:

Think time 0 s between sync cycles, 45s per step, 6 gunicorn workers.

| Devices | Mutations/s | Requests/s | Push p50 ms | Push p95 ms | Pull p95 ms | Cycle p95 ms | Errors % | Lock wait p50/p95 ms | Lock held p50/p95 ms | Lock busy | Waiting on lock avg/max |
|---|---|---|---|---|---|---|---|---|---|---|---|
| 10 | 119.8 | 102.3 | 142 | 230 | 90 | 288 | 0.00 | 32.0 / 42.4 | 7.9 / 10.1 | 98% | 3.8 / 5 |
| 50 | 113.6 | 102.9 | 511 | 675 | 566 | 1086 | 0.00 | 31.8 / 41.3 | 7.9 / 10.0 | 93% | 3.5 / 5 |

Dataset before: submissions=3242 events=30564 ledger=30564 users=103
Dataset after: submissions=4142 events=41144 ledger=41144 users=103

Throughput did not rise (120 and 114 mutations/s, against 117 and 101 with 3 workers). What changed is the
**wait**: the median wait for the lock went from about 8 ms to 32 ms, the sampled queue reached 5, and the
lock was busy 93 to 98% of the time. More writers just lined up at the lock. This is the evidence that the
serial write section is the ceiling at about 120 mutations a second on this machine.

## 5. What is the lock held for? Asynchronous commit

The lock is released by the commit, so a part of the 7.8 ms is the disk flush. With
`ALTER DATABASE talaan SET synchronous_commit = off` (not safe for production, a diagnostic only):

Think time 0 s between sync cycles, 45s per step, 3 gunicorn workers.

| Devices | Mutations/s | Requests/s | Push p50 ms | Push p95 ms | Pull p95 ms | Cycle p95 ms | Errors % | Lock wait p50/p95 ms | Lock held p50/p95 ms | Lock busy | Waiting on lock avg/max |
|---|---|---|---|---|---|---|---|---|---|---|---|
| 10 | 136.8 | 117.9 | 97 | 146 | 104 | 223 | 0.00 | 6.3 / 13.2 | 6.6 / 8.3 | 93% | 1.1 / 2 |
| 50 | 121.3 | 109.3 | 428 | 624 | 593 | 932 | 0.00 | 6.7 / 13.3 | 6.5 / 8.1 | 81% | 0.7 / 2 |

Dataset before: submissions=4142 events=41144 ledger=41144 users=103
Dataset after: submissions=5042 events=52837 ledger=52837 users=103

The median hold fell from about 7.8 to 6.5 ms and throughput rose by roughly 15 to 20% (137 and 121
mutations/s). So about **1.3 ms of the hold is the flush**, and **about 6.5 ms is work done while holding
the lock**: locking the row, validating, bumping the version, writing the submission, event and ledger rows.
(One run each, so the exact gain is uncertain; the direction and rough size are what to take from it.)

## What this means

- For the intended use (tens of devices syncing every few seconds to a minute) the write path has more than
  an order of magnitude of headroom: 50 field-rate devices use about 5% of the lock, and the lock alone
  would carry on the order of 600 to 900 such devices before it is the limit.
- The ceiling when it comes is the one ADR 0005 predicted: every accepted change takes one global lock
  before drawing a `server_seq`, so writes are serial and throughput is about 1 / (time held). Adding
  gunicorn workers does not raise it; it only lengthens the queue.
- The cheapest improvements, in the order I would try them: shorten the work under the lock (draw the
  sequence value last, move the event write after it, fewer round trips), batch several mutations of one push
  into a single transaction and lock acquisition, and only then replace the lock with a safe-watermark
  cursor (the alternative in ADR 0005) so writers no longer serialise at all.

## Reproduce

```bash
docker compose down -v                      # a clean database
DURATION=60s bash loadtest/run.sh field
DURATION=60s bash loadtest/run.sh realistic
bash loadtest/run.sh saturation
WEB_CONCURRENCY=6 DEVICES="10 50" THINK=0 LABEL=workers6 bash loadtest/run.sh custom
docker compose exec -T db psql -U postgres -d talaan -c "ALTER DATABASE talaan SET synchronous_commit = off"
DEVICES="10 50" THINK=0 LABEL=async-commit bash loadtest/run.sh custom
docker compose exec -T db psql -U postgres -d talaan -c "ALTER DATABASE talaan RESET synchronous_commit"
bash server/scripts/migrate.sh              # restores the host test databases wiped by `down -v`
```

The results above came from running `saturation` and `all` as one sequence, then `workers6`, `async-commit`,
and finally `field` and `realistic` again after adding a start-up jitter to the script (the first
versions of those two runs were dominated by all 50 devices starting at the same instant). The saturation
runs use no think time, so the jitter does not affect them.
