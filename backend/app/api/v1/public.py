"""Public, unauthenticated endpoints.

Only aggregate counts that are safe to show anyone - no per-report detail, no
reporter identities. Kept separate from the admin analytics so the two cannot be
confused for one another.
"""

from __future__ import annotations

from fastapi import APIRouter, Depends
from pydantic import BaseModel
from sqlalchemy.orm import Session

from app.api.deps import get_session
from app.services.analytics import AnalyticsService

router = APIRouter(prefix="/stats", tags=["public"])


class PublicStats(BaseModel):
    total_reports: int
    resolved: int
    unresolved: int
    resolution_rate: float
    reports_last_7_days: int
    average_resolution_hours: float | None = None


@router.get("/public", response_model=PublicStats, summary="Public service statistics")
def public_stats(db: Session = Depends(get_session)) -> PublicStats:
    kpis = AnalyticsService(db).kpis()
    return PublicStats(
        total_reports=kpis.total_reports,
        resolved=kpis.resolved,
        unresolved=kpis.unresolved,
        resolution_rate=kpis.resolution_rate,
        reports_last_7_days=kpis.reports_last_7_days,
        average_resolution_hours=kpis.average_resolution_hours,
    )
