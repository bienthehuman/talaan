"""Request validation for push, and typed response shapes for the OpenAPI schema.

The service returns plain dicts (sync/results.py); the *Response serializers below describe them so
drf-spectacular can publish accurate types and the client's types are generated, not hand-written.
"""

from rest_framework import serializers

STATUSES = ["draft", "submitted", "approved", "returned"]


class PushMutationSerializer(serializers.Serializer):
    mutation_id = serializers.UUIDField()
    record_id = serializers.UUIDField()
    # Not a ChoiceField on purpose: an unknown op is a per-mutation `rejected` result, not a 400
    # that would discard the rest of the batch.
    op = serializers.CharField(max_length=32)
    base_version = serializers.IntegerField(min_value=0)
    fields = serializers.DictField(
        child=serializers.JSONField(allow_null=True),
        required=False,
        default=dict,
        help_text="Field values to set. null clears a field.",
    )
    assignment_id = serializers.IntegerField(required=False, allow_null=True, default=None)


class PushRequestSerializer(serializers.Serializer):
    device_id = serializers.UUIDField()
    client_schema = serializers.IntegerField(min_value=0)
    app_version = serializers.CharField(max_length=64, required=False, allow_blank=True, default="")
    mutations = PushMutationSerializer(many=True, allow_empty=True)


# --- response shapes (documentation only) -------------------------------------------------------


class RecordSerializer(serializers.Serializer):
    id = serializers.UUIDField()
    assignment_id = serializers.IntegerField()
    form_version_id = serializers.IntegerField()
    version = serializers.IntegerField()
    field_versions = serializers.DictField(child=serializers.IntegerField())
    data = serializers.DictField(child=serializers.JSONField(allow_null=True))
    status = serializers.ChoiceField(choices=STATUSES)
    deleted = serializers.BooleanField()
    server_seq = serializers.IntegerField()


class FieldErrorSerializer(serializers.Serializer):
    field = serializers.CharField()
    code = serializers.CharField()
    message = serializers.CharField()


class ConflictFieldSerializer(serializers.Serializer):
    field = serializers.CharField()
    server_value = serializers.JSONField(allow_null=True, required=False)
    client_value = serializers.JSONField(allow_null=True, required=False)
    server_version = serializers.IntegerField(required=False)


class ConflictSerializer(serializers.Serializer):
    kind = serializers.ChoiceField(
        choices=["field_conflict", "deleted_remotely", "edited_since_base"]
    )
    fields = ConflictFieldSerializer(many=True)


class MutationResultSerializer(serializers.Serializer):
    mutation_id = serializers.UUIDField()
    status = serializers.ChoiceField(choices=["applied", "conflict", "rejected"])
    record = RecordSerializer(required=False)
    conflict = ConflictSerializer(required=False)
    code = serializers.ChoiceField(
        choices=[
            "locked",
            "not_found",
            "id_taken",
            "invalid",
            "invalid_state",
            "unknown_form_version",
            "mutation_id_reuse",
            "forbidden",
        ],
        required=False,
    )
    detail = serializers.CharField(required=False)
    errors = FieldErrorSerializer(many=True, required=False)


class PushResponseSerializer(serializers.Serializer):
    results = MutationResultSerializer(many=True)


class PullResponseSerializer(serializers.Serializer):
    records = RecordSerializer(many=True)
    next_cursor = serializers.IntegerField()
    has_more = serializers.BooleanField()


class AssignmentSerializer(serializers.Serializer):
    id = serializers.IntegerField()
    form_version_id = serializers.IntegerField()
    form_name = serializers.CharField()
    site_name = serializers.CharField()
    due_date = serializers.DateField(allow_null=True)
    cancelled = serializers.BooleanField()


class AssignmentListSerializer(serializers.Serializer):
    results = AssignmentSerializer(many=True)


class FormVersionSerializer(serializers.Serializer):
    id = serializers.IntegerField()
    form_id = serializers.IntegerField()
    form_name = serializers.CharField()
    number = serializers.IntegerField()
    schema = serializers.DictField(child=serializers.JSONField(allow_null=True))
    published_at = serializers.DateTimeField()


class FormVersionListSerializer(serializers.Serializer):
    results = FormVersionSerializer(many=True)


class ProblemSerializer(serializers.Serializer):
    """RFC 7807 problem+json, returned for every non-2xx response."""

    type = serializers.CharField()
    title = serializers.CharField()
    status = serializers.IntegerField()
    code = serializers.CharField()
    detail = serializers.CharField()
    errors = serializers.JSONField(required=False)
    retry_after = serializers.IntegerField(required=False)
