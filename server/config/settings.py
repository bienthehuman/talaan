"""Talaan settings. Everything environment-specific comes from env vars (see ../.env.example)."""

from datetime import timedelta
from pathlib import Path

import environ
from django.core.exceptions import ImproperlyConfigured
from django.utils.csp import CSP

BASE_DIR = Path(__file__).resolve().parent.parent

env = environ.Env(DJANGO_DEBUG=(bool, False))
environ.Env.read_env(BASE_DIR.parent / ".env")

DEBUG = env("DJANGO_DEBUG")

SECRET_KEY = env("DJANGO_SECRET_KEY", default="dev-only-insecure-key" if DEBUG else None)
if not SECRET_KEY:
    raise ImproperlyConfigured("DJANGO_SECRET_KEY is required when DJANGO_DEBUG is off")
# The key signs the JWTs (HS256); PyJWT warns below 32 bytes, so refuse a short one in production.
if not DEBUG and len(SECRET_KEY) < 32:
    raise ImproperlyConfigured(
        "DJANGO_SECRET_KEY must be at least 32 characters when DJANGO_DEBUG is off"
    )

ALLOWED_HOSTS = env.list("DJANGO_ALLOWED_HOSTS", default=["localhost", "127.0.0.1"])
# Django checks the Origin header on POST; behind a TLS-terminating proxy it must be listed, e.g.
# https://talaan.example.com
CSRF_TRUSTED_ORIGINS = env.list("DJANGO_CSRF_TRUSTED_ORIGINS", default=[])

# Dev/test only. The fault-injection middleware (phase 1) must never exist in production.
FAULT_INJECTION = env.bool("FAULT_INJECTION", default=False)
if FAULT_INJECTION and not DEBUG:
    raise ImproperlyConfigured("FAULT_INJECTION=1 is only allowed with DJANGO_DEBUG=1")

# Protocol version floor; older clients get 426 (docs/protocol.md section 2).
MIN_CLIENT_SCHEMA = env.int("MIN_CLIENT_SCHEMA", default=1)

INSTALLED_APPS = [
    "django.contrib.admin",
    "django.contrib.auth",
    "django.contrib.contenttypes",
    "django.contrib.sessions",
    "django.contrib.messages",
    "django.contrib.staticfiles",
    "rest_framework",
    "drf_spectacular",
    "drf_spectacular_sidecar",
    "core",
    "accounts",
    "forms",
    "assignments",
    "submissions",
    "sync",
]

MIDDLEWARE = [
    "django.middleware.security.SecurityMiddleware",
    "django.middleware.csp.ContentSecurityPolicyMiddleware",
    "whitenoise.middleware.WhiteNoiseMiddleware",
    "django.contrib.sessions.middleware.SessionMiddleware",
    "django.middleware.common.CommonMiddleware",
    "django.middleware.csrf.CsrfViewMiddleware",
    "django.contrib.auth.middleware.AuthenticationMiddleware",
    "django.contrib.messages.middleware.MessageMiddleware",
    "django.middleware.clickjacking.XFrameOptionsMiddleware",
]

# Test-only failures (sync/faults.py): installed only when enabled, and refused outside debug.
if FAULT_INJECTION:
    MIDDLEWARE.append("sync.middleware.FaultInjectionMiddleware")

ROOT_URLCONF = "config.urls"
WSGI_APPLICATION = "config.wsgi.application"
AUTH_USER_MODEL = "accounts.User"

TEMPLATES = [
    {
        "BACKEND": "django.template.backends.django.DjangoTemplates",
        "DIRS": [],
        "APP_DIRS": True,
        "OPTIONS": {
            "context_processors": [
                "django.template.context_processors.request",
                "django.contrib.auth.context_processors.auth",
                "django.contrib.messages.context_processors.messages",
            ],
        },
    },
]

# No dev default outside debug: a deploy that forgot the password must fail, not use a known one.
DB_PASSWORD = env("POSTGRES_PASSWORD", default="talaan_app_dev" if DEBUG else None)
if not DB_PASSWORD:
    raise ImproperlyConfigured("POSTGRES_PASSWORD is required when DJANGO_DEBUG is off")

# The app connects as a least-privilege role (no DDL). Migrations run as the owner role by
# overriding POSTGRES_USER/POSTGRES_PASSWORD (scripts/migrate.sh). See ARCHITECTURE.md, section 7.
DATABASES = {
    "default": {
        "ENGINE": "django.db.backends.postgresql",
        "NAME": env("POSTGRES_DB", default="talaan"),
        "USER": env("POSTGRES_USER", default="talaan_app"),
        "PASSWORD": DB_PASSWORD,
        "HOST": env("POSTGRES_HOST", default="localhost"),
        "PORT": env("POSTGRES_PORT", default="5434"),
        "CONN_MAX_AGE": 60,
    }
}
DEFAULT_AUTO_FIELD = "django.db.models.BigAutoField"

