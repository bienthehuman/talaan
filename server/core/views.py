import json

from django.db import connection
from django.http import HttpResponse
from django.views.defaults import page_not_found
from django.views.defaults import server_error as default_server_error
from drf_spectacular.utils import OpenApiResponse, extend_schema, inline_serializer
from rest_framework import serializers
from rest_framework.permissions import AllowAny
from rest_framework.response import Response
from rest_framework.views import APIView

from .errors import PROBLEM_CONTENT_TYPE, problem


def _is_api(request) -> bool:
    return request.path.startswith("/api/")


def _problem_http(request, status: int, code: str, detail: str) -> HttpResponse:
    body = json.dumps(problem(status, code, detail))
    return HttpResponse(body, status=status, content_type=PROBLEM_CONTENT_TYPE)


def not_found(request, exception, template_name="404.html"):
    if _is_api(request):
        return _problem_http(request, 404, "not_found", "Not found.")
    return page_not_found(request, exception, template_name)


def server_error(request, template_name="500.html"):
    if _is_api(request):
        return _problem_http(request, 500, "server_error", "Something went wrong on the server.")
    return default_server_error(request, template_name)


class HealthView(APIView):
    """Liveness and database check. No auth, no side effects."""

    authentication_classes: list = []
    permission_classes = [AllowAny]
    pagination_class = None

    @extend_schema(
        responses={
            200: inline_serializer(
                "Health", {"status": serializers.CharField(), "database": serializers.CharField()}
            ),
            503: OpenApiResponse(description="Database unreachable (problem+json)"),
        },
    )
    def get(self, request):
        try:
            with connection.cursor() as cur:
                cur.execute("SELECT 1")
                cur.fetchone()
        except Exception:
            return Response(
                problem(503, "database_unavailable", "The database is not reachable."),
                status=503,
                content_type=PROBLEM_CONTENT_TYPE,
            )
        return Response({"status": "ok", "database": "ok"})
