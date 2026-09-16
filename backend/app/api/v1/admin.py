"""Administrative endpoints.

Every route here sits behind ``require_admin``. Citizens and repair crews cannot
reach any of it, and the guard is a router-level dependency rather than a
per-function check so a new endpoint cannot be added unprotected by accident.
"""

from __future__ import annotations

import uuid
from dataclasses import asdict

from fastapi import APIRouter, Depends, Query, Request
from sqlalchemy.orm import Session

from app.api.deps import client_ip, get_session, require_admin
from app.api.serializers import to_detail, to_duplicate_link, to_summary
from app.core.config import settings
from app.core.enums import ComplaintStatus, DamageType, PriorityLevel
from app.core.errors import ConflictError, NotFoundError
from app.models.repair import RepairTeam
from app.models.user import User
from app.repositories.complaint import ComplaintFilters, ComplaintRepository
from app.repositories.repair import RepairRepository
from app.repositories.system import DuplicateRepository
from app.repositories.user import UserRepository
from app.schemas.admin import (
    AnalyticsResponse,
    AuditLogResponse,
    DashboardResponse,
    KpiResponse,
    RepairTeamCreateRequest,
    RepairTeamResponse,
    RepairTeamUpdateRequest,
    RepairTeamWithLoad,
    SettingsResponse,
    TeamMemberResponse,
    VerifyRepairRequest,
)
from app.schemas.common import MessageResponse, PaginatedResponse
from app.schemas.complaint import (
    AssignmentSummary,
    AssignRequest,
    ComplaintDetail,
    ComplaintSummary,
    DuplicateLinkResponse,
    PriorityOverrideRequest,
    RejectRequest,
    StatusChangeRequest,
)
from app.services.analytics import AnalyticsService
from app.services.audit import AuditService
from app.services.complaints import ComplaintService
from app.services.priority import ENGINE_VERSION

router = APIRouter(prefix="/admin", tags=["admin"], dependencies=[Depends(require_admin)])


# -- dashboard & analytics ----------------------------------------------


@router.get("/dashboard", response_model=DashboardResponse, summary="Dashboard summary")
def dashboard(db: Session = Depends(get_session)) -> DashboardResponse:
    analytics = AnalyticsService(db)
    repository = ComplaintRepository(db)

    queue, _ = repository.list(
        ComplaintFilters(exclude_closed=True),
        page=1,
        page_size=10,
        sort_by="priority_score",
        sort_dir="desc",
    )
    recent, _ = repository.list(
        ComplaintFilters(), page=1, page_size=8, sort_by="created_at", sort_dir="desc"
    )

    kpis = analytics.kpis()
    return DashboardResponse(
        kpis=KpiResponse(**asdict(kpis)),
        priority_queue=[to_summary(item) for item in queue],
        recent_reports=[to_summary(item) for item in recent],
        status_distribution=analytics.status_distribution(),
        priority_distribution=analytics.priority_distribution(),
    )


@router.get("/analytics", response_model=AnalyticsResponse, summary="Operational analytics")
def analytics(
    days: int = Query(30, ge=7, le=365),
    db: Session = Depends(get_session),
) -> AnalyticsResponse:
    service = AnalyticsService(db)
    kpis = service.kpis()
    return AnalyticsResponse(
        kpis=KpiResponse(**asdict(kpis)),
        reports_over_time=service.reports_over_time(days),
        by_damage_type=service.by_damage_type(),
        by_area=service.by_area(),
        priority_distribution=service.priority_distribution(),
        status_distribution=service.status_distribution(),
        top_roads=service.top_roads(),
        repeat_locations=service.repeat_locations(),
        team_performance=service.team_performance(),
        resolution_by_priority=service.resolution_by_priority(),
    )


