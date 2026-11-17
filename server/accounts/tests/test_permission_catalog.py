"""docs/ROLES.md is the source of truth; the code catalog must not drift from it."""

import re
from pathlib import Path

from accounts.permissions import ADMIN, CATALOG, ROLE_PERMISSIONS, WORKER

ROLES_MD = Path(__file__).resolve().parents[3] / "docs" / "ROLES.md"


def _catalog_from_docs() -> set[str]:
    text = ROLES_MD.read_text()
    section = text.split("## 3. Permission catalog", 1)[1].split("\n## ", 1)[0]
    catalog_paragraph = section.split("Worker:", 1)[0]
    return set(re.findall(r"`([a-z]+\.[a-z]+)`", catalog_paragraph))


def test_catalog_matches_roles_doc():
    assert _catalog_from_docs() == set(CATALOG)


def test_role_assignments_match_roles_doc_text():
    # "Worker: create, edit, submit, delete (all scoped to own). Admin: all except create/submit."
    assert ROLE_PERMISSIONS[WORKER] == {
        "submission.create",
        "submission.edit",
        "submission.submit",
        "submission.delete",
    }
    assert ROLE_PERMISSIONS[ADMIN] == CATALOG - {"submission.create", "submission.submit"}


def test_roles_doc_still_says_what_the_test_assumes():
    text = ROLES_MD.read_text()
    assert "Worker: create, edit, submit, delete" in text
    assert "Admin: all except create/submit" in text