AUTH_PASSWORD_VALIDATORS = [
    {"NAME": "django.contrib.auth.password_validation.UserAttributeSimilarityValidator"},
    {"NAME": "django.contrib.auth.password_validation.MinimumLengthValidator"},
    {"NAME": "django.contrib.auth.password_validation.CommonPasswordValidator"},
    {"NAME": "django.contrib.auth.password_validation.NumericPasswordValidator"},
]

LANGUAGE_CODE = "en-us"
TIME_ZONE = "UTC"
USE_I18N = False
USE_TZ = True

STATIC_URL = "static/"
STATIC_ROOT = BASE_DIR / "staticfiles"
WHITENOISE_USE_FINDERS = DEBUG

# --- REST framework -------------------------------------------------------------------------
REST_FRAMEWORK = {
    "DEFAULT_AUTHENTICATION_CLASSES": ["rest_framework_simplejwt.authentication.JWTAuthentication"],
    "DEFAULT_PERMISSION_CLASSES": ["rest_framework.permissions.IsAuthenticated"],
    "DEFAULT_RENDERER_CLASSES": ["rest_framework.renderers.JSONRenderer"],
    "DEFAULT_SCHEMA_CLASS": "drf_spectacular.openapi.AutoSchema",
    "DEFAULT_PAGINATION_CLASS": "core.pagination.StandardPagination",
    "EXCEPTION_HANDLER": "core.errors.problem_exception_handler",
    "DEFAULT_THROTTLE_RATES": {
        "login": env("THROTTLE_LOGIN", default="10/min"),
        "push": env("THROTTLE_PUSH", default="120/min"),
    },
    # Number of proxies in front of Django (production: Caddy and nginx = 2). Without this every
    # client shares the proxy's address and the login rate limit becomes one global bucket.
    "NUM_PROXIES": env.int("NUM_PROXIES", default=None),
}

SIMPLE_JWT = {
    # Short access token so token expiry mid-sync is a testable case (scenario 9).
    "ACCESS_TOKEN_LIFETIME": timedelta(minutes=env.int("JWT_ACCESS_MINUTES", default=5)),
    "REFRESH_TOKEN_LIFETIME": timedelta(days=env.int("JWT_REFRESH_DAYS", default=7)),
    "ROTATE_REFRESH_TOKENS": False,
    "AUTH_HEADER_TYPES": ("Bearer",),
}

SPECTACULAR_SETTINGS = {
    "TITLE": "Talaan API",
    "DESCRIPTION": "Offline-first field data sync. Protocol: docs/protocol.md",
    "VERSION": "0.1.0",
    "SERVE_INCLUDE_SCHEMA": False,
    "SWAGGER_UI_DIST": "SIDECAR",
    "SWAGGER_UI_FAVICON_HREF": "SIDECAR",
    "REDOC_DIST": "SIDECAR",
    "COMPONENT_SPLIT_REQUEST": True,
}

# --- Security headers and cookies ----------------------------------------------------------
SECURE_CONTENT_TYPE_NOSNIFF = True
SECURE_REFERRER_POLICY = "same-origin"
SECURE_CROSS_ORIGIN_OPENER_POLICY = "same-origin"
X_FRAME_OPTIONS = "DENY"
SECURE_CSP = {
    "default-src": [CSP.SELF],
    "script-src": [CSP.SELF],
    "style-src": [CSP.SELF],
    "img-src": [CSP.SELF, "data:"],
    "connect-src": [CSP.SELF],
    "frame-ancestors": [CSP.NONE],
    "base-uri": [CSP.SELF],
    "form-action": [CSP.SELF],
}

if not DEBUG:
    SECURE_SSL_REDIRECT = env.bool("SECURE_SSL_REDIRECT", default=True)
    SECURE_PROXY_SSL_HEADER = ("HTTP_X_FORWARDED_PROTO", "https")
    SECURE_HSTS_SECONDS = 31536000
    SECURE_HSTS_INCLUDE_SUBDOMAINS = True
    SESSION_COOKIE_SECURE = True
    CSRF_COOKIE_SECURE = True

LOGGING = {
    "version": 1,
    "disable_existing_loggers": False,
    "handlers": {"console": {"class": "logging.StreamHandler"}},
    "root": {"handlers": ["console"], "level": env("LOG_LEVEL", default="INFO")},
}
