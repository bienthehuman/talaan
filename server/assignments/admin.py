from django.contrib import admin, messages
from django.contrib.admin.options import ActionLocation

from accounts.models import User
from accounts.permissions import WORKER
from forms.models import FormVersion

from .models import Assignment


@admin.register(Assignment)
class AssignmentAdmin(admin.ModelAdmin):
    list_display = ("site_name", "form_version", "worker", "due_date", "state")
    list_filter = ("form_version__form", "worker")
    search_fields = ("site_name", "worker__username")
    readonly_fields = ("cancelled_at", "created_at")
    actions = ["cancel_selected"]

    @admin.display(description="State")
    def state(self, obj: Assignment) -> str:
        return "cancelled" if obj.is_cancelled else "active"

    def formfield_for_foreignkey(self, db_field, request, **kwargs):
        if db_field.name == "form_version":
            kwargs["queryset"] = FormVersion.objects.filter(published_at__isnull=False)
        if db_field.name == "worker":
            kwargs["queryset"] = User.objects.filter(groups__name=WORKER)
        return super().formfield_for_foreignkey(db_field, request, **kwargs)

    def get_actions(self, request, action_location=ActionLocation.CHANGE_LIST):
        actions = super().get_actions(request, action_location)
        actions.pop("delete_selected", None)  # correct a mistake by cancelling instead
        return actions

    def has_delete_permission(self, request, obj=None) -> bool:
        return False

    @admin.action(description="Cancel selected assignments")
    def cancel_selected(self, request, queryset) -> None:
        count = 0
        for assignment in queryset:
            if not assignment.is_cancelled:
                assignment.cancel()
                count += 1
        self.message_user(request, f"Cancelled {count} assignment(s).", messages.SUCCESS)
