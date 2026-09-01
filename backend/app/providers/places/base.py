"""Nearby-places provider contract."""

from __future__ import annotations

from dataclasses import dataclass
from typing import Protocol, runtime_checkable

from app.core.enums import PlaceType


@dataclass(slots=True)
class NearbyPlaceResult:
    place_type: PlaceType
    name: str
    latitude: float
    longitude: float
    distance_meters: float
    source: str


@runtime_checkable
class NearbyPlacesProvider(Protocol):
    name: str

    def find_nearby(
        self, latitude: float, longitude: float, radius_meters: int
    ) -> list[NearbyPlaceResult]:
        """Facilities within ``radius_meters``, nearest first."""
        ...
