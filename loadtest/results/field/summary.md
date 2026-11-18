Think time 10 s between sync cycles, 60s per step, 3 gunicorn workers.

| Devices | Mutations/s | Requests/s | Push p50 ms | Push p95 ms | Pull p95 ms | Cycle p95 ms | Errors % | Lock wait p50/p95 ms | Lock held p50/p95 ms | Lock busy | Waiting on lock avg/max |
|---|---|---|---|---|---|---|---|---|---|---|---|
| 50 | 6.6 | 8.7 | 24 | 40 | 13 | 51 | 0.00 | 0.2 / 6.0 | 6.9 / 8.2 | 5% | 0.0 / 0 |

Dataset before: submissions=5269 events=53413 ledger=53413 users=103
Dataset after: submissions=5476 events=53874 ledger=53874 users=103
