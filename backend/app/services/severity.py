"""Visual severity estimation.

**What this is:** an AI-assisted estimate of how bad damage *looks* in a
photograph, on a 0-10 scale.

**What this is not:** an engineering inspection. An ordinary RGB photo carries
no depth information, so this service deliberately makes no claim about how deep
a pothole is or how structurally compromised a road is. Every surface that
displays a severity value is required to say so.

Severity is computed from four visual signals:

* the **damage class** (a flooded carriageway starts from a higher floor than a
  hairline crack);
* the **detector's confidence** (a barely-recognised object should not drive a
  9/10);
* the **damaged area ratio** - how much of the frame the damage covers;
* the **number of distinct damaged regions** - several separate failures on one
  stretch is worse than one.

All thresholds live in :class:`SeverityConfig` so they can be retuned - or
per-city calibrated - without touching the algorithm.
"""

from __future__ import annotations

from dataclasses import dataclass, field

from app.core.enums import DamageType
from app.providers.ai.base import AnalysisResult

#: Where each damage class starts before visual evidence adjusts it, 0-10.
#: Flooding and potholes are immediate hazards to vehicles and pedestrians;
#: a broken streetlight is serious but rarely causes an accident on contact.
DEFAULT_BASE_SEVERITY: dict[DamageType, float] = {
    DamageType.FLOODING: 6.0,
    DamageType.POTHOLE: 5.5,
    DamageType.DAMAGED_SIDEWALK: 4.5,
    DamageType.BROKEN_STREETLIGHT: 4.0,
    DamageType.CRACKED_ROAD: 3.5,
    DamageType.OTHER: 3.0,
    DamageType.UNKNOWN: 2.5,
}


@dataclass(slots=True)
class SeverityConfig:
    """Tunable severity thresholds."""

    base_severity: dict[DamageType, float] = field(
        default_factory=lambda: dict(DEFAULT_BASE_SEVERITY)
    )

    #: Area coverage (0-1) -> points added. Read as: "damage covering more than
    #: 30% of the frame is a large defect".
    area_bands: tuple[tuple[float, float], ...] = (
        (0.02, 0.0),
        (0.06, 0.8),
        (0.12, 1.6),
        (0.22, 2.4),
        (0.35, 3.2),
        (1.01, 4.0),
    )

    #: Extra points for multiple distinct damaged regions, capped.
    points_per_extra_detection: float = 0.6
    max_detection_bonus: float = 1.8

    #: Confidence scaling. Below the floor the estimate is treated as unreliable
    #: and pulled back towards the base score.
    confidence_floor: float = 0.45
    max_confidence_penalty: float = 2.0

    min_severity: float = 1.0
    max_severity: float = 10.0


@dataclass(slots=True)
class SeverityResult:
    score: float
    explanation: str
    #: Component breakdown, persisted alongside the analysis for transparency.
    components: dict[str, float]


class SeverityService:
    """Turns raw detector output into a 0-10 visual severity estimate."""

    def __init__(self, config: SeverityConfig | None = None) -> None:
        self.config = config or SeverityConfig()

    def estimate(self, analysis: AnalysisResult) -> SeverityResult:
        cfg = self.config

        if not analysis.succeeded or not analysis.detections:
            return SeverityResult(
                score=0.0,
                explanation="No damage could be visually assessed from the photo.",
                components={"base": 0.0, "area": 0.0, "count": 0.0, "confidence": 0.0},
            )

        base = cfg.base_severity.get(analysis.damage_type, cfg.base_severity[DamageType.UNKNOWN])
        area_points = self._area_points(analysis.damaged_area_ratio)
        count_points = min(
            cfg.max_detection_bonus,
            max(0, len(analysis.detections) - 1) * cfg.points_per_extra_detection,
        )
        confidence_penalty = self._confidence_penalty(analysis.confidence)

        raw = base + area_points + count_points - confidence_penalty
        score = round(max(cfg.min_severity, min(cfg.max_severity, raw)), 1)

        return SeverityResult(
            score=score,
            explanation=self._explain(analysis, base, area_points, count_points, confidence_penalty),
            components={
                "base": round(base, 2),
                "area": round(area_points, 2),
                "count": round(count_points, 2),
                "confidence": round(-confidence_penalty, 2),
            },
        )

    def _area_points(self, area_ratio: float) -> float:
        ratio = max(0.0, min(1.0, area_ratio))
        for upper_bound, points in self.config.area_bands:
            if ratio < upper_bound:
                return points
        return self.config.area_bands[-1][1]

    def _confidence_penalty(self, confidence: float) -> float:
        """Scale the estimate down when the detector is unsure.

        At or above the floor there is no penalty; it grows linearly to
        ``max_confidence_penalty`` as confidence approaches zero.
        """
        cfg = self.config
        if confidence >= cfg.confidence_floor or cfg.confidence_floor <= 0:
            return 0.0
        shortfall = (cfg.confidence_floor - confidence) / cfg.confidence_floor
        return round(shortfall * cfg.max_confidence_penalty, 3)

    def _explain(
        self,
        analysis: AnalysisResult,
        base: float,
        area_points: float,
        count_points: float,
        confidence_penalty: float,
    ) -> str:
        label = analysis.damage_type.value.replace("_", " ").lower()
        parts = [f"{label} has a baseline visual severity of {base:g}/10"]

        percent = analysis.damaged_area_ratio * 100
        if area_points > 0:
            parts.append(f"the damage covers about {percent:.0f}% of the frame (+{area_points:g})")
        else:
            parts.append(f"the damaged area is small, about {percent:.0f}% of the frame")

        if count_points > 0:
            parts.append(
                f"{len(analysis.detections)} separate damaged regions were found "
                f"(+{count_points:g})"
            )

        if confidence_penalty > 0:
            parts.append(
                f"detection confidence is low at {analysis.confidence:.0%}, "
                f"so the estimate is held back (-{confidence_penalty:g})"
            )

        return (
            "Visual severity estimate: " + ", ".join(parts) + ". "
            "This is an AI-assisted assessment of the photograph, not an engineering inspection."
        )


#: Shared default instance.
severity_service = SeverityService()
