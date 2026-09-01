"""Severity estimation, location risk and geospatial maths."""

from __future__ import annotations

import pytest

from app.core.enums import DamageType, PlaceType
from app.providers.ai.base import AnalysisResult, Detection
from app.providers.places.base import NearbyPlaceResult
from app.services.geo import bounding_box, haversine_meters, is_valid_coordinate
from app.services.location_risk import LocationRiskService
from app.services.severity import SeverityService


def detection(damage_type=DamageType.POTHOLE, confidence=0.9, width=0.3, height=0.3) -> Detection:
    return Detection(
        damage_type=damage_type,
        confidence=confidence,
        bbox_x=0.1,
        bbox_y=0.1,
        bbox_width=width,
        bbox_height=height,
    )


def analysis(**kwargs) -> AnalysisResult:
    defaults = {
        "damage_type": DamageType.POTHOLE,
        "confidence": 0.9,
        "detections": [detection()],
        "damaged_area_ratio": 0.09,
    }
    defaults.update(kwargs)
    return AnalysisResult(**defaults)


# -- severity -----------------------------------------------------------


class TestSeverity:
    def setup_method(self) -> None:
        self.service = SeverityService()

    def test_returns_zero_when_nothing_detected(self) -> None:
        result = self.service.estimate(analysis(detections=[], damaged_area_ratio=0.0))
        assert result.score == 0.0
        assert "No damage" in result.explanation

    def test_returns_zero_when_analysis_failed(self) -> None:
        failed = analysis(error_message="AI service unreachable")
        assert self.service.estimate(failed).score == 0.0

    def test_score_stays_within_range(self) -> None:
        for ratio in (0.0, 0.05, 0.2, 0.5, 0.99):
            score = self.service.estimate(analysis(damaged_area_ratio=ratio)).score
            assert 0.0 <= score <= 10.0

    def test_larger_damage_scores_higher(self) -> None:
        small = self.service.estimate(analysis(damaged_area_ratio=0.03)).score
        large = self.service.estimate(analysis(damaged_area_ratio=0.40)).score
        assert large > small

    def test_more_detections_score_higher(self) -> None:
        one = self.service.estimate(analysis(detections=[detection()])).score
        three = self.service.estimate(analysis(detections=[detection()] * 3)).score
        assert three > one

    def test_detection_bonus_is_capped(self) -> None:
        many = self.service.estimate(analysis(detections=[detection()] * 20)).score
        few = self.service.estimate(analysis(detections=[detection()] * 4)).score
        assert many == few

    def test_low_confidence_is_penalised(self) -> None:
        """A barely-recognised object must not drive a high severity."""
        confident = self.service.estimate(analysis(confidence=0.95)).score
        unsure = self.service.estimate(analysis(confidence=0.10)).score
        assert unsure < confident

    def test_damage_type_sets_the_baseline(self) -> None:
        flooding = self.service.estimate(analysis(damage_type=DamageType.FLOODING)).score
        crack = self.service.estimate(analysis(damage_type=DamageType.CRACKED_ROAD)).score
        assert flooding > crack

    def test_explanation_states_it_is_not_an_inspection(self) -> None:
        result = self.service.estimate(analysis())
        assert "not an engineering inspection" in result.explanation

    def test_thresholds_are_configurable(self) -> None:
        from app.services.severity import SeverityConfig

        custom = SeverityService(
            SeverityConfig(base_severity={damage: 1.0 for damage in DamageType})
        )
        assert custom.estimate(analysis()).score < self.service.estimate(analysis()).score


# -- location risk ------------------------------------------------------


