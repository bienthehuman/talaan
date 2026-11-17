from django.conf import settings
from django.contrib.auth.models import Group
from django.core.management.base import BaseCommand, CommandError

from accounts.models import User
from accounts.permissions import ADMIN, WORKER

DEMO_USERS = [("admin", ADMIN), ("worker1", WORKER), ("worker2", WORKER)]


class Command(BaseCommand):
    help = "Create demo logins (one admin, two workers). Development only."

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
