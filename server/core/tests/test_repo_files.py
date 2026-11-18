"""Guards for the files a reviewer meets first: the dev container and the README."""

import json
import os
import pathlib
import re

ROOT = pathlib.Path(__file__).resolve().parents[3]


def test_the_dev_container_builds_and_opens_the_app_on_codespaces_hostnames():
    config = json.loads((ROOT / ".devcontainer/devcontainer.json").read_text())
    assert 8080 in config["forwardPorts"]
    assert config["portsAttributes"]["8080"]["onAutoForward"] == "openBrowser"
    hosts = config["containerEnv"]["DJANGO_ALLOWED_HOSTS"].split(",")
    assert ".app.github.dev" in hosts and "localhost" in hosts
    assert config["containerEnv"]["DJANGO_CSRF_TRUSTED_ORIGINS"] == "https://*.app.github.dev"
    assert config["containerEnv"]["FAULT_INJECTION"] == "1"  # development only: needs DEBUG
    setup = ROOT / ".devcontainer/setup.sh"
    assert setup.name in config["postCreateCommand"] and os.access(setup, os.X_OK)
    assert "seed_demo" in setup.read_text() and "up -d --build --wait" in setup.read_text()


def test_the_dev_compose_file_takes_its_allowed_hosts_from_the_environment():
    compose = (ROOT / "docker-compose.yml").read_text()
    assert "DJANGO_ALLOWED_HOSTS: ${DJANGO_ALLOWED_HOSTS:-localhost,127.0.0.1,server}" in compose
    assert "DJANGO_CSRF_TRUSTED_ORIGINS: ${DJANGO_CSRF_TRUSTED_ORIGINS:-}" in compose


def test_every_relative_link_in_the_readme_points_at_a_file_that_exists():
    text = (ROOT / "README.md").read_text()
    links = re.findall(r"\]\(([^)\s]+)\)", text)
    local = [link.split("#")[0] for link in links if not re.match(r"https?:", link)]
    missing = [link for link in local if link and not (ROOT / link).exists()]
    assert missing == []
    assert len(local) > 20  # the guarantees table is made of these links


def test_the_readme_links_the_codespaces_button_and_both_clips():
    text = (ROOT / "README.md").read_text()
    assert "codespaces.new/bienthehuman/talaan" in text
    for clip in ("offline-and-lost-response.gif", "two-device-conflict.gif"):
        assert f"docs/media/{clip}" in text and (ROOT / "docs/media" / clip).stat().st_size > 10_000


def test_the_demo_script_and_its_playwright_config_exist():
    for path in ("scripts/demo.sh", "scripts/lost-response-demo.sh", "e2e/demo/demo.spec.ts"):
        assert (ROOT / path).exists()
    assert os.access(ROOT / "scripts/demo.sh", os.X_OK)