class TestLocationRisk:
    def setup_method(self) -> None:
        self.service = LocationRiskService()

    def place(self, place_type, distance) -> NearbyPlaceResult:
        return NearbyPlaceResult(
            place_type=place_type,
            name=f"Test {place_type.value}",
            latitude=12.96,
            longitude=77.64,
            distance_meters=distance,
            source="test",
        )

    def test_no_places_falls_back_to_road_importance(self) -> None:
        quiet = self.service.assess([], 500, road_importance=2.0)
        arterial = self.service.assess([], 500, road_importance=10.0)
        assert arterial.score > quiet.score
        assert "No hospitals" in quiet.explanation

    def test_closer_facility_scores_higher(self) -> None:
        near = self.service.assess([self.place(PlaceType.HOSPITAL, 50)], 500)
        far = self.service.assess([self.place(PlaceType.HOSPITAL, 480)], 500)
        assert near.score > far.score

    def test_hospital_outranks_bus_stop(self) -> None:
        hospital = self.service.assess([self.place(PlaceType.HOSPITAL, 100)], 500)
        bus_stop = self.service.assess([self.place(PlaceType.BUS_STOP, 100)], 500)
        assert hospital.score > bus_stop.score

    def test_diverse_facilities_add_a_bonus(self) -> None:
        single = self.service.assess([self.place(PlaceType.HOSPITAL, 100)], 500)
        mixed = self.service.assess(
            [
                self.place(PlaceType.HOSPITAL, 100),
                self.place(PlaceType.SCHOOL, 150),
                self.place(PlaceType.BUS_STOP, 90),
            ],
            500,
        )
        assert mixed.score > single.score

    def test_score_never_exceeds_ten(self) -> None:
        crowded = [self.place(place_type, 5) for place_type in PlaceType] * 3
        assert self.service.assess(crowded, 500, road_importance=10).score <= 10.0

    def test_reports_nearest_distance_per_type(self) -> None:
        result = self.service.assess(
            [self.place(PlaceType.HOSPITAL, 300), self.place(PlaceType.HOSPITAL, 120)], 500
        )
        assert result.nearest_by_type["HOSPITAL"] == 120


# -- geo ----------------------------------------------------------------


class TestGeo:
    def test_haversine_zero_distance(self) -> None:
        assert haversine_meters(12.96, 77.64, 12.96, 77.64) == 0.0

    def test_haversine_known_distance(self) -> None:
        """One degree of latitude is about 111.2km."""
        distance = haversine_meters(12.0, 77.0, 13.0, 77.0)
        assert 110_000 < distance < 112_000

    def test_haversine_is_symmetric(self) -> None:
        forward = haversine_meters(12.96, 77.64, 12.97, 77.65)
        backward = haversine_meters(12.97, 77.65, 12.96, 77.64)
        assert forward == pytest.approx(backward)

    def test_small_distance_precision(self) -> None:
        """~111m north, the scale duplicate detection works at."""
        distance = haversine_meters(12.9600, 77.6400, 12.9610, 77.6400)
        assert 105 < distance < 118

    def test_bounding_box_contains_the_circle(self) -> None:
        box = bounding_box(12.96, 77.64, 500)
        assert box.min_lat < 12.96 < box.max_lat
        assert box.min_lon < 77.64 < box.max_lon

        # Every corner must be at least the radius away, or the prefilter
        # would discard points inside the circle.
        for lat, lon in (
            (box.min_lat, 77.64),
            (box.max_lat, 77.64),
            (12.96, box.min_lon),
            (12.96, box.max_lon),
        ):
            assert haversine_meters(12.96, 77.64, lat, lon) >= 499

    def test_bounding_box_widens_with_latitude(self) -> None:
        """Longitude degrees shrink towards the poles."""
        equator = bounding_box(0.0, 0.0, 1000)
        north = bounding_box(60.0, 0.0, 1000)
        assert (north.max_lon - north.min_lon) > (equator.max_lon - equator.min_lon)

    def test_coordinate_validation(self) -> None:
        assert is_valid_coordinate(12.96, 77.64)
        assert is_valid_coordinate(-90, -180)
        assert not is_valid_coordinate(91, 0)
        assert not is_valid_coordinate(0, 181)
