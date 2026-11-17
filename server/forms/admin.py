from django.contrib import admin, messages
from django.contrib.admin.options import ActionLocation
from django.core.exceptions import ValidationError

from .models import Form, FormVersion


@admin.register(Form)
class FormAdmin(admin.ModelAdmin):
    list_display = ("name", "latest_version", "created_at")
    search_fields = ("name",)

    @admin.display(description="Latest version")
    def latest_version(self, obj: Form) -> str:
        latest = obj.versions.order_by("-number").first()
        return str(latest) if latest else "none"


@admin.register(FormVersion)
class FormVersionAdmin(admin.ModelAdmin):
    """Forms are JSON edited here (no form builder in the PoC). A draft can be edited freely; once
    published it is read-only, because the database refuses any further change."""

    list_display = ("form", "number", "state", "created_at")
    list_filter = ("form",)
    readonly_fields = ("number", "published_at", "created_at")
    actions = ["publish_selected"]

    @admin.display(description="State")
    def state(self, obj: FormVersion) -> str:
        return "published" if obj.is_published else "draft"

    def has_change_permission(self, request, obj=None) -> bool:
        if obj is not None and obj.is_published:
            return False
        return super().has_change_permission(request, obj)

    def has_delete_permission(self, request, obj=None) -> bool:
        if obj is not None and obj.is_published:
            return False
        return super().has_delete_permission(request, obj)

    def get_actions(self, request, action_location=ActionLocation.CHANGE_LIST):
        actions = super().get_actions(request, action_location)
        # Bulk delete would try to remove published versions; the database would refuse them.
        actions.pop("delete_selected", None)
        return actions

    @admin.action(description="Publish selected drafts (cannot be undone)")
    def publish_selected(self, request, queryset) -> None:
        published = 0
        for version in queryset:
            try:
                was_published = version.is_published
                version.publish()
                published += 0 if was_published else 1
            except ValidationError as exc:
                self.message_user(request, f"{version}: {'; '.join(exc.messages)}", messages.ERROR)
        if published:
            self.message_user(request, f"Published {published} version(s).", messages.SUCCESS)
