"""Shapes for the admin API (docs/protocol.md section 11). Read-only serializers describe responses;
the few request serializers validate what an admin sends."""

from rest_framework import serializers

from assignments.models import Assignment
from forms.models import Form, FormVersion
from submissions.models import Submission, SubmissionEvent


class UserRefSerializer(serializers.Serializer):
    id = serializers.IntegerField()
    username = serializers.CharField()


class SubmissionRowSerializer(serializers.ModelSerializer):
    assignment_id = serializers.IntegerField()
    site_name = serializers.CharField(source="assignment.site_name")
    form_name = serializers.CharField(source="form_version.form.name")
    form_version_id = serializers.IntegerField()
    form_version_number = serializers.IntegerField(source="form_version.number")
    worker = UserRefSerializer(source="assignment.worker")
    deleted = serializers.SerializerMethodField()
    updated_by = serializers.CharField(source="updated_by.username", default=None)

    class Meta:
        model = Submission
        fields = [
            "id",
            "assignment_id",
            "site_name",
            "form_name",
            "form_version_id",
            "form_version_number",
            "worker",
            "status",
            "version",
            "deleted",
            "server_seq",
            "updated_by",
            "updated_at",
        ]

    def get_deleted(self, obj: Submission) -> bool:
        return obj.deleted_at is not None


class EventSerializer(serializers.ModelSerializer):
    actor = UserRefSerializer(allow_null=True)

    class Meta:
        model = SubmissionEvent
        fields = ["id", "version", "kind", "actor", "mutation_id", "detail", "created_at"]


class SubmissionDetailSerializer(SubmissionRowSerializer):
    data = serializers.JSONField()
    field_versions = serializers.JSONField()
    schema = serializers.JSONField(source="form_version.schema")
    events = EventSerializer(many=True)

    class Meta(SubmissionRowSerializer.Meta):
        fields = [
            *SubmissionRowSerializer.Meta.fields,
            "data",
            "field_versions",
            "schema",
            "events",
        ]


class AdminAssignmentSerializer(serializers.ModelSerializer):
    form_name = serializers.CharField(source="form_version.form.name")
    form_version_number = serializers.IntegerField(source="form_version.number")
    worker = UserRefSerializer()
    cancelled = serializers.BooleanField(source="is_cancelled")
    submissions = serializers.IntegerField(source="submission_count", default=0)

    class Meta:
        model = Assignment
        fields = [
            "id",
            "form_version_id",
            "form_name",
            "form_version_number",
            "worker",
            "site_name",
            "due_date",
            "cancelled",
            "submissions",
            "created_at",
        ]


class AssignmentCreateSerializer(serializers.Serializer):
    form_version_id = serializers.IntegerField()
    worker_id = serializers.IntegerField()
    site_name = serializers.CharField(max_length=200)
    due_date = serializers.DateField(required=False, allow_null=True, default=None)


class AdminFormVersionSerializer(serializers.ModelSerializer):
    class Meta:
        model = FormVersion
        fields = ["id", "number", "published_at", "created_at"]


class FormVersionDetailSerializer(AdminFormVersionSerializer):
    form_id = serializers.IntegerField()
    form_name = serializers.CharField(source="form.name")

    class Meta(AdminFormVersionSerializer.Meta):
        fields = [*AdminFormVersionSerializer.Meta.fields, "form_id", "form_name", "schema"]


class FormSerializer(serializers.ModelSerializer):
    versions = AdminFormVersionSerializer(many=True)

    class Meta:
        model = Form
        fields = ["id", "name", "created_at", "versions"]


class FormCreateSerializer(serializers.Serializer):
    name = serializers.CharField(max_length=200)


class SchemaSerializer(serializers.Serializer):
    schema = serializers.JSONField()


class FormDraftSerializer(serializers.Serializer):
    schema = serializers.JSONField(help_text="Work in progress; may be incomplete or invalid.")
    revision = serializers.IntegerField(help_text="Send this back when saving or publishing.")
    based_on_version = serializers.IntegerField(
        source="based_on_version.number",
        allow_null=True,
        help_text="The number of the latest published version when the draft was started.",
    )
    updated_by = serializers.CharField(source="updated_by.username", allow_null=True)
    updated_at = serializers.DateTimeField()


class FormDraftSaveSerializer(serializers.Serializer):
    schema = serializers.JSONField()
    revision = serializers.IntegerField(
        min_value=0, help_text="The revision last read; 0 to start a draft."
    )


class FormDraftPublishSerializer(serializers.Serializer):
    revision = serializers.IntegerField(min_value=1)


class StaleDraftSerializer(serializers.Serializer):
    """The 409 problem body: the draft as it is now (null when it was published or removed)."""

    status = serializers.IntegerField()
    code = serializers.CharField()
    detail = serializers.CharField()
    draft = FormDraftSerializer(allow_null=True)


class SchemaCheckRequestSerializer(SchemaSerializer):
    form_id = serializers.IntegerField(
        required=False,
        help_text="Also compare with this form's published versions (the change summary).",
    )


class SchemaChangeSerializer(serializers.Serializer):
    level = serializers.ChoiceField(choices=["safe", "review", "refused"])
    field = serializers.CharField(allow_blank=True, help_text="Empty for a change to the form.")
    message = serializers.CharField()


class SchemaCheckSerializer(serializers.Serializer):
    valid = serializers.BooleanField()
    errors = serializers.ListField(child=serializers.CharField())
    changes = SchemaChangeSerializer(many=True)


class ConflictLogRowSerializer(serializers.Serializer):
    id = serializers.IntegerField()
    created_at = serializers.DateTimeField()
    kind = serializers.ChoiceField(choices=["conflict", "rejected"])
    reason = serializers.CharField(help_text="The conflict kind or the rejection code.")
    fields = serializers.ListField(child=serializers.CharField())
    submission_id = serializers.UUIDField()
    site_name = serializers.CharField()
    form_name = serializers.CharField()
    worker = UserRefSerializer()
    mutation_id = serializers.UUIDField(allow_null=True)
    changed_since = serializers.BooleanField(
        help_text="The same worker has changed this record on the server since."
    )
