"""Repair crews, their assignments and the evidence they submit."""

from __future__ import annotations

import uuid
from datetime import datetime
from typing import TYPE_CHECKING

from sqlalchemy import Boolean, DateTime, Float, ForeignKey, Integer, String, Text
from sqlalchemy import Enum as SAEnum
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.core.enums import AssignmentStatus
from app.db.base import Base, TimestampMixin, UUIDPrimaryKeyMixin
from app.db.types import GUID

if TYPE_CHECKING:
    from app.models.complaint import Complaint
    from app.models.user import User


class RepairTeam(UUIDPrimaryKeyMixin, TimestampMixin, Base):
    __tablename__ = "repair_teams"

    name: Mapped[str] = mapped_column(String(120), unique=True, nullable=False)
    code: Mapped[str] = mapped_column(String(20), unique=True, nullable=False)
    contact_phone: Mapped[str | None] = mapped_column(String(32))
    #: Free-text coverage area shown in the admin UI.
    zone: Mapped[str | None] = mapped_column(String(120), index=True)
    #: Crew home base, used to rank nearby jobs.
    base_latitude: Mapped[float | None] = mapped_column(Float)
    base_longitude: Mapped[float | None] = mapped_column(Float)
    #: Specialities the crew handles, e.g. "POTHOLE,CRACKED_ROAD".
    specialities: Mapped[str | None] = mapped_column(String(200))
    max_concurrent_jobs: Mapped[int] = mapped_column(Integer, default=5, nullable=False)
    is_active: Mapped[bool] = mapped_column(Boolean, default=True, nullable=False)

    members: Mapped[list[User]] = relationship(back_populates="team", foreign_keys="User.team_id")
    assignments: Mapped[list[RepairAssignment]] = relationship(back_populates="team")


class RepairAssignment(UUIDPrimaryKeyMixin, TimestampMixin, Base):
    __tablename__ = "repair_assignments"

    complaint_id: Mapped[uuid.UUID] = mapped_column(
        GUID(), ForeignKey("complaints.id", ondelete="CASCADE"), nullable=False, index=True
    )
    team_id: Mapped[uuid.UUID] = mapped_column(
        GUID(), ForeignKey("repair_teams.id", ondelete="CASCADE"), nullable=False, index=True
    )
    assigned_by_id: Mapped[uuid.UUID | None] = mapped_column(
        GUID(), ForeignKey("users.id", ondelete="SET NULL")
    )

    status: Mapped[AssignmentStatus] = mapped_column(
        SAEnum(AssignmentStatus, native_enum=False, length=20),
        default=AssignmentStatus.ASSIGNED,
        nullable=False,
        index=True,
    )
    due_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), index=True)
    started_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    completed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    verified_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    verified_by_id: Mapped[uuid.UUID | None] = mapped_column(
        GUID(), ForeignKey("users.id", ondelete="SET NULL")
    )
    notes: Mapped[str | None] = mapped_column(Text)

    complaint: Mapped[Complaint] = relationship(back_populates="assignments")
    team: Mapped[RepairTeam] = relationship(back_populates="assignments")
    evidence: Mapped[list[RepairEvidence]] = relationship(
        back_populates="assignment", cascade="all, delete-orphan", order_by="RepairEvidence.created_at"
    )


class RepairEvidence(UUIDPrimaryKeyMixin, TimestampMixin, Base):
    """Completion photos and notes submitted by the crew."""

    __tablename__ = "repair_evidence"

    assignment_id: Mapped[uuid.UUID] = mapped_column(
        GUID(), ForeignKey("repair_assignments.id", ondelete="CASCADE"), nullable=False, index=True
    )
    submitted_by_id: Mapped[uuid.UUID | None] = mapped_column(
        GUID(), ForeignKey("users.id", ondelete="SET NULL")
    )
    storage_key: Mapped[str] = mapped_column(String(500), nullable=False)
    url: Mapped[str] = mapped_column(String(700), nullable=False)
    content_type: Mapped[str] = mapped_column(String(100), nullable=False)
    size_bytes: Mapped[int] = mapped_column(Integer, nullable=False)
    note: Mapped[str | None] = mapped_column(Text)

    assignment: Mapped[RepairAssignment] = relationship(back_populates="evidence")
