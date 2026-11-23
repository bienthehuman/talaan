"""The admin API: what the admin web needs to review work, manage assignments and form versions,
and read the conflict log. Reads go through the ORM; every change to a submission still goes through
sync.services (see AdminActionView). Each endpoint requires one catalog permission."""

import json

from django.db import IntegrityError, transaction
from django.db.models import Count, Exists, F, OuterRef, Q
from django.utils import timezone
from drf_spectacular.utils import OpenApiParameter, extend_schema
from rest_framework import generics
from rest_framework.exceptions import NotFound, ValidationError
from rest_framework.response import Response
from rest_framework.views import APIView

from accounts import invites
from accounts.drf import requires
from accounts.models import User, WorkerInvite
from accounts.permissions import (
    ASSIGNMENT_MANAGE,
    CONFLICTLOG_VIEW,
    FORM_PUBLISH,
    SUBMISSION_APPROVE,
    WORKER,
    WORKER_MANAGE,
)
from assignments.models import Assignment
from core.errors import problem_response
from forms.compat import changes
from forms.models import Form, FormDraft, FormVersion, publish_problems, published_schemas
from forms.schema import MAX_SCHEMA_BYTES, validate_form_schema
from submissions.models import EventKind, Submission, SubmissionEvent

from . import serializers as s

TRI = ("true", "false", "any")


def _tri(request, name: str, default: str) -> str:
    value = request.query_params.get(name, default)
    if value not in TRI:
        raise ValidationError({name: "Use true, false or any."})
    return value


def _int(request, name: str) -> int | None:
    raw = request.query_params.get(name)
    if raw is None or raw == "":
        return None
    try:
        return int(raw)
    except ValueError:
        raise ValidationError({name: "Must be a whole number."}) from None


# --- review queue -----------------------------------------------------------------------------


class SubmissionListView(generics.ListAPIView):
    """The review queue: every submission, newest change first."""

    permission_classes = [requires(SUBMISSION_APPROVE)]
    serializer_class = s.SubmissionRowSerializer

    def get_queryset(self):
        request = self.request
        qs = Submission.objects.select_related(
            "assignment__worker", "form_version__form", "updated_by"
        ).order_by("-server_seq")
        if (status := request.query_params.get("status")) is not None:
            if status not in {c for c, _ in Submission._meta.get_field("status").choices}:
                raise ValidationError({"status": "Unknown status."})
            qs = qs.filter(status=status)
        if (worker := _int(request, "worker")) is not None:
            qs = qs.filter(assignment__worker_id=worker)
        if (assignment := _int(request, "assignment")) is not None:
            qs = qs.filter(assignment_id=assignment)
        deleted = _tri(request, "deleted", "false")
        if deleted == "true":
            qs = qs.filter(deleted_at__isnull=False)
        elif deleted == "false":
            qs = qs.filter(deleted_at__isnull=True)
        return qs

    @extend_schema(
        parameters=[
            OpenApiParameter("status", str, description="draft, submitted, approved or returned."),
            OpenApiParameter("worker", int, description="The worker's user id."),
            OpenApiParameter("assignment", int),
            OpenApiParameter("deleted", str, enum=list(TRI), description="Default false."),
        ],
        summary="List submissions (the review queue)",
    )
    def get(self, request, *args, **kwargs):
        return super().get(request, *args, **kwargs)


class SubmissionDetailView(generics.RetrieveAPIView):
    permission_classes = [requires(SUBMISSION_APPROVE)]
    serializer_class = s.SubmissionDetailSerializer
    lookup_url_kwarg = "record_id"

    def get_queryset(self):
        return Submission.objects.select_related(
            "assignment__worker", "form_version__form", "updated_by"
        ).prefetch_related("events__actor")

    @extend_schema(summary="One submission with its data, form schema and event history")
    def get(self, request, *args, **kwargs):
        return super().get(request, *args, **kwargs)


# --- assignments ------------------------------------------------------------------------------


def _assignments():
    return Assignment.objects.select_related("form_version__form", "worker").annotate(
        submission_count=Count("submissions")
    )


