"""Plants deliberate bugs in the sync service and requires the tests to notice each one.

    cd server && python scripts/mutation_check_service.py        (about 8 minutes)
    python scripts/mutation_check_service.py lock duplicate     (only matching entries)

Run it after changing sync/services.py, forms/validation.py or submissions/guard.py. Each entry
replaces an exact piece of source, runs the tests, and restores the file. A bug that no test notices
means a rule is unprotected (exit 1). A pattern that no longer matches means the entry is stale
after a refactor and must be updated (exit 2), so the check cannot quietly stop checking.
"""

import pathlib
import subprocess
import sys

ROOT = pathlib.Path(".")
M = [  # (description, file, old, new)
    (
        "no advisory lock",
        "sync/services.py",
        "            _take_sequence_lock()\n            result = handler()",
        "            result = handler()",
    ),
    (
        "conflict ignores 'same value is not a conflict'",
        "sync/services.py",
        "if server_version > base_version and server_value != value:",
        "if server_version > base_version:",
    ),
    (
        "conflict boundary off by one (>=)",
        "sync/services.py",
        "if server_version > base_version and server_value != value:",
        "if server_version >= base_version and server_value != value:",
    ),
    (
        "field_versions not bumped",
        "sync/services.py",
        "        field_versions[name] = new_version",
        "        field_versions[name] = field_versions.get(name, 1)",
    ),
    (
        "workers never locked out",
        "sync/services.py",
        "LOCKED_FOR_WORKERS = {Status.SUBMITTED, Status.APPROVED}",
        "LOCKED_FOR_WORKERS = set()",
    ),
    (
        "mutation_id_reuse not detected",
        "sync/services.py",
        "if prior.user_id != user.id:",
        "if False:",
    ),
    (
        "ledger result never stored",
        "sync/services.py",
        "            AppliedMutation.objects.filter(pk=mutation_id).update(result=result)\n",
        "            pass\n",
    ),
    (
        "rejection consumes a sequence value",
        "sync/services.py",
        '    if sub is not None:\n        _event(user, mutation_id, sub, EventKind.REJECTED, {"code": code})',
        '    _next_server_seq()\n    if sub is not None:\n        _event(user, mutation_id, sub, EventKind.REJECTED, {"code": code})',
    ),
    (
        "validation skipped",
        "sync/services.py",
        "    if fields or complete:\n        errors = validate_data",
        "    if False:\n        errors = validate_data",
    ),
    (
        "null no longer clears",
        "sync/services.py",
        "        if value is None:\n            new_data.pop(name, None)",
        "        if False:\n            new_data.pop(name, None)",
    ),
    (
        "submit does not require required fields",
        "sync/services.py",
        "        status=Status.SUBMITTED,\n        complete=True,",
        "        status=Status.SUBMITTED,\n        complete=False,",
    ),
    (
        "delete ignores newer work",
        "sync/services.py",
        "    if newer:\n        return _conflict",
        "    if False:\n        return _conflict",
    ),
    (
        "other workers' records are visible",
        "sync/services.py",
        "if sub is None or sub.assignment.worker_id != user.id:",
        "if sub is None:",
    ),
    (
        "admin actions open to everyone",
        "sync/services.py",
        "    if user.role != ADMIN or not user.can(permission):",
        "    if False:",
    ),
    (
        "create ignores an existing id",
        "sync/services.py",
        "    if Submission.objects.filter(pk=m.record_id).exists():",
        "    if False:",
    ),
    (
        "conflicts not logged",
        "sync/services.py",
        "    _event(\n        user,\n        mutation_id,\n        sub,\n        EventKind.CONFLICT,",
        "    (lambda *a, **k: None)(\n        user,\n        mutation_id,\n        sub,\n        EventKind.CONFLICT,",
    ),
    (
        "approve from any status",
        "sync/services.py",
        '        if sub.status != Status.SUBMITTED:\n            return refuse(f"Only a submitted record can be approved',
        '        if False:\n            return refuse(f"Only a submitted record can be approved',
    ),
    (
        "impossible base_version accepted",
        "sync/services.py",
        "    if m.base_version < 0 or m.base_version > sub.version:",
        "    if False:",
    ),
    (
        "deleted record can still be edited",
        "sync/services.py",
        'def _update(user: User, m: Mutation, sub: Submission) -> dict:\n    if sub.status in LOCKED_FOR_WORKERS:\n        return _reject(\n            user, m.mutation_id, r.LOCKED, f"The record is {sub.status} and locked.", sub=sub\n        )\n    if sub.deleted_at:',
        'def _update(user: User, m: Mutation, sub: Submission) -> dict:\n    if sub.status in LOCKED_FOR_WORKERS:\n        return _reject(\n            user, m.mutation_id, r.LOCKED, f"The record is {sub.status} and locked.", sub=sub\n        )\n    if False:',
    ),
    (
        "runtime write guard removed from save()",
        "submissions/guard.py",
        "    def save(self, *args, **kwargs):\n        check_write_access()\n",
        "    def save(self, *args, **kwargs):\n",
    ),
    (
        "unknown fields accepted",
        "forms/validation.py",
        "    for name in sorted(set(data) - set(properties)):",
        "    for name in []:",
    ),
    # --- API layer (slice 1.3) ---
    (
        "push has no batch limit",
        "sync/views.py",
        "if isinstance(mutations, list) and len(mutations) > MAX_BATCH:",
        "if False:",
    ),
    (
        "push ignores the client protocol version",
        "sync/views.py",
        'enforce_client_schema(body.get("client_schema"))',
        "None",
    ),
    (
        "old clients are never refused (426)",
        "sync/views.py",
        "if version < settings.MIN_CLIENT_SCHEMA:",
        "if False:",
    ),
    (
        "device is never registered",
        "sync/views.py",
        'register_device(request.user, data["device_id"], data["app_version"])',
        "pass",
    ),
    (
        "admins may push worker mutations",
        "sync/views.py",
        "    permission_classes = [IsWorker]",
        "    permission_classes = [IsWorkerOrAdmin]",
    ),
    ("expire-token never fires", "sync/views.py", "and applied < total:", "and False:"),
    (
        "pull returns newest first",
        "sync/views.py",
        'records.order_by("server_seq")',
        'records.order_by("-server_seq")',
    ),
    (
        "pull re-sends the record at the cursor",
        "sync/views.py",
        "server_seq__gt=cursor",
        "server_seq__gte=cursor",
    ),
    (
        "pull leaks other workers' records",
        "sync/views.py",
        "            records = records.filter(assignment__worker=request.user)",
        "            pass",
    ),
    (
        "pull never reports has_more",
        "sync/views.py",
        "has_more = len(page) > limit",
        "has_more = False",
    ),
    (
        "pull cursor does not advance",
        "sync/views.py",
        "page[-1].server_seq if page else cursor",
        "cursor",
    ),
    (
        "workers see every assignment",
        "sync/views.py",
        "            assignments = assignments.filter(worker=request.user)",
        "            pass",
    ),
    (
        "workers see every form version",
        "sync/views.py",
        "            versions = versions.filter(assignments__worker=request.user).distinct()",
        "            pass",
    ),
    (
        "unpublished drafts are listed",
        "sync/views.py",
        'FormVersion.objects.select_related("form").filter(published_at__isnull=False)',
        'FormVersion.objects.select_related("form")',
    ),
    (
        "drop-after-commit does nothing",
        "sync/middleware.py",
        'if find(faults, "drop-after-commit"):',
        "if False:",
    ),
    (
        "fail-before does nothing",
        "sync/middleware.py",
        'if find(faults, "fail-before"):',
        "if False:",
    ),
    (
        "delay is not capped",
        "sync/middleware.py",
        "time.sleep(min(delay.arg or 0, MAX_DELAY_MS) / 1000)",
        "time.sleep((delay.arg or 0) / 1000)",
    ),
    (
        "faults apply outside the sync endpoints",
        "sync/middleware.py",
        'if not header or not request.path.startswith("/api/sync/"):',
        "if not header:",
    ),
    (
        "a duplicate is answered with a fresh verdict, not the stored one",
        "sync/services.py",
        "        return prior.result\n",
        '        return r.rejected(mutation_id, r.ID_TAKEN, "duplicate")\n',
    ),
    (
        "admin endpoint open to workers",
        "sync/views.py",
        "    permission_classes = [IsAdmin]",
        "    permission_classes = [IsWorkerOrAdmin]",
    ),
    (
        "admin endpoint ignores the action and reason",
        "sync/views.py",
        'request.user, record_id, data["action"], reason=data["reason"], fields=data["fields"]',
        'request.user, record_id, data["action"], reason="reason", fields=data["fields"]',
    ),
    (
        "conflict log needs only the review permission",
        "adminapi/views.py",
        "    permission_classes = [requires(CONFLICTLOG_VIEW)]",
        "    permission_classes = [requires(SUBMISSION_APPROVE)]",
    ),
    (
        "queue ignores the status filter",
        "adminapi/views.py",
        "            qs = qs.filter(status=status)",
        "            pass",
    ),
    (
        "queue shows deleted records by default",
        "adminapi/views.py",
        'deleted = _tri(request, "deleted", "false")',
        'deleted = _tri(request, "deleted", "any")',
    ),
    (
        "queue is not paged",
        "adminapi/views.py",
        "    serializer_class = s.SubmissionRowSerializer\n",
        "    serializer_class = s.SubmissionRowSerializer\n    pagination_class = None\n",
    ),
    (
        "invalid schemas can be published",
        "adminapi/views.py",
        "        if problems := validate_form_schema(schema):",
        "        if False and (problems := validate_form_schema(schema)):",
    ),
    (
        "assignments skip model validation",
        "adminapi/views.py",
        "            assignment.full_clean()",
        "            pass",
    ),
    (
        "cancelling again moves the timestamp",
        "adminapi/views.py",
        "        assignment.cancel()  # a second call changes nothing",
        "        assignment.cancelled_at = None\n        assignment.cancel()",
    ),
    (
        "conflict log shows admin refusals too",
        "adminapi/views.py",
        '            .filter(actor_id=F("submission__assignment__worker_id"))\n',
        "",
    ),
    (
        "conflict log: changed_since ignores who changed it",
        "adminapi/views.py",
        '            actor_id=OuterRef("actor_id"),\n',
        "",
    ),
    (
        "history not in order",
        "adminapi/serializers.py",
        "    events = EventSerializer(many=True)",
        '    events = EventSerializer(many=True, source="events.all.reverse")',
    ),
    (
        "fault middleware loads outside debug",
        "sync/middleware.py",
        "if not (settings.DEBUG and settings.FAULT_INJECTION):",
        "if False:",
    ),
]

