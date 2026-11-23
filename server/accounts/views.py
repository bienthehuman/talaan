from drf_spectacular.utils import extend_schema, inline_serializer
from rest_framework import serializers
from rest_framework.permissions import AllowAny, IsAuthenticated
from rest_framework.response import Response
from rest_framework.throttling import ScopedRateThrottle
from rest_framework.views import APIView
from rest_framework_simplejwt.views import TokenObtainPairView

from core.errors import problem_response

from . import invites
from .permissions import permissions_for
from .serializers import (
    InviteAcceptedSerializer,
    InviteAcceptSerializer,
    InviteInfoSerializer,
    InviteTokenSerializer,
)


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


class InviteView(APIView):
    """Public invite endpoints: no authentication (a stale `Authorization` header is ignored),
    throttled per client address. The token travels only in the body (ADR 0014)."""

    authentication_classes = []
    permission_classes = [AllowAny]
    throttle_classes = [ScopedRateThrottle]
    throttle_scope = "invite"

    def handle_exception(self, exc):
        if isinstance(exc, invites.InviteError):
            return problem_response(exc.status, exc.code, exc.detail)
        return super().handle_exception(exc)


class InviteCheckView(InviteView):
    @extend_schema(
        request=InviteTokenSerializer,
        responses={200: InviteInfoSerializer},
        summary="Who an invite link is for, if it can still be used",
    )
    def post(self, request):
        body = InviteTokenSerializer(data=request.data)
        body.is_valid(raise_exception=True)
        return Response(InviteInfoSerializer(invites.check(body.validated_data["token"])).data)


class InviteAcceptView(InviteView):
    @extend_schema(
        request=InviteAcceptSerializer,
        responses={201: InviteAcceptedSerializer},
        summary="Set a password and become a worker; the link then stops working",
    )
    def post(self, request):
        body = InviteAcceptSerializer(data=request.data)
        body.is_valid(raise_exception=True)
        user = invites.accept(body.validated_data["token"], body.validated_data["password"])
        return Response({"username": user.username}, status=201)
