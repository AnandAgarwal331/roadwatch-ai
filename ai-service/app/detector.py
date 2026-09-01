"""Road damage detection.

Two implementations behind one interface:

``YoloDetector``
    Loads a trained YOLO checkpoint with Ultralytics. **This is where a real
    model goes.** Point ``AI_MODEL_PATH`` at a ``.pt`` file and install
    ``ultralytics``; nothing else in the system changes.

``HeuristicDetector``
    The development fallback used when no checkpoint is configured. It is not a
    model and does not pretend to be one - it derives a stable, plausible
    detection set from image statistics so the whole pipeline can be exercised
    end to end without a GPU or a training run.

The service reports which one is live at ``/health`` and in every response's
``model_name``, so a caller can always tell whether it is talking to a real
detector. See ``docs/AI.md`` for the training and deployment notes.
"""

from __future__ import annotations

import hashlib
import io
import logging
import random
import time
from dataclasses import dataclass, field

from PIL import Image, ImageFilter, UnidentifiedImageError

logger = logging.getLogger("ai-service.detector")

#: Classes the service can emit. A trained checkpoint must map its class
#: indices onto exactly these names.
DAMAGE_CLASSES = [
    "POTHOLE",
    "CRACKED_ROAD",
    "FLOODING",
    "DAMAGED_SIDEWALK",
    "BROKEN_STREETLIGHT",
]


@dataclass(slots=True)
class Detection:
    damage_type: str
    confidence: float
    bbox_x: float
    bbox_y: float
    bbox_width: float
    bbox_height: float

    @property
    def area_ratio(self) -> float:
        return max(0.0, min(1.0, self.bbox_width * self.bbox_height))


@dataclass(slots=True)
class DetectionResult:
    damage_type: str
    confidence: float
    detections: list[Detection] = field(default_factory=list)
    damaged_area_ratio: float = 0.0
    model_name: str = "unknown"
    model_version: str = "0"
    processing_ms: int = 0


class DetectorError(Exception):
    """The image could not be processed."""


# -- production path ----------------------------------------------------


class YoloDetector:
    """Ultralytics YOLO adapter.

    Expects a checkpoint trained on the classes in :data:`DAMAGE_CLASSES`.
    Bounding boxes are normalised to 0-1 before leaving this class so callers
    never depend on the input resolution.
    """

    def __init__(self, model_path: str, confidence_threshold: float = 0.25) -> None:
        try:
            from ultralytics import YOLO  # noqa: PLC0415 - optional heavy dependency
        except ImportError as exc:  # pragma: no cover - depends on the install
            raise DetectorError(
                "AI_MODEL_PATH is set but ultralytics is not installed. "
                "Run: pip install ultralytics"
            ) from exc

        self.model_path = model_path
        self.confidence_threshold = confidence_threshold
        self.model = YOLO(model_path)
        self.model_name = f"yolo:{model_path.rsplit('/', 1)[-1]}"
        self.model_version = getattr(self.model, "version", "custom")
        logger.info("Loaded YOLO checkpoint from %s", model_path)

    def detect(self, image_bytes: bytes) -> DetectionResult:
        started = time.perf_counter()
        try:
            image = Image.open(io.BytesIO(image_bytes)).convert("RGB")
        except (UnidentifiedImageError, OSError) as exc:
            raise DetectorError("The uploaded file could not be read as an image.") from exc

        width, height = image.size
        predictions = self.model.predict(image, conf=self.confidence_threshold, verbose=False)

        detections: list[Detection] = []
        for prediction in predictions:
            names = getattr(prediction, "names", {}) or {}
            for box in getattr(prediction, "boxes", []):
                x1, y1, x2, y2 = (float(value) for value in box.xyxy[0].tolist())
                label = str(names.get(int(box.cls[0]), "OTHER")).upper()
                detections.append(
                    Detection(
                        damage_type=label if label in DAMAGE_CLASSES else "OTHER",
                        confidence=round(float(box.conf[0]), 4),
                        bbox_x=round(max(0.0, x1 / width), 4),
                        bbox_y=round(max(0.0, y1 / height), 4),
                        bbox_width=round(min(1.0, (x2 - x1) / width), 4),
                        bbox_height=round(min(1.0, (y2 - y1) / height), 4),
                    )
                )

        return _summarise(
            detections,
            model_name=self.model_name,
            model_version=str(self.model_version),
            started=started,
        )

    def health(self) -> dict:
        return {"detector": "yolo", "model": self.model_name, "trained_model": True}


# -- development path ---------------------------------------------------


