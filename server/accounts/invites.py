"""Worker invites (ADR 0014, protocol section 11). The token is returned once, when it is made, and
only its SHA-256 is stored; it is never logged. Accepting creates the user in the `worker` group and
closes the invite in one transaction, with the invite row locked, so a link works exactly once."""

import hashlib
import logging
import secrets
from datetime import timedelta

from django.contrib.auth.models import Group
from django.contrib.auth.password_validation import validate_password
from django.core.exceptions import ValidationError as DjangoValidationError
from django.db import IntegrityError, transaction
from django.utils import timezone
from rest_framework.exceptions import ValidationError

from .models import User, WorkerInvite
from .permissions import WORKER

log = logging.getLogger("talaan.accounts")

TTL = timedelta(days=7)
OPEN_USERNAME = (
    "Someone already has an open invite with this username. Make a new link for it or revoke it."
)
TAKEN_USERNAME = "A user with this username already exists."


class InviteError(Exception):
    """A refusal the API returns as problem+json with this status and code."""

    def __init__(self, status: int, code: str, detail: str):
        super().__init__(detail)
        self.status, self.code, self.detail = status, code, detail


REFUSALS = {
    "expired": (
        410,
        "invite_expired",
        "This invite link has expired. Ask your admin for a new one.",
    ),
    "accepted": (410, "invite_used", "This invite link has already been used. Sign in instead."),
    "revoked": (
        410,
        "invite_revoked",
        "This invite link was withdrawn. Ask your admin for a new one.",
    ),
    None: (
        404,
        "invite_not_found",
        "This invite link is not valid. Check that you copied all of it.",
    ),
}


def hash_token(token: str) -> str:
    return hashlib.sha256(token.encode()).hexdigest()


def _new_token() -> tuple[str, str]:
    token = secrets.token_urlsafe(32)
    return token, hash_token(token)


def _event(name: str, invite: WorkerInvite, user_id: int) -> None:
    log.info(name, extra={"event": name, "invite_id": invite.id, "user_id": user_id})


def create(
    by: User, username: str, first_name: str = "", last_name: str = ""
) -> tuple[WorkerInvite, str]:
    if User.objects.filter(username__iexact=username).exists():
        raise ValidationError({"username": [TAKEN_USERNAME]})
    token, digest = _new_token()
    invite = WorkerInvite(
        username=username,
        first_name=first_name,
        last_name=last_name,
        token_hash=digest,
        created_by=by,
        expires_at=timezone.now() + TTL,
    )
    try:
        with transaction.atomic():
            invite.save()
    except IntegrityError:
        raise ValidationError({"username": [OPEN_USERNAME]}) from None
    _event("invite_created", invite, by.id)
    return invite, token


def _locked(invite_id: int) -> WorkerInvite | None:
    return WorkerInvite.objects.select_for_update().filter(pk=invite_id).first()


@transaction.atomic
def new_link(by: User, invite_id: int) -> tuple[WorkerInvite, str] | None:
    """A new token and expiry for an open invite; the old link stops working. None if no such
    invite."""
    invite = _locked(invite_id)
    if invite is None:
        return None
    if invite.accepted_at or invite.revoked_at:
        raise InviteError(409, "invite_closed", "This invite has been accepted or revoked.")
    token, invite.token_hash = _new_token()
    invite.expires_at = timezone.now() + TTL
    invite.save(update_fields=["token_hash", "expires_at"])
    _event("invite_reissued", invite, by.id)
    return invite, token


@transaction.atomic
def revoke(by: User, invite_id: int) -> WorkerInvite | None:
    """Close an open invite. A second call changes nothing. None if no such invite."""
    invite = _locked(invite_id)
    if invite is None:
        return None
    if invite.accepted_at:
        raise InviteError(409, "invite_closed", "This invite has been accepted or revoked.")
    if not invite.revoked_at:
        invite.revoked_at = timezone.now()
        invite.save(update_fields=["revoked_at"])
        _event("invite_revoked", invite, by.id)
    return invite


def _usable(invite: WorkerInvite | None) -> WorkerInvite:
    status = invite.status() if invite else None
    if status != "pending":
        raise InviteError(*REFUSALS[status])
    return invite


def check(token: str) -> WorkerInvite:
    return _usable(WorkerInvite.objects.filter(token_hash=hash_token(token)).first())


@transaction.atomic
def accept(token: str, password: str) -> User:
    invite = _usable(
        WorkerInvite.objects.select_for_update().filter(token_hash=hash_token(token)).first()
    )
    user = User(username=invite.username, first_name=invite.first_name, last_name=invite.last_name)
    try:
        validate_password(password, user=user)
    except DjangoValidationError as exc:
        raise ValidationError({"password": list(exc.messages)}) from None
    username_taken = InviteError(409, "username_taken", f"{TAKEN_USERNAME} Ask your admin.")
    if User.objects.filter(username__iexact=invite.username).exists():
        raise username_taken
    user.set_password(password)
    try:
        with transaction.atomic():
            user.save()
    except IntegrityError:
        raise username_taken from None
    user.groups.add(Group.objects.get(name=WORKER))
    invite.accepted_at = timezone.now()
    invite.accepted_user = user
    invite.save(update_fields=["accepted_at", "accepted_user"])
    _event("invite_accepted", invite, user.id)
    return user
