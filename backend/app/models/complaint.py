"""The complaint aggregate: the report itself, its images, status log and duplicates."""

from __future__ import annotations

import uuid
from datetime import datetime
from typing import TYPE_CHECKING

from sqlalchemy import (
    DateTime,
    Float,
    ForeignKey,
    Index,
    Integer,
    String,
    Text,
    UniqueConstraint,
)
from sqlalchemy import (
    Enum as SAEnum,
)
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.core.enums import (
    ComplaintStatus,
    DamageType,
    DuplicateStatus,
    ImageKind,
    PriorityLevel,
)
from app.db.base import Base, TimestampMixin, UUIDPrimaryKeyMixin
from app.db.types import GUID

if TYPE_CHECKING:
    from app.models.analysis import AIAnalysis, PriorityAssessment
    from app.models.geo import Location, NearbyPlace, TrafficSnapshot
    from app.models.repair import RepairAssignment
    from app.models.user import User


class Complaint(UUIDPrimaryKeyMixin, TimestampMixin, Base):
    """A citizen report of a road problem.

    ``latitude``/``longitude`` are duplicated from :class:`Location` on purpose:
    every list, map and proximity query filters on them, and keeping them here
    avoids a join on the hottest read paths.
    """

    __tablename__ = "complaints"
    __table_args__ = (
        Index("ix_complaints_lat_lon", "latitude", "longitude"),
        Index("ix_complaints_status_priority", "status", "priority_score"),
        Index("ix_complaints_type_created", "damage_type", "created_at"),
    )

    #: Human-friendly identifier, e.g. RW-2026-001024.
    complaint_number: Mapped[str] = mapped_column(String(24), unique=True, index=True, nullable=False)

    reporter_id: Mapped[uuid.UUID | None] = mapped_column(
        GUID(), ForeignKey("users.id", ondelete="SET NULL"), index=True
    )

    description: Mapped[str | None] = mapped_column(Text)
    #: What the citizen selected, if anything. May differ from the AI verdict.
    reported_damage_type: Mapped[DamageType | None] = mapped_column(
        SAEnum(DamageType, native_enum=False, length=30)
    )
    #: The type the system acts on: AI verdict, or the citizen's when AI is unsure.
    damage_type: Mapped[DamageType] = mapped_column(
        SAEnum(DamageType, native_enum=False, length=30),
        default=DamageType.UNKNOWN,
        nullable=False,
        index=True,
    )
    road_name: Mapped[str | None] = mapped_column(String(200))

    latitude: Mapped[float] = mapped_column(Float, nullable=False)
    longitude: Mapped[float] = mapped_column(Float, nullable=False)

    status: Mapped[ComplaintStatus] = mapped_column(
        SAEnum(ComplaintStatus, native_enum=False, length=20),
        default=ComplaintStatus.PENDING,
        nullable=False,
        index=True,
    )

    #: Denormalised copy of the latest PriorityAssessment, for sorting/filtering.
    priority_score: Mapped[float] = mapped_column(Float, default=0.0, nullable=False, index=True)
    priority_level: Mapped[PriorityLevel] = mapped_column(
        SAEnum(PriorityLevel, native_enum=False, length=20),
        default=PriorityLevel.LOW,
        nullable=False,
        index=True,
    )
    severity_score: Mapped[float] = mapped_column(Float, default=0.0, nullable=False)
    #: Admins may override the AI-assisted recommendation; recorded in the audit log.
    manual_priority_override: Mapped[float | None] = mapped_column(Float)

    #: Number of linked duplicate reports, kept in sync by DuplicateService.
    report_count: Mapped[int] = mapped_column(Integer, default=1, nullable=False)

    #: Set when this complaint is confirmed as a duplicate of another.
    duplicate_of_id: Mapped[uuid.UUID | None] = mapped_column(
        GUID(), ForeignKey("complaints.id", ondelete="SET NULL"), index=True
    )

    resolved_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    rejection_reason: Mapped[str | None] = mapped_column(Text)

    reporter: Mapped[User | None] = relationship(back_populates="complaints", foreign_keys=[reporter_id])
    location: Mapped[Location | None] = relationship(
        back_populates="complaint", uselist=False, cascade="all, delete-orphan"
    )
    images: Mapped[list[ComplaintImage]] = relationship(
        back_populates="complaint", cascade="all, delete-orphan", order_by="ComplaintImage.created_at"
    )
    analyses: Mapped[list[AIAnalysis]] = relationship(
        back_populates="complaint", cascade="all, delete-orphan", order_by="AIAnalysis.created_at"
    )
    assessments: Mapped[list[PriorityAssessment]] = relationship(
        back_populates="complaint", cascade="all, delete-orphan", order_by="PriorityAssessment.created_at"
    )
    nearby_places: Mapped[list[NearbyPlace]] = relationship(
        back_populates="complaint", cascade="all, delete-orphan"
    )
    traffic_snapshots: Mapped[list[TrafficSnapshot]] = relationship(
        back_populates="complaint", cascade="all, delete-orphan"
    )
    status_history: Mapped[list[ComplaintStatusHistory]] = relationship(
        back_populates="complaint",
        cascade="all, delete-orphan",
        order_by="ComplaintStatusHistory.created_at",
    )
    assignments: Mapped[list[RepairAssignment]] = relationship(
        back_populates="complaint", cascade="all, delete-orphan", order_by="RepairAssignment.created_at"
    )

    @property
    def latest_analysis(self) -> AIAnalysis | None:
        return self.analyses[-1] if self.analyses else None

    @property
    def latest_assessment(self) -> PriorityAssessment | None:
        return self.assessments[-1] if self.assessments else None

    @property
    def active_assignment(self) -> RepairAssignment | None:
        from app.core.enums import AssignmentStatus

        open_states = {AssignmentStatus.ASSIGNED, AssignmentStatus.IN_PROGRESS, AssignmentStatus.COMPLETED}
        for assignment in reversed(self.assignments):
            if assignment.status in open_states:
                return assignment
        return None

    def __repr__(self) -> str:  # pragma: no cover - debug helper
        return f"<Complaint {self.complaint_number} {self.status} {self.priority_score}>"


