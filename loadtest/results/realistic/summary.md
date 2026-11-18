Think time 1 s between sync cycles, 60s per step, 3 gunicorn workers.

| Devices | Mutations/s | Requests/s | Push p50 ms | Push p95 ms | Pull p95 ms | Cycle p95 ms | Errors % | Lock wait p50/p95 ms | Lock held p50/p95 ms | Lock busy | Waiting on lock avg/max |
|---|---|---|---|---|---|---|---|---|---|---|---|
| 50 | 90.5 | 81.9 | 66 | 180 | 139 | 299 | 0.00 | 6.8 / 15.4 | 7.6 / 9.7 | 73% | 0.8 / 2 |

Dataset before: submissions=5476 events=53874 ledger=53874 users=103
Dataset after: submissions=6226 events=59444 ledger=59444 users=103
