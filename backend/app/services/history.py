"""Complaint history analysis.

Answers: "has this spot been reported before, how recently, and did anyone fix
it?" - and turns that into the 0-10 history factor.

The weighting encodes two judgements a municipal operator would recognise:

* **recency matters** - a report from three days ago says more about the road's
  current state than one from last year;
* **unresolved matters more than resolved** - a location that keeps being
  reported and never fixed is exactly what a prioritisation system should
  surface, whereas a cluster of already-repaired reports is history, not
  backlog.
"""

from __future__ import annotations

from dataclasses import dataclass
from datetime import UTC, datetime, timedelta

from app.core.config import settings
from app.core.enums import CLOSED_STATUSES, ComplaintStatus
from app.repositories.complaint import ComplaintRepository

#: Age band -> weight. Checked in order.
AGE_WEIGHTS: tuple[tuple[int, float], ...] = (
    (7, 1.6),
    (30, 1.0),
    (90, 0.5),
    (365, 0.25),
)
OLDER_WEIGHT = 0.1

#: Applied on top of the age weight.
UNRESOLVED_MULTIPLIER = 1.5
RESOLVED_MULTIPLIER = 0.5


@dataclass(slots=True)
class HistoryResult:
    score: float
    total_previous: int
    last_7_days: int
    last_30_days: int
    unresolved: int
    resolved: int
    radius_meters: int
    explanation: str

    def as_signals(self) -> dict[str, float | int]:
        return {
            "total_previous": self.total_previous,
            "last_7_days": self.last_7_days,
            "last_30_days": self.last_30_days,
            "unresolved": self.unresolved,
            "resolved": self.resolved,
            "radius_meters": self.radius_meters,
        }


class ComplaintHistoryService:
    def __init__(self, repository: ComplaintRepository, radius_meters: int | None = None) -> None:
        self.repository = repository
        self.radius_meters = radius_meters or settings.HISTORY_RADIUS_METERS

    def analyse(
        self,
        latitude: float,
        longitude: float,
        *,
        exclude_id=None,
        now: datetime | None = None,
    ) -> HistoryResult:
        now = now or datetime.now(UTC)
        neighbours = self.repository.find_nearby(
            latitude, longitude, self.radius_meters, exclude_id=exclude_id
        )

        weighted = 0.0
        last_7 = last_30 = unresolved = resolved = 0

        for item in neighbours:
            complaint = item.complaint
            age_days = max(0.0, (now - _as_utc(complaint.created_at)).total_seconds() / 86400)

            if age_days <= 7:
                last_7 += 1
            if age_days <= 30:
                last_30 += 1

            is_open = complaint.status not in CLOSED_STATUSES
            if is_open:
                unresolved += 1
            elif complaint.status == ComplaintStatus.RESOLVED:
                resolved += 1

            weighted += _age_weight(age_days) * (
                UNRESOLVED_MULTIPLIER if is_open else RESOLVED_MULTIPLIER
            )

        score = round(min(10.0, weighted), 2)

        return HistoryResult(
            score=score,
            total_previous=len(neighbours),
            last_7_days=last_7,
            last_30_days=last_30,
            unresolved=unresolved,
            resolved=resolved,
            radius_meters=self.radius_meters,
            explanation=self._explain(len(neighbours), last_7, unresolved),
        )

    def _explain(self, total: int, last_7: int, unresolved: int) -> str:
        if total == 0:
            return f"No previous reports within {self.radius_meters}m of this location."

        text = (
            f"{total} previous report{'s' if total != 1 else ''} within "
            f"{self.radius_meters}m of this spot"
        )
        if last_7:
            text += f", {last_7} in the last 7 days"
        if unresolved:
            text += f", and {unresolved} still unresolved"
        return text + "."


def _age_weight(age_days: float) -> float:
    for max_days, weight in AGE_WEIGHTS:
        if age_days <= max_days:
            return weight
    return OLDER_WEIGHT


def _as_utc(value: datetime) -> datetime:
    """SQLite hands back naive datetimes; treat those as UTC."""
    return value if value.tzinfo else value.replace(tzinfo=UTC)


def days_ago(days: int, now: datetime | None = None) -> datetime:
    return (now or datetime.now(UTC)) - timedelta(days=days)
