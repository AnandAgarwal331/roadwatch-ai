"""Selects the weather provider from configuration."""

from __future__ import annotations

from functools import lru_cache

from app.core.config import settings
from app.providers.weather.base import WeatherProvider
from app.providers.weather.mock import MockWeatherProvider


@lru_cache
def get_weather_provider() -> WeatherProvider | None:
    """``None`` when the weather signal is switched off."""
    if not settings.WEATHER_ENABLED:
        return None
    return MockWeatherProvider()
