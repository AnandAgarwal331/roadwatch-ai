"""In-app notification endpoints."""

from __future__ import annotations

import uuid
from datetime import UTC, datetime

from fastapi import APIRouter, Depends, Query
from sqlalchemy.orm import Session

from app.api.deps import get_current_user, get_session
from app.core.errors import NotFoundError
from app.models.user import User
from app.repositories.system import NotificationRepository
from app.schemas.admin import NotificationListResponse, NotificationResponse
from app.schemas.common import MessageResponse

router = APIRouter(prefix="/notifications", tags=["notifications"])


@router.get("", response_model=NotificationListResponse, summary="Your notifications")
def list_notifications(
    unread_only: bool = Query(False),
    limit: int = Query(30, ge=1, le=100),
    user: User = Depends(get_current_user),
    db: Session = Depends(get_session),
) -> NotificationListResponse:
    repository = NotificationRepository(db)
    items = repository.list_for_user(user.id, unread_only=unread_only, limit=limit)
    return NotificationListResponse(
        items=[NotificationResponse.model_validate(item) for item in items],
        unread_count=repository.unread_count(user.id),
    )


@router.post("/{notification_id}/read", response_model=MessageResponse, summary="Mark one as read")
def mark_read(
    notification_id: uuid.UUID,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_session),
) -> MessageResponse:
    repository = NotificationRepository(db)
    notification = repository.get(notification_id)

    # Not found and not-yours are the same answer, so ids cannot be probed.
    if notification is None or notification.user_id != user.id:
        raise NotFoundError("That notification could not be found.")

    if not notification.is_read:
        notification.is_read = True
        notification.read_at = datetime.now(UTC)
        db.commit()

    return MessageResponse(message="Marked as read.")


@router.post("/read-all", response_model=MessageResponse, summary="Mark all as read")
def mark_all_read(
    user: User = Depends(get_current_user),
    db: Session = Depends(get_session),
) -> MessageResponse:
    repository = NotificationRepository(db)
    now = datetime.now(UTC)
    unread = repository.list_for_user(user.id, unread_only=True, limit=500)
    for notification in unread:
        notification.is_read = True
        notification.read_at = now
    db.commit()
    return MessageResponse(message=f"{len(unread)} notification(s) marked as read.")
