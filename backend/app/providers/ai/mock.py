"""Development AI provider.

This is NOT a trained model and makes no claim to be one. It derives a stable,
plausible-looking detection set from cheap image statistics (dark-region ratio,
blue dominance, contrast) seeded by a hash of the image bytes, so that:

* the same photo always yields the same analysis - demos and tests are stable;
* visibly different photos yield visibly different analyses;
* the shape of the output exactly matches what the real detector returns.

Swap it for the real thing by setting ``AI_PROVIDER=http`` and pointing
``AI_SERVICE_URL`` at the ai-service container. See ``docs/AI.md``.
"""

from __future__ import annotations

import hashlib
import io
import random
import time

from PIL import Image, ImageFilter, UnidentifiedImageError

from app.core.enums import DamageType
from app.providers.ai.base import AnalysisResult, Detection

#: Damage classes the development stub can emit, with the relative likelihood
#: used when image statistics do not clearly point at one class.
_BASE_WEIGHTS: list[tuple[DamageType, float]] = [
    (DamageType.POTHOLE, 0.40),
    (DamageType.CRACKED_ROAD, 0.25),
    (DamageType.FLOODING, 0.12),
    (DamageType.DAMAGED_SIDEWALK, 0.13),
    (DamageType.BROKEN_STREETLIGHT, 0.10),
]


class MockAIProvider:
    """Deterministic stand-in for the vision model."""

    name = "mock"

    def __init__(self, model_name: str = "roadwatch-dev-stub", model_version: str = "0.1.0") -> None:
        self.model_name = model_name
        self.model_version = model_version

    async def analyze(self, image_bytes: bytes, content_type: str) -> AnalysisResult:
        started = time.perf_counter()
        try:
            stats = _image_stats(image_bytes)
        except (UnidentifiedImageError, OSError, ValueError):
            return AnalysisResult(
                damage_type=DamageType.UNKNOWN,
                confidence=0.0,
                provider=self.name,
                model_name=self.model_name,
                model_version=self.model_version,
                processing_ms=int((time.perf_counter() - started) * 1000),
                error_message="The uploaded file could not be read as an image.",
            )

        seed = int(hashlib.sha256(image_bytes).hexdigest()[:16], 16)
        rng = random.Random(seed)

        primary = _choose_damage_type(stats, rng)
        detections = _build_detections(primary, stats, rng)

        if not detections:
            return AnalysisResult(
                damage_type=DamageType.UNKNOWN,
                confidence=0.0,
                provider=self.name,
                model_name=self.model_name,
                model_version=self.model_version,
                processing_ms=int((time.perf_counter() - started) * 1000),
            )

        best = max(detections, key=lambda d: d.confidence)
        # Overlapping boxes must not push coverage above the frame.
        area_ratio = min(1.0, sum(d.area_ratio for d in detections))

        return AnalysisResult(
            damage_type=best.damage_type,
            confidence=best.confidence,
            detections=detections,
            damaged_area_ratio=round(area_ratio, 4),
            provider=self.name,
            model_name=self.model_name,
            model_version=self.model_version,
            processing_ms=int((time.perf_counter() - started) * 1000),
        )

    async def health(self) -> bool:
        return True


class _Stats:
    __slots__ = ("dark_ratio", "blue_dominance", "edge_density", "brightness", "top_light_ratio")

    def __init__(
        self,
        dark_ratio: float,
        blue_dominance: float,
        edge_density: float,
        brightness: float,
        top_light_ratio: float,
    ):
        self.dark_ratio = dark_ratio
        self.blue_dominance = blue_dominance
        self.edge_density = edge_density
        self.brightness = brightness
        self.top_light_ratio = top_light_ratio


