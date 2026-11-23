from django.core.exceptions import ValidationError
from django.db import models, transaction
from django.utils import timezone

from .compat import changes, refused
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
        problems = publish_problems(self.form_id, self.schema)
        if problems:
            raise ValidationError({"schema": problems})

    def publish(self) -> None:
        """Validate and publish. Publishing an already published version does nothing.

        The form row is locked first, so two publishes of one form are checked one after the other
        and cannot both give a field name a different type."""
        if self.is_published:
            return
        with transaction.atomic():
            Form.objects.select_for_update().get(pk=self.form_id)
            self.full_clean()
            self.published_at = timezone.now()
            self.save(update_fields=["published_at"])


def published_schemas(form_id: int) -> list[dict]:
    """The schemas of a form's published versions, oldest first."""
    return list(
        FormVersion.objects.filter(form_id=form_id, published_at__isnull=False)
        .order_by("number")
        .values_list("schema", flat=True)
    )


def publish_problems(form_id: int, schema: object) -> list[str]:
    """Everything that would stop `schema` being published as the next version of the form: the
    schema rules, then the per-form name/type rule (ADR 0013). Empty means it can be published."""
    problems = validate_form_schema(schema)
    if isinstance(schema, dict):
        problems += refused(changes(published_schemas(form_id), schema))
    return problems
