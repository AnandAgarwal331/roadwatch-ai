"""AI analysis output and the explainable priority assessment."""

from __future__ import annotations

import uuid
from typing import TYPE_CHECKING

from sqlalchemy import Boolean, Float, ForeignKey, Integer, String, Text
from sqlalchemy import Enum as SAEnum
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.core.enums import DamageType, PriorityLevel
from app.db.base import Base, TimestampMixin, UUIDPrimaryKeyMixin
from app.db.types import GUID, JSONType

if TYPE_CHECKING:
    from app.models.complaint import Complaint


class AIAnalysis(UUIDPrimaryKeyMixin, TimestampMixin, Base):
    """One run of the vision model over one image.

    Analyses are never overwritten - re-running the model appends a new row so
    the history of what the system believed, and when, stays auditable.
    """

    __tablename__ = "ai_analyses"

    complaint_id: Mapped[uuid.UUID] = mapped_column(
        GUID(), ForeignKey("complaints.id", ondelete="CASCADE"), nullable=False, index=True
    )
    image_id: Mapped[uuid.UUID | None] = mapped_column(
        GUID(), ForeignKey("complaint_images.id", ondelete="SET NULL")
    )

    damage_type: Mapped[DamageType] = mapped_column(
        SAEnum(DamageType, native_enum=False, length=30), nullable=False
    )
    confidence: Mapped[float] = mapped_column(Float, nullable=False)
    #: Visual severity, 0-10. An AI-assisted estimate, not an engineering measurement.
    severity_score: Mapped[float] = mapped_column(Float, nullable=False)
    #: Share of the frame covered by damage, 0-1.
    damaged_area_ratio: Mapped[float] = mapped_column(Float, default=0.0, nullable=False)
    detection_count: Mapped[int] = mapped_column(Integer, default=0, nullable=False)
    #: False when every detection fell below the confidence threshold.
    is_confident: Mapped[bool] = mapped_column(Boolean, default=True, nullable=False)

    model_name: Mapped[str] = mapped_column(String(100), nullable=False)
    model_version: Mapped[str] = mapped_column(String(50), nullable=False)
    provider: Mapped[str] = mapped_column(String(50), nullable=False)
    processing_ms: Mapped[int | None] = mapped_column(Integer)
    #: Human-readable summary of how severity was derived.
    severity_explanation: Mapped[str | None] = mapped_column(Text)
    error_message: Mapped[str | None] = mapped_column(Text)

    complaint: Mapped[Complaint] = relationship(back_populates="analyses")
    detections: Mapped[list[AIDetection]] = relationship(
        back_populates="analysis", cascade="all, delete-orphan"
    )


class AIDetection(UUIDPrimaryKeyMixin, TimestampMixin, Base):
    """A single bounding box produced by the detector."""

    __tablename__ = "ai_detections"

    analysis_id: Mapped[uuid.UUID] = mapped_column(
        GUID(), ForeignKey("ai_analyses.id", ondelete="CASCADE"), nullable=False, index=True
    )
    damage_type: Mapped[DamageType] = mapped_column(
        SAEnum(DamageType, native_enum=False, length=30), nullable=False
    )
    confidence: Mapped[float] = mapped_column(Float, nullable=False)
    #: Normalised 0-1 box coordinates so overlays scale to any rendered size.
    bbox_x: Mapped[float] = mapped_column(Float, nullable=False)
    bbox_y: Mapped[float] = mapped_column(Float, nullable=False)
    bbox_width: Mapped[float] = mapped_column(Float, nullable=False)
    bbox_height: Mapped[float] = mapped_column(Float, nullable=False)
    area_ratio: Mapped[float] = mapped_column(Float, default=0.0, nullable=False)

    analysis: Mapped[AIAnalysis] = relationship(back_populates="detections")


class PriorityAssessment(UUIDPrimaryKeyMixin, TimestampMixin, Base):
    """An explainable priority score.

    Every factor, weight and contribution is persisted so the UI can show
    exactly why a complaint scored what it did - and so a later scoring change
    does not silently rewrite history.
    """

    __tablename__ = "priority_assessments"

    complaint_id: Mapped[uuid.UUID] = mapped_column(
        GUID(), ForeignKey("complaints.id", ondelete="CASCADE"), nullable=False, index=True
    )

    #: Normalised 0-10 factor inputs.
    severity_factor: Mapped[float] = mapped_column(Float, nullable=False)
    traffic_factor: Mapped[float] = mapped_column(Float, nullable=False)
    location_factor: Mapped[float] = mapped_column(Float, nullable=False)
    history_factor: Mapped[float] = mapped_column(Float, nullable=False)

    #: Points each factor contributed to the 0-100 total.
    severity_points: Mapped[float] = mapped_column(Float, nullable=False)
    traffic_points: Mapped[float] = mapped_column(Float, nullable=False)
    location_points: Mapped[float] = mapped_column(Float, nullable=False)
    history_points: Mapped[float] = mapped_column(Float, nullable=False)

    total_score: Mapped[float] = mapped_column(Float, nullable=False, index=True)
    level: Mapped[PriorityLevel] = mapped_column(
        SAEnum(PriorityLevel, native_enum=False, length=20), nullable=False
    )
    explanation: Mapped[str] = mapped_column(Text, nullable=False)

    #: Weights and thresholds in force at scoring time, plus the raw signals.
    weights: Mapped[dict] = mapped_column(JSONType, nullable=False)
    signals: Mapped[dict] = mapped_column(JSONType, nullable=False)
    #: Optional weather escalation multiplier (1.0 when disabled).
    weather_multiplier: Mapped[float] = mapped_column(Float, default=1.0, nullable=False)
    engine_version: Mapped[str] = mapped_column(String(20), default="weighted-v1", nullable=False)

    complaint: Mapped[Complaint] = relationship(back_populates="assessments")
