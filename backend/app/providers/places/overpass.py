"""Nearby places from OpenStreetMap via the Overpass API.

Enabled with ``PLACES_PROVIDER=overpass``. Kept off by default: the public
Overpass endpoint rate-limits aggressively and would make report submission
depend on a third party. On any failure this falls back to the seeded
catalogue, so scoring still completes.
"""

from __future__ import annotations

import logging

import httpx
from sqlalchemy.orm import Session

from app.core.enums import PlaceType
from app.providers.places.base import NearbyPlaceResult
from app.providers.places.seeded import SeededPlacesProvider
from app.services.geo import haversine_meters

logger = logging.getLogger("roadwatch.places")

#: OSM tag -> our facility taxonomy.
_TAG_MAP: list[tuple[str, str, PlaceType]] = [
    ("amenity", "hospital", PlaceType.HOSPITAL),
    ("amenity", "clinic", PlaceType.HOSPITAL),
    ("amenity", "school", PlaceType.SCHOOL),
    ("amenity", "college", PlaceType.SCHOOL),
    ("amenity", "fire_station", PlaceType.EMERGENCY_SERVICE),
    ("amenity", "police", PlaceType.EMERGENCY_SERVICE),
    ("highway", "bus_stop", PlaceType.BUS_STOP),
]


class OverpassPlacesProvider:
    name = "overpass"

    def __init__(self, db: Session, api_url: str, timeout_seconds: float = 8.0) -> None:
        self.db = db
        self.api_url = api_url
        self.timeout_seconds = timeout_seconds
        self._fallback = SeededPlacesProvider(db)

    def find_nearby(
        self, latitude: float, longitude: float, radius_meters: int
    ) -> list[NearbyPlaceResult]:
        try:
            payload = self._query(latitude, longitude, radius_meters)
        except (httpx.HTTPError, ValueError) as exc:
            logger.warning("Overpass unavailable (%s); using the seeded catalogue", exc)
            return self._fallback.find_nearby(latitude, longitude, radius_meters)

        results: list[NearbyPlaceResult] = []
        for element in payload.get("elements", []):
            tags = element.get("tags", {})
            place_type = _classify(tags)
            if place_type is None:
                continue
            lat = element.get("lat") or element.get("center", {}).get("lat")
            lon = element.get("lon") or element.get("center", {}).get("lon")
            if lat is None or lon is None:
                continue
            distance = haversine_meters(latitude, longitude, float(lat), float(lon))
            if distance > radius_meters:
                continue
            results.append(
                NearbyPlaceResult(
                    place_type=place_type,
                    name=tags.get("name") or place_type.value.replace("_", " ").title(),
                    latitude=float(lat),
                    longitude=float(lon),
                    distance_meters=round(distance, 1),
                    source=self.name,
                )
            )

        results.sort(key=lambda item: item.distance_meters)
        return results

    def _query(self, latitude: float, longitude: float, radius_meters: int) -> dict:
        clauses = "".join(
            f'node(around:{radius_meters},{latitude},{longitude})["{key}"="{value}"];'
            for key, value, _ in _TAG_MAP
        )
        query = f"[out:json][timeout:{int(self.timeout_seconds)}];({clauses});out center;"
        with httpx.Client(timeout=self.timeout_seconds) as client:
            response = client.post(self.api_url, data={"data": query})
            response.raise_for_status()
            return response.json()


def _classify(tags: dict) -> PlaceType | None:
    for key, value, place_type in _TAG_MAP:
        if tags.get(key) == value:
            return place_type
    return None
