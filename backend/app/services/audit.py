"""Administrative audit trail.

Any action that changes a complaint's fate - status, priority, assignment,
duplicate merge, rejection - is recorded with the actor, the timestamp and the
old and new values. In a municipal system this is not optional: it is how a
decision gets defended six months later.

Entries are append-only. Nothing in the API updates or deletes an audit row.
"""

from __future__ import annotations

import uuid
from typing import Any

from sqlalchemy.orm import Session

from app.models.system import AuditLog
from app.models.user import User
from app.repositories.system import AuditRepository


class AuditService:
    def __init__(self, db: Session) -> None:
        self.db = db
        self.repository = AuditRepository(db)

    def record(
        self,
        *,
        actor: User | None,
        action: str,
        entity_type: str,
        entity_id: uuid.UUID | None = None,
        complaint_id: uuid.UUID | None = None,
        old_value: dict[str, Any] | None = None,
        new_value: dict[str, Any] | None = None,
        note: str | None = None,
        ip_address: str | None = None,
    ) -> AuditLog:
        entry = AuditLog(
            actor_id=actor.id if actor else None,
            # Denormalised so the trail stays readable even if the account is
            # later deleted.
            actor_email=actor.email if actor else None,
            action=action,
            entity_type=entity_type,
            entity_id=entity_id,
            complaint_id=complaint_id,
            old_value=old_value,
            new_value=new_value,
            note=note,
            ip_address=ip_address,
        )
        return self.repository.add(entry)

    def list_recent(self, *, complaint_id: uuid.UUID | None = None, limit: int = 100) -> list[AuditLog]:
        return self.repository.list_recent(complaint_id=complaint_id, limit=limit)