@router.get("/settings", response_model=SettingsResponse, summary="Live scoring configuration")
def get_settings() -> SettingsResponse:
    return SettingsResponse(
        priority_weights={
            "severity": settings.PRIORITY_WEIGHT_SEVERITY,
            "traffic": settings.PRIORITY_WEIGHT_TRAFFIC,
            "location": settings.PRIORITY_WEIGHT_LOCATION,
            "history": settings.PRIORITY_WEIGHT_HISTORY,
        },
        priority_thresholds={
            "medium": settings.PRIORITY_THRESHOLD_MEDIUM,
            "high": settings.PRIORITY_THRESHOLD_HIGH,
            "critical": settings.PRIORITY_THRESHOLD_CRITICAL,
        },
        nearby_radius_meters=settings.NEARBY_RADIUS_METERS,
        duplicate_radius_meters=settings.DUPLICATE_RADIUS_METERS,
        duplicate_window_days=settings.DUPLICATE_WINDOW_DAYS,
        history_radius_meters=settings.HISTORY_RADIUS_METERS,
        ai_provider=settings.AI_PROVIDER,
        ai_min_confidence=settings.AI_MIN_CONFIDENCE,
        traffic_provider=settings.TRAFFIC_PROVIDER,
        places_provider=settings.PLACES_PROVIDER,
        storage_provider=settings.STORAGE_PROVIDER,
        weather_enabled=settings.WEATHER_ENABLED,
        max_upload_mb=round(settings.MAX_UPLOAD_BYTES / (1024 * 1024), 1),
        engine_version=ENGINE_VERSION,
    )


# -- complaints ----------------------------------------------------------


@router.get(
    "/reports",
    response_model=PaginatedResponse[ComplaintSummary],
    summary="All reports, unfiltered by visibility",
)
def list_reports(
    page: int = Query(1, ge=1),
    page_size: int = Query(20, ge=1, le=100),
    status_filter: list[ComplaintStatus] | None = Query(None, alias="status"),
    damage_type: list[DamageType] | None = Query(None),
    priority_level: list[PriorityLevel] | None = Query(None),
    search: str | None = Query(None, max_length=200),
    sort_by: str = Query("priority_score"),
    sort_dir: str = Query("desc", pattern="^(asc|desc)$"),
    exclude_closed: bool = Query(False),
    db: Session = Depends(get_session),
) -> PaginatedResponse[ComplaintSummary]:
    filters = ComplaintFilters(
        status=status_filter,
        damage_type=damage_type,
        priority_level=priority_level,
        search=search,
        exclude_closed=exclude_closed,
    )
    items, total = ComplaintRepository(db).list(
        filters, page=page, page_size=page_size, sort_by=sort_by, sort_dir=sort_dir
    )
    return PaginatedResponse.build([to_summary(item) for item in items], total, page, page_size)


@router.get("/reports/{complaint_id}", response_model=ComplaintDetail, summary="Report detail")
def get_report(complaint_id: uuid.UUID, db: Session = Depends(get_session)) -> ComplaintDetail:
    complaint = ComplaintRepository(db).get(complaint_id, full=True)
    if complaint is None:
        raise NotFoundError("That report could not be found.")
    return to_detail(complaint, include_reporter=True)


@router.patch("/reports/{complaint_id}/status", response_model=ComplaintDetail, summary="Change status")
def change_status(
    complaint_id: uuid.UUID,
    payload: StatusChangeRequest,
    db: Session = Depends(get_session),
    admin: User = Depends(require_admin),
) -> ComplaintDetail:
    repository = ComplaintRepository(db)
    complaint = repository.get(complaint_id, full=True)
    if complaint is None:
        raise NotFoundError("That report could not be found.")

    ComplaintService(db).change_status(complaint, payload.status, admin, payload.note)
    return to_detail(repository.get(complaint_id, full=True), include_reporter=True)


@router.post("/reports/{complaint_id}/reject", response_model=ComplaintDetail, summary="Reject a report")
def reject_report(
    complaint_id: uuid.UUID,
    payload: RejectRequest,
    db: Session = Depends(get_session),
    admin: User = Depends(require_admin),
) -> ComplaintDetail:
    repository = ComplaintRepository(db)
    complaint = repository.get(complaint_id, full=True)
    if complaint is None:
        raise NotFoundError("That report could not be found.")

    ComplaintService(db).reject(complaint, payload.reason, admin)
    return to_detail(repository.get(complaint_id, full=True), include_reporter=True)


