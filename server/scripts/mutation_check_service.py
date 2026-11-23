"""Plants deliberate bugs in the sync service and requires the tests to notice each one.

    cd server && python scripts/mutation_check_service.py        (about 8 minutes)
    python scripts/mutation_check_service.py lock duplicate     (only matching entries)

Run it after changing sync/services.py, forms/ (validation, schema, compat, models),
submissions/guard.py or accounts/invites.py. Each entry
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
        '        if sub.status != Status.SUBMITTED:\n            return refuse(\n                f"Only a submitted inspection can be approved',
        '        if False:\n            return refuse(\n                f"Only a submitted inspection can be approved',
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
        'def _update(user: User, m: Mutation, sub: Submission) -> dict:\n    if sub.status in LOCKED_FOR_WORKERS:\n        return _reject(\n            user,\n            m.mutation_id,\n            r.LOCKED,\n            f"This inspection is {sub.status} and can no longer be changed.",\n            sub=sub,\n        )\n    if sub.deleted_at:',
        'def _update(user: User, m: Mutation, sub: Submission) -> dict:\n    if sub.status in LOCKED_FOR_WORKERS:\n        return _reject(\n            user,\n            m.mutation_id,\n            r.LOCKED,\n            f"This inspection is {sub.status} and can no longer be changed.",\n            sub=sub,\n        )\n    if False:',
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
        "            if problems := publish_problems(form.pk, schema):",
        "            if False and (problems := publish_problems(form.pk, schema)):",
    ),
    (
        "publish ignores the per-form name/type rule",
        "forms/models.py",
        "        problems += refused(changes(published_schemas(form_id), schema))",
        "        pass",
    ),
    (
        "two publishes of one form are not serialised",
        "forms/models.py",
        "            Form.objects.select_for_update().get(pk=self.form_id)\n            self.full_clean()",
        "            self.full_clean()",
    ),
    (
        "type rule looks only at the latest version",
        "forms/compat.py",
        "    types = _types(history)",
        "    types = _types(history[-1:])",
    ),
    (
        "removing a field is not flagged for review",
        "forms/compat.py",
        '                    REVIEW,\n                    name,\n                    f"{_label(name, old_spec)} is removed.',
        '                    SAFE,\n                    name,\n                    f"{_label(name, old_spec)} is removed.',
    ),
    (
        "a tighter limit counts as looser",
        "forms/compat.py",
        "            tighter = (after > before) == larger_is_tighter",
        "            tighter = (after < before) == larger_is_tighter",
    ),
    (
        "choice removal not flagged",
        "forms/compat.py",
        "    if removed := [c for c in before if c not in after]:",
        "    if removed := []:",
    ),
    (
        "x-order may leave fields out",
        "forms/schema.py",
        "    if missing := sorted(set(properties) - set(order)):",
        "    if missing := []:",
    ),
    (
        "x-order not required",
        "forms/schema.py",
        '    if "x-order" not in schema:\n        return [',
        '    if "x-order" not in schema:\n        return []\n        return [',
    ),
    (
        "no field count limit",
        "forms/schema.py",
        "    if len(properties) > MAX_FIELDS:",
        "    if False:",
    ),
    (
        "choice length unchecked",
        "forms/schema.py",
        "            elif any(len(c) > MAX_CHOICE for c in choices):",
        "            elif False:",
    ),
    (
        "schema size unchecked",
        "forms/schema.py",
        "    if size > MAX_SCHEMA_BYTES:",
        "    if False:",
    ),
    (
        "impossible bounds accepted",
        "forms/schema.py",
        "            if _number(spec.get(low)) and _number(spec.get(high)) and spec[low] > spec[high]:",
        "            if False:",
    ),
    (
        "a stale draft save overwrites",
        "adminapi/views.py",
        "FormDraft.objects.filter(form=form, revision=revision).update(",
        "FormDraft.objects.filter(form=form).update(",
    ),
    (
        "draft publish ignores the revision",
        "adminapi/views.py",
        'if draft is None or draft.revision != body.validated_data["revision"]:',
        "if draft is None:",
    ),
    (
        "publishing leaves the draft behind",
        "adminapi/views.py",
        "            draft.delete()\n",
        "",
    ),
    (
        "draft publish not in one transaction",
        "adminapi/views.py",
        "        with transaction.atomic():\n            Form.objects.select_for_update().get(pk=form.pk)\n            draft =",
        "        if True:\n            Form.objects.select_for_update().get(pk=form.pk)\n            draft =",
    ),
    (
        "draft size unchecked",
        "adminapi/views.py",
        "        if size > MAX_DRAFT_BYTES:",
        "        if False:",
    ),
    (
        "admin responses may be cached",
        "core/middleware.py",
        '            response["Cache-Control"] = "no-store"',
        "            pass",
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
        "retries not counted",
        "sync/services.py",
        "        _count_replay(mutation_id)\n        log.info(",
        "        log.info(",
    ),
    (
        "metrics readable without the token",
        "sync/views.py",
        "        if token:\n            given =",
        "        if False:\n            given =",
    ),
    (
        "metrics exist in production with no token",
        "sync/views.py",
        "        if not token and not settings.DEBUG:",
        "        if False:",
    ),
    (
        "pull lag counts everyone's records",
        "sync/metrics.py",
        "                assignment__worker=device.user, server_seq__gt=device.last_pull_cursor",
        "                server_seq__gt=device.last_pull_cursor",
    ),
    (
        "admin actions counted as device pushes",
        "sync/metrics.py",
        '        source = "admin" if row["source"] == ADMIN_DEVICE_ID else "device"',
        '        source = "device"',
    ),
    (
        "any request id accepted",
        "core/middleware.py",
        "request_id = supplied if VALID_REQUEST_ID.match(supplied) else uuid.uuid4().hex",
        "request_id = supplied or uuid.uuid4().hex",
    ),
    (
        "request id not returned",
        "core/middleware.py",
        "            response[HEADER] = request_id\n",
        "",
    ),
    (
        "form data allowed into logs",
        "core/logs.py",
        '    "count",\n',
        '    "count",\n    "fields",\n',
    ),
    (
        "pull position never recorded",
        "sync/views.py",
        "            note_pull(request.user, device_id, next_cursor)\n",
        "",
    ),
    (
        "mutation lines carry no outcome",
        "sync/views.py",
        '                    "status": result["status"],\n',
        "",
    ),
    (
        "lock timing not logged",
        "sync/services.py",
        "        logs.set_context(\n            lock_wait_ms=",
        "        logs.set_context(\n            _unused=",
    ),
    (
        "fault middleware loads outside debug",
        "sync/middleware.py",
        "if not (settings.DEBUG and settings.FAULT_INJECTION):",
        "if False:",
    ),
    (
        "invite accept without the row lock",
        "accounts/invites.py",
        "WorkerInvite.objects.select_for_update().filter(token_hash",
        "WorkerInvite.objects.filter(token_hash",
    ),
    (
        "invites never expire",
        "accounts/models.py",
        "        if self.expires_at <= (now or timezone.now()):",
        "        if False:",
    ),
    (
        "invite accept skips password rules",
        "accounts/invites.py",
        "        validate_password(password, user=user)\n",
        "        pass\n",
    ),
    (
        "invite responses may be cached",
        "core/middleware.py",
        '"/api/admin/", "/api/invites/"',
        '"/api/admin/",',
    ),
    (
        "invited user not made a worker",
        "accounts/invites.py",
        "    user.groups.add(Group.objects.get(name=WORKER))\n",
        "",
    ),
    (
        "accepted invite can be revoked",
        "accounts/invites.py",
        "    if invite.accepted_at:\n        raise InviteError(409",
        "    if False:\n        raise InviteError(409",
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
                "core",
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
