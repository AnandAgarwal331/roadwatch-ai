"""Geospatial primitives.

Proximity queries run in two steps:

1. a **bounding-box prefilter** in SQL, which uses the ``(latitude, longitude)``
   index and cheaply discards almost everything;
2. an exact **haversine** refinement in Python over the small candidate set.

This is deliberately portable - it needs no PostGIS, no trigonometric SQL
functions, and behaves identically on PostgreSQL and SQLite. For city-scale
radii (tens to hundreds of metres) the candidate set is tiny, so the cost is
dominated by the indexed range scan. ``docs/DATABASE.md`` describes how to move
to a PostGIS ``geography`` column when the dataset outgrows this.
"""

from __future__ import annotations

import math
from dataclasses import dataclass

from sqlalchemy import ColumnElement, and_

EARTH_RADIUS_M = 6_371_000.0
#: One degree of latitude is ~111.32 km everywhere.
METERS_PER_DEGREE_LAT = 111_320.0


@dataclass(frozen=True, slots=True)
class BoundingBox:
    min_lat: float
    max_lat: float
    min_lon: float
    max_lon: float


def haversine_meters(lat1: float, lon1: float, lat2: float, lon2: float) -> float:
    """Great-circle distance between two WGS84 points, in metres."""
    phi1, phi2 = math.radians(lat1), math.radians(lat2)
    d_phi = phi2 - phi1
    d_lambda = math.radians(lon2 - lon1)

    a = math.sin(d_phi / 2) ** 2 + math.cos(phi1) * math.cos(phi2) * math.sin(d_lambda / 2) ** 2
    return 2 * EARTH_RADIUS_M * math.asin(math.sqrt(min(1.0, a)))


def bounding_box(latitude: float, longitude: float, radius_meters: float) -> BoundingBox:
    """Smallest lat/lon rectangle containing the circle of ``radius_meters``.

    Longitude degrees shrink with latitude, hence the ``cos(lat)`` term. Near the
    poles that term collapses, so it is floored to keep the box finite.
    """
    lat_delta = radius_meters / METERS_PER_DEGREE_LAT
    cos_lat = max(0.01, math.cos(math.radians(latitude)))
    lon_delta = radius_meters / (METERS_PER_DEGREE_LAT * cos_lat)

    return BoundingBox(
        min_lat=max(-90.0, latitude - lat_delta),
        max_lat=min(90.0, latitude + lat_delta),
        min_lon=max(-180.0, longitude - lon_delta),
        max_lon=min(180.0, longitude + lon_delta),
    )


def within_bounding_box(
    lat_column: ColumnElement[float],
    lon_column: ColumnElement[float],
    latitude: float,
    longitude: float,
    radius_meters: float,
) -> ColumnElement[bool]:
    """SQL predicate for the index-friendly prefilter."""
    box = bounding_box(latitude, longitude, radius_meters)
    return and_(
        lat_column >= box.min_lat,
        lat_column <= box.max_lat,
        lon_column >= box.min_lon,
        lon_column <= box.max_lon,
    )


def is_valid_coordinate(latitude: float, longitude: float) -> bool:
    return -90.0 <= latitude <= 90.0 and -180.0 <= longitude <= 180.0
