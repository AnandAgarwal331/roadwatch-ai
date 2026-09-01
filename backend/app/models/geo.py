"""Geospatial records: resolved locations, nearby facilities, environment snapshots.

Coordinates are stored as indexed ``Float`` columns and queried with a
bounding-box prefilter plus an exact haversine refinement (see
``app.services.geo``). That keeps every query portable across PostgreSQL and
SQLite. ``docs/DATABASE.md`` documents the PostGIS upgrade path.
"""

from __future__ import annotations

import uuid
from datetime import datetime
from typing import TYPE_CHECKING

from sqlalchemy import DateTime, Float, ForeignKey, Index, Integer, String
from sqlalchemy import Enum as SAEnum
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.core.enums import PlaceType, TrafficLevel
from app.db.base import Base, TimestampMixin, UUIDPrimaryKeyMixin
from app.db.types import GUID

if TYPE_CHECKING:
    from app.models.complaint import Complaint


class Location(UUIDPrimaryKeyMixin, TimestampMixin, Base):
    """Address metadata for a complaint (one-to-one).

    The authoritative coordinates for querying live on ``Complaint`` so that
    list and map endpoints never need a join; this table carries the
    human-readable context that only the detail views need.
    """

    __tablename__ = "locations"

    complaint_id: Mapped[uuid.UUID] = mapped_column(
        GUID(), ForeignKey("complaints.id", ondelete="CASCADE"), unique=True, nullable=False
    )
    latitude: Mapped[float] = mapped_column(Float, nullable=False)
    longitude: Mapped[float] = mapped_column(Float, nullable=False)
    accuracy_meters: Mapped[float | None] = mapped_column(Float)
    address: Mapped[str | None] = mapped_column(String(400))
    road_name: Mapped[str | None] = mapped_column(String(200))
    ward: Mapped[str | None] = mapped_column(String(120))
    city: Mapped[str | None] = mapped_column(String(120), index=True)
    state: Mapped[str | None] = mapped_column(String(120))
    postal_code: Mapped[str | None] = mapped_column(String(20))
    #: How important this road is, 0-10. Feeds the location risk factor.
    road_importance: Mapped[float] = mapped_column(Float, default=5.0, nullable=False)
    geocode_source: Mapped[str | None] = mapped_column(String(50))

    complaint: Mapped[Complaint] = relationship(back_populates="location")


class NearbyPlace(UUIDPrimaryKeyMixin, TimestampMixin, Base):
    """A facility found within the analysis radius of a complaint."""

    __tablename__ = "nearby_places"

    complaint_id: Mapped[uuid.UUID] = mapped_column(
        GUID(), ForeignKey("complaints.id", ondelete="CASCADE"), nullable=False, index=True
    )
    place_type: Mapped[PlaceType] = mapped_column(
        SAEnum(PlaceType, native_enum=False, length=30), nullable=False, index=True
    )
    name: Mapped[str] = mapped_column(String(200), nullable=False)
    distance_meters: Mapped[float] = mapped_column(Float, nullable=False)
    latitude: Mapped[float] = mapped_column(Float, nullable=False)
    longitude: Mapped[float] = mapped_column(Float, nullable=False)
    source: Mapped[str] = mapped_column(String(50), default="seeded", nullable=False)

    complaint: Mapped[Complaint] = relationship(back_populates="nearby_places")


class TrafficSnapshot(UUIDPrimaryKeyMixin, TimestampMixin, Base):
    """Traffic conditions captured at the moment a complaint was assessed."""

    __tablename__ = "traffic_snapshots"

    complaint_id: Mapped[uuid.UUID] = mapped_column(
        GUID(), ForeignKey("complaints.id", ondelete="CASCADE"), nullable=False, index=True
    )
    level: Mapped[TrafficLevel] = mapped_column(
        SAEnum(TrafficLevel, native_enum=False, length=20), nullable=False
    )
    score: Mapped[float] = mapped_column(Float, nullable=False)
    estimated_vehicles_per_hour: Mapped[int | None] = mapped_column(Integer)
    observed_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    provider: Mapped[str] = mapped_column(String(50), default="mock", nullable=False)

    complaint: Mapped[Complaint] = relationship(back_populates="traffic_snapshots")


class WeatherSnapshot(UUIDPrimaryKeyMixin, TimestampMixin, Base):
    """Optional weather signal (disabled by default - see settings.WEATHER_ENABLED)."""

    __tablename__ = "weather_snapshots"

    complaint_id: Mapped[uuid.UUID] = mapped_column(
        GUID(), ForeignKey("complaints.id", ondelete="CASCADE"), nullable=False, index=True
    )
    condition: Mapped[str] = mapped_column(String(50), nullable=False)
    rainfall_mm_24h: Mapped[float] = mapped_column(Float, default=0.0, nullable=False)
    temperature_c: Mapped[float | None] = mapped_column(Float)
    #: Multiplier applied to the final score when weather escalation is enabled.
    risk_multiplier: Mapped[float] = mapped_column(Float, default=1.0, nullable=False)
    observed_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    provider: Mapped[str] = mapped_column(String(50), default="mock", nullable=False)


class SeededPlace(UUIDPrimaryKeyMixin, TimestampMixin, Base):
    """City facility catalogue backing the development NearbyPlacesProvider.

    Replacing this with a live Overpass or Places lookup is a provider swap; no
    business logic depends on this table directly.
    """

    __tablename__ = "seeded_places"
    __table_args__ = (Index("ix_seeded_places_lat_lon", "latitude", "longitude"),)

    place_type: Mapped[PlaceType] = mapped_column(
        SAEnum(PlaceType, native_enum=False, length=30), nullable=False, index=True
    )
    name: Mapped[str] = mapped_column(String(200), nullable=False)
    latitude: Mapped[float] = mapped_column(Float, nullable=False)
    longitude: Mapped[float] = mapped_column(Float, nullable=False)
    city: Mapped[str | None] = mapped_column(String(120), index=True)
