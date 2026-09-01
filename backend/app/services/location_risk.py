"""Location risk scoring.

Converts "what is near this pothole" into the 0-10 location factor the priority
engine consumes.

The model is intentionally simple and defensible:

* every facility type carries a **criticality weight** - an ambulance route to a
  hospital matters more than a quiet residential turning;
* weight **decays with distance**, because damage 40m from a school gate is a
  different problem from damage 480m away;
* the strongest single facility sets the base score, with a small bonus when
  *several different kinds* of critical facility cluster nearby;
* a busy classified road has a **floor** even with no facilities around it.
"""

from __future__ import annotations

from dataclasses import dataclass, field

from app.core.enums import PlaceType
from app.providers.places.base import NearbyPlaceResult

#: How critical each facility type is to keep accessible, 0-10.
DEFAULT_PLACE_WEIGHTS: dict[PlaceType, float] = {
    PlaceType.HOSPITAL: 10.0,
    PlaceType.EMERGENCY_SERVICE: 9.5,
    PlaceType.SCHOOL: 8.5,
    PlaceType.MAJOR_INTERSECTION: 7.5,
    PlaceType.BUS_STOP: 6.5,
}


@dataclass(slots=True)
class LocationRiskConfig:
    place_weights: dict[PlaceType, float] = field(default_factory=lambda: dict(DEFAULT_PLACE_WEIGHTS))
    #: Retained weight at the edge of the search radius (1.0 at zero distance).
    edge_retention: float = 0.40
    #: Bonus per additional *distinct* critical facility type nearby.
    diversity_bonus: float = 0.4
    max_diversity_bonus: float = 1.2
    #: Fraction of road importance used as a floor when nothing is nearby.
    road_importance_floor_ratio: float = 0.35


@dataclass(slots=True)
class LocationRiskResult:
    score: float
    explanation: str
    #: Closest distance per facility type, for the UI.
    nearest_by_type: dict[str, float]
    place_count: int


class LocationRiskService:
    def __init__(self, config: LocationRiskConfig | None = None) -> None:
        self.config = config or LocationRiskConfig()

    def assess(
        self,
        places: list[NearbyPlaceResult],
        radius_meters: int,
        road_importance: float = 5.0,
    ) -> LocationRiskResult:
        cfg = self.config
        road_floor = road_importance * cfg.road_importance_floor_ratio

        if not places:
            score = round(max(0.0, min(10.0, road_floor)), 2)
            return LocationRiskResult(
                score=score,
                explanation=(
                    "No hospitals, schools, bus stops or emergency services were found within "
                    f"{radius_meters}m. The score reflects the road's own importance."
                ),
                nearest_by_type={},
                place_count=0,
            )

        nearest_by_type: dict[str, float] = {}
        best_score = 0.0
        best_place: NearbyPlaceResult | None = None

        for place in places:
            key = place.place_type.value
            if key not in nearest_by_type or place.distance_meters < nearest_by_type[key]:
                nearest_by_type[key] = round(place.distance_meters, 1)

            weight = cfg.place_weights.get(place.place_type, 5.0)
            weighted = weight * self._decay(place.distance_meters, radius_meters)
            if weighted > best_score:
                best_score = weighted
                best_place = place

        distinct_types = len(nearest_by_type)
        diversity = min(cfg.max_diversity_bonus, max(0, distinct_types - 1) * cfg.diversity_bonus)

        score = round(max(0.0, min(10.0, max(best_score + diversity, road_floor))), 2)

        return LocationRiskResult(
            score=score,
            explanation=self._explain(best_place, distinct_types, radius_meters, len(places)),
            nearest_by_type=nearest_by_type,
            place_count=len(places),
        )

    def _decay(self, distance_meters: float, radius_meters: int) -> float:
        """Linear falloff from 1.0 at the site to ``edge_retention`` at the radius."""
        if radius_meters <= 0:
            return 1.0
        ratio = max(0.0, min(1.0, distance_meters / radius_meters))
        return 1.0 - (1.0 - self.config.edge_retention) * ratio

    def _explain(
        self,
        best_place: NearbyPlaceResult | None,
        distinct_types: int,
        radius_meters: int,
        total_places: int,
    ) -> str:
        if best_place is None:  # pragma: no cover - guarded by the caller
            return "No nearby critical facilities were found."

        label = best_place.place_type.value.replace("_", " ").lower()
        text = (
            f"The most sensitive facility nearby is a {label} "
            f"({best_place.name}) about {best_place.distance_meters:.0f}m away"
        )
        if distinct_types > 1:
            text += (
                f", and {total_places} facilities of {distinct_types} different kinds "
                f"sit within {radius_meters}m"
            )
        return text + "."


location_risk_service = LocationRiskService()
