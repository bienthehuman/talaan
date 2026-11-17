"""API errors specific to the sync protocol (docs/protocol.md sections 2, 4 and 9)."""

from rest_framework import status
from rest_framework.exceptions import APIException


class ClientTooOld(APIException):
    """The client's protocol version is below MIN_CLIENT_SCHEMA. The client keeps its local data and
    shows "update the app"."""

    status_code = status.HTTP_426_UPGRADE_REQUIRED
    default_code = "client_too_old"
    default_detail = "This version of the app is too old to sync. Update the app."


class BatchTooLarge(APIException):
    status_code = status.HTTP_400_BAD_REQUEST
    default_code = "batch_too_large"
    default_detail = "A push carries at most 50 mutations."


class ClientSchemaMissing(APIException):
    status_code = status.HTTP_400_BAD_REQUEST
    default_code = "client_schema_required"
    default_detail = "Send your protocol version in the X-Client-Schema header."
