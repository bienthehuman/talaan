from django.contrib import admin
from django.urls import path
from django.views.decorators.csp import csp_override
from drf_spectacular.views import SpectacularAPIView, SpectacularSwaggerView
from rest_framework_simplejwt.views import TokenRefreshView

from accounts.views import LoginView, MeView
from adminapi import views as admin_views
from core.views import HealthView
from sync import views as sync_views

handler404 = "core.views.not_found"
handler500 = "core.views.server_error"

# The Swagger UI template uses an inline script and style, so its CSP is relaxed for this one view.
swagger_csp = {
    "default-src": ["'self'"],
    "script-src": ["'self'", "'unsafe-inline'"],
    "style-src": ["'self'", "'unsafe-inline'"],
    "img-src": ["'self'", "data:"],
}

urlpatterns = [
    path("admin/", admin.site.urls),
    path("api/health/", HealthView.as_view(), name="health"),
    path("api/auth/token/", LoginView.as_view(), name="token_obtain"),
    path("api/auth/token/refresh/", TokenRefreshView.as_view(), name="token_refresh"),
    path("api/me/", MeView.as_view(), name="me"),
    path("api/sync/push/", sync_views.PushView.as_view(), name="sync_push"),
    path("api/sync/pull/", sync_views.PullView.as_view(), name="sync_pull"),
    path(
        "api/admin/submissions/<uuid:record_id>/actions/",
        sync_views.AdminActionView.as_view(),
        name="admin_submission_action",
    ),
    path(
        "api/admin/submissions/", admin_views.SubmissionListView.as_view(), name="admin_submissions"
    ),
    path(
        "api/admin/submissions/<uuid:record_id>/",
        admin_views.SubmissionDetailView.as_view(),
        name="admin_submission",
    ),
    path("api/admin/workers/", admin_views.WorkerListView.as_view(), name="admin_workers"),
    path(
        "api/admin/assignments/",
        admin_views.AssignmentListCreateView.as_view(),
        name="admin_assignments",
    ),
    path(
        "api/admin/assignments/<int:pk>/cancel/",
        admin_views.AssignmentCancelView.as_view(),
        name="admin_assignment_cancel",
    ),
    path("api/admin/forms/", admin_views.FormListCreateView.as_view(), name="admin_forms"),
    path(
        "api/admin/forms/<int:pk>/versions/",
        admin_views.FormVersionCreateView.as_view(),
        name="admin_form_versions",
    ),
    path(
        "api/admin/forms/check-schema/",
        admin_views.SchemaCheckView.as_view(),
        name="admin_schema_check",
    ),
    path(
        "api/admin/form-versions/<int:pk>/",
        admin_views.FormVersionDetailView.as_view(),
        name="admin_form_version",
    ),
    path("api/admin/conflicts/", admin_views.ConflictLogView.as_view(), name="admin_conflicts"),
    path("api/assignments/", sync_views.AssignmentListView.as_view(), name="assignments"),
    path("api/form-versions/", sync_views.FormVersionListView.as_view(), name="form_versions"),
    path("api/schema/", SpectacularAPIView.as_view(), name="schema"),
    path(
        "api/docs/",
        csp_override(swagger_csp)(SpectacularSwaggerView.as_view(url_name="schema")),
        name="docs",
    ),
]
