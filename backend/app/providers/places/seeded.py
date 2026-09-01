"""Nearby places from the seeded facility catalogue.

Backed by the ``seeded_places`` table, which the seed script fills with a
plausible set of hospitals, schools, bus stops, intersections and emergency
services. This is real data flow through the real database - only the *source*
of the catalogue is local rather than a live map API.
"""

from __future__ import annotations

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.models.geo import SeededPlace
from app.providers.places.base import NearbyPlaceResult
from app.services.geo import haversine_meters, within_bounding_box


class SeededPlacesProvider:
    name = "seeded"

    def __init__(self, db: Session) -> None:
        self.db = db

    def find_nearby(
        self, latitude: float, longitude: float, radius_meters: int
    ) -> list[NearbyPlaceResult]:
        stmt = select(SeededPlace).where(
            within_bounding_box(
                SeededPlace.latitude, SeededPlace.longitude, latitude, longitude, radius_meters
            )
        )
        candidates = self.db.execute(stmt).scalars().all()

        results: list[NearbyPlaceResult] = []
        for place in candidates:
            distance = haversine_meters(latitude, longitude, place.latitude, place.longitude)
            if distance <= radius_meters:
                results.append(
                    NearbyPlaceResult(
                        place_type=place.place_type,
                        name=place.name,
                        latitude=place.latitude,
                        longitude=place.longitude,
                        distance_meters=round(distance, 1),
                        source=self.name,
                    )
                )

        results.sort(key=lambda item: item.distance_meters)
        return results
