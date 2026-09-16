"""Map data endpoints.

Kept separate from the complaint list because a map has different needs: a
viewport bounding box instead of pages, a trimmed payload, and a hard cap on
how many markers can come back at once.
"""

from __future__ import annotations

from datetime import datetime

from fastapi import APIRouter, Depends, Query
from sqlalchemy.orm import Session

from app.api.deps import get_optional_user, get_session
from app.api.serializers import to_map_issue
from app.core.enums import ComplaintStatus, DamageType, PriorityLevel, UserRole
from app.models.user import User
from app.repositories.complaint import ComplaintFilters, ComplaintRepository
from app.schemas.complaint import MapIssue

router = APIRouter(prefix="/map", tags=["map"])

#: Hidden from anonymous and citizen viewers of the public map.
_PUBLIC_HIDDEN = {ComplaintStatus.REJECTED, ComplaintStatus.DUPLICATE}


@router.get("/issues", response_model=list[MapIssue], summary="Map markers")
def map_issues(
    min_lat: float | None = Query(None, ge=-90, le=90),
    min_lon: float | None = Query(None, ge=-180, le=180),
    max_lat: float | None = Query(None, ge=-90, le=90),
    max_lon: float | None = Query(None, ge=-180, le=180),
    damage_type: list[DamageType] | None = Query(None),
    priority_level: list[PriorityLevel] | None = Query(None),
    status_filter: list[ComplaintStatus] | None = Query(None, alias="status"),
    created_from: datetime | None = Query(None),
    created_to: datetime | None = Query(None),
    exclude_closed: bool = Query(False),
    limit: int = Query(1000, ge=1, le=5000),
    user: User | None = Depends(get_optional_user),
    db: Session = Depends(get_session),
) -> list[MapIssue]:
    is_staff = user is not None and user.role in (UserRole.ADMIN, UserRole.REPAIR_TEAM)

    statuses = status_filter
    if not is_staff:
        allowed = [s for s in (status_filter or list(ComplaintStatus)) if s not in _PUBLIC_HIDDEN]
        statuses = allowed

    bbox = None
    if None not in (min_lat, min_lon, max_lat, max_lon):
        # Normalise, so a viewport dragged in either direction still works.
        bbox = (
            min(min_lat, max_lat),
            min(min_lon, max_lon),
            max(min_lat, max_lat),
            max(min_lon, max_lon),
        )

    filters = ComplaintFilters(
        status=statuses,
        damage_type=damage_type,
        priority_level=priority_level,
        created_from=created_from,
        created_to=created_to,
        exclude_closed=exclude_closed,
        bbox=bbox,
    )
    return [
        to_map_issue(item, precise=is_staff)
        for item in ComplaintRepository(db).map_points(filters, limit=limit)
    ]
