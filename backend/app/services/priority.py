"""The priority engine.

Combines four normalised 0-10 factors into a 0-100 recommendation::

    priority_score = severity * 4.0      (40%)
                   + traffic  * 2.5      (25%)
                   + location * 2.0      (20%)
                   + history  * 1.5      (15%)

Worked example - severity 9, traffic 8, location 10, history 7::

    9  * 4.0  = 36.0
    8  * 2.5  = 20.0
    10 * 2.0  = 20.0
    7  * 1.5  = 10.5
                -----
                86.5  -> CRITICAL

Two properties are load-bearing:

**It is explainable.** Every factor, weight and point contribution is returned
and persisted, so the UI can always answer "why is this 86.5?" A score a
municipal officer cannot interrogate is a score they cannot act on.

**It is a recommendation, not a decision.** The output is an AI-assisted
ranking aid; the final call belongs to authorised personnel, and every surface
that shows a score says so.

Weights and thresholds are configuration, not constants, so a city can retune
them without a code change. ``docs/ARCHITECTURE.md`` describes how this
weighted model is intended to give way to a trained ranking model once enough
resolution history exists - the factor vector here is deliberately the feature
vector that model would consume.
"""

from __future__ import annotations

from dataclasses import asdict, dataclass, field
from typing import Any

from app.core.config import settings
from app.core.enums import PriorityLevel

ENGINE_VERSION = "weighted-v1"


@dataclass(slots=True)
class PriorityWeights:
    """Points contributed per unit of each 0-10 factor."""

    severity: float = 4.0
    traffic: float = 2.5
    location: float = 2.0
    history: float = 1.5

    @property
    def total(self) -> float:
        return self.severity + self.traffic + self.location + self.history

    def validate(self) -> None:
        """Weights must sum to 10 so that all-10 factors give exactly 100."""
        if abs(self.total - 10.0) > 1e-6:
            raise ValueError(
                f"Priority weights must sum to 10.0 to produce a 0-100 score; got {self.total}"
            )

    @classmethod
    def from_settings(cls) -> PriorityWeights:
        return cls(
            severity=settings.PRIORITY_WEIGHT_SEVERITY,
            traffic=settings.PRIORITY_WEIGHT_TRAFFIC,
            location=settings.PRIORITY_WEIGHT_LOCATION,
            history=settings.PRIORITY_WEIGHT_HISTORY,
        )


@dataclass(slots=True)
class PriorityThresholds:
    """Lower bound of each band."""

    medium: float = 40.0
    high: float = 70.0
    critical: float = 85.0

    @classmethod
    def from_settings(cls) -> PriorityThresholds:
        return cls(
            medium=settings.PRIORITY_THRESHOLD_MEDIUM,
            high=settings.PRIORITY_THRESHOLD_HIGH,
            critical=settings.PRIORITY_THRESHOLD_CRITICAL,
        )

    def level_for(self, score: float) -> PriorityLevel:
        if score >= self.critical:
            return PriorityLevel.CRITICAL
        if score >= self.high:
            return PriorityLevel.HIGH
        if score >= self.medium:
            return PriorityLevel.MEDIUM
        return PriorityLevel.LOW


@dataclass(slots=True)
class PriorityInput:
    """The four normalised factors, plus optional context for the explanation."""

    severity: float
    traffic: float
    location: float
    history: float
    severity_note: str = ""
    traffic_note: str = ""
    location_note: str = ""
    history_note: str = ""
    #: Weather escalation, 1.0 when the signal is disabled.
    weather_multiplier: float = 1.0
    signals: dict[str, Any] = field(default_factory=dict)


@dataclass(slots=True)
class FactorBreakdown:
    key: str
    label: str
    value: float
    weight: float
    points: float
    max_points: float
    note: str


@dataclass(slots=True)
class PriorityResult:
    total_score: float
    level: PriorityLevel
    explanation: str
    breakdown: list[FactorBreakdown]
    weights: dict[str, float]
    thresholds: dict[str, float]
    signals: dict[str, Any]
    weather_multiplier: float
    engine_version: str = ENGINE_VERSION

    @property
    def severity_factor(self) -> float:
        return self._factor("severity")

    @property
    def traffic_factor(self) -> float:
        return self._factor("traffic")

    @property
    def location_factor(self) -> float:
        return self._factor("location")

    @property
    def history_factor(self) -> float:
        return self._factor("history")

    def points(self, key: str) -> float:
        for item in self.breakdown:
            if item.key == key:
                return item.points
        return 0.0

    def _factor(self, key: str) -> float:
        for item in self.breakdown:
            if item.key == key:
                return item.value
        return 0.0

    def to_dict(self) -> dict[str, Any]:
        return {
            "total_score": self.total_score,
            "level": self.level.value,
            "explanation": self.explanation,
            "breakdown": [asdict(item) for item in self.breakdown],
            "weights": self.weights,
            "thresholds": self.thresholds,
            "signals": self.signals,
            "weather_multiplier": self.weather_multiplier,
            "engine_version": self.engine_version,
        }


