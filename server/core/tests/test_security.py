import os
import subprocess
import sys
from pathlib import Path

SERVER_DIR = Path(__file__).resolve().parents[2]


def test_security_headers_present(client):
    response = client.get("/api/health/")
    assert response["X-Content-Type-Options"] == "nosniff"
    assert response["X-Frame-Options"] == "DENY"
    assert response["Referrer-Policy"] == "same-origin"
    assert response["Cross-Origin-Opener-Policy"] == "same-origin"
    csp = response["Content-Security-Policy"]
    assert "default-src 'self'" in csp
    assert "frame-ancestors 'none'" in csp


def _run_settings(code: str = "import config.settings", **env) -> subprocess.CompletedProcess:
    """Load settings in a fresh interpreter. The repo .env is read by settings too, so anything a
    test depends on must be passed explicitly (an explicit value, even empty, beats the file)."""
    full_env = {
        k: v
        for k, v in os.environ.items()
        if k not in {"DJANGO_DEBUG", "DJANGO_SECRET_KEY", "FAULT_INJECTION"}
    }
    full_env.update(env)
    full_env["DJANGO_SETTINGS_MODULE"] = "config.settings"
    return subprocess.run(  # noqa: S603
        [sys.executable, "-c", code],
        cwd=SERVER_DIR,
        env=full_env,
        capture_output=True,
        text=True,
        check=False,
    )


def _import_settings(**env) -> subprocess.CompletedProcess:
    return _run_settings("import config.settings", **env)


def test_fault_injection_refused_outside_debug():
    result = _import_settings(DJANGO_DEBUG="0", DJANGO_SECRET_KEY="x" * 40, FAULT_INJECTION="1")
    assert result.returncode != 0
    assert "FAULT_INJECTION" in result.stderr


def test_fault_injection_allowed_in_debug():
    result = _import_settings(DJANGO_DEBUG="1", FAULT_INJECTION="1")
    assert result.returncode == 0, result.stderr


def test_secret_key_required_outside_debug(tmp_path):
    # A path with no .env: Env.read_env reads the repo .env, so blank the key explicitly.
    result = _import_settings(DJANGO_DEBUG="0", DJANGO_SECRET_KEY="")
    assert result.returncode != 0
    assert "DJANGO_SECRET_KEY" in result.stderr


def test_short_secret_key_refused_outside_debug():
    result = _import_settings(DJANGO_DEBUG="0", DJANGO_SECRET_KEY="too-short")
    assert result.returncode != 0
    assert "at least 32 characters" in result.stderr


def test_long_secret_key_accepted_outside_debug():
    result = _import_settings(DJANGO_DEBUG="0", DJANGO_SECRET_KEY="x" * 40, POSTGRES_PASSWORD="pw")
    assert result.returncode == 0, result.stderr


def test_database_password_required_outside_debug():
    result = _import_settings(DJANGO_DEBUG="0", DJANGO_SECRET_KEY="x" * 40, POSTGRES_PASSWORD="")
    assert result.returncode != 0
    assert "POSTGRES_PASSWORD" in result.stderr


def test_csrf_trusted_origins_and_proxy_count_come_from_the_environment():
    result = _run_settings(
        "from django.conf import settings as s; "
        "print(s.CSRF_TRUSTED_ORIGINS, s.REST_FRAMEWORK['NUM_PROXIES'])",
        DJANGO_DEBUG="1",
        DJANGO_CSRF_TRUSTED_ORIGINS="https://a.example,https://b.example",
        NUM_PROXIES="2",
    )
    assert result.returncode == 0, result.stderr
    assert result.stdout.strip() == "['https://a.example', 'https://b.example'] 2"
