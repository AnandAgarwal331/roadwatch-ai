"""Data access for users."""

from __future__ import annotations

import uuid

from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.core.enums import UserRole
from app.models.user import User


class UserRepository:
    def __init__(self, db: Session) -> None:
        self.db = db

    def get(self, user_id: uuid.UUID) -> User | None:
        return self.db.get(User, user_id)

    def get_by_email(self, email: str) -> User | None:
        # Emails are stored and compared case-insensitively.
        stmt = select(User).where(func.lower(User.email) == email.strip().lower())
        return self.db.execute(stmt).scalars().first()

    def exists_by_email(self, email: str) -> bool:
        return self.get_by_email(email) is not None

    def list_by_role(self, role: UserRole) -> list[User]:
        stmt = select(User).where(User.role == role, User.is_active.is_(True))
        return list(self.db.execute(stmt).scalars().all())

    def list_by_team(self, team_id: uuid.UUID) -> list[User]:
        stmt = select(User).where(User.team_id == team_id, User.is_active.is_(True))
        return list(self.db.execute(stmt).scalars().all())

    def add(self, user: User) -> User:
        self.db.add(user)
        self.db.flush()
        return user
