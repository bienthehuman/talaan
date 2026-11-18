"""The sync endpoints (docs/protocol.md sections 4, 7 and 8). Thin on purpose: validation, then the
rules in sync/services.py."""

import hmac
import logging
import uuid

from django.conf import settings
from django.http import Http404, HttpResponse
from drf_spectacular.utils import OpenApiParameter, extend_schema
from rest_framework import serializers
from rest_framework.exceptions import NotAuthenticated
from rest_framework.response import Response
from rest_framework.throttling import ScopedRateThrottle
from rest_framework.views import APIView

from accounts.drf import IsAdmin, IsWorker, IsWorkerOrAdmin
from accounts.permissions import WORKER
from assignments.models import Assignment
from core import logs
from forms.models import FormVersion
from submissions.models import Submission

from . import metrics
from . import serializers as s
from .devices import note_pull, register_device
from .exceptions import BatchTooLarge, ClientSchemaMissing, ClientTooOld
from .faults import find
from .results import record_payload
from .services import Mutation, apply_admin_action, apply_mutation

log = logging.getLogger("talaan.sync")
DEVICE_HEADER = "X-Device-Id"
MAX_BATCH = 50
DEFAULT_PULL_LIMIT = 200
MAX_PULL_LIMIT = 500
CLIENT_SCHEMA_HEADER = "X-Client-Schema"

CLIENT_SCHEMA_PARAM = OpenApiParameter(
    CLIENT_SCHEMA_HEADER,
    int,
    OpenApiParameter.HEADER,
    required=True,
    description="The client's protocol version. Below the server's minimum the answer is 426.",
)
PROBLEMS = {
    401: s.ProblemSerializer,
    403: s.ProblemSerializer,
    426: s.ProblemSerializer,
    429: s.ProblemSerializer,
}


def enforce_client_schema(value) -> None:
    """426 when the client's protocol version is too old; 400 when it did not send one."""
    if isinstance(value, bool) or value is None:
        raise ClientSchemaMissing()
    try:
        version = int(value)
    except (TypeError, ValueError):
        raise ClientSchemaMissing() from None
    if version < settings.MIN_CLIENT_SCHEMA:
        raise ClientTooOld()


class HeaderSchemaView(APIView):
    """Endpoints that take the client's protocol version in the X-Client-Schema header."""

    pagination_class = None

    def initial(self, request, *args, **kwargs):
        super().initial(request, *args, **kwargs)  # authentication, permissions, throttles
        enforce_client_schema(request.headers.get(CLIENT_SCHEMA_HEADER))


class PushView(APIView):
    permission_classes = [IsWorker]
    throttle_classes = [ScopedRateThrottle]
    throttle_scope = "push"
    pagination_class = None

    @extend_schema(
        request=s.PushRequestSerializer,
        responses={200: s.PushResponseSerializer, 400: s.ProblemSerializer, **PROBLEMS},
        summary="Push local changes",
        description=(
            "Applies up to 50 mutations in order, each in its own transaction, and returns one "
            "result per mutation. A repeated mutation_id returns its stored result."
        ),
    )
    def post(self, request):
        body = request.data if isinstance(request.data, dict) else {}
        enforce_client_schema(body.get("client_schema"))  # before validation: an old client's body
        mutations = body.get("mutations")  # may differ in shape, and must still get its 426
        if isinstance(mutations, list) and len(mutations) > MAX_BATCH:
            raise BatchTooLarge()

        serializer = s.PushRequestSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        data = serializer.validated_data

        register_device(request.user, data["device_id"], data["app_version"])
        logs.set_context(user_id=request.user.id, device_id=data["device_id"])

        results = []
        total = len(data["mutations"])
        for index, item in enumerate(data["mutations"], start=1):
            result = apply_mutation(
                request.user,
                data["device_id"],
                Mutation(
                    mutation_id=item["mutation_id"],
                    record_id=item["record_id"],
                    op=item["op"],
                    base_version=item["base_version"],
                    fields=item["fields"],
                    assignment_id=item["assignment_id"],
                ),
            )
            results.append(result)
            # What happened, never what was typed: core/logs.py has no field for form data.
            log.info(
                "mutation",
                extra={
                    "event": "mutation",
                    "mutation_id": item["mutation_id"],
                    "record_id": item["record_id"],
                    "op": item["op"],
                    "status": result["status"],
                    "code": result.get("code"),
                    "kind": (result.get("conflict") or {}).get("kind"),
                },
            )
            self._maybe_expire_token(request, applied=index, total=total)
        return Response({"results": results})

    @staticmethod
    def _maybe_expire_token(request, *, applied: int, total: int) -> None:
        """Fault injection: the access token "expires" partway through a batch (scenario 9)."""
        fault = find(getattr(request, "faults", []), "expire-token")
        if fault and applied == (fault.arg or 1) and applied < total:
            raise NotAuthenticated("Injected fault: the access token expired mid-batch.")


def _device_id(request) -> uuid.UUID | None:
    """The optional X-Device-Id header. A malformed one is ignored: it only feeds /metrics."""
    raw = request.headers.get(DEVICE_HEADER)
    if not raw:
        return None
    try:
        return uuid.UUID(raw)
    except ValueError:
        return None


def _int_param(request, name: str, default: int, *, minimum: int) -> int:
    raw = request.query_params.get(name)
    if raw is None:
        return default
    try:
        value = int(raw)
    except ValueError:
        raise serializers.ValidationError({name: "Must be a whole number."}) from None
    if value < minimum:
        raise serializers.ValidationError({name: f"Must be at least {minimum}."})
    return value


