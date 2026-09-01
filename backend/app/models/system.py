"""Cross-cutting records: notifications and the administrative audit log."""

from __future__ import annotations

import uuid
from datetime import datetime
from typing import TYPE_CHECKING

from sqlalchemy import Boolean, DateTime, ForeignKey, String, Text
from sqlalchemy import Enum as SAEnum
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.core.enums import NotificationChannel
from app.db.base import Base, TimestampMixin, UUIDPrimaryKeyMixin
from app.db.types import GUID, JSONType

if TYPE_CHECKING:
    from app.models.user import User


class Notification(UUIDPrimaryKeyMixin, TimestampMixin, Base):
    """In-app notification.

    ``channel`` exists so the same rows can later be fanned out to email, SMS or
    push by a delivery worker without a schema change.
    """

    __tablename__ = "notifications"

    user_id: Mapped[uuid.UUID] = mapped_column(
        GUID(), ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True
    )
    title: Mapped[str] = mapped_column(String(200), nullable=False)
    body: Mapped[str] = mapped_column(Text, nullable=False)
    #: Dot-separated event key, e.g. "complaint.assigned".
    event: Mapped[str] = mapped_column(String(60), nullable=False, index=True)
    channel: Mapped[NotificationChannel] = mapped_column(
        SAEnum(NotificationChannel, native_enum=False, length=20),
        default=NotificationChannel.IN_APP,
        nullable=False,
    )
    complaint_id: Mapped[uuid.UUID | None] = mapped_column(
        GUID(), ForeignKey("complaints.id", ondelete="CASCADE"), index=True
    )
    #: Where the UI should navigate when the notification is clicked.
    link: Mapped[str | None] = mapped_column(String(300))
    is_read: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False, index=True)
    read_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))

    user: Mapped[User] = relationship(back_populates="notifications")


class AuditLog(UUIDPrimaryKeyMixin, TimestampMixin, Base):
    """Immutable record of administrative actions.

    Required for a municipal system: who changed what, when, and from what value
    to what value.
    """

    __tablename__ = "audit_logs"

    actor_id: Mapped[uuid.UUID | None] = mapped_column(
        GUID(), ForeignKey("users.id", ondelete="SET NULL"), index=True
    )
    actor_email: Mapped[str | None] = mapped_column(String(255))
    #: e.g. "complaint.status_changed", "complaint.assigned".
    action: Mapped[str] = mapped_column(String(80), nullable=False, index=True)
    entity_type: Mapped[str] = mapped_column(String(50), nullable=False)
    entity_id: Mapped[uuid.UUID | None] = mapped_column(GUID(), index=True)
    complaint_id: Mapped[uuid.UUID | None] = mapped_column(
        GUID(), ForeignKey("complaints.id", ondelete="SET NULL"), index=True
    )
    old_value: Mapped[dict | None] = mapped_column(JSONType)
    new_value: Mapped[dict | None] = mapped_column(JSONType)
    note: Mapped[str | None] = mapped_column(Text)
    ip_address: Mapped[str | None] = mapped_column(String(45))
