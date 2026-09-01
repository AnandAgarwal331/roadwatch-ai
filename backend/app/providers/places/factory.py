"""Selects the nearby-places provider from configuration.

Unlike the other factories this is not cached: the seeded provider is bound to a
request-scoped database session.
"""

from __future__ import annotations

import logging

from sqlalchemy.orm import Session

from app.core.config import settings
from app.providers.places.base import NearbyPlacesProvider
from app.providers.places.overpass import OverpassPlacesProvider
from app.providers.places.seeded import SeededPlacesProvider

logger = logging.getLogger("roadwatch.places")


def get_places_provider(db: Session) -> NearbyPlacesProvider:
    provider = settings.PLACES_PROVIDER.strip().lower()
    if provider == "overpass":
        return OverpassPlacesProvider(db, settings.PLACES_API_URL)
    if provider != "seeded":
        logger.warning("Unknown PLACES_PROVIDER %r; using the seeded catalogue", provider)
    return SeededPlacesProvider(db)