class PullView(HeaderSchemaView):
    permission_classes = [IsWorkerOrAdmin]

    @extend_schema(
        parameters=[
            CLIENT_SCHEMA_PARAM,
            OpenApiParameter(
                "cursor", int, description="Last server_seq already received (0 to start)."
            ),
            OpenApiParameter("limit", int, description="Page size, default 200, at most 500."),
            OpenApiParameter(
                DEVICE_HEADER,
                str,
                OpenApiParameter.HEADER,
                required=False,
                description="This device's id, so the server can report how far behind it is.",
            ),
        ],
        responses={200: s.PullResponseSerializer, 400: s.ProblemSerializer, **PROBLEMS},
        summary="Pull changes since a cursor",
    )
    def get(self, request):
        cursor = _int_param(request, "cursor", 0, minimum=0)
        limit = min(_int_param(request, "limit", DEFAULT_PULL_LIMIT, minimum=1), MAX_PULL_LIMIT)

        records = Submission.objects.filter(server_seq__gt=cursor)
        if request.user.role == WORKER:
            records = records.filter(assignment__worker=request.user)
        page = list(records.order_by("server_seq")[: limit + 1])  # one extra row tells has_more

        has_more = len(page) > limit
        page = page[:limit]
        next_cursor = page[-1].server_seq if page else cursor

        device_id = _device_id(request)
        if device_id is not None and request.user.role == WORKER:
            note_pull(request.user, device_id, next_cursor)
            logs.set_context(user_id=request.user.id, device_id=device_id)
        log.info(
            "pull",
            extra={"event": "pull", "cursor": cursor, "count": len(page), "has_more": has_more},
        )
        return Response(
            {
                "records": [record_payload(r) for r in page],
                "next_cursor": next_cursor,
                "has_more": has_more,
            }
        )


class AssignmentListView(HeaderSchemaView):
    permission_classes = [IsWorkerOrAdmin]

    @extend_schema(
        parameters=[CLIENT_SCHEMA_PARAM],
        responses={200: s.AssignmentListSerializer, **PROBLEMS},
        summary="Assignments (the whole list, not paged)",
    )
    def get(self, request):
        assignments = Assignment.objects.select_related("form_version__form").order_by("id")
        if request.user.role == WORKER:
            assignments = assignments.filter(worker=request.user)
        return Response(
            {
                "results": [
                    {
                        "id": a.id,
                        "form_version_id": a.form_version_id,
                        "form_name": a.form_version.form.name,
                        "site_name": a.site_name,
                        "due_date": a.due_date.isoformat() if a.due_date else None,
                        "cancelled": a.is_cancelled,
                    }
                    for a in assignments
                ]
            }
        )


class FormVersionListView(HeaderSchemaView):
    permission_classes = [IsWorkerOrAdmin]

    @extend_schema(
        parameters=[CLIENT_SCHEMA_PARAM],
        responses={200: s.FormVersionListSerializer, **PROBLEMS},
        summary="Published form versions the user needs (the whole list, not paged)",
    )
    def get(self, request):
        versions = FormVersion.objects.select_related("form").filter(published_at__isnull=False)
        if request.user.role == WORKER:
            versions = versions.filter(assignments__worker=request.user).distinct()
        return Response(
            {
                "results": [
                    {
                        "id": v.id,
                        "form_id": v.form_id,
                        "form_name": v.form.name,
                        "number": v.number,
                        "schema": v.schema,
                        "published_at": v.published_at.isoformat(),
                    }
                    for v in versions.order_by("id")
                ]
            }
        )


class AdminActionView(APIView):
    """An admin acts on one submission: approve, return, restore, delete or edit.

    Same core as push (docs/protocol.md section 5): advisory lock, version bump, ledger row, event.
    The answer is the service's result, so a refusal is a 200 with `rejected`."""

    permission_classes = [IsAdmin]
    pagination_class = None

    @extend_schema(
        request=s.AdminActionRequestSerializer,
        responses={200: s.MutationResultSerializer, 400: s.ProblemSerializer, **PROBLEMS},
        summary="Act on a submission as an admin",
    )
    def post(self, request, record_id):
        serializer = s.AdminActionRequestSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        data = serializer.validated_data
        result = apply_admin_action(
            request.user, record_id, data["action"], reason=data["reason"], fields=data["fields"]
        )
        return Response(result)


class MetricsView(APIView):
    """Prometheus text metrics. Not part of the public API.

    The proxy answers 404 for /metrics; a scraper inside the stack presents `METRICS_TOKEN`. With no
    token set (and not in debug) the endpoint does not exist at all."""

    authentication_classes: list = []
    permission_classes: list = []

    @extend_schema(exclude=True)
    def get(self, request):
        token = settings.METRICS_TOKEN
        if not token and not settings.DEBUG:
            raise Http404
        if token:
            given = request.headers.get("Authorization", "")
            expected = f"Bearer {token}"
            if not hmac.compare_digest(given.encode(), expected.encode()):
                response = HttpResponse("unauthorized\n", status=401, content_type="text/plain")
                response["WWW-Authenticate"] = "Bearer"
                return response
        return HttpResponse(
            metrics.collect(), content_type="text/plain; version=0.0.4; charset=utf-8"
        )