@router.patch(
    "/reports/{complaint_id}/priority",
    response_model=ComplaintDetail,
    summary="Override the recommended priority",
)
def override_priority(
    complaint_id: uuid.UUID,
    payload: PriorityOverrideRequest,
    db: Session = Depends(get_session),
    admin: User = Depends(require_admin),
) -> ComplaintDetail:
    repository = ComplaintRepository(db)
    complaint = repository.get(complaint_id, full=True)
    if complaint is None:
        raise NotFoundError("That report could not be found.")

    ComplaintService(db).override_priority(complaint, payload.priority_score, admin, payload.note)
    return to_detail(repository.get(complaint_id, full=True), include_reporter=True)


@router.post(
    "/reports/{complaint_id}/assign",
    response_model=AssignmentSummary,
    summary="Assign a repair team",
)
def assign_team(
    complaint_id: uuid.UUID,
    payload: AssignRequest,
    db: Session = Depends(get_session),
    admin: User = Depends(require_admin),
) -> AssignmentSummary:
    complaint = ComplaintRepository(db).get(complaint_id, full=True)
    if complaint is None:
        raise NotFoundError("That report could not be found.")

    assignment = ComplaintService(db).assign(
        complaint, payload.team_id, admin, due_at=payload.due_at, note=payload.note
    )
    return AssignmentSummary.model_validate(assignment)


@router.post(
    "/reports/{complaint_id}/verify",
    response_model=ComplaintDetail,
    summary="Verify a completed repair",
)
def verify_repair(
    complaint_id: uuid.UUID,
    payload: VerifyRepairRequest,
    db: Session = Depends(get_session),
    admin: User = Depends(require_admin),
) -> ComplaintDetail:
    repository = ComplaintRepository(db)
    complaint = repository.get(complaint_id, full=True)
    if complaint is None:
        raise NotFoundError("That report could not be found.")

    assignment = RepairRepository(db).active_assignment_for_complaint(complaint_id)
    if assignment is None:
        raise ConflictError("There is no completed repair to verify for this report.")

    ComplaintService(db).verify_repair(assignment, admin, payload.note)
    return to_detail(repository.get(complaint_id, full=True), include_reporter=True)


@router.post(
    "/reports/{complaint_id}/reassess",
    response_model=ComplaintDetail,
    summary="Re-run the assessment pipeline",
)
async def reassess(
    complaint_id: uuid.UUID,
    db: Session = Depends(get_session),
    admin: User = Depends(require_admin),
) -> ComplaintDetail:
    repository = ComplaintRepository(db)
    complaint = repository.get(complaint_id, full=True)
    if complaint is None:
        raise NotFoundError("That report could not be found.")

    await ComplaintService(db).reassess(complaint, actor=admin)
    return to_detail(repository.get(complaint_id, full=True), include_reporter=True)


# -- duplicates ----------------------------------------------------------


@router.get(
    "/duplicates",
    response_model=list[DuplicateLinkResponse],
    summary="Duplicate suggestions awaiting review",
)
def list_duplicates(
    limit: int = Query(50, ge=1, le=200),
    db: Session = Depends(get_session),
) -> list[DuplicateLinkResponse]:
    return [to_duplicate_link(link) for link in DuplicateRepository(db).list_pending(limit)]


@router.get(
    "/reports/{complaint_id}/duplicates",
    response_model=list[DuplicateLinkResponse],
    summary="Duplicate links for one report",
)
def complaint_duplicates(
    complaint_id: uuid.UUID, db: Session = Depends(get_session)
) -> list[DuplicateLinkResponse]:
    return [to_duplicate_link(link) for link in DuplicateRepository(db).list_for_complaint(complaint_id)]


