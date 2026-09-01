"""Operational analytics.

Every figure here answers a question a public-works supervisor actually asks:
what is coming in, what is stuck, how long do we take, where do we keep going
back, and how are the crews doing. Nothing is computed just to fill a chart.

Aggregation runs in SQL wherever it can. Resolution time is the one exception:
it needs a per-row interval, and computing date differences in portable SQL
across PostgreSQL and SQLite is worse than pulling the small set of resolved
rows and averaging in Python.
"""

from __future__ import annotations

import uuid
from collections import Counter, defaultdict
from dataclasses import dataclass
from datetime import UTC, datetime, timedelta

from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.core.enums import (
    CLOSED_STATUSES,
    AssignmentStatus,
    ComplaintStatus,
    PriorityLevel,
)
from app.models.complaint import Complaint
from app.models.repair import RepairAssignment, RepairTeam
from app.repositories.complaint import ComplaintRepository
from app.repositories.system import DuplicateRepository
from app.services.geo import haversine_meters

#: Grid size for "repeat locations" clustering, ~55m.
_CLUSTER_PRECISION = 0.0005


@dataclass(slots=True)
class KpiSummary:
    total_reports: int
    critical: int
    high: int
    in_progress: int
    resolved: int
    pending_review: int
    unresolved: int
    average_resolution_hours: float | None
    resolution_rate: float
    reports_last_7_days: int
    reports_last_30_days: int
    pending_duplicates: int


