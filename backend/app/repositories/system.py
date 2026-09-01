"""Data access for notifications, audit entries and duplicate links."""

from __future__ import annotations

import uuid

from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.core.enums import DuplicateStatus
from app.models.complaint import PotentialDuplicate
from app.models.system import AuditLog, Notification


class NotificationRepository:
    def __init__(self, db: Session) -> None:
        self.db = db

    def list_for_user(
        self, user_id: uuid.UUID, *, unread_only: bool = False, limit: int = 50
    ) -> list[Notification]:
        stmt = select(Notification).where(Notification.user_id == user_id)
        if unread_only:
            stmt = stmt.where(Notification.is_read.is_(False))
        stmt = stmt.order_by(Notification.created_at.desc()).limit(limit)
        return list(self.db.execute(stmt).scalars().all())

    def unread_count(self, user_id: uuid.UUID) -> int:
        stmt = select(func.count(Notification.id)).where(
            Notification.user_id == user_id, Notification.is_read.is_(False)
        )
        return int(self.db.execute(stmt).scalar_one())

    def get(self, notification_id: uuid.UUID) -> Notification | None:
        return self.db.get(Notification, notification_id)

    def add(self, notification: Notification) -> Notification:
        self.db.add(notification)
        self.db.flush()
        return notification


class AuditRepository:
    def __init__(self, db: Session) -> None:
        self.db = db

    def add(self, entry: AuditLog) -> AuditLog:
        self.db.add(entry)
        self.db.flush()
        return entry

    def list_recent(self, *, complaint_id: uuid.UUID | None = None, limit: int = 100) -> list[AuditLog]:
        stmt = select(AuditLog)
        if complaint_id:
            stmt = stmt.where(AuditLog.complaint_id == complaint_id)
        stmt = stmt.order_by(AuditLog.created_at.desc()).limit(limit)
        return list(self.db.execute(stmt).scalars().all())


class DuplicateRepository:
    def __init__(self, db: Session) -> None:
        self.db = db

    def get(self, link_id: uuid.UUID) -> PotentialDuplicate | None:
        return self.db.get(PotentialDuplicate, link_id)

    def list_for_complaint(self, complaint_id: uuid.UUID) -> list[PotentialDuplicate]:
        """Links in either direction - duplication is symmetric."""
        stmt = (
            select(PotentialDuplicate)
            .where(
                (PotentialDuplicate.complaint_id == complaint_id)
                | (PotentialDuplicate.duplicate_complaint_id == complaint_id)
            )
            .order_by(PotentialDuplicate.similarity_score.desc())
        )
        return list(self.db.execute(stmt).scalars().all())

    def list_pending(self, limit: int = 100) -> list[PotentialDuplicate]:
        stmt = (
            select(PotentialDuplicate)
            .where(PotentialDuplicate.status == DuplicateStatus.SUGGESTED)
            .order_by(PotentialDuplicate.similarity_score.desc())
            .limit(limit)
        )
        return list(self.db.execute(stmt).scalars().all())

    def find_pair(
        self, complaint_id: uuid.UUID, duplicate_id: uuid.UUID
    ) -> PotentialDuplicate | None:
        stmt = select(PotentialDuplicate).where(
            (
                (PotentialDuplicate.complaint_id == complaint_id)
                & (PotentialDuplicate.duplicate_complaint_id == duplicate_id)
            )
            | (
                (PotentialDuplicate.complaint_id == duplicate_id)
                & (PotentialDuplicate.duplicate_complaint_id == complaint_id)
            )
        )
        return self.db.execute(stmt).scalars().first()

    def add(self, link: PotentialDuplicate) -> PotentialDuplicate:
        self.db.add(link)
        self.db.flush()
        return link

    def pending_count(self) -> int:
        stmt = select(func.count(PotentialDuplicate.id)).where(
            PotentialDuplicate.status == DuplicateStatus.SUGGESTED
        )
        return int(self.db.execute(stmt).scalar_one())
