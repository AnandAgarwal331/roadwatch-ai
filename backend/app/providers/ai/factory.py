"""Selects the AI provider from configuration."""

from __future__ import annotations

import logging
from functools import lru_cache

from app.core.config import settings
from app.providers.ai.base import AIAnalysisProvider
from app.providers.ai.http import HttpAIProvider
from app.providers.ai.mock import MockAIProvider

logger = logging.getLogger("roadwatch.ai")


@lru_cache
def get_ai_provider() -> AIAnalysisProvider:
    provider = settings.AI_PROVIDER.strip().lower()
    if provider == "http":
        logger.info("AI provider: http (%s)", settings.AI_SERVICE_URL)
        return HttpAIProvider(settings.AI_SERVICE_URL, settings.AI_SERVICE_TIMEOUT_SECONDS)
    if provider != "mock":
        logger.warning("Unknown AI_PROVIDER %r; falling back to the development stub", provider)
    logger.info("AI provider: development stub (not a trained model)")
    return MockAIProvider()