class HeuristicDetector:
    """Deterministic development stand-in. Not a trained model.

    Mirrors the backend's in-process stub so behaviour is identical whether the
    backend calls this service or falls back to its own local provider.
    """

    model_name = "roadwatch-dev-stub"
    model_version = "0.1.0"

    def detect(self, image_bytes: bytes) -> DetectionResult:
        started = time.perf_counter()
        try:
            stats = _image_stats(image_bytes)
        except (UnidentifiedImageError, OSError, ValueError) as exc:
            raise DetectorError("The uploaded file could not be read as an image.") from exc

        rng = random.Random(int(hashlib.sha256(image_bytes).hexdigest()[:16], 16))
        primary = _classify(stats)
        detections = _synthesise_boxes(primary, stats, rng)

        return _summarise(
            detections,
            model_name=self.model_name,
            model_version=self.model_version,
            started=started,
        )

    def health(self) -> dict:
        return {"detector": "heuristic", "model": self.model_name, "trained_model": False}


# -- shared helpers -----------------------------------------------------


def _summarise(
    detections: list[Detection], *, model_name: str, model_version: str, started: float
) -> DetectionResult:
    elapsed = int((time.perf_counter() - started) * 1000)

    if not detections:
        return DetectionResult(
            damage_type="UNKNOWN",
            confidence=0.0,
            model_name=model_name,
            model_version=model_version,
            processing_ms=elapsed,
        )

    best = max(detections, key=lambda item: item.confidence)
    return DetectionResult(
        damage_type=best.damage_type,
        confidence=best.confidence,
        detections=detections,
        # Overlapping boxes must not push coverage above the whole frame.
        damaged_area_ratio=round(min(1.0, sum(item.area_ratio for item in detections)), 4),
        model_name=model_name,
        model_version=model_version,
        processing_ms=elapsed,
    )


class _Stats:
    __slots__ = ("dark_ratio", "blue_dominance", "edge_density", "brightness", "top_light_ratio")

    def __init__(self, dark_ratio, blue_dominance, edge_density, brightness, top_light_ratio):
        self.dark_ratio = dark_ratio
        self.blue_dominance = blue_dominance
        self.edge_density = edge_density
        self.brightness = brightness
        self.top_light_ratio = top_light_ratio


def _image_stats(image_bytes: bytes) -> _Stats:
    with Image.open(io.BytesIO(image_bytes)) as img:
        img.load()
        rgb = img.convert("RGB").resize((64, 64))

    pixels = list(rgb.getdata())
    count = len(pixels)
    luminance = [(0.299 * r + 0.587 * g + 0.114 * b) for r, g, b in pixels]
    brightness = sum(luminance) / count

    threshold = max(20.0, brightness * 0.62)
    dark_ratio = sum(1 for value in luminance if value < threshold) / count
    blue_dominance = sum(1 for r, g, b in pixels if b > r + 12 and b > g + 6) / count

    edges = list(rgb.convert("L").filter(ImageFilter.FIND_EDGES).getdata())
    edge_density = sum(1 for value in edges if value > 40) / len(edges)

    top_rows = luminance[: count // 2]
    top_light_ratio = sum(1 for value in top_rows if value > 125) / max(1, len(top_rows))

    return _Stats(dark_ratio, blue_dominance, edge_density, brightness / 255.0, top_light_ratio)


def _classify(stats: _Stats) -> str:
    if stats.blue_dominance > 0.20:
        return "FLOODING"
    if stats.brightness < 0.25:
        return "BROKEN_STREETLIGHT"
    if stats.top_light_ratio > 0.40:
        return "DAMAGED_SIDEWALK"

    edge_to_dark = stats.dark_ratio / max(stats.edge_density, 1e-6)
    if stats.edge_density >= 0.125 and edge_to_dark < 0.5:
        return "CRACKED_ROAD"
    if stats.dark_ratio > 0.005:
        return "POTHOLE"
    if stats.edge_density > 0.085:
        return "CRACKED_ROAD"
    return "POTHOLE"


def _synthesise_boxes(primary: str, stats: _Stats, rng: random.Random) -> list[Detection]:
    hint = min(
        1.0, stats.dark_ratio * 1.8 + stats.edge_density * 0.6 + stats.blue_dominance * 0.75
    )
    box_count = 1 + int(hint > 0.45) + int(hint > 0.75)

    detections: list[Detection] = []
    for index in range(box_count):
        scale = 1.0 - (index * 0.28)
        width = round(min(0.62, max(0.06, (0.16 + hint * 0.34) * scale)), 4)
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

    return detections
