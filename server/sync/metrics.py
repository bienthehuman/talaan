"""Numbers for /metrics in the Prometheus text format (docs/protocol.md section 12).

Everything is read from the database, not kept in memory, because the app runs several gunicorn
workers and a counter in one process would only ever show a third of the truth. The cost is a few
grouped queries per scrape; for a busier system the first change would be periodic rollups
(docs/BUILD_PLAN.md, "what I would change at scale")."""

from django.db.models import Count, F, Max, Min, Q, Sum
from django.db.models.fields.json import KT
from django.utils import timezone

from submissions.models import Submission

from .models import AppliedMutation, Device, Replay
from .services import ADMIN_DEVICE_ID


def _esc(value) -> str:
    return str(value).replace("\\", "\\\\").replace('"', '\\"').replace("\n", "\\n")


def _labels(labels: dict) -> str:
    if not labels:
        return ""
    return "{" + ",".join(f'{k}="{_esc(v)}"' for k, v in sorted(labels.items())) + "}"


class _Out:
    def __init__(self) -> None:
        self.lines: list[str] = []

    def metric(self, name: str, kind: str, help_text: str, samples) -> None:
        self.lines.append(f"# HELP {name} {help_text}")
        self.lines.append(f"# TYPE {name} {kind}")
        for labels, value in samples:
            self.lines.append(f"{name}{_labels(labels)} {value}")


def collect() -> str:
    out = _Out()
    now = timezone.now()
    recorded = AppliedMutation.objects.exclude(result={})

    # Pushes: every mutation a device sent, by what the server answered. Admin actions are apart.
    by_status = (
        recorded.annotate(source=F("device_id"), outcome=KT("result__status"))
        .values("source", "outcome")
        .annotate(n=Count("mutation_id"))
    )
    counts: dict[tuple[str, str], int] = {}
    for row in by_status:
        source = "admin" if row["source"] == ADMIN_DEVICE_ID else "device"
        counts[(source, row["outcome"])] = counts.get((source, row["outcome"]), 0) + row["n"]
    out.metric(
        "talaan_mutations_total",
        "counter",
        "Mutations processed, by source and outcome.",
        [({"source": s, "status": o}, n) for (s, o), n in sorted(counts.items())],
    )

    conflicts = (
        recorded.filter(result__status="conflict")
        .annotate(kind=KT("result__conflict__kind"))
        .values("kind")
        .annotate(n=Count("mutation_id"))
        .order_by("kind")
    )
    out.metric(
        "talaan_conflicts_total",
        "counter",
        "Mutations answered with a conflict, by kind.",
        [({"kind": r["kind"]}, r["n"]) for r in conflicts],
    )
    rejections = (
        recorded.filter(result__status="rejected")
        .annotate(code=KT("result__code"))
        .values("code")
        .annotate(n=Count("mutation_id"))
        .order_by("code")
    )
    out.metric(
        "talaan_rejections_total",
        "counter",
        "Mutations rejected, by code.",
        [({"code": r["code"]}, r["n"]) for r in rejections],
    )

    replays = Replay.objects.aggregate(times=Sum("count"), mutations=Count("mutation_id"))
    out.metric(
        "talaan_retries_total",
        "counter",
        "Times an already applied mutation was sent again (retries after a lost response).",
        [({}, replays["times"] or 0)],
    )
    out.metric(
        "talaan_retried_mutations_total",
        "counter",
        "Distinct mutations that were sent again at least once.",
        [({}, replays["mutations"])],
    )

    # Pull lag: records a device's user can see that are beyond the cursor it was last given.
    behind = []
    for device in Device.objects.exclude(last_pull_cursor=None).select_related("user"):
        behind.append(
            Submission.objects.filter(
                assignment__worker=device.user, server_seq__gt=device.last_pull_cursor
            ).count()
        )
    pulled = Device.objects.exclude(last_pull_at=None).aggregate(oldest=Min("last_pull_at"))
    out.metric(
        "talaan_pull_lag_records_max",
        "gauge",
        "Most records any device still has to pull.",
        [({}, max(behind, default=0))],
    )
    out.metric(
        "talaan_pull_lag_records_total",
        "gauge",
        "Records still to be pulled, summed over devices.",
        [({}, sum(behind))],
    )
    out.metric(
        "talaan_devices_behind",
        "gauge",
        "Devices with at least one record still to pull.",
        [({}, sum(1 for b in behind if b > 0))],
    )
    out.metric(
        "talaan_pull_age_seconds_max",
        "gauge",
        "Seconds since the least recently pulling device last pulled.",
        [({}, round((now - pulled["oldest"]).total_seconds(), 1) if pulled["oldest"] else 0)],
    )

    out.metric(
        "talaan_devices",
        "gauge",
        "Devices that have synced.",
        [({}, Device.objects.count())],
    )
    out.metric(
        "talaan_server_seq",
        "gauge",
        "The highest server_seq handed out.",
        [({}, Submission.objects.aggregate(m=Max("server_seq"))["m"] or 0)],
    )
    states = (
        Submission.objects.values("status")
        .annotate(
            live=Count("id", filter=Q(deleted_at__isnull=True)),
            gone=Count("id", filter=Q(deleted_at__isnull=False)),
        )
        .order_by("status")
    )
    samples = []
    for r in states:
        samples.append(({"status": r["status"], "deleted": "false"}, r["live"]))
        samples.append(({"status": r["status"], "deleted": "true"}, r["gone"]))
    out.metric("talaan_submissions", "gauge", "Submissions by status and deletion.", samples)
    return "\n".join(out.lines) + "\n"
