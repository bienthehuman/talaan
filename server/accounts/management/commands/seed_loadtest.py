from django.conf import settings
from django.contrib.auth.models import Group
from django.core.management.base import BaseCommand, CommandError

from accounts.models import User
from accounts.permissions import WORKER
from assignments.models import Assignment
from forms.models import Form, FormVersion
from forms.samples import GENERATOR_INSPECTION

PREFIX = "loadtest"


class Command(BaseCommand):
    help = (
        "Create N worker logins (loadtest001, ...), one assignment each, for loadtest/. Debug only."
    )

    def add_arguments(self, parser):
        parser.add_argument("--workers", type=int, default=100)
        parser.add_argument("--password", default="loadtest-password-1")

    def handle(self, *args, workers, password, **options):
        if not settings.DEBUG:
            raise CommandError("seed_loadtest only runs with DJANGO_DEBUG=1")
        group = Group.objects.get(name=WORKER)
        form, _ = Form.objects.get_or_create(name=GENERATOR_INSPECTION["title"])
        version = form.versions.filter(published_at__isnull=False).order_by("number").first()
        if version is None:
            version = FormVersion.objects.create(form=form, schema=GENERATOR_INSPECTION)
            version.publish()
        created = 0
        for n in range(1, workers + 1):
            user, was_created = User.objects.get_or_create(username=f"{PREFIX}{n:03d}")
            user.set_password(password)
            user.save()
            user.groups.set([group])
            Assignment.objects.get_or_create(
                form_version=version, worker=user, site_name=f"Load site {n:03d}"
            )
            created += was_created
        self.stdout.write(f"{workers} load-test workers ready ({created} new), password {password}")
