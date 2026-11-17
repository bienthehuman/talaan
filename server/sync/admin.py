from django.contrib import admin

from .models import AppliedMutation, Device


@admin.register(Device)
class DeviceAdmin(admin.ModelAdmin):
    list_display = ("id", "user", "app_version", "last_seen_at")

    def has_add_permission(self, request) -> bool:
        return False


@admin.register(AppliedMutation)
class AppliedMutationAdmin(admin.ModelAdmin):
    """The ledger is evidence. It is shown, never edited."""

    list_display = ("mutation_id", "user", "device_id", "created_at")

    def has_add_permission(self, request) -> bool:
        return False

    def has_change_permission(self, request, obj=None) -> bool:
        return False

    def has_delete_permission(self, request, obj=None) -> bool:
        return False