class WorkerListView(generics.ListAPIView):
    permission_classes = [requires(ASSIGNMENT_MANAGE)]
    serializer_class = s.UserRefSerializer
    pagination_class = None

    def get_queryset(self):
        return User.objects.filter(groups__name=WORKER, is_active=True).order_by("username")

    @extend_schema(summary="Workers an assignment can be given to")
    def get(self, request, *args, **kwargs):
        return super().get(request, *args, **kwargs)


# --- worker invites (ADR 0014) ----------------------------------------------------------------


def _invite_status_filter(qs, status: str):
    now = timezone.now()
    open_ = Q(accepted_at__isnull=True, revoked_at__isnull=True)
    return qs.filter(
        {
            "accepted": Q(accepted_at__isnull=False),
            "revoked": Q(revoked_at__isnull=False),
            "expired": open_ & Q(expires_at__lte=now),
            "pending": open_ & Q(expires_at__gt=now),
        }[status]
    )


def _invite_response(invite, token=None, status=200):
    if token is None:
        return Response(s.AdminInviteSerializer(invite).data, status=status)
    return Response(
        s.AdminInviteWithTokenSerializer(invite, context={"token": token}).data, status=status
    )


class InviteRefusalMixin:
    def handle_exception(self, exc):
        if isinstance(exc, invites.InviteError):
            return problem_response(exc.status, exc.code, exc.detail)
        return super().handle_exception(exc)


class InviteListCreateView(InviteRefusalMixin, generics.ListCreateAPIView):
    permission_classes = [requires(WORKER_MANAGE)]
    serializer_class = s.AdminInviteSerializer

    def get_queryset(self):
        qs = WorkerInvite.objects.select_related("created_by").order_by("-created_at", "-id")
        status = self.request.query_params.get("status")
        if status in (None, ""):
            return qs
        if status not in s.INVITE_STATUSES:
            raise ValidationError({"status": f"Use one of: {', '.join(s.INVITE_STATUSES)}."})
        return _invite_status_filter(qs, status)

    @extend_schema(
        parameters=[OpenApiParameter("status", str, enum=list(s.INVITE_STATUSES))],
        summary="List worker invites, newest first",
    )
    def get(self, request, *args, **kwargs):
        return super().get(request, *args, **kwargs)

    @extend_schema(
        request=s.InviteCreateSerializer,
        responses={201: s.AdminInviteWithTokenSerializer},
        summary="Invite a worker; the response carries the link token, once",
    )
    def post(self, request, *args, **kwargs):
        body = s.InviteCreateSerializer(data=request.data)
        body.is_valid(raise_exception=True)
        data = body.validated_data
        invite, token = invites.create(
            request.user, data["username"], data["first_name"].strip(), data["last_name"].strip()
        )
        return _invite_response(invite, token, status=201)


class InviteNewLinkView(InviteRefusalMixin, APIView):
    permission_classes = [requires(WORKER_MANAGE)]

    @extend_schema(
        request=None,
        responses={200: s.AdminInviteWithTokenSerializer},
        summary="Replace an open invite's link (new token, new 7-day expiry)",
    )
    def post(self, request, pk):
        made = invites.new_link(request.user, pk)
        if made is None:
            raise NotFound("No such invite.")
        return _invite_response(*made)


class InviteRevokeView(InviteRefusalMixin, APIView):
    permission_classes = [requires(WORKER_MANAGE)]

    @extend_schema(
        request=None,
        responses={200: s.AdminInviteSerializer},
        summary="Revoke an open invite; its link stops working",
    )
    def post(self, request, pk):
        invite = invites.revoke(request.user, pk)
        if invite is None:
            raise NotFound("No such invite.")
        return _invite_response(invite)