_LABELS = {
    "severity": "Visual severity",
    "traffic": "Traffic",
    "location": "Location risk",
    "history": "Complaint history",
}


class PriorityService:
    """Computes an explainable 0-100 priority recommendation."""

    def __init__(
        self,
        weights: PriorityWeights | None = None,
        thresholds: PriorityThresholds | None = None,
    ) -> None:
        self.weights = weights or PriorityWeights.from_settings()
        self.thresholds = thresholds or PriorityThresholds.from_settings()
        self.weights.validate()

    def calculate(self, data: PriorityInput) -> PriorityResult:
        weights = self.weights

        severity = _clamp_factor(data.severity)
        traffic = _clamp_factor(data.traffic)
        location = _clamp_factor(data.location)
        history = _clamp_factor(data.history)

        breakdown = [
            _factor("severity", severity, weights.severity, data.severity_note),
            _factor("traffic", traffic, weights.traffic, data.traffic_note),
            _factor("location", location, weights.location, data.location_note),
            _factor("history", history, weights.history, data.history_note),
        ]

        base_score = sum(item.points for item in breakdown)

        # Weather can only escalate, and is capped by the provider.
        multiplier = max(1.0, data.weather_multiplier)
        total = round(min(100.0, base_score * multiplier), 2)
        level = self.thresholds.level_for(total)

        return PriorityResult(
            total_score=total,
            level=level,
            explanation=self._explain(total, level, breakdown, multiplier),
            breakdown=breakdown,
            weights={
                "severity": weights.severity,
                "traffic": weights.traffic,
                "location": weights.location,
                "history": weights.history,
            },
            thresholds={
                "medium": self.thresholds.medium,
                "high": self.thresholds.high,
                "critical": self.thresholds.critical,
            },
            signals=data.signals,
            weather_multiplier=round(multiplier, 4),
        )

    def _explain(
        self,
        total: float,
        level: PriorityLevel,
        breakdown: list[FactorBreakdown],
        multiplier: float,
    ) -> str:
        """A sentence a municipal officer can act on, led by what mattered most."""
        ranked = sorted(breakdown, key=lambda item: item.points, reverse=True)
        drivers: list[str] = []

        for item in ranked[:3]:
            # Only mention a factor that actually pushed the score up.
            if item.points < item.max_points * 0.35:
                continue
            note = item.note.rstrip(".") if item.note else _fallback_note(item)
            # Notes are standalone sentences; joined with ";" they must not
            # keep their leading capital mid-sentence.
            drivers.append(note[:1].lower() + note[1:] if note else note)

        headline = f"{level.value.title()} priority ({total:g}/100)"
        if not drivers:
            return (
                f"{headline}: none of the contributing factors scored highly. "
                "This is an AI-assisted recommendation for review by authorised personnel."
            )

        body = "; ".join(drivers)
        weather = ""
        if multiplier > 1.0:
            weather = (
                f" Recent heavy rainfall raised the score by {int(round((multiplier - 1) * 100))}%."
            )

        return (
            f"{headline} because {body}.{weather} "
            "This is an AI-assisted recommendation; the final repair priority should be "
            "reviewed by authorised personnel."
        )


def _factor(key: str, value: float, weight: float, note: str) -> FactorBreakdown:
    return FactorBreakdown(
        key=key,
        label=_LABELS[key],
        value=round(value, 2),
        weight=weight,
        points=round(value * weight, 2),
        max_points=round(10.0 * weight, 2),
        note=note,
    )


def _fallback_note(item: FactorBreakdown) -> str:
    return f"{item.label.lower()} scored {item.value:g}/10"


def _clamp_factor(value: float) -> float:
    """Factors are contractually 0-10; clamp rather than trusting callers."""
    try:
        numeric = float(value)
    except (TypeError, ValueError):
        return 0.0
    if numeric != numeric:  # NaN
        return 0.0
    return max(0.0, min(10.0, numeric))


#: Shared default instance.
priority_service = PriorityService()
