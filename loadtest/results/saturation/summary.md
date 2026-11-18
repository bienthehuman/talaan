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