class AssignmentListCreateView(generics.ListCreateAPIView):
    permission_classes = [requires(ASSIGNMENT_MANAGE)]

    def get_serializer_class(self):
        return (
            s.AssignmentCreateSerializer
            if self.request.method == "POST"
            else s.AdminAssignmentSerializer
        )

    def get_queryset(self):
        request = self.request
        qs = _assignments().order_by("-created_at", "-id")
        if (worker := _int(request, "worker")) is not None:
            qs = qs.filter(worker_id=worker)
        cancelled = _tri(request, "cancelled", "any")
        if cancelled == "true":
            qs = qs.filter(cancelled_at__isnull=False)
        elif cancelled == "false":
            qs = qs.filter(cancelled_at__isnull=True)
        return qs

    @extend_schema(
        parameters=[
            OpenApiParameter("worker", int),
            OpenApiParameter("cancelled", str, enum=list(TRI), description="Default any."),
        ],
        summary="List assignments",
    )
    def get(self, request, *args, **kwargs):
        return super().get(request, *args, **kwargs)

    @extend_schema(
        request=s.AssignmentCreateSerializer,
        responses={201: s.AdminAssignmentSerializer},
        summary="Assign a published form version to a worker",
    )
    def post(self, request, *args, **kwargs):
        body = s.AssignmentCreateSerializer(data=request.data)
        body.is_valid(raise_exception=True)
        data = body.validated_data
        version = FormVersion.objects.filter(pk=data["form_version_id"]).first()
        worker = User.objects.filter(pk=data["worker_id"]).first()
        if version is None:
            raise ValidationError({"form_version_id": "No such form version."})
        if worker is None:
            raise ValidationError({"worker_id": "No such user."})
        assignment = Assignment(
            form_version=version,
            worker=worker,
            site_name=data["site_name"].strip(),
            due_date=data["due_date"],
        )
        if not assignment.site_name:
            raise ValidationError({"site_name": "Enter a site name."})
        try:
            assignment.full_clean()
        except Exception as exc:  # django ValidationError -> the same problem+json shape
            raise ValidationError(getattr(exc, "message_dict", {"detail": str(exc)})) from None
        assignment.save()
        created = _assignments().get(pk=assignment.pk)
        return Response(s.AdminAssignmentSerializer(created).data, status=201)


class AssignmentCancelView(APIView):
    permission_classes = [requires(ASSIGNMENT_MANAGE)]

    @extend_schema(
        request=None,
        responses={200: s.AdminAssignmentSerializer},
        summary="Cancel an assignment (existing submissions stay)",
    )
    def post(self, request, pk):
        assignment = Assignment.objects.filter(pk=pk).first()
        if assignment is None:
            raise NotFound("No such assignment.")
        assignment.cancel()  # a second call changes nothing
        return Response(s.AdminAssignmentSerializer(_assignments().get(pk=pk)).data)


# --- forms ------------------------------------------------------------------------------------


class FormListCreateView(generics.ListCreateAPIView):
    permission_classes = [requires(FORM_PUBLISH)]

    def get_serializer_class(self):
        return s.FormCreateSerializer if self.request.method == "POST" else s.FormSerializer

    def get_queryset(self):
        return Form.objects.prefetch_related("versions").order_by("name")

    @extend_schema(summary="Forms with their versions")
    def get(self, request, *args, **kwargs):
        return super().get(request, *args, **kwargs)

    @extend_schema(
        request=s.FormCreateSerializer,
        responses={201: s.FormSerializer},
        summary="Create a form (it has no versions yet)",
    )
    def post(self, request, *args, **kwargs):
        body = s.FormCreateSerializer(data=request.data)
        body.is_valid(raise_exception=True)
        name = body.validated_data["name"].strip()
        if not name:
            raise ValidationError({"name": "Enter a name."})
        if Form.objects.filter(name=name).exists():
            raise ValidationError({"name": "A form with this name already exists."})
        form = Form.objects.create(name=name)
        return Response(s.FormSerializer(form).data, status=201)


class FormVersionCreateView(APIView):
    """Publish a new version of a form. The schema is checked with the same rules as the Django
    admin, and a published version can never change (ADR 0008)."""

    permission_classes = [requires(FORM_PUBLISH)]

    @extend_schema(
        request=s.SchemaSerializer,
        responses={201: s.FormVersionDetailSerializer},
        summary="Publish a new version of a form",
    )
    def post(self, request, pk):
        form = Form.objects.filter(pk=pk).first()
        if form is None:
            raise NotFound("No such form.")
        body = s.SchemaSerializer(data=request.data)
        body.is_valid(raise_exception=True)
        schema = body.validated_data["schema"]
        with transaction.atomic():
            # Locked so the per-form name/type rule sees every version published before this one.
            Form.objects.select_for_update().get(pk=form.pk)
            if problems := publish_problems(form.pk, schema):
                raise ValidationError({"schema": problems})
            version = FormVersion.objects.create(form=form, schema=schema)
            version.publish()
        return Response(s.FormVersionDetailSerializer(version).data, status=201)


