"""Development traffic provider.

Deterministic in location and time: the same coordinates always sit on the same
underlying corridor, and that corridor busies up during morning and evening
peaks and quietens overnight. Deterministic output keeps the priority engine's
tests meaningful, and the time-of-day curve keeps demo data believable.

Replace with a real feed by setting ``TRAFFIC_PROVIDER=http``.
"""

from __future__ import annotations

import hashlib
from datetime import datetime

from app.core.enums import TrafficLevel
from app.providers.traffic.base import LEVEL_SCORES, TrafficReading

#: ~110m cells - fine enough that neighbouring streets differ, coarse enough
#: that two reports of the same pothole agree.
_GRID = 0.001


def _corridor_weight(latitude: float, longitude: float) -> float:
    """A stable 0-1 'how arterial is this cell' value."""
    cell = f"{round(latitude / _GRID)}:{round(longitude / _GRID)}"
    digest = hashlib.sha256(cell.encode("utf-8")).digest()
    return int.from_bytes(digest[:4], "big") / 0xFFFFFFFF


def _time_multiplier(at: datetime) -> float:
    hour = at.hour
    if 8 <= hour <= 11 or 17 <= hour <= 20:
        return 1.28  # peak
    if 0 <= hour <= 5:
        return 0.55  # overnight
    if 12 <= hour <= 16:
        return 1.0
    return 0.85


class MockTrafficProvider:
    name = "mock"

    async def get_traffic(self, latitude: float, longitude: float, at: datetime) -> TrafficReading:
        base = _corridor_weight(latitude, longitude)
        intensity = min(1.0, base * _time_multiplier(at))

        if intensity < 0.30:
            level = TrafficLevel.LOW
        elif intensity < 0.58:
            level = TrafficLevel.MEDIUM
        elif intensity < 0.84:
            level = TrafficLevel.HIGH
        else:
            level = TrafficLevel.VERY_HIGH

        return TrafficReading(
            level=level,
            score=LEVEL_SCORES[level],
            estimated_vehicles_per_hour=int(200 + intensity * 2600),
            observed_at=at,
            provider=self.name,
        )
