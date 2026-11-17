"""Test settings: the pre-migrated `talaan_test` database, still as the least-privilege app role."""

from .settings import *  # noqa: F403

DATABASES["default"]["NAME"] = env("POSTGRES_TEST_DB", default="talaan_test")  # noqa: F405
DATABASES["default"]["CONN_MAX_AGE"] = 0  # noqa: F405
SECURE_SSL_REDIRECT = False
PASSWORD_HASHERS = ["django.contrib.auth.hashers.MD5PasswordHasher"]
REST_FRAMEWORK = {  # noqa: F405
    **REST_FRAMEWORK,  # noqa: F405
    "DEFAULT_THROTTLE_RATES": {"login": "5/min", "push": "1000/min"},
}
CACHES = {"default": {"BACKEND": "django.core.cache.backends.locmem.LocMemCache"}}