class FormVersionDetailView(generics.RetrieveAPIView):
    permission_classes = [requires(FORM_PUBLISH)]
    serializer_class = s.FormVersionDetailSerializer
    queryset = FormVersion.objects.select_related("form")

    @extend_schema(summary="One form version with its schema")
    def get(self, request, *args, **kwargs):
        return super().get(request, *args, **kwargs)


# A draft may be invalid, but it is still stored, so it gets a ceiling too: twice the publish limit.
MAX_DRAFT_BYTES = 2 * MAX_SCHEMA_BYTES


def _form(pk: int) -> Form:
    form = Form.objects.filter(pk=pk).first()
    if form is None:
        raise NotFound("No such form.")
    return form


def _draft(form_id: int) -> FormDraft | None:
    return (
        FormDraft.objects.select_related("based_on_version", "updated_by")
        .filter(form_id=form_id)
        .first()
    )


def _stale(form_id: int) -> Response:
    """409: someone saved or published the draft since the caller read it. The body carries the
    draft as it is now, so the editor can offer it instead of overwriting it."""
    current = _draft(form_id)
    return problem_response(
        409,
        "stale_draft",
        "Someone else changed this draft after you opened it.",
        draft=s.FormDraftSerializer(current).data if current else None,
    )


class FormDraftView(APIView):
    """The one draft of a form (ADR 0013). Only admins with form.publish see drafts; workers never
    do. Saves carry the revision last read, and a stale one is refused, never merged."""

    permission_classes = [requires(FORM_PUBLISH)]

    @extend_schema(responses={200: s.FormDraftSerializer}, summary="The form's draft")
    def get(self, request, pk):
        draft = _draft(_form(pk).pk)
        if draft is None:
            raise NotFound("This form has no draft.")
        return Response(s.FormDraftSerializer(draft).data)

    @extend_schema(
        request=s.FormDraftSaveSerializer,
        responses={
            200: s.FormDraftSerializer,
            201: s.FormDraftSerializer,
            409: s.StaleDraftSerializer,
        },
        summary="Save the form's draft (revision 0 starts one)",
    )
    def put(self, request, pk):
        form = _form(pk)
        body = s.FormDraftSaveSerializer(data=request.data)
        body.is_valid(raise_exception=True)
        schema, revision = body.validated_data["schema"], body.validated_data["revision"]
        if not isinstance(schema, dict):
            raise ValidationError({"schema": "A draft must be a JSON object."})
        size = len(json.dumps(schema, separators=(",", ":"), ensure_ascii=False).encode())
        if size > MAX_DRAFT_BYTES:
            raise ValidationError({"schema": f"A draft is at most {MAX_DRAFT_BYTES // 1024} KB."})

        if revision == 0:
            latest = form.versions.filter(published_at__isnull=False).order_by("-number").first()
            try:
                with transaction.atomic():
                    FormDraft.objects.create(
                        form=form, schema=schema, based_on_version=latest, updated_by=request.user
                    )
            except IntegrityError:  # someone started one first
                return _stale(form.pk)
            return Response(s.FormDraftSerializer(_draft(form.pk)).data, status=201)

        # Compare and set in one statement: only the revision the caller read is replaced.
        saved = FormDraft.objects.filter(form=form, revision=revision).update(
            schema=schema,
            revision=F("revision") + 1,
            updated_by=request.user,
            updated_at=timezone.now(),
        )
        if not saved:
            return _stale(form.pk)
        return Response(s.FormDraftSerializer(_draft(form.pk)).data)


class FormDraftPublishView(APIView):
    """Publish the draft as the next version and delete it, in one transaction."""

    permission_classes = [requires(FORM_PUBLISH)]

    @extend_schema(
        request=s.FormDraftPublishSerializer,
        responses={201: s.FormVersionDetailSerializer, 409: s.StaleDraftSerializer},
        summary="Publish the form's draft as its next version",
    )
    def post(self, request, pk):
        form = _form(pk)
        body = s.FormDraftPublishSerializer(data=request.data)
        body.is_valid(raise_exception=True)
        with transaction.atomic():
            Form.objects.select_for_update().get(pk=form.pk)
            draft = FormDraft.objects.select_for_update().filter(form=form).first()
            if draft is None or draft.revision != body.validated_data["revision"]:
                return _stale(form.pk)
            if problems := publish_problems(form.pk, draft.schema):
                raise ValidationError({"schema": problems})
            version = FormVersion.objects.create(form=form, schema=draft.schema)
            version.publish()
            draft.delete()
        return Response(s.FormVersionDetailSerializer(version).data, status=201)