def _image_stats(image_bytes: bytes) -> _Stats:
    """Cheap 64x64 summary of the photo used to bias the stub's output."""
    with Image.open(io.BytesIO(image_bytes)) as img:
        img.load()
        rgb = img.convert("RGB").resize((64, 64))

    pixels = list(rgb.getdata())
    count = len(pixels)
    luminance = [(0.299 * r + 0.587 * g + 0.114 * b) for r, g, b in pixels]
    brightness = sum(luminance) / count

    # A pothole reads as a dark patch against lighter tarmac.
    threshold = max(20.0, brightness * 0.62)
    dark_ratio = sum(1 for lum in luminance if lum < threshold) / count

    blue_dominance = sum(1 for r, g, b in pixels if b > r + 12 and b > g + 6) / count

    grey = rgb.convert("L").filter(ImageFilter.FIND_EDGES)
    edge_pixels = list(grey.getdata())
    edge_density = sum(1 for value in edge_pixels if value > 40) / len(edge_pixels)

    # Paved footpath reads as a broad, bright band across the top of the frame.
    top_rows = luminance[: count // 2]
    top_light_ratio = sum(1 for lum in top_rows if lum > 125) / max(1, len(top_rows))

    return _Stats(dark_ratio, blue_dominance, edge_density, brightness / 255.0, top_light_ratio)


def _choose_damage_type(stats: _Stats, rng: random.Random) -> DamageType:
    """Pick a class from visual evidence, falling back to chance only when the
    evidence is genuinely ambiguous.

    The thresholds are crude by design - this is a stub, not a detector - but
    the ordering reflects how separable each cue is: standing water and a
    night-time scene are unmistakable, a dark patch on tarmac is a strong
    pothole cue, and dense fine edges without a dark patch suggest cracking.
    """
    if stats.blue_dominance > 0.20:
        return DamageType.FLOODING
    if stats.brightness < 0.25:
        return DamageType.BROKEN_STREETLIGHT
    if stats.top_light_ratio > 0.40:
        return DamageType.DAMAGED_SIDEWALK

    # Cracking vs a pothole is the one genuinely close call. A pothole is a
    # compact dark blob: lots of dark pixels relative to edge content. Cracking
    # is the opposite - dense fine edges with little dark area.
    edge_to_dark = stats.dark_ratio / max(stats.edge_density, 1e-6)
    if stats.edge_density >= 0.125 and edge_to_dark < 0.5:
        return DamageType.CRACKED_ROAD
    if stats.dark_ratio > 0.005:
        return DamageType.POTHOLE
    if stats.edge_density > 0.085:
        return DamageType.CRACKED_ROAD

    # Nothing decisive in the frame - fall back to the prior.
    population = [item[0] for item in _BASE_WEIGHTS]
    return rng.choices(population, weights=[item[1] for item in _BASE_WEIGHTS], k=1)[0]


def _build_detections(primary: DamageType, stats: _Stats, rng: random.Random) -> list[Detection]:
    """Emit 1-3 boxes: the primary class plus an occasional secondary finding."""
    # Standing water covers ground without being dark, so blue coverage has to
    # count towards extent or every flood would look equally minor.
    severity_hint = min(
        1.0, stats.dark_ratio * 1.8 + stats.edge_density * 0.6 + stats.blue_dominance * 0.75
    )
    box_count = 1 + int(severity_hint > 0.45) + int(severity_hint > 0.75)

    detections: list[Detection] = []
    for index in range(box_count):
        # Later boxes are smaller and less certain, as with a real detector.
        scale = 1.0 - (index * 0.28)
        width = round(min(0.62, max(0.06, (0.16 + severity_hint * 0.34) * scale)), 4)
        height = round(min(0.55, max(0.05, width * rng.uniform(0.55, 1.05))), 4)
        detections.append(
            Detection(
                damage_type=primary,
                confidence=round(min(0.98, max(0.30, rng.uniform(0.62, 0.95) * scale + 0.08)), 4),
                bbox_x=round(rng.uniform(0.04, max(0.05, 0.94 - width)), 4),
                bbox_y=round(rng.uniform(0.10, max(0.11, 0.90 - height)), 4),
                bbox_width=width,
                bbox_height=height,
            )
        )

    # Real scenes are often mixed - a flooded stretch also shows cracking.
    if stats.edge_density > 0.34 and primary != DamageType.CRACKED_ROAD and rng.random() < 0.45:
        detections.append(
            Detection(
                damage_type=DamageType.CRACKED_ROAD,
                confidence=round(rng.uniform(0.48, 0.72), 4),
                bbox_x=round(rng.uniform(0.05, 0.55), 4),
                bbox_y=round(rng.uniform(0.15, 0.65), 4),
                bbox_width=round(rng.uniform(0.10, 0.26), 4),
                bbox_height=round(rng.uniform(0.06, 0.18), 4),
            )
        )

    return detections
