Think time 0 s between sync cycles, 45s per step, 6 gunicorn workers.

| Devices | Mutations/s | Requests/s | Push p50 ms | Push p95 ms | Pull p95 ms | Cycle p95 ms | Errors % | Lock wait p50/p95 ms | Lock held p50/p95 ms | Lock busy | Waiting on lock avg/max |
|---|---|---|---|---|---|---|---|---|---|---|---|
| 10 | 119.8 | 102.3 | 142 | 230 | 90 | 288 | 0.00 | 32.0 / 42.4 | 7.9 / 10.1 | 98% | 3.8 / 5 |
| 50 | 113.6 | 102.9 | 511 | 675 | 566 | 1086 | 0.00 | 31.8 / 41.3 | 7.9 / 10.0 | 93% | 3.5 / 5 |

Dataset before: submissions=3242 events=30564 ledger=30564 users=103
Dataset after: submissions=4142 events=41144 ledger=41144 users=103
