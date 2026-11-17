from django.core.exceptions import ValidationError
from django.db import models, transaction
from django.utils import timezone

from .schema import validate_form_schema


class Form(models.Model):
    """A form family, for example "Generator inspection"."""

    name = models.CharField(max_length=200, unique=True)
    created_at = models.DateTimeField(auto_now_add=True)

    def __str__(self) -> str:
        return self.name


class FormVersion(models.Model):
    """One version of a form. Immutable once published (a database trigger enforces it), because
    submissions pin to the exact version they were started on (ADR 0008)."""

    form = models.ForeignKey(Form, on_delete=models.PROTECT, related_name="versions")
    number = models.PositiveIntegerField(editable=False)
    schema = models.JSONField(help_text="Form schema; see docs/DATA_MODEL.md section 5.")
    published_at = models.DateTimeField(null=True, blank=True, editable=False)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        constraints = [
            models.UniqueConstraint(
                fields=["form", "number"], name="forms_formversion_unique_number"
            ),
            models.CheckConstraint(
                condition=models.Q(number__gte=1), name="forms_formversion_number_gte_1"
            ),
        ]
        ordering = ["form_id", "number"]

    def __str__(self) -> str:
        return f"{self.form.name} v{self.number}" + ("" if self.published_at else " (draft)")

    def save(self, *args, **kwargs) -> None:
        if self._state.adding and self.number is None:
            # Lock the parent row so two new versions of one form cannot take the same number.
            with transaction.atomic():
                Form.objects.select_for_update().get(pk=self.form_id)
                last = FormVersion.objects.filter(form_id=self.form_id).aggregate(
                    m=models.Max("number")
                )["m"]
                self.number = (last or 0) + 1
                super().save(*args, **kwargs)
            return
        super().save(*args, **kwargs)

    @property
    def is_published(self) -> bool:
        return self.published_at is not None

    def clean(self) -> None:
        problems = validate_form_schema(self.schema)
        if problems:
            raise ValidationError({"schema": problems})

    def publish(self) -> None:
        """Validate and publish. Publishing an already published version does nothing."""
        if self.is_published:
            return
        self.full_clean()
        self.published_at = timezone.now()
        self.save(update_fields=["published_at"])
