"""Shared FastAPI dependencies: session, current user, role guards.

Authorisation is enforced here and re-checked in the routers that need
ownership rules. Nothing trusts a role claim from the client: the role is read
from the signed token and then re-read from the database, so a deactivated or
demoted account loses access immediately rather than at token expiry.
"""

from __future__ import annotations

import uuid
from collections.abc import Callable, Iterator

from fastapi import Depends, Request
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from sqlalchemy.orm import Session

from app.core.enums import UserRole
from app.core.errors import AuthenticationError, PermissionDeniedError
from app.core.security import TokenError, decode_access_token
from app.db.session import get_db
from app.models.user import User
from app.repositories.user import UserRepository

#: auto_error=False so a missing header becomes our JSON envelope, not FastAPI's.
_bearer = HTTPBearer(auto_error=False, description="JWT access token")


def get_session() -> Iterator[Session]:
    yield from get_db()


def get_current_user(
    credentials: HTTPAuthorizationCredentials | None = Depends(_bearer),
    db: Session = Depends(get_session),
) -> User:
    if credentials is None or not credentials.credentials:
        raise AuthenticationError("You need to sign in to do that.")

    try:
        payload = decode_access_token(credentials.credentials)
    except TokenError as exc:
        raise AuthenticationError(str(exc)) from exc

    try:
        user_id = uuid.UUID(payload["sub"])
    except (KeyError, ValueError) as exc:
        raise AuthenticationError("Invalid authentication token") from exc

    user = UserRepository(db).get(user_id)
    if user is None:
        raise AuthenticationError("That account no longer exists.")
    if not user.is_active:
        raise PermissionDeniedError("This account has been deactivated.")

    return user


def get_optional_user(
    credentials: HTTPAuthorizationCredentials | None = Depends(_bearer),
    db: Session = Depends(get_session),
) -> User | None:
    """For endpoints that are public but richer when signed in."""
    if credentials is None or not credentials.credentials:
        return None
    try:
        return get_current_user(credentials, db)
    except (AuthenticationError, PermissionDeniedError):
        return None


def require_roles(*roles: UserRole) -> Callable[[User], User]:
    allowed = set(roles)

    def dependency(user: User = Depends(get_current_user)) -> User:
        if user.role not in allowed:
            raise PermissionDeniedError(
                "You do not have permission to do that.",
                details={"required_roles": sorted(role.value for role in allowed)},
            )
        return user

    return dependency


require_admin = require_roles(UserRole.ADMIN)
require_team = require_roles(UserRole.REPAIR_TEAM, UserRole.ADMIN)
require_citizen = require_roles(UserRole.CITIZEN, UserRole.ADMIN)


def client_ip(request: Request) -> str | None:
    forwarded = request.headers.get("x-forwarded-for", "")
    if forwarded:
        return forwarded.split(",")[0].strip()
    return request.client.host if request.client else None
