from django.conf import settings
from django.contrib.auth.models import Group
from django.core.management.base import BaseCommand, CommandError

from accounts.models import User
from accounts.permissions import ADMIN, WORKER
from assignments.models import Assignment
from forms.models import Form, FormVersion
from forms.samples import GENERATOR_INSPECTION

DEMO_USERS = [("admin", ADMIN), ("worker1", WORKER), ("worker2", WORKER)]


class Command(BaseCommand):
    help = "Create demo logins, a published form and one assignment per worker. Development only."

    def add_arguments(self, parser):
        parser.add_argument("--password", default="demo-password-1")

    def handle(self, *args, password, **options):
        if not settings.DEBUG:
            raise CommandError("seed_demo only runs with DJANGO_DEBUG=1")
        for username, role in DEMO_USERS:
            user, created = User.objects.get_or_create(
                username=username, defaults={"is_staff": role == ADMIN}
            )
            user.set_password(password)
            user.is_staff = role == ADMIN
            user.save()
            user.groups.set([Group.objects.get(name=role)])
            self.stdout.write(f"{'created' if created else 'updated'} {username} ({role})")
        self._seed_form_and_assignments()

    def _seed_form_and_assignments(self):
        form, _ = Form.objects.get_or_create(name=GENERATOR_INSPECTION["title"])
        version = form.versions.filter(published_at__isnull=False).order_by("number").first()
        if version is None:
            version = FormVersion.objects.create(form=form, schema=GENERATOR_INSPECTION)
            version.publish()
            self.stdout.write(f"published {version}")
        for username, site in (("worker1", "North plant"), ("worker2", "Harbour depot")):
            worker = User.objects.get(username=username)
            _, created = Assignment.objects.get_or_create(
                form_version=version, worker=worker, site_name=site
            )
            self.stdout.write(
                f"{'created' if created else 'kept'} assignment {site} for {username}"
            )
