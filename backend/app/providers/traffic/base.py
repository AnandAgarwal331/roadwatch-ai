"""Traffic provider contract."""

from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime
from typing import Protocol, runtime_checkable

from app.core.enums import TrafficLevel


@dataclass(slots=True)
class TrafficReading:
    level: TrafficLevel
    #: 0-10, the normalised value the priority engine consumes.
    score: float
    estimated_vehicles_per_hour: int | None
    observed_at: datetime
    provider: str


#: Canonical mapping from a qualitative level to the 0-10 factor.
LEVEL_SCORES: dict[TrafficLevel, float] = {
    TrafficLevel.LOW: 3.0,
    TrafficLevel.MEDIUM: 6.0,
    TrafficLevel.HIGH: 9.0,
    TrafficLevel.VERY_HIGH: 10.0,
}


@runtime_checkable
class TrafficProvider(Protocol):
    name: str

    async def get_traffic(self, latitude: float, longitude: float, at: datetime) -> TrafficReading:
        ...
