"""The AI analysis contract.

Business logic depends only on this module. Whether detections come from a real
YOLO checkpoint, a remote inference service or the development stub is a wiring
decision made in :mod:`app.providers.ai.factory`.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Protocol, runtime_checkable

from app.core.enums import DamageType


@dataclass(slots=True)
class Detection:
    """One detected damaged region.

    Bounding boxes are normalised to 0-1 against the image dimensions so the
    frontend can overlay them at any rendered size.
    """

    damage_type: DamageType
    confidence: float
    bbox_x: float
    bbox_y: float
    bbox_width: float
    bbox_height: float

    @property
    def area_ratio(self) -> float:
        return max(0.0, min(1.0, self.bbox_width * self.bbox_height))


@dataclass(slots=True)
class AnalysisResult:
    """Raw model output.

    Note this carries no severity: severity is a *business* decision derived by
    :class:`app.services.severity.SeverityService`, not something the detector
    returns. Keeping them apart means the severity rules can be retuned without
    touching the model integration.
    """

    damage_type: DamageType
    confidence: float
    detections: list[Detection] = field(default_factory=list)
    damaged_area_ratio: float = 0.0
    model_name: str = "unknown"
    model_version: str = "0"
    provider: str = "unknown"
    processing_ms: int = 0
    #: Set when the provider failed; callers degrade gracefully rather than 500.
    error_message: str | None = None

    @property
    def succeeded(self) -> bool:
        return self.error_message is None


@runtime_checkable
class AIAnalysisProvider(Protocol):
    """Detects road damage in a photograph."""

    name: str

    async def analyze(self, image_bytes: bytes, content_type: str) -> AnalysisResult:
        """Analyse one image. Must not raise for upstream failures.

        Implementations return an :class:`AnalysisResult` with ``error_message``
        set instead, so a report is never lost because inference was down.
        """
        ...

    async def health(self) -> bool:
        """Whether the provider is currently usable."""
        ...
