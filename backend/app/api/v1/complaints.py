"""Citizen-facing complaint endpoints."""

from __future__ import annotations

import uuid

from fastapi import APIRouter, Depends, File, Form, Query, Request, UploadFile, status
from pydantic import ValidationError as PydanticValidationError
from sqlalchemy.orm import Session

from app.api.deps import get_current_user, get_optional_user, get_session
from app.api.serializers import (
    to_detail,
    to_duplicate_candidate,
    to_priority_response,
    to_summary,
)
from app.core.config import settings
from app.core.enums import CLOSED_STATUSES, ComplaintStatus, DamageType, PriorityLevel, UserRole
from app.core.errors import NotFoundError, PermissionDeniedError, ValidationError
from app.core.rate_limit import write_rate_limit
from app.models.user import User
from app.repositories.complaint import ComplaintFilters, ComplaintRepository
from app.schemas.common import PaginatedResponse
from app.schemas.complaint import (
    ComplaintCreateForm,
    ComplaintCreateResponse,
    ComplaintDetail,
    ComplaintSummary,
    PriorityAssessmentResponse,
)
from app.services.complaints import ComplaintService, CreateComplaintInput

router = APIRouter(prefix="/complaints", tags=["complaints"])

#: Statuses a citizen browsing the public feed should not see.
_PUBLIC_HIDDEN = {ComplaintStatus.REJECTED, ComplaintStatus.DUPLICATE}


@router.post(
    "",
    response_model=ComplaintCreateResponse,
    status_code=status.HTTP_201_CREATED,
    summary="Submit a road damage report",
)
async def create_complaint(
    request: Request,
    latitude: float = Form(..., ge=-90, le=90),
    longitude: float = Form(..., ge=-180, le=180),
    description: str | None = Form(None),
    reported_damage_type: str | None = Form(None),
    road_name: str | None = Form(None),
    address: str | None = Form(None),
    city: str | None = Form(None),
    accuracy_meters: float | None = Form(None, ge=0, le=100_000),
    photo: UploadFile | None = File(None),
    _: None = Depends(write_rate_limit),
    user: User = Depends(get_current_user),
    db: Session = Depends(get_session),
) -> ComplaintCreateResponse:
    """Runs the full pipeline: AI analysis, severity, geo, traffic, history, priority.

    Accepts multipart form data so the photo streams alongside the fields.
    """
    try:
        form = ComplaintCreateForm(
            latitude=latitude,
            longitude=longitude,
            description=description,
            reported_damage_type=reported_damage_type,
            road_name=road_name,
            address=address,
            city=city,
            accuracy_meters=accuracy_meters,
        )
    except PydanticValidationError as exc:
        # Multipart fields are validated by hand, so a schema failure here must
        # still reach the client as a 422 rather than an unhandled 500.
        raise ValidationError(
            "Some fields need attention.",
            details={
                "fields": [
                    {
                        "field": ".".join(str(part) for part in error.get("loc", ())),
                        "message": error.get("msg", "Invalid value"),
                    }
                    for error in exc.errors()
                ]
            },
        ) from exc

    image_bytes = None
    content_type = None
    filename = "report.jpg"
    if photo is not None and photo.filename:
        image_bytes = await photo.read()
        # Guard before decoding: refuse an oversized upload on size alone.
        if len(image_bytes) > settings.MAX_UPLOAD_BYTES:
            raise ValidationError(
                f"That image is too large. Please upload a file under "
                f"{settings.MAX_UPLOAD_BYTES / (1024 * 1024):.0f}MB."
            )
        content_type = photo.content_type
        filename = photo.filename

    service = ComplaintService(db)
    result = await service.create(
        CreateComplaintInput(
            latitude=form.latitude,
            longitude=form.longitude,
            description=form.description,
            reported_damage_type=form.reported_damage_type,
            road_name=form.road_name,
            address=form.address,
            city=form.city,
            accuracy_meters=form.accuracy_meters,
            image_bytes=image_bytes,
            image_content_type=content_type,
            image_filename=filename,
        ),
        reporter=user,
    )

    complaint = result.complaint
    return ComplaintCreateResponse(
        complaint=to_detail(complaint, precise=True),
        needs_manual_review=result.needs_manual_review,
        ai_message=result.ai_message,
        duplicate_candidates=[to_duplicate_candidate(item) for item in result.duplicate_candidates],
        next_step=_next_step(complaint, result.needs_manual_review),
    )


