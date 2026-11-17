from django.contrib import admin

from .models import Submission, SubmissionEvent


class ReadOnlyAdmin(admin.ModelAdmin):
    """Submissions change only through the sync service (advisory lock, version bump, ledger).
    The admin shows them but never writes them; admin actions come with the review UI."""

    def has_add_permission(self, request) -> bool:
        return False

    def has_change_permission(self, request, obj=None) -> bool:
        return False

    def has_delete_permission(self, request, obj=None) -> bool:
        return False


@admin.register(Submission)
class SubmissionAdmin(ReadOnlyAdmin):
    list_display = (
        "id",
        "assignment",
        "status",
        "version",
        "server_seq",
        "deleted_at",
        "updated_at",
    )
    list_filter = ("status", "form_version__form")
    search_fields = ("id",)


@admin.register(SubmissionEvent)
class SubmissionEventAdmin(ReadOnlyAdmin):
    list_display = ("id", "submission", "kind", "version", "actor", "created_at")
    list_filter = ("kind",)
