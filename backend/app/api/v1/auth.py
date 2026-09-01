"""Authentication endpoints."""

from __future__ import annotations

from fastapi import APIRouter, Depends, Request, status
from sqlalchemy.orm import Session

from app.api.deps import get_current_user, get_session
from app.core.enums import UserRole
from app.core.errors import AuthenticationError, ConflictError, ValidationError
from app.core.rate_limit import auth_rate_limit
from app.core.security import create_access_token, hash_password, verify_password
from app.models.user import User
from app.repositories.user import UserRepository
from app.schemas.auth import (
    ChangePasswordRequest,
    LoginRequest,
    RegisterRequest,
    TokenResponse,
    UpdateProfileRequest,
    UserResponse,
)
from app.schemas.common import MessageResponse

router = APIRouter(prefix="/auth", tags=["auth"])


@router.post(
    "/register",
    response_model=TokenResponse,
    status_code=status.HTTP_201_CREATED,
    summary="Register a citizen account",
)
def register(
    payload: RegisterRequest,
    _: None = Depends(auth_rate_limit),
    db: Session = Depends(get_session),
) -> TokenResponse:
    """Public registration always creates a CITIZEN.

    Admin and repair-team accounts are provisioned by an administrator or the
    seed script - self-service privilege selection would be an obvious hole.
    """
    repository = UserRepository(db)
    email = payload.email.strip().lower()

    if repository.exists_by_email(email):
        raise ConflictError("An account with that email already exists.")

    try:
        hashed = hash_password(payload.password)
    except ValueError as exc:
        raise ValidationError(str(exc)) from exc

    user = repository.add(
        User(
            email=email,
            hashed_password=hashed,
            full_name=payload.full_name,
            phone=payload.phone,
            role=UserRole.CITIZEN,
        )
    )
    db.commit()
    db.refresh(user)

    token, expires_in = create_access_token(user.id, user.role.value)
    return TokenResponse(
        access_token=token, expires_in=expires_in, user=UserResponse.model_validate(user)
    )


@router.post("/login", response_model=TokenResponse, summary="Sign in")
def login(
    payload: LoginRequest,
    _: None = Depends(auth_rate_limit),
    db: Session = Depends(get_session),
) -> TokenResponse:
    user = UserRepository(db).get_by_email(payload.email)

    # One message for both "no such user" and "wrong password", so the endpoint
    # cannot be used to enumerate registered addresses.
    if user is None or not verify_password(payload.password, user.hashed_password):
        raise AuthenticationError("That email or password is not correct.")
    if not user.is_active:
        raise AuthenticationError("This account has been deactivated.")

    token, expires_in = create_access_token(user.id, user.role.value)
    return TokenResponse(
        access_token=token, expires_in=expires_in, user=UserResponse.model_validate(user)
    )


@router.post("/logout", response_model=MessageResponse, summary="Sign out")
def logout(_: User = Depends(get_current_user)) -> MessageResponse:
    """Tokens are stateless, so logout is a client-side cookie clear.

    The endpoint exists so the frontend has one place to call, and so a future
    token denylist can be added without changing the client.
    """
    return MessageResponse(message="Signed out.")


@router.get("/me", response_model=UserResponse, summary="Current user")
def me(user: User = Depends(get_current_user)) -> UserResponse:
    return UserResponse.model_validate(user)


@router.patch("/me", response_model=UserResponse, summary="Update your profile")
def update_profile(
    payload: UpdateProfileRequest,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_session),
) -> UserResponse:
    if payload.full_name is not None:
        user.full_name = payload.full_name
    if payload.phone is not None:
        user.phone = payload.phone.strip() or None
    db.commit()
    db.refresh(user)
    return UserResponse.model_validate(user)


@router.post("/change-password", response_model=MessageResponse, summary="Change your password")
def change_password(
    payload: ChangePasswordRequest,
    request: Request,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_session),
) -> MessageResponse:
    from app.core.rate_limit import enforce

    enforce(request, "auth", 10)

    if not verify_password(payload.current_password, user.hashed_password):
        raise AuthenticationError("Your current password is not correct.")

    try:
        user.hashed_password = hash_password(payload.new_password)
    except ValueError as exc:
        raise ValidationError(str(exc)) from exc

    db.commit()
    return MessageResponse(message="Your password has been changed.")
