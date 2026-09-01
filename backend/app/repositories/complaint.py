"""Data access for complaints.

Every query the API can reach lives here; services compose repositories rather
than writing SQL of their own. All user input reaches the database as bound
parameters through the ORM - there is no string-built SQL anywhere in the
project.
"""

from __future__ import annotations

import uuid
from collections.abc import Sequence
from dataclasses import dataclass
from datetime import datetime

from sqlalchemy import Select, func, select
from sqlalchemy.orm import Session, selectinload

from app.core.enums import ComplaintStatus, DamageType, PriorityLevel
from app.models.complaint import Complaint, ComplaintImage, ComplaintStatusHistory
from app.services.geo import haversine_meters, within_bounding_box

#: Sortable columns, whitelisted so a caller can never inject an ordering.
SORTABLE_FIELDS = {
    "priority_score": Complaint.priority_score,
    "created_at": Complaint.created_at,
    "updated_at": Complaint.updated_at,
    "severity_score": Complaint.severity_score,
    "report_count": Complaint.report_count,
    "status": Complaint.status,
    "complaint_number": Complaint.complaint_number,
}


@dataclass(slots=True)
class ComplaintFilters:
    status: list[ComplaintStatus] | None = None
    damage_type: list[DamageType] | None = None
    priority_level: list[PriorityLevel] | None = None
    reporter_id: uuid.UUID | None = None
    team_id: uuid.UUID | None = None
    search: str | None = None
    created_from: datetime | None = None
    created_to: datetime | None = None
    min_priority: float | None = None
    max_priority: float | None = None
    #: Geographic window, e.g. the current map viewport.
    bbox: tuple[float, float, float, float] | None = None
    near: tuple[float, float, float] | None = None
    exclude_closed: bool = False


@dataclass(slots=True)
class NearbyComplaint:
    complaint: Complaint
    distance_meters: float


