from django.conf import settings
from django.core.exceptions import ValidationError
from django.db import models
from django.utils import timezone

from accounts.permissions import WORKER
from forms.models import FormVersion


class Assignment(models.Model):
    """A published form version assigned to one worker for one site. What a worker downloads."""

    form_version = models.ForeignKey(
        FormVersion, on_delete=models.PROTECT, related_name="assignments"
    )
    worker = models.ForeignKey(
        settings.AUTH_USER_MODEL, on_delete=models.PROTECT, related_name="assignments"
    )
    site_name = models.CharField(max_length=200)
    due_date = models.DateField(null=True, blank=True)
    # The correction for an assignment made by mistake. Existing submissions stay.
    cancelled_at = models.DateTimeField(null=True, blank=True, editable=False)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        indexes = [models.Index(fields=["worker"], name="assignments_worker_idx")]
        ordering = ["-created_at"]

    def __str__(self) -> str:
        return f"{self.form_version} at {self.site_name}"

    @property
    def is_cancelled(self) -> bool:
        return self.cancelled_at is not None

    def clean(self) -> None:
        if self.form_version_id and not self.form_version.is_published:
            raise ValidationError(
                {"form_version": "Only a published form version can be assigned."}
            )
        if self.worker_id and self.worker.role != WORKER:
            raise ValidationError({"worker": "Assignments go to users with the worker role."})

    def cancel(self) -> None:
        if not self.is_cancelled:
            self.cancelled_at = timezone.now()
            self.save(update_fields=["cancelled_at"])
