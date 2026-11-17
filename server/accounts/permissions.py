"""Permission catalog in code; roles are data (groups). Must match docs/ROLES.md section 3,
which a test enforces."""

WORKER = "worker"
ADMIN = "admin"
ROLES = (WORKER, ADMIN)

SUBMISSION_CREATE = "submission.create"
SUBMISSION_EDIT = "submission.edit"
SUBMISSION_SUBMIT = "submission.submit"
SUBMISSION_DELETE = "submission.delete"
SUBMISSION_APPROVE = "submission.approve"
SUBMISSION_RETURN = "submission.return"
SUBMISSION_RESTORE = "submission.restore"
ASSIGNMENT_MANAGE = "assignment.manage"
FORM_PUBLISH = "form.publish"
CONFLICTLOG_VIEW = "conflictlog.view"
METRICS_VIEW = "metrics.view"

CATALOG = frozenset(
    {
        SUBMISSION_CREATE,
        SUBMISSION_EDIT,
        SUBMISSION_SUBMIT,
        SUBMISSION_DELETE,
        SUBMISSION_APPROVE,
        SUBMISSION_RETURN,
        SUBMISSION_RESTORE,
        ASSIGNMENT_MANAGE,
        FORM_PUBLISH,
        CONFLICTLOG_VIEW,
        METRICS_VIEW,
    }
)

# Worker: create, edit, submit, delete (all scoped to own records, enforced where data is read).
# Admin: everything except create and submit.
ROLE_PERMISSIONS: dict[str, frozenset[str]] = {
    WORKER: frozenset({SUBMISSION_CREATE, SUBMISSION_EDIT, SUBMISSION_SUBMIT, SUBMISSION_DELETE}),
    ADMIN: CATALOG - {SUBMISSION_CREATE, SUBMISSION_SUBMIT},
}


def permissions_for(role: str | None) -> frozenset[str]:
    return ROLE_PERMISSIONS.get(role or "", frozenset())
