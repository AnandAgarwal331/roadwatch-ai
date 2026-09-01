"""Complaint request and response schemas."""

from __future__ import annotations

import uuid
from datetime import datetime

from pydantic import BaseModel, Field, field_validator

from app.core.enums import (
    AssignmentStatus,
    ComplaintStatus,
    DamageType,
    DuplicateStatus,
    ImageKind,
    PlaceType,
    PriorityLevel,
    TrafficLevel,
)
from app.schemas.common import ORMModel


class CoordinatePayload(BaseModel):
    latitude: float = Field(ge=-90, le=90)
    longitude: float = Field(ge=-180, le=180)


class ComplaintCreateForm(CoordinatePayload):
    """Parsed from multipart form fields alongside the uploaded photo."""

    description: str | None = Field(default=None, max_length=2000)
    reported_damage_type: DamageType | None = None
    road_name: str | None = Field(default=None, max_length=200)
    address: str | None = Field(default=None, max_length=400)
    city: str | None = Field(default=None, max_length=120)
    accuracy_meters: float | None = Field(default=None, ge=0, le=100_000)

    @field_validator("description", "road_name", "address", "city")
    @classmethod
    def _blank_to_none(cls, value: str | None) -> str | None:
        if value is None:
            return None
        cleaned = value.strip()
        return cleaned or None

    @field_validator("reported_damage_type", mode="before")
    @classmethod
    def _empty_type(cls, value):
        if value in ("", None, "null", "undefined"):
            return None
        return value


class DetectionResponse(ORMModel):
    id: uuid.UUID
    damage_type: DamageType
    confidence: float
    bbox_x: float
    bbox_y: float
    bbox_width: float
    bbox_height: float
    area_ratio: float


class AIAnalysisResponse(ORMModel):
    id: uuid.UUID
    damage_type: DamageType
    confidence: float
    severity_score: float
    damaged_area_ratio: float
    detection_count: int
    is_confident: bool
    model_name: str
    model_version: str
    provider: str
    processing_ms: int | None = None
    severity_explanation: str | None = None
    error_message: str | None = None
    detections: list[DetectionResponse] = []
    created_at: datetime


class PriorityFactorResponse(BaseModel):
    key: str
    label: str
    value: float
    weight: float
    points: float
    max_points: float
    note: str = ""


class PriorityAssessmentResponse(BaseModel):
    """The explainable breakdown - the core of the product."""

    id: uuid.UUID
    total_score: float
    level: PriorityLevel
    explanation: str
    factors: list[PriorityFactorResponse]
    weights: dict
    signals: dict
    weather_multiplier: float
    engine_version: str
    created_at: datetime
    #: Constant reminder rendered wherever a score is shown.
    disclaimer: str = (
        "AI-assisted priority recommendation. Final repair priority should be reviewed by "
        "authorized personnel."
    )


class ComplaintImageResponse(ORMModel):
    id: uuid.UUID
    url: str
    content_type: str
    width: int | None = None
    height: int | None = None
    kind: ImageKind
    created_at: datetime


class LocationResponse(ORMModel):
    latitude: float
    longitude: float
    accuracy_meters: float | None = None
    address: str | None = None
    road_name: str | None = None
    city: str | None = None
    road_importance: float


class NearbyPlaceResponse(ORMModel):
    place_type: PlaceType
    name: str
    distance_meters: float
    latitude: float
    longitude: float


class TrafficSnapshotResponse(ORMModel):
    level: TrafficLevel
    score: float
    estimated_vehicles_per_hour: int | None = None
    observed_at: datetime
    provider: str


class StatusHistoryResponse(ORMModel):
    id: uuid.UUID
    from_status: ComplaintStatus | None = None
    to_status: ComplaintStatus
    note: str | None = None
    created_at: datetime


class ReporterSummary(ORMModel):
    id: uuid.UUID
    full_name: str
    email: str


class AssignmentSummary(ORMModel):
    id: uuid.UUID
    team_id: uuid.UUID
    status: AssignmentStatus
    due_at: datetime | None = None
    started_at: datetime | None = None
    completed_at: datetime | None = None
    verified_at: datetime | None = None
    notes: str | None = None
    created_at: datetime


class ComplaintSummary(ORMModel):
    """List/map projection - deliberately small."""

    id: uuid.UUID
    complaint_number: str
    damage_type: DamageType
    status: ComplaintStatus
    priority_score: float
    priority_level: PriorityLevel
    severity_score: float
    report_count: int
    latitude: float
    longitude: float
    road_name: str | None = None
    description: str | None = None
    thumbnail_url: str | None = None
    created_at: datetime
    updated_at: datetime


class ComplaintDetail(ComplaintSummary):
    reported_damage_type: DamageType | None = None
    resolved_at: datetime | None = None
    rejection_reason: str | None = None
    manual_priority_override: float | None = None
    duplicate_of_id: uuid.UUID | None = None
    location: LocationResponse | None = None
    images: list[ComplaintImageResponse] = []
    latest_analysis: AIAnalysisResponse | None = None
    priority: PriorityAssessmentResponse | None = None
    nearby_places: list[NearbyPlaceResponse] = []
    traffic: TrafficSnapshotResponse | None = None
    status_history: list[StatusHistoryResponse] = []
    assignment: AssignmentSummary | None = None
    reporter: ReporterSummary | None = None


class DuplicateCandidateResponse(BaseModel):
    complaint_id: uuid.UUID
    complaint_number: str
    similarity: float
    distance_meters: float
    reason: str
    status: ComplaintStatus
    created_at: datetime


class DuplicateLinkResponse(BaseModel):
    id: uuid.UUID
    complaint_id: uuid.UUID
    complaint_number: str
    duplicate_complaint_id: uuid.UUID
    duplicate_complaint_number: str
    similarity_score: float
    distance_meters: float
    reason: str
    status: DuplicateStatus
    created_at: datetime


class ComplaintCreateResponse(BaseModel):
    complaint: ComplaintDetail
    needs_manual_review: bool
    ai_message: str | None = None
    duplicate_candidates: list[DuplicateCandidateResponse] = []
    next_step: str


class StatusChangeRequest(BaseModel):
    status: ComplaintStatus
    note: str | None = Field(default=None, max_length=1000)


class RejectRequest(BaseModel):
    reason: str = Field(min_length=3, max_length=1000)


class PriorityOverrideRequest(BaseModel):
    priority_score: float = Field(ge=0, le=100)
    note: str | None = Field(default=None, max_length=1000)


class AssignRequest(BaseModel):
    team_id: uuid.UUID
    due_at: datetime | None = None
    note: str | None = Field(default=None, max_length=1000)


class DuplicateDecisionRequest(BaseModel):
    link_id: uuid.UUID
    confirm: bool


class MapIssue(BaseModel):
    """Trimmed further than ComplaintSummary - a map can hold thousands."""

    id: uuid.UUID
    complaint_number: str
    latitude: float
    longitude: float
    damage_type: DamageType
    status: ComplaintStatus
    priority_level: PriorityLevel
    priority_score: float
    severity_score: float
    report_count: int
    road_name: str | None = None
    created_at: datetime
