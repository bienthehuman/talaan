from django.contrib import admin
from django.urls import path
from django.views.decorators.csp import csp_override
from drf_spectacular.views import SpectacularAPIView, SpectacularSwaggerView
from rest_framework_simplejwt.views import TokenRefreshView

from accounts.views import LoginView, MeView
from core.views import HealthView

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
    path("api/schema/", SpectacularAPIView.as_view(), name="schema"),
    path(
        "api/docs/",
        csp_override(swagger_csp)(SpectacularSwaggerView.as_view(url_name="schema")),
        name="docs",
    ),
]