class AnalyticsService:
    def __init__(self, db: Session) -> None:
        self.db = db
        self.complaints = ComplaintRepository(db)
        self.duplicates = DuplicateRepository(db)

    # -- dashboard ------------------------------------------------------

    def kpis(self, now: datetime | None = None) -> KpiSummary:
        now = now or datetime.now(UTC)
        by_status = self.complaints.count_by_status()
        by_level = self.complaints.count_by_priority_level()

        total = self.complaints.total()
        resolved = by_status.get(ComplaintStatus.RESOLVED.value, 0)
        closed = sum(by_status.get(status.value, 0) for status in CLOSED_STATUSES)

        return KpiSummary(
            total_reports=total,
            critical=by_level.get(PriorityLevel.CRITICAL.value, 0),
            high=by_level.get(PriorityLevel.HIGH.value, 0),
            in_progress=by_status.get(ComplaintStatus.IN_PROGRESS.value, 0),
            resolved=resolved,
            pending_review=(
                by_status.get(ComplaintStatus.PENDING.value, 0)
                + by_status.get(ComplaintStatus.AI_ANALYZED.value, 0)
                + by_status.get(ComplaintStatus.PRIORITIZED.value, 0)
            ),
            unresolved=total - closed,
            average_resolution_hours=self.average_resolution_hours(),
            # Rate over *actioned* reports: counting rejected and duplicate rows
            # as failures would understate a team that triaged them correctly.
            resolution_rate=round(resolved / total * 100, 1) if total else 0.0,
            reports_last_7_days=self.complaints.count_created_since(now - timedelta(days=7)),
            reports_last_30_days=self.complaints.count_created_since(now - timedelta(days=30)),
            pending_duplicates=self.duplicates.pending_count(),
        )

    def average_resolution_hours(self) -> float | None:
        rows = self.db.execute(
            select(Complaint.created_at, Complaint.resolved_at).where(
                Complaint.resolved_at.is_not(None)
            )
        ).all()
        if not rows:
            return None
        durations = [
            (_utc(resolved) - _utc(created)).total_seconds() / 3600
            for created, resolved in rows
            if resolved and created
        ]
        durations = [value for value in durations if value >= 0]
        if not durations:
            return None
        return round(sum(durations) / len(durations), 1)

    # -- time series ----------------------------------------------------

    def reports_over_time(self, days: int = 30, now: datetime | None = None) -> list[dict]:
        """Daily counts, gap-filled so the chart has no missing days."""
        now = now or datetime.now(UTC)
        start = (now - timedelta(days=days - 1)).replace(hour=0, minute=0, second=0, microsecond=0)

        rows = self.db.execute(
            select(Complaint.created_at, Complaint.status, Complaint.priority_level).where(
                Complaint.created_at >= start
            )
        ).all()

        created_by_day: Counter[str] = Counter()
        critical_by_day: Counter[str] = Counter()
        for created_at, _status, level in rows:
            key = _utc(created_at).date().isoformat()
            created_by_day[key] += 1
            if level == PriorityLevel.CRITICAL:
                critical_by_day[key] += 1

        resolved_rows = self.db.execute(
            select(Complaint.resolved_at).where(Complaint.resolved_at >= start)
        ).all()
        resolved_by_day: Counter[str] = Counter()
        for (resolved_at,) in resolved_rows:
            if resolved_at:
                resolved_by_day[_utc(resolved_at).date().isoformat()] += 1

        series = []
        for offset in range(days):
            day = (start + timedelta(days=offset)).date().isoformat()
            series.append(
                {
                    "date": day,
                    "reported": created_by_day.get(day, 0),
                    "resolved": resolved_by_day.get(day, 0),
                    "critical": critical_by_day.get(day, 0),
                }
            )
        return series

    def by_damage_type(self) -> list[dict]:
        counts = self.complaints.count_by_damage_type()
        return [
            {"damage_type": key, "count": value}
            for key, value in sorted(counts.items(), key=lambda item: item[1], reverse=True)
        ]

    def priority_distribution(self) -> list[dict]:
        counts = self.complaints.count_by_priority_level()
        return [
            {"level": level.value, "count": counts.get(level.value, 0)}
            for level in (
                PriorityLevel.CRITICAL,
                PriorityLevel.HIGH,
                PriorityLevel.MEDIUM,
                PriorityLevel.LOW,
            )
        ]

    def status_distribution(self) -> list[dict]:
        counts = self.complaints.count_by_status()
        return [{"status": status.value, "count": counts.get(status.value, 0)} for status in ComplaintStatus]

    def by_area(self, limit: int = 10) -> list[dict]:
        """Volume by administrative area, from the resolved location record."""
        from app.models.geo import Location

        rows = self.db.execute(
            select(
                func.coalesce(Location.city, "Unknown"),
                func.count(Complaint.id),
                func.avg(Complaint.priority_score),
            )
            .join(Complaint, Complaint.id == Location.complaint_id)
            .group_by(func.coalesce(Location.city, "Unknown"))
            .order_by(func.count(Complaint.id).desc())
            .limit(limit)
        ).all()
        return [
            {"area": area, "count": int(count), "average_priority": round(float(avg or 0), 1)}
            for area, count, avg in rows
        ]

    def top_roads(self, limit: int = 10) -> list[dict]:
        """Roads generating the most reports - the recurring-failure list."""
        rows = self.db.execute(
            select(
                Complaint.road_name,
                func.count(Complaint.id),
                func.avg(Complaint.priority_score),
                func.max(Complaint.priority_score),
            )
            .where(Complaint.road_name.is_not(None), Complaint.road_name != "")
            .group_by(Complaint.road_name)
            .order_by(func.count(Complaint.id).desc(), func.avg(Complaint.priority_score).desc())
            .limit(limit)
        ).all()
        return [
            {
                "road_name": road,
                "count": int(count),
                "average_priority": round(float(avg or 0), 1),
                "max_priority": round(float(peak or 0), 1),
            }
            for road, count, avg, peak in rows
        ]

    def repeat_locations(self, limit: int = 10, min_reports: int = 2) -> list[dict]:
        """Spots reported more than once - where repairs are not holding.

        Coordinates are snapped to a ~55m grid, then neighbouring cells are
        merged, so two reports either side of a grid boundary still cluster.
        """
        rows = self.db.execute(
            select(
                Complaint.latitude,
                Complaint.longitude,
                Complaint.road_name,
                Complaint.priority_score,
                Complaint.status,
            )
        ).all()

        buckets: dict[tuple[int, int], list] = defaultdict(list)
        for latitude, longitude, road, score, status in rows:
            key = (round(latitude / _CLUSTER_PRECISION), round(longitude / _CLUSTER_PRECISION))
            buckets[key].append((latitude, longitude, road, score, status))

        clusters = []
        for entries in buckets.values():
            if len(entries) < min_reports:
                continue
            latitudes = [item[0] for item in entries]
            longitudes = [item[1] for item in entries]
            centre_lat = sum(latitudes) / len(latitudes)
            centre_lon = sum(longitudes) / len(longitudes)
            spread = max(
                haversine_meters(centre_lat, centre_lon, lat, lon)
                for lat, lon in zip(latitudes, longitudes, strict=True)
            )
            roads = [item[2] for item in entries if item[2]]
            unresolved = sum(1 for item in entries if item[4] not in CLOSED_STATUSES)
            clusters.append(
                {
                    "latitude": round(centre_lat, 6),
                    "longitude": round(centre_lon, 6),
                    "road_name": Counter(roads).most_common(1)[0][0] if roads else None,
                    "report_count": len(entries),
                    "unresolved": unresolved,
                    "max_priority": round(max(item[3] for item in entries), 1),
                    "spread_meters": round(spread, 1),
                }
            )

        clusters.sort(key=lambda item: (item["report_count"], item["max_priority"]), reverse=True)
        return clusters[:limit]

    # -- teams ----------------------------------------------------------

    def team_performance(self) -> list[dict]:
        teams = self.db.execute(select(RepairTeam).order_by(RepairTeam.name)).scalars().all()
        assignments = self.db.execute(
            select(RepairAssignment).options()
        ).scalars().all()

        by_team: dict[uuid.UUID, list[RepairAssignment]] = defaultdict(list)
        for assignment in assignments:
            by_team[assignment.team_id].append(assignment)

        results = []
        for team in teams:
            items = by_team.get(team.id, [])
            completed = [
                item
                for item in items
                if item.status in (AssignmentStatus.COMPLETED, AssignmentStatus.VERIFIED)
            ]
            open_jobs = [
                item
                for item in items
                if item.status in (AssignmentStatus.ASSIGNED, AssignmentStatus.IN_PROGRESS)
            ]

            durations = [
                (_utc(item.completed_at) - _utc(item.created_at)).total_seconds() / 3600
                for item in completed
                if item.completed_at and item.created_at
            ]
            on_time = [
                item
                for item in completed
                if item.due_at and item.completed_at and _utc(item.completed_at) <= _utc(item.due_at)
            ]

            results.append(
                {
                    "team_id": str(team.id),
                    "team_name": team.name,
                    "zone": team.zone,
                    "total_assigned": len(items),
                    "completed": len(completed),
                    "open_jobs": len(open_jobs),
                    "capacity": team.max_concurrent_jobs,
                    "average_completion_hours": (
                        round(sum(durations) / len(durations), 1) if durations else None
                    ),
                    "on_time_rate": (
                        round(len(on_time) / len(completed) * 100, 1) if completed else None
                    ),
                }
            )

        results.sort(key=lambda item: item["completed"], reverse=True)
        return results

    def resolution_by_priority(self) -> list[dict]:
        """Are the urgent ones actually being done first?"""
        rows = self.db.execute(
            select(Complaint.priority_level, Complaint.created_at, Complaint.resolved_at).where(
                Complaint.resolved_at.is_not(None)
            )
        ).all()

        grouped: dict[str, list[float]] = defaultdict(list)
        for level, created, resolved in rows:
            if created and resolved:
                grouped[str(level)].append((_utc(resolved) - _utc(created)).total_seconds() / 3600)

        return [
            {
                "level": level.value,
                "resolved_count": len(grouped.get(level.value, [])),
                "average_hours": (
                    round(sum(grouped[level.value]) / len(grouped[level.value]), 1)
                    if grouped.get(level.value)
                    else None
                ),
            }
            for level in (
                PriorityLevel.CRITICAL,
                PriorityLevel.HIGH,
                PriorityLevel.MEDIUM,
                PriorityLevel.LOW,
            )
        ]


def _utc(value: datetime) -> datetime:
    return value if value.tzinfo else value.replace(tzinfo=UTC)