class ComplaintRepository:
    def __init__(self, db: Session) -> None:
        self.db = db

    # -- reads ----------------------------------------------------------

    def get(self, complaint_id: uuid.UUID, *, full: bool = False) -> Complaint | None:
        stmt = select(Complaint).where(Complaint.id == complaint_id)
        if full:
            stmt = stmt.options(*self._detail_options())
        return self.db.execute(stmt).scalars().first()

    def get_by_number(self, number: str, *, full: bool = False) -> Complaint | None:
        stmt = select(Complaint).where(Complaint.complaint_number == number)
        if full:
            stmt = stmt.options(*self._detail_options())
        return self.db.execute(stmt).scalars().first()

    def list(
        self,
        filters: ComplaintFilters,
        *,
        page: int = 1,
        page_size: int = 20,
        sort_by: str = "priority_score",
        sort_dir: str = "desc",
    ) -> tuple[list[Complaint], int]:
        """Return one page plus the total count matching ``filters``."""
        base = self._apply_filters(select(Complaint), filters)

        count_stmt = self._apply_filters(select(func.count(Complaint.id)), filters)
        total = int(self.db.execute(count_stmt).scalar_one())

        column = SORTABLE_FIELDS.get(sort_by, Complaint.priority_score)
        ordering = column.desc() if sort_dir.lower() == "desc" else column.asc()

        stmt = (
            base.options(
                selectinload(Complaint.images),
                selectinload(Complaint.location),
                selectinload(Complaint.assignments),
            )
            # A stable secondary key keeps pagination deterministic when many
            # complaints share a score.
            .order_by(ordering, Complaint.created_at.desc(), Complaint.id)
            .offset(max(0, (page - 1)) * page_size)
            .limit(page_size)
        )
        rows = list(self.db.execute(stmt).scalars().unique().all())

        if filters.near:
            latitude, longitude, _ = filters.near
            rows.sort(key=lambda c: haversine_meters(latitude, longitude, c.latitude, c.longitude))

        return rows, total

    def map_points(self, filters: ComplaintFilters, limit: int = 2000) -> Sequence[Complaint]:
        """Lightweight projection for the map: no image or history eager-loading."""
        stmt = self._apply_filters(select(Complaint), filters)
        stmt = stmt.order_by(Complaint.priority_score.desc()).limit(limit)
        return list(self.db.execute(stmt).scalars().all())

    def find_nearby(
        self,
        latitude: float,
        longitude: float,
        radius_meters: float,
        *,
        exclude_id: uuid.UUID | None = None,
        since: datetime | None = None,
        damage_type: DamageType | None = None,
        limit: int = 200,
    ) -> list[NearbyComplaint]:
        """Complaints within ``radius_meters``, nearest first.

        Bounding-box prefilter in SQL (index-friendly), exact haversine in
        Python. See :mod:`app.services.geo`.
        """
        stmt = select(Complaint).where(
            within_bounding_box(
                Complaint.latitude, Complaint.longitude, latitude, longitude, radius_meters
            )
        )
        if exclude_id is not None:
            stmt = stmt.where(Complaint.id != exclude_id)
        if since is not None:
            stmt = stmt.where(Complaint.created_at >= since)
        if damage_type is not None:
            stmt = stmt.where(Complaint.damage_type == damage_type)
        stmt = stmt.limit(limit * 4)

        results: list[NearbyComplaint] = []
        for complaint in self.db.execute(stmt).scalars().all():
            distance = haversine_meters(latitude, longitude, complaint.latitude, complaint.longitude)
            if distance <= radius_meters:
                results.append(NearbyComplaint(complaint=complaint, distance_meters=round(distance, 1)))

        results.sort(key=lambda item: item.distance_meters)
        return results[:limit]

    def count_by_status(self) -> dict[str, int]:
        rows = self.db.execute(
            select(Complaint.status, func.count(Complaint.id)).group_by(Complaint.status)
        ).all()
        return {str(status): int(count) for status, count in rows}

    def count_by_priority_level(self) -> dict[str, int]:
        rows = self.db.execute(
            select(Complaint.priority_level, func.count(Complaint.id)).group_by(Complaint.priority_level)
        ).all()
        return {str(level): int(count) for level, count in rows}

    def count_by_damage_type(self) -> dict[str, int]:
        rows = self.db.execute(
            select(Complaint.damage_type, func.count(Complaint.id)).group_by(Complaint.damage_type)
        ).all()
        return {str(damage): int(count) for damage, count in rows}

    def total(self) -> int:
        return int(self.db.execute(select(func.count(Complaint.id))).scalar_one())

    def count_created_since(self, since: datetime) -> int:
        return int(
            self.db.execute(
                select(func.count(Complaint.id)).where(Complaint.created_at >= since)
            ).scalar_one()
        )

    # -- writes ---------------------------------------------------------

    def add(self, complaint: Complaint) -> Complaint:
        self.db.add(complaint)
        self.db.flush()
        return complaint

    def add_image(self, image: ComplaintImage) -> ComplaintImage:
        self.db.add(image)
        self.db.flush()
        return image

    def record_status(
        self,
        complaint: Complaint,
        from_status: ComplaintStatus | None,
        to_status: ComplaintStatus,
        changed_by_id: uuid.UUID | None = None,
        note: str | None = None,
    ) -> ComplaintStatusHistory:
        entry = ComplaintStatusHistory(
            complaint_id=complaint.id,
            from_status=from_status,
            to_status=to_status,
            changed_by_id=changed_by_id,
            note=note,
        )
        self.db.add(entry)
        self.db.flush()
        return entry

    # -- internals ------------------------------------------------------

    def _detail_options(self) -> tuple:
        from app.models.analysis import AIAnalysis

        return (
            selectinload(Complaint.images),
            selectinload(Complaint.location),
            selectinload(Complaint.nearby_places),
            selectinload(Complaint.traffic_snapshots),
            selectinload(Complaint.status_history),
            selectinload(Complaint.assessments),
            selectinload(Complaint.analyses).selectinload(AIAnalysis.detections),
            selectinload(Complaint.assignments),
            selectinload(Complaint.reporter),
        )

    def _apply_filters(self, stmt: Select, filters: ComplaintFilters) -> Select:
        from app.core.enums import CLOSED_STATUSES
        from app.models.repair import RepairAssignment

        # ``is not None`` rather than truthiness: an *empty* allow-list means
        # "nothing is visible", and must not silently degrade to "no filter".
        if filters.status is not None:
            stmt = stmt.where(Complaint.status.in_(filters.status))
        if filters.damage_type is not None:
            stmt = stmt.where(Complaint.damage_type.in_(filters.damage_type))
        if filters.priority_level is not None:
            stmt = stmt.where(Complaint.priority_level.in_(filters.priority_level))
        if filters.reporter_id:
            stmt = stmt.where(Complaint.reporter_id == filters.reporter_id)
        if filters.exclude_closed:
            stmt = stmt.where(Complaint.status.notin_(list(CLOSED_STATUSES)))
        if filters.created_from:
            stmt = stmt.where(Complaint.created_at >= filters.created_from)
        if filters.created_to:
            stmt = stmt.where(Complaint.created_at <= filters.created_to)
        if filters.min_priority is not None:
            stmt = stmt.where(Complaint.priority_score >= filters.min_priority)
        if filters.max_priority is not None:
            stmt = stmt.where(Complaint.priority_score <= filters.max_priority)

        if filters.team_id:
            stmt = stmt.where(
                Complaint.id.in_(
                    select(RepairAssignment.complaint_id).where(
                        RepairAssignment.team_id == filters.team_id
                    )
                )
            )

        if filters.search:
            # Bound parameter, not interpolation - safe against injection.
            pattern = f"%{filters.search.strip().lower()}%"
            stmt = stmt.where(
                func.lower(Complaint.complaint_number).like(pattern)
                | func.lower(func.coalesce(Complaint.description, "")).like(pattern)
                | func.lower(func.coalesce(Complaint.road_name, "")).like(pattern)
            )

        if filters.bbox:
            min_lat, min_lon, max_lat, max_lon = filters.bbox
            stmt = stmt.where(
                Complaint.latitude >= min_lat,
                Complaint.latitude <= max_lat,
                Complaint.longitude >= min_lon,
                Complaint.longitude <= max_lon,
            )

        if filters.near:
            latitude, longitude, radius = filters.near
            stmt = stmt.where(
                within_bounding_box(
                    Complaint.latitude, Complaint.longitude, latitude, longitude, radius
                )
            )

        return stmt