@router.get(
    "",
    response_model=PaginatedResponse[ComplaintSummary],
    summary="Browse public reports",
)
def list_complaints(
    page: int = Query(1, ge=1),
    page_size: int = Query(20, ge=1, le=100),
    status_filter: list[ComplaintStatus] | None = Query(None, alias="status"),
    damage_type: list[DamageType] | None = Query(None),
    priority_level: list[PriorityLevel] | None = Query(None),
    search: str | None = Query(None, max_length=200),
    sort_by: str = Query("created_at"),
    sort_dir: str = Query("desc", pattern="^(asc|desc)$"),
    near_lat: float | None = Query(None, ge=-90, le=90),
    near_lon: float | None = Query(None, ge=-180, le=180),
    radius_meters: int = Query(2000, ge=10, le=50_000),
    user: User | None = Depends(get_optional_user),
    db: Session = Depends(get_session),
) -> PaginatedResponse[ComplaintSummary]:
    """The public feed. Rejected and duplicate reports are excluded."""
    visible = [s for s in (status_filter or list(ComplaintStatus)) if s not in _PUBLIC_HIDDEN]
    is_staff = user is not None and user.role in (UserRole.ADMIN, UserRole.REPAIR_TEAM)

    filters = ComplaintFilters(
        status=visible,
        damage_type=damage_type,
        priority_level=priority_level,
        search=search,
        near=(near_lat, near_lon, radius_meters) if near_lat is not None and near_lon is not None else None,
    )
    items, total = ComplaintRepository(db).list(
        filters, page=page, page_size=page_size, sort_by=sort_by, sort_dir=sort_dir
    )
    return PaginatedResponse.build(
        [to_summary(item, precise=is_staff) for item in items], total, page, page_size
    )


@router.get(
    "/mine",
    response_model=PaginatedResponse[ComplaintSummary],
    summary="Your submitted reports",
)
def my_complaints(
    page: int = Query(1, ge=1),
    page_size: int = Query(20, ge=1, le=100),
    status_filter: list[ComplaintStatus] | None = Query(None, alias="status"),
    sort_by: str = Query("created_at"),
    sort_dir: str = Query("desc", pattern="^(asc|desc)$"),
    user: User = Depends(get_current_user),
    db: Session = Depends(get_session),
) -> PaginatedResponse[ComplaintSummary]:
    filters = ComplaintFilters(reporter_id=user.id, status=status_filter)
    items, total = ComplaintRepository(db).list(
        filters, page=page, page_size=page_size, sort_by=sort_by, sort_dir=sort_dir
    )
    # These are all the caller's own reports, so full precision is fine here.
    return PaginatedResponse.build(
        [to_summary(item, precise=True) for item in items], total, page, page_size
    )


@router.get("/{complaint_id}", response_model=ComplaintDetail, summary="Report detail")
def get_complaint(
    complaint_id: uuid.UUID,
    user: User | None = Depends(get_optional_user),
    db: Session = Depends(get_session),
) -> ComplaintDetail:
    complaint = ComplaintRepository(db).get(complaint_id, full=True)
    if complaint is None:
        raise NotFoundError("That report could not be found.")

    is_owner = user is not None and complaint.reporter_id == user.id
    is_staff = user is not None and user.role in (UserRole.ADMIN, UserRole.REPAIR_TEAM)

    # Rejected and duplicate reports stay visible to their author and to staff,
    # but are not part of the public feed.
    if complaint.status in _PUBLIC_HIDDEN and not (is_owner or is_staff):
        raise NotFoundError("That report could not be found.")

    return to_detail(complaint, include_reporter=is_owner or is_staff, precise=is_owner or is_staff)


@router.get(
    "/{complaint_id}/priority",
    response_model=PriorityAssessmentResponse,
    summary="Explainable priority breakdown",
)
def get_priority(
    complaint_id: uuid.UUID,
    db: Session = Depends(get_session),
) -> PriorityAssessmentResponse:
    complaint = ComplaintRepository(db).get(complaint_id, full=True)
    if complaint is None:
        raise NotFoundError("That report could not be found.")

    response = to_priority_response(complaint)
    if response is None:
        raise NotFoundError("This report has not been scored yet.")
    return response


@router.post(
    "/{complaint_id}/analyze",
    response_model=ComplaintDetail,
    summary="Re-run AI analysis and re-score",
)
async def reanalyze(
    complaint_id: uuid.UUID,
    _: None = Depends(write_rate_limit),
    user: User = Depends(get_current_user),
    db: Session = Depends(get_session),
) -> ComplaintDetail:
    """Available to the report's author (e.g. after an AI outage) and to admins."""
    repository = ComplaintRepository(db)
    complaint = repository.get(complaint_id, full=True)
    if complaint is None:
        raise NotFoundError("That report could not be found.")

    if user.role != UserRole.ADMIN and complaint.reporter_id != user.id:
        raise PermissionDeniedError("You can only re-analyse your own reports.")

    if complaint.status in CLOSED_STATUSES and user.role != UserRole.ADMIN:
        raise ValidationError("This report is closed and cannot be re-analysed.")

    complaint = await ComplaintService(db).reassess(complaint, actor=user)
    return to_detail(repository.get(complaint.id, full=True), include_reporter=True, precise=True)


def _next_step(complaint, needs_manual_review: bool) -> str:
    if needs_manual_review:
        return (
            "A municipal reviewer will confirm the damage type manually. You can track progress "
            "from My Reports."
        )
    if complaint.priority_level == PriorityLevel.CRITICAL:
        return (
            "This report is queued as critical and will be reviewed by the works department as a "
            "priority. You will be notified when a repair team is assigned."
        )
    return (
        "Your report is in the prioritisation queue. You will be notified when a repair team is "
        "assigned."
    )
