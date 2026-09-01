"""Development weather provider.

Deterministic in location and date, with a monsoon-shaped seasonal curve so that
enabling the weather signal produces believable behaviour without a paid API key.
"""

from __future__ import annotations

import hashlib
from datetime import datetime

from app.providers.weather.base import WeatherReading

#: Rough monthly wet-season weighting (index 0 = January).
_MONTH_WETNESS = [0.05, 0.05, 0.08, 0.12, 0.25, 0.75, 0.95, 0.90, 0.70, 0.35, 0.15, 0.08]


class MockWeatherProvider:
    name = "mock"

    async def get_weather(self, latitude: float, longitude: float, at: datetime) -> WeatherReading:
        key = f"{round(latitude, 2)}:{round(longitude, 2)}:{at.date().isoformat()}"
        digest = hashlib.sha256(key.encode("utf-8")).digest()
        roll = int.from_bytes(digest[:4], "big") / 0xFFFFFFFF

        wetness = _MONTH_WETNESS[at.month - 1]
        rainfall = round(roll * wetness * 85.0, 1)

        if rainfall >= 40:
            condition = "heavy_rain"
        elif rainfall >= 10:
            condition = "rain"
        elif rainfall > 0.5:
            condition = "light_rain"
        else:
            condition = "clear"

        temperature = round(22.0 + (1 - wetness) * 12.0 + (roll - 0.5) * 4, 1)

        return WeatherReading(
            condition=condition,
            rainfall_mm_24h=rainfall,
            temperature_c=temperature,
            observed_at=at,
            provider=self.name,
        )