ONLY = sys.argv[1:]  # optional: run only entries whose description contains one of these words
caught = survived = stale = 0
for desc, file, old, new in M:
    if ONLY and not any(word in desc for word in ONLY):
        continue
    path = ROOT / file
    original = path.read_text()
    if old not in original:
        stale += 1
        print(f"  STALE     {desc} (pattern not found in {file}; update this entry)")
        continue
    path.write_text(original.replace(old, new, 1))
    try:
        out = subprocess.run(
            [
                sys.executable,
                "-m",
                "pytest",
                "-q",
                "-x",
                "-p",
                "no:cacheprovider",
                "sync",
                "forms",
                "submissions",
                "adminapi",
            ],
            capture_output=True,
            text=True,
        ).stdout
    finally:
        path.write_text(original)
    failed = "failed" in out.splitlines()[-1] or "error" in out.splitlines()[-1]
    first = next((ln for ln in out.splitlines() if ln.startswith("FAILED")), "")
    name = first.split("::")[-1].split(" ")[0] if first else ""
    if failed:
        caught += 1
        print(f"  caught    {desc:55s} {name}")
    else:
        survived += 1
        print(f"  SURVIVED  {desc}")
print(f"\n{caught} caught, {survived} survived, {stale} stale")
sys.exit(1 if survived else 2 if stale else 0)