@router.post(
    "/duplicates/{link_id}/confirm",
    response_model=MessageResponse,
    summary="Merge a confirmed duplicate",
)
def confirm_duplicate(
    link_id: uuid.UUID,
    db: Session = Depends(get_session),
    admin: User = Depends(require_admin),
) -> MessageResponse:
    canonical, duplicate = ComplaintService(db).confirm_duplicate(link_id, admin)
    return MessageResponse(
        message=f"{duplicate.complaint_number} linked to {canonical.complaint_number}.",
        detail=f"{canonical.complaint_number} now represents {canonical.report_count} reports.",
    )


@router.post(
    "/duplicates/{link_id}/reject",
    response_model=MessageResponse,
    summary="Dismiss a duplicate suggestion",
)
def reject_duplicate(
    link_id: uuid.UUID,
    db: Session = Depends(get_session),
    admin: User = Depends(require_admin),
) -> MessageResponse:
    ComplaintService(db).reject_duplicate(link_id, admin)
    return MessageResponse(message="Marked as separate issues.")


# -- teams ---------------------------------------------------------------


@router.get("/teams", response_model=list[RepairTeamWithLoad], summary="Repair teams")
def list_teams(db: Session = Depends(get_session)) -> list[RepairTeamWithLoad]:
    repository = RepairRepository(db)
    users = UserRepository(db)
    workload = repository.workload_by_team()

    return [
        RepairTeamWithLoad(
            **RepairTeamResponse.model_validate(team).model_dump(),
            open_jobs=workload.get(team.id, 0),
            completed_jobs=repository.completed_count(team.id),
            members=[TeamMemberResponse.model_validate(user) for user in users.list_by_team(team.id)],
        )
        for team in repository.list_teams()
    ]


@router.post("/teams", response_model=RepairTeamResponse, summary="Create a repair team")
def create_team(
    payload: RepairTeamCreateRequest,
    request: Request,
    db: Session = Depends(get_session),
    admin: User = Depends(require_admin),
) -> RepairTeamResponse:
    repository = RepairRepository(db)
    if any(team.code == payload.code for team in repository.list_teams()):
        raise ConflictError(f"A team with the code {payload.code} already exists.")

    team = repository.add_team(RepairTeam(**payload.model_dump()))
    AuditService(db).record(
        actor=admin,
        action="team.created",
        entity_type="repair_team",
        entity_id=team.id,
        new_value={"name": team.name, "code": team.code},
        ip_address=client_ip(request),
    )
    db.commit()
    db.refresh(team)
    return RepairTeamResponse.model_validate(team)


@router.patch("/teams/{team_id}", response_model=RepairTeamResponse, summary="Update a repair team")
def update_team(
    team_id: uuid.UUID,
    payload: RepairTeamUpdateRequest,
    request: Request,
    db: Session = Depends(get_session),
    admin: User = Depends(require_admin),
) -> RepairTeamResponse:
    repository = RepairRepository(db)
    team = repository.get_team(team_id)
    if team is None:
        raise NotFoundError("That team does not exist.")

    changes = payload.model_dump(exclude_unset=True, exclude_none=True)
    before = {key: getattr(team, key) for key in changes}
    for key, value in changes.items():
        setattr(team, key, value)

    AuditService(db).record(
        actor=admin,
        action="team.updated",
        entity_type="repair_team",
        entity_id=team.id,
        old_value=before,
        new_value=changes,
        ip_address=client_ip(request),
    )
    db.commit()
    db.refresh(team)
    return RepairTeamResponse.model_validate(team)


# -- audit ---------------------------------------------------------------


@router.get("/audit", response_model=list[AuditLogResponse], summary="Audit trail")
def audit_log(
    complaint_id: uuid.UUID | None = Query(None),
    limit: int = Query(100, ge=1, le=500),
    db: Session = Depends(get_session),
) -> list[AuditLogResponse]:
    entries = AuditService(db).list_recent(complaint_id=complaint_id, limit=limit)
    return [AuditLogResponse.model_validate(entry) for entry in entries]
