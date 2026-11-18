"""Summarise one load-test run directory (see loadtest/run.sh) as a markdown table.

    python3 loadtest/analyze.py loadtest/results/saturation --think 0 --duration 45s --workers 3

Reads, for every step N: k6-N.json (k6's summary export), server-N.log (the server's JSON log lines
for the window) and pg-N.csv (a once-a-second sample of Postgres sessions waiting on the advisory
lock). Prints the table and writes `summary.md` next to the inputs.
"""

import argparse
import json
import pathlib
import re
import statistics


def pct(values: list[float], p: float) -> float:
    if not values:
        return 0.0
    ordered = sorted(values)
    return ordered[min(len(ordered) - 1, int(round((p / 100) * (len(ordered) - 1))))]


def metric(summary: dict, name: str, stat: str) -> float:
    m = summary.get("metrics", {}).get(name, {})
    values = m.get("values", m)  # k6 versions differ: with or without a "values" level
    return float(values.get(stat, 0) or 0)


def seconds(text: str) -> float:
    match = re.fullmatch(r"(\d+)(s|m)", text)
    return int(match.group(1)) * (60 if match.group(2) == "m" else 1) if match else 0.0


def server_lines(path: pathlib.Path) -> list[dict]:
    out = []
    for line in path.read_text(errors="replace").splitlines():
        brace = line.find("{")
        if brace < 0:
            continue
        try:
            out.append(json.loads(line[brace:]))
        except json.JSONDecodeError:
            continue
    return out


def step(directory: pathlib.Path, devices: int, window: float) -> dict:
    k6 = json.loads((directory / f"k6-{devices}.json").read_text())
    lines = server_lines(directory / f"server-{devices}.log")
    mutations = [e for e in lines if e.get("event") == "mutation" and "lock_hold_ms" in e]
    waits = [e["lock_wait_ms"] for e in mutations]
    holds = [e["lock_hold_ms"] for e in mutations]
    samples = []
    pg = directory / f"pg-{devices}.csv"
    if pg.exists():
        for row in pg.read_text().splitlines():
            parts = row.split(",")
            if len(parts) == 3 and parts[1].isdigit():
                samples.append((int(parts[1]), int(parts[2])))
    return {
        "devices": devices,
        "http_reqs_per_s": metric(k6, "http_reqs", "rate"),
        "mutations_per_s": metric(k6, "mutations_sent", "rate"),
        "push_p50": metric(k6, "http_req_duration{name:push}", "med"),
        "push_p95": metric(k6, "http_req_duration{name:push}", "p(95)"),
        "pull_p95": metric(k6, "http_req_duration{name:pull}", "p(95)"),
        "cycle_p95": metric(k6, "sync_cycle_ms", "p(95)"),
        "errors_pct": metric(k6, "http_req_failed", "rate") * 100,
        "conflicts": metric(k6, "mutations_conflict", "count"),
        "logged_mutations": len(mutations),
        "wait_p50": pct(waits, 50),
        "wait_p95": pct(waits, 95),
        "hold_p50": pct(holds, 50),
        "hold_p95": pct(holds, 95),
        # Fraction of wall-clock time some writer held the lock: near 1.0 means writers queue behind each other.
        "lock_utilisation": sum(holds) / 1000 / window if window else 0,
        "waiters_avg": statistics.mean([w for w, _ in samples]) if samples else 0,
        "waiters_max": max([w for w, _ in samples], default=0),
        "active_avg": statistics.mean([a for _, a in samples]) if samples else 0,
    }


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("directory", type=pathlib.Path)
    parser.add_argument("--think", default="?")
    parser.add_argument("--duration", default="45s")
    parser.add_argument("--workers", default="3")
    args = parser.parse_args()
    window = seconds(args.duration)

    steps = sorted(
        int(m.group(1)) for p in args.directory.glob("k6-*.json") if (m := re.fullmatch(r"k6-(\d+)\.json", p.name))
    )
    rows = [step(args.directory, n, window) for n in steps]
    header = (
        "| Devices | Mutations/s | Requests/s | Push p50 ms | Push p95 ms | Pull p95 ms | Cycle p95 ms | Errors % "
        "| Lock wait p50/p95 ms | Lock held p50/p95 ms | Lock busy | Waiting on lock avg/max |"
    )
    lines = [header, "|" + "---|" * 12]
    for r in rows:
        lines.append(
            f"| {r['devices']} | {r['mutations_per_s']:.1f} | {r['http_reqs_per_s']:.1f} | {r['push_p50']:.0f} "
            f"| {r['push_p95']:.0f} | {r['pull_p95']:.0f} | {r['cycle_p95']:.0f} | {r['errors_pct']:.2f} "
            f"| {r['wait_p50']:.1f} / {r['wait_p95']:.1f} | {r['hold_p50']:.1f} / {r['hold_p95']:.1f} "
            f"| {r['lock_utilisation'] * 100:.0f}% | {r['waiters_avg']:.1f} / {r['waiters_max']} |"
        )
    text = (
        f"Think time {args.think} s between sync cycles, {args.duration} per step, {args.workers} gunicorn workers.\n\n"
        + "\n".join(lines)
        + "\n"
    )
    before = (args.directory / "dataset-before.txt")
    after = (args.directory / "dataset-after.txt")
    if before.exists() and after.exists():
        text += f"\nDataset before: {before.read_text().strip()}\nDataset after: {after.read_text().strip()}\n"
    (args.directory / "summary.md").write_text(text)
    (args.directory / "summary.json").write_text(json.dumps(rows, indent=1))
    print(text)


if __name__ == "__main__":
    main()
