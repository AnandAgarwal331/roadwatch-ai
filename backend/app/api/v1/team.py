"""Repair team endpoints.

A crew member sees only their own team's work. The team is taken from the
authenticated user's ``team_id``, never from a request parameter, so one crew
cannot read or act on another's jobs by guessing an id.
"""

from __future__ import annotations

import uuid
from datetime import UTC, datetime, timedelta

from fastapi import APIRouter, Depends, File, Form, Query, UploadFile
from sqlalchemy.orm import Session

from app.api.deps import get_session, require_team
from app.api.serializers import to_task
from app.core.config import settings
from app.core.enums import AssignmentStatus, PriorityLevel, UserRole
from app.core.errors import PermissionDeniedError, ValidationError
from app.core.rate_limit import write_rate_limit
from app.models.repair import RepairAssignment
from app.models.user import User
from app.repositories.repair import RepairRepository
from app.schemas.admin import (
    RepairTeamResponse,
    TaskResponse,
    TeamDashboardResponse,
)
from app.services.complaints import ComplaintService

router = APIRouter(prefix="/team", tags=["team"])


def _resolve_team_id(user: User, requested: uuid.UUID | None = None) -> uuid.UUID:
    """Crews are pinned to their own team; admins may inspect any team."""
    if user.role == UserRole.ADMIN and requested is not None:
        return requested
    if user.team_id is None:
        raise PermissionDeniedError(
            "Your account is not linked to a repair team. Ask an administrator to assign you to one."
        )
    return user.team_id


def _load_assignment(db: Session, assignment_id: uuid.UUID, user: User) -> RepairAssignment:
    assignment = RepairRepository(db).get_assignment(assignment_id)
    if assignment is None:
        from app.core.errors import NotFoundError

        raise NotFoundError("That job could not be found.")

    if user.role != UserRole.ADMIN and assignment.team_id != user.team_id:
        # Same message as "not found" so ids cannot be probed for existence.
        from app.core.errors import NotFoundError

        raise NotFoundError("That job could not be found.")

    return assignment


@router.get("/dashboard", response_model=TeamDashboardResponse, summary="Crew dashboard")
def team_dashboard(
    team_id: uuid.UUID | None = None,
    user: User = Depends(require_team),
    db: Session = Depends(get_session),
) -> TeamDashboardResponse:
    resolved = _resolve_team_id(user, team_id)
    repository = RepairRepository(db)
    team = repository.get_team(resolved)
    if team is None:
        from app.core.errors import NotFoundError

        raise NotFoundError("That team does not exist.")

    assignments = repository.list_team_assignments(resolved, limit=200)
    now = datetime.now(UTC)
    end_of_day = now.replace(hour=23, minute=59, second=59)

    tasks = [to_task(item) for item in assignments]
    open_tasks = [
        task for task in tasks if task.status in (AssignmentStatus.ASSIGNED, AssignmentStatus.IN_PROGRESS)
    ]

    today = [
        task
        for task in open_tasks
        if task.due_at is None or _utc(task.due_at) <= end_of_day + timedelta(hours=0)
    ]
    critical = [task for task in open_tasks if task.complaint.priority_level == PriorityLevel.CRITICAL]
    in_progress = [task for task in open_tasks if task.status == AssignmentStatus.IN_PROGRESS]
    completed = [
        task
        for task in tasks
        if task.status in (AssignmentStatus.COMPLETED, AssignmentStatus.VERIFIED)
    ][:10]

    return TeamDashboardResponse(
        team=RepairTeamResponse.model_validate(team),
        today=today,
        critical=critical,
        in_progress=in_progress,
        completed_recently=completed,
        stats={
            "open_jobs": len(open_tasks),
            "critical_open": len(critical),
            "in_progress": len(in_progress),
            "overdue": sum(1 for task in open_tasks if task.is_overdue),
            "completed_total": sum(
                1
                for task in tasks
                if task.status in (AssignmentStatus.COMPLETED, AssignmentStatus.VERIFIED)
            ),
            "capacity": team.max_concurrent_jobs,
        },
    )


@router.get("/tasks", response_model=list[TaskResponse], summary="Assigned jobs")
def list_tasks(
    # Without an explicit Query(), FastAPI reads a list-typed parameter from the
    # request body, which a GET does not send - the filter would be silently
    # ignored rather than rejected.
    status_filter: list[AssignmentStatus] | None = Query(None),
    team_id: uuid.UUID | None = Query(None),
    user: User = Depends(require_team),
    db: Session = Depends(get_session),
) -> list[TaskResponse]:
    resolved = _resolve_team_id(user, team_id)
    assignments = RepairRepository(db).list_team_assignments(resolved, statuses=status_filter)
    return [to_task(item) for item in assignments]


@router.get("/tasks/{assignment_id}", response_model=TaskResponse, summary="Job detail")
def get_task(
    assignment_id: uuid.UUID,
    user: User = Depends(require_team),
    db: Session = Depends(get_session),
) -> TaskResponse:
    return to_task(_load_assignment(db, assignment_id, user))


@router.post("/tasks/{assignment_id}/start", response_model=TaskResponse, summary="Start a repair")
def start_task(
    assignment_id: uuid.UUID,
    _: None = Depends(write_rate_limit),
    user: User = Depends(require_team),
    db: Session = Depends(get_session),
) -> TaskResponse:
    assignment = _load_assignment(db, assignment_id, user)
    return to_task(ComplaintService(db).start_repair(assignment, user))


@router.post(
    "/tasks/{assignment_id}/complete",
    response_model=TaskResponse,
    summary="Submit completion evidence",
)
async def complete_task(
    assignment_id: uuid.UUID,
    note: str | None = Form(None),
    photos: list[UploadFile] = File(default_factory=list),
    _: None = Depends(write_rate_limit),
    user: User = Depends(require_team),
    db: Session = Depends(get_session),
) -> TaskResponse:
    assignment = _load_assignment(db, assignment_id, user)

    files: list[tuple[bytes, str, str]] = []
    for upload in photos:
        if not upload.filename:
            continue
        raw = await upload.read()
        if len(raw) > settings.MAX_UPLOAD_BYTES:
            raise ValidationError(
                f"{upload.filename} is too large. Please keep photos under "
                f"{settings.MAX_UPLOAD_BYTES / (1024 * 1024):.0f}MB."
            )
        files.append((raw, upload.content_type or "application/octet-stream", upload.filename))

    updated = ComplaintService(db).complete_repair(
        assignment, user, note=(note or "").strip() or None, evidence_files=files
    )
    return to_task(updated)


def _utc(value: datetime) -> datetime:
    return value if value.tzinfo else value.replace(tzinfo=UTC)
