from drf_spectacular.utils import extend_schema, inline_serializer
from rest_framework import serializers
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response
from rest_framework.throttling import ScopedRateThrottle
from rest_framework.views import APIView
from rest_framework_simplejwt.views import TokenObtainPairView

from .permissions import permissions_for


class LoginView(TokenObtainPairView):
    """Exchange credentials for an access and refresh token. Rate limited per client."""

    throttle_classes = [ScopedRateThrottle]
    throttle_scope = "login"


class MeView(APIView):
    permission_classes = [IsAuthenticated]
    pagination_class = None

    @extend_schema(
        responses=inline_serializer(
            "Me",
            {
                "id": serializers.IntegerField(),
                "username": serializers.CharField(),
                "role": serializers.CharField(allow_null=True),
                "permissions": serializers.ListField(child=serializers.CharField()),
            },
        )
    )
    def get(self, request):
        user = request.user
        return Response(
            {
                "id": user.id,
                "username": user.get_username(),
                "role": user.role,
                "permissions": sorted(permissions_for(user.role)),
            }
        )
