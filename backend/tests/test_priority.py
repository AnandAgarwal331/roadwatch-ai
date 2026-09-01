"""Priority engine tests.

The formula is the product's core claim, so it is pinned exactly - including
the worked example from the specification.
"""

from __future__ import annotations

import pytest

from app.core.enums import PriorityLevel
from app.services.priority import (
    PriorityInput,
    PriorityService,
    PriorityThresholds,
    PriorityWeights,
)


@pytest.fixture
def service() -> PriorityService:
    return PriorityService(PriorityWeights(), PriorityThresholds())


def test_specification_example(service: PriorityService) -> None:
    """Severity 9, traffic 8, location 10, history 7 must total exactly 86.5."""
    result = service.calculate(PriorityInput(severity=9, traffic=8, location=10, history=7))

    assert result.total_score == 86.5
    assert result.level is PriorityLevel.CRITICAL


def test_specification_example_breakdown(service: PriorityService) -> None:
    result = service.calculate(PriorityInput(severity=9, traffic=8, location=10, history=7))

    assert result.points("severity") == 36.0
    assert result.points("traffic") == 20.0
    assert result.points("location") == 20.0
    assert result.points("history") == 10.5
    assert sum(item.points for item in result.breakdown) == 86.5


def test_all_maximum_gives_one_hundred(service: PriorityService) -> None:
    assert service.calculate(PriorityInput(10, 10, 10, 10)).total_score == 100.0


def test_all_zero_gives_zero(service: PriorityService) -> None:
    result = service.calculate(PriorityInput(0, 0, 0, 0))
    assert result.total_score == 0.0
    assert result.level is PriorityLevel.LOW


@pytest.mark.parametrize(
    ("score_inputs", "expected"),
    [
        ((10, 10, 10, 10), PriorityLevel.CRITICAL),  # 100
        ((9, 8, 10, 7), PriorityLevel.CRITICAL),  # 86.5
        ((8, 8, 8, 8), PriorityLevel.HIGH),  # 80
        ((7, 7, 7, 7), PriorityLevel.HIGH),  # 70
        ((6, 6, 6, 6), PriorityLevel.MEDIUM),  # 60
        ((4, 4, 4, 4), PriorityLevel.MEDIUM),  # 40
        ((3, 3, 3, 3), PriorityLevel.LOW),  # 30
    ],
)
def test_level_bands(service: PriorityService, score_inputs, expected) -> None:
    result = service.calculate(PriorityInput(*score_inputs))
    assert result.level is expected


def test_band_boundaries_are_inclusive(service: PriorityService) -> None:
    """A score exactly on a threshold belongs to the higher band."""
    assert service.calculate(PriorityInput(8.5, 8.5, 8.5, 8.5)).level is PriorityLevel.CRITICAL  # 85
    assert service.calculate(PriorityInput(7, 7, 7, 7)).level is PriorityLevel.HIGH  # 70
    assert service.calculate(PriorityInput(4, 4, 4, 4)).level is PriorityLevel.MEDIUM  # 40


def test_factors_are_clamped(service: PriorityService) -> None:
    """Out-of-range inputs are clamped rather than trusted."""
    result = service.calculate(PriorityInput(99, -5, 10, 10))
    assert result.severity_factor == 10.0
    assert result.traffic_factor == 0.0
    assert result.total_score == 75.0


def test_weights_must_sum_to_ten() -> None:
    with pytest.raises(ValueError, match="must sum to 10"):
        PriorityService(PriorityWeights(severity=5, traffic=3, location=2, history=2))


def test_configurable_weights_change_the_result() -> None:
    """A city can retune the model without touching the algorithm."""
    severity_heavy = PriorityService(
        PriorityWeights(severity=7, traffic=1, location=1, history=1), PriorityThresholds()
    )
    result = severity_heavy.calculate(PriorityInput(severity=10, traffic=0, location=0, history=0))
    assert result.total_score == 70.0


def test_explanation_names_the_dominant_factors(service: PriorityService) -> None:
    result = service.calculate(
        PriorityInput(
            severity=9,
            traffic=8,
            location=10,
            history=7,
            severity_note="the damage covers 30% of the frame",
            traffic_note="traffic on this stretch is very high",
            location_note="a hospital is 60m away",
            history_note="4 previous reports, 3 unresolved",
        )
    )

    assert "Critical priority" in result.explanation
    assert "hospital is 60m away" in result.explanation
    assert "reviewed by authorised personnel" in result.explanation


def test_explanation_always_carries_the_disclaimer(service: PriorityService) -> None:
    """Every score, however low, is framed as a recommendation."""
    for factors in ((0, 0, 0, 0), (5, 5, 5, 5), (10, 10, 10, 10)):
        result = service.calculate(PriorityInput(*factors))
        assert "authorised personnel" in result.explanation


def test_weather_multiplier_only_escalates(service: PriorityService) -> None:
    base = service.calculate(PriorityInput(6, 6, 6, 6)).total_score
    raised = service.calculate(PriorityInput(6, 6, 6, 6, weather_multiplier=1.1)).total_score
    lowered = service.calculate(PriorityInput(6, 6, 6, 6, weather_multiplier=0.5)).total_score

    assert raised > base
    assert lowered == base  # a multiplier below 1 is ignored


def test_weather_cannot_exceed_one_hundred(service: PriorityService) -> None:
    result = service.calculate(PriorityInput(10, 10, 10, 10, weather_multiplier=1.15))
    assert result.total_score == 100.0


def test_nan_factor_is_treated_as_zero(service: PriorityService) -> None:
    result = service.calculate(PriorityInput(float("nan"), 5, 5, 5))
    assert result.severity_factor == 0.0
    assert result.total_score == 30.0
