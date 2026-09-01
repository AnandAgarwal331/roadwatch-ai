"""Selects the traffic provider from configuration."""

from __future__ import annotations

import logging
from functools import lru_cache

from app.core.config import settings
from app.providers.traffic.base import TrafficProvider
from app.providers.traffic.http import HttpTrafficProvider
from app.providers.traffic.mock import MockTrafficProvider

logger = logging.getLogger("roadwatch.traffic")


@lru_cache
def get_traffic_provider() -> TrafficProvider:
    provider = settings.TRAFFIC_PROVIDER.strip().lower()
    if provider == "http":
        return HttpTrafficProvider(settings.TRAFFIC_API_URL, settings.TRAFFIC_API_KEY)
    if provider != "mock":
        logger.warning("Unknown TRAFFIC_PROVIDER %r; using the development provider", provider)
    return MockTrafficProvider()
