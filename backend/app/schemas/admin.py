"""Admin, team and analytics schemas."""

from __future__ import annotations

import uuid
from datetime import datetime

from pydantic import BaseModel, Field, field_validator

from app.core.enums import AssignmentStatus
from app.schemas.common import ORMModel
from app.schemas.complaint import ComplaintSummary


class KpiResponse(BaseModel):
    total_reports: int
    critical: int
    high: int
    in_progress: int
    resolved: int
    pending_review: int
    unresolved: int
    average_resolution_hours: float | None = None
    resolution_rate: float
    reports_last_7_days: int
    reports_last_30_days: int
    pending_duplicates: int


class DashboardResponse(BaseModel):
    kpis: KpiResponse
    priority_queue: list[ComplaintSummary]
    recent_reports: list[ComplaintSummary]
    status_distribution: list[dict]
    priority_distribution: list[dict]


class AnalyticsResponse(BaseModel):
    kpis: KpiResponse
    reports_over_time: list[dict]
    by_damage_type: list[dict]
    by_area: list[dict]
    priority_distribution: list[dict]
    status_distribution: list[dict]
    top_roads: list[dict]
    repeat_locations: list[dict]
    team_performance: list[dict]
    resolution_by_priority: list[dict]


class TeamMemberResponse(ORMModel):
    id: uuid.UUID
    full_name: str
    email: str


class RepairTeamResponse(ORMModel):
    id: uuid.UUID
    name: str
    code: str
    zone: str | None = None
    contact_phone: str | None = None
    specialities: str | None = None
    max_concurrent_jobs: int
    is_active: bool
    base_latitude: float | None = None
    base_longitude: float | None = None
    created_at: datetime


class RepairTeamWithLoad(RepairTeamResponse):
    open_jobs: int
    completed_jobs: int
    members: list[TeamMemberResponse] = []


class RepairTeamCreateRequest(BaseModel):
    name: str = Field(min_length=2, max_length=120)
    code: str = Field(min_length=2, max_length=20)
    zone: str | None = Field(default=None, max_length=120)
    contact_phone: str | None = Field(default=None, max_length=32)
    specialities: str | None = Field(default=None, max_length=200)
    max_concurrent_jobs: int = Field(default=5, ge=1, le=100)
    base_latitude: float | None = Field(default=None, ge=-90, le=90)
    base_longitude: float | None = Field(default=None, ge=-180, le=180)

    @field_validator("code")
    @classmethod
    def _upper(cls, value: str) -> str:
        return value.strip().upper()


class RepairTeamUpdateRequest(BaseModel):
    name: str | None = Field(default=None, min_length=2, max_length=120)
    zone: str | None = Field(default=None, max_length=120)
    contact_phone: str | None = Field(default=None, max_length=32)
    specialities: str | None = Field(default=None, max_length=200)
    max_concurrent_jobs: int | None = Field(default=None, ge=1, le=100)
    is_active: bool | None = None


class RepairEvidenceResponse(ORMModel):
    id: uuid.UUID
    url: str
    content_type: str
    note: str | None = None
    created_at: datetime


class TaskResponse(ORMModel):
    """One job as the repair crew sees it."""

    id: uuid.UUID
    status: AssignmentStatus
    due_at: datetime | None = None
    started_at: datetime | None = None
    completed_at: datetime | None = None
    verified_at: datetime | None = None
    notes: str | None = None
    created_at: datetime
    complaint: ComplaintSummary
    evidence: list[RepairEvidenceResponse] = []
    is_overdue: bool = False


class TeamDashboardResponse(BaseModel):
    team: RepairTeamResponse
    today: list[TaskResponse]
    critical: list[TaskResponse]
    in_progress: list[TaskResponse]
    completed_recently: list[TaskResponse]
    stats: dict


class CompleteRepairRequest(BaseModel):
    note: str | None = Field(default=None, max_length=2000)


class VerifyRepairRequest(BaseModel):
    note: str | None = Field(default=None, max_length=1000)


class AuditLogResponse(ORMModel):
    id: uuid.UUID
    actor_email: str | None = None
    action: str
    entity_type: str
    entity_id: uuid.UUID | None = None
    complaint_id: uuid.UUID | None = None
    old_value: dict | None = None
    new_value: dict | None = None
    note: str | None = None
    created_at: datetime


class NotificationResponse(ORMModel):
    id: uuid.UUID
    title: str
    body: str
    event: str
    link: str | None = None
    complaint_id: uuid.UUID | None = None
    is_read: bool
    created_at: datetime


class NotificationListResponse(BaseModel):
    items: list[NotificationResponse]
    unread_count: int


class SettingsResponse(BaseModel):
    """Live scoring configuration, surfaced read-only in the admin UI."""

    priority_weights: dict
    priority_thresholds: dict
    nearby_radius_meters: int
    duplicate_radius_meters: int
    duplicate_window_days: int
    history_radius_meters: int
    ai_provider: str
    ai_min_confidence: float
    traffic_provider: str
    places_provider: str
    storage_provider: str
    weather_enabled: bool
    max_upload_mb: float
    engine_version: str
