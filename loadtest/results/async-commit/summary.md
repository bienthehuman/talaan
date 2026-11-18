Think time 0 s between sync cycles, 45s per step, 3 gunicorn workers.

| Devices | Mutations/s | Requests/s | Push p50 ms | Push p95 ms | Pull p95 ms | Cycle p95 ms | Errors % | Lock wait p50/p95 ms | Lock held p50/p95 ms | Lock busy | Waiting on lock avg/max |
|---|---|---|---|---|---|---|---|---|---|---|---|
| 10 | 136.8 | 117.9 | 97 | 146 | 104 | 223 | 0.00 | 6.3 / 13.2 | 6.6 / 8.3 | 93% | 1.1 / 2 |
| 50 | 121.3 | 109.3 | 428 | 624 | 593 | 932 | 0.00 | 6.7 / 13.3 | 6.5 / 8.1 | 81% | 0.7 / 2 |

Dataset before: submissions=4142 events=41144 ledger=41144 users=103
Dataset after: submissions=5042 events=52837 ledger=52837 users=103