class SchemaCheckView(APIView):
    """For the editor's live feedback: the problems a publish would report, without publishing."""

    permission_classes = [requires(FORM_PUBLISH)]

    @extend_schema(
        request=s.SchemaCheckRequestSerializer,
        responses={200: s.SchemaCheckSerializer},
        summary="Check a form schema without publishing it",
    )
    def post(self, request):
        body = s.SchemaCheckRequestSerializer(data=request.data)
        body.is_valid(raise_exception=True)
        schema = body.validated_data["schema"]
        form_id = body.validated_data.get("form_id")
        if form_id is None:
            problems = validate_form_schema(schema)
            return Response({"valid": not problems, "errors": problems, "changes": []})
        if not Form.objects.filter(pk=form_id).exists():
            raise ValidationError({"form_id": "No such form."})
        problems = publish_problems(form_id, schema)
        found = changes(published_schemas(form_id), schema) if isinstance(schema, dict) else []
        return Response({"valid": not problems, "errors": problems, "changes": found})


# --- conflict log -----------------------------------------------------------------------------


class ConflictLogView(generics.ListAPIView):
    """Every refused change from a worker's device: conflicts and rejections, newest first."""

    permission_classes = [requires(CONFLICTLOG_VIEW)]
    serializer_class = s.ConflictLogRowSerializer

    def get_queryset(self):
        request = self.request
        later_change = SubmissionEvent.objects.filter(
            submission_id=OuterRef("submission_id"),
            actor_id=OuterRef("actor_id"),
            id__gt=OuterRef("id"),
            kind__in=[EventKind.UPDATED, EventKind.SUBMITTED, EventKind.DELETED],
        )
        qs = (
            SubmissionEvent.objects.filter(kind__in=[EventKind.CONFLICT, EventKind.REJECTED])
            # Only changes made by the record's own worker: admin refusals are not conflicts.
            .filter(actor_id=F("submission__assignment__worker_id"))
            .select_related("submission__assignment", "submission__form_version__form", "actor")
            .annotate(changed_since=Exists(later_change))
            .order_by("-id")
        )
        if (kind := request.query_params.get("kind")) is not None:
            if kind not in {EventKind.CONFLICT, EventKind.REJECTED}:
                raise ValidationError({"kind": "Use conflict or rejected."})
            qs = qs.filter(kind=kind)
        if (worker := _int(request, "worker")) is not None:
            qs = qs.filter(actor_id=worker)
        if (since := request.query_params.get("changed_since")) is not None:
            qs = qs.filter(Q(changed_since=True) if since == "true" else Q(changed_since=False))
        return qs

    def list(self, request, *args, **kwargs):
        page = self.paginate_queryset(self.filter_queryset(self.get_queryset()))
        rows = [self._row(e) for e in page]
        return self.get_paginated_response(s.ConflictLogRowSerializer(rows, many=True).data)

    @staticmethod
    def _row(event: SubmissionEvent) -> dict:
        sub = event.submission
        detail = event.detail or {}
        return {
            "id": event.id,
            "created_at": event.created_at,
            "kind": event.kind,
            "reason": detail.get("kind") or detail.get("code") or "",
            "fields": detail.get("fields", []),
            "submission_id": sub.id,
            "site_name": sub.assignment.site_name,
            "form_name": sub.form_version.form.name,
            "worker": {"id": event.actor_id, "username": event.actor.username},
            "mutation_id": event.mutation_id,
            "changed_since": event.changed_since,
        }

    @extend_schema(
        parameters=[
            OpenApiParameter("kind", str, enum=["conflict", "rejected"]),
            OpenApiParameter("worker", int),
            OpenApiParameter(
                "changed_since",
                str,
                enum=["true", "false"],
                description="Whether the same worker changed the record on the server afterwards.",
            ),
        ],
        summary="The conflict log",
    )
    def get(self, request, *args, **kwargs):
        return self.list(request, *args, **kwargs)
