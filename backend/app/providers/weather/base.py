"""Weather provider contract.

Weather is an *optional* escalation signal, off by default
(``WEATHER_ENABLED=false``). When enabled, sustained rain raises the urgency of
water-sensitive damage - flooding and potholes deteriorate fast once saturated -
by applying a bounded multiplier to the final priority score. It never lowers a
score, and it is recorded on the assessment so the effect stays visible.
"""

from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime
from typing import Protocol, runtime_checkable

from app.core.enums import DamageType

#: Damage classes that rain makes materially worse.
WEATHER_SENSITIVE_TYPES = {DamageType.FLOODING, DamageType.POTHOLE, DamageType.CRACKED_ROAD}

#: Hard ceiling on the escalation, so weather can never dominate the score.
MAX_WEATHER_MULTIPLIER = 1.15


@dataclass(slots=True)
class WeatherReading:
    condition: str
    rainfall_mm_24h: float
    temperature_c: float | None
    observed_at: datetime
    provider: str

    def risk_multiplier(self, damage_type: DamageType) -> float:
        """Escalation factor for ``damage_type`` given this weather."""
        if damage_type not in WEATHER_SENSITIVE_TYPES or self.rainfall_mm_24h <= 5:
            return 1.0
        # 5mm -> 1.0 scaling linearly to the ceiling at 60mm.
        ramp = min(1.0, (self.rainfall_mm_24h - 5) / 55)
        return round(1.0 + ramp * (MAX_WEATHER_MULTIPLIER - 1.0), 4)


@runtime_checkable
class WeatherProvider(Protocol):
    name: str

    async def get_weather(self, latitude: float, longitude: float, at: datetime) -> WeatherReading:
        ...