class ComplaintImage(UUIDPrimaryKeyMixin, TimestampMixin, Base):
    """An uploaded photo: the original report or repair evidence."""

    __tablename__ = "complaint_images"

    complaint_id: Mapped[uuid.UUID] = mapped_column(
        GUID(), ForeignKey("complaints.id", ondelete="CASCADE"), nullable=False, index=True
    )
    #: Provider-agnostic key (local relative path, or S3 object key).
    storage_key: Mapped[str] = mapped_column(String(500), nullable=False)
    url: Mapped[str] = mapped_column(String(700), nullable=False)
    content_type: Mapped[str] = mapped_column(String(100), nullable=False)
    size_bytes: Mapped[int] = mapped_column(Integer, nullable=False)
    width: Mapped[int | None] = mapped_column(Integer)
    height: Mapped[int | None] = mapped_column(Integer)
    kind: Mapped[ImageKind] = mapped_column(
        SAEnum(ImageKind, native_enum=False, length=30), default=ImageKind.REPORT, nullable=False
    )
    #: Perceptual hash used for near-duplicate image comparison.
    perceptual_hash: Mapped[str | None] = mapped_column(String(64), index=True)

    complaint: Mapped[Complaint] = relationship(back_populates="images")


class ComplaintStatusHistory(UUIDPrimaryKeyMixin, TimestampMixin, Base):
    """Append-only status log; never updated in place."""

    __tablename__ = "complaint_status_history"

    complaint_id: Mapped[uuid.UUID] = mapped_column(
        GUID(), ForeignKey("complaints.id", ondelete="CASCADE"), nullable=False, index=True
    )
    from_status: Mapped[ComplaintStatus | None] = mapped_column(
        SAEnum(ComplaintStatus, native_enum=False, length=20)
    )
    to_status: Mapped[ComplaintStatus] = mapped_column(
        SAEnum(ComplaintStatus, native_enum=False, length=20), nullable=False
    )
    changed_by_id: Mapped[uuid.UUID | None] = mapped_column(
        GUID(), ForeignKey("users.id", ondelete="SET NULL")
    )
    note: Mapped[str | None] = mapped_column(Text)

    complaint: Mapped[Complaint] = relationship(back_populates="status_history")


class PotentialDuplicate(UUIDPrimaryKeyMixin, TimestampMixin, Base):
    """A suggested link between two complaints. Never auto-deletes anything."""

    __tablename__ = "potential_duplicates"
    __table_args__ = (
        UniqueConstraint("complaint_id", "duplicate_complaint_id", name="uq_duplicate_pair"),
    )

    complaint_id: Mapped[uuid.UUID] = mapped_column(
        GUID(), ForeignKey("complaints.id", ondelete="CASCADE"), nullable=False, index=True
    )
    duplicate_complaint_id: Mapped[uuid.UUID] = mapped_column(
        GUID(), ForeignKey("complaints.id", ondelete="CASCADE"), nullable=False, index=True
    )
    #: 0-1 blended similarity across distance, damage type, time and image hash.
    similarity_score: Mapped[float] = mapped_column(Float, nullable=False)
    distance_meters: Mapped[float] = mapped_column(Float, nullable=False)
    reason: Mapped[str] = mapped_column(Text, nullable=False)
    status: Mapped[DuplicateStatus] = mapped_column(
        SAEnum(DuplicateStatus, native_enum=False, length=20),
        default=DuplicateStatus.SUGGESTED,
        nullable=False,
        index=True,
    )
    reviewed_by_id: Mapped[uuid.UUID | None] = mapped_column(
        GUID(), ForeignKey("users.id", ondelete="SET NULL")
    )
    reviewed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))

    complaint: Mapped[Complaint] = relationship(foreign_keys=[complaint_id])
    duplicate_complaint: Mapped[Complaint] = relationship(foreign_keys=[duplicate_complaint_id])
