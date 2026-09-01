"""Traffic provider backed by an external HTTP API.

Written against the common shape of commercial traffic APIs (a flow segment
lookup returning current vs. free-flow speed). Adapt ``_to_level`` when wiring a
specific vendor. Falls back to the development provider on any failure so
scoring never blocks on a third party.
"""

from __future__ import annotations

import logging
from datetime import datetime

import httpx

from app.core.enums import TrafficLevel
from app.providers.traffic.base import LEVEL_SCORES, TrafficReading
from app.providers.traffic.mock import MockTrafficProvider

logger = logging.getLogger("roadwatch.traffic")


class HttpTrafficProvider:
    name = "http"

    def __init__(self, api_url: str, api_key: str, timeout_seconds: float = 6.0) -> None:
        self.api_url = api_url
        self.api_key = api_key
        self.timeout_seconds = timeout_seconds
        self._fallback = MockTrafficProvider()

    async def get_traffic(self, latitude: float, longitude: float, at: datetime) -> TrafficReading:
        if not self.api_url or not self.api_key:
            logger.warning("TRAFFIC_API_URL/KEY not configured; using the development provider")
            return await self._fallback.get_traffic(latitude, longitude, at)

        params = {"point": f"{latitude},{longitude}", "key": self.api_key, "unit": "KMPH"}
        try:
            async with httpx.AsyncClient(timeout=self.timeout_seconds) as client:
                response = await client.get(self.api_url, params=params)
                response.raise_for_status()
                data = response.json()
        except (httpx.HTTPError, ValueError) as exc:
            logger.warning("Traffic API unavailable (%s); using the development provider", exc)
            return await self._fallback.get_traffic(latitude, longitude, at)

        segment = data.get("flowSegmentData", data)
        current = float(segment.get("currentSpeed") or 0)
        free_flow = float(segment.get("freeFlowSpeed") or 0)
        level = _to_level(current, free_flow)

        return TrafficReading(
            level=level,
            score=LEVEL_SCORES[level],
            estimated_vehicles_per_hour=None,
            observed_at=at,
            provider=self.name,
        )


def _to_level(current_speed: float, free_flow_speed: float) -> TrafficLevel:
    """Congestion is how far current speed has fallen below free flow."""
    if free_flow_speed <= 0:
        return TrafficLevel.MEDIUM
    ratio = max(0.0, min(1.0, current_speed / free_flow_speed))
    if ratio >= 0.85:
        return TrafficLevel.LOW
    if ratio >= 0.60:
        return TrafficLevel.MEDIUM
    if ratio >= 0.35:
        return TrafficLevel.HIGH
    return TrafficLevel.VERY_HIGH
