"""Test-only urlconf with a view that raises, to check the JSON 500 handler."""

from django.urls import path

handler404 = "core.views.not_found"
handler500 = "core.views.server_error"


def boom(request):
    raise RuntimeError("kaboom")


urlpatterns = [
    path("api/boom/", boom),
    path("boom/", boom),
]
