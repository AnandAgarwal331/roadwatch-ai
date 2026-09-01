"""AI provider backed by the standalone inference service.

Talks to ``ai-service`` over HTTP so the model can be scaled (or GPU-hosted)
independently of the API. Every failure mode is converted into an
``AnalysisResult`` carrying ``error_message`` - a detector outage must never
cost a citizen their report.
"""

from __future__ import annotations

import logging

import httpx

from app.core.enums import DamageType
from app.providers.ai.base import AnalysisResult, Detection

logger = logging.getLogger("roadwatch.ai")


class HttpAIProvider:
    name = "http"

    def __init__(self, base_url: str, timeout_seconds: float = 20.0) -> None:
        self.base_url = base_url.rstrip("/")
        self.timeout_seconds = timeout_seconds

    async def analyze(self, image_bytes: bytes, content_type: str) -> AnalysisResult:
        files = {"file": ("upload", image_bytes, content_type or "application/octet-stream")}
        try:
            async with httpx.AsyncClient(timeout=self.timeout_seconds) as client:
                response = await client.post(f"{self.base_url}/analyze", files=files)
                response.raise_for_status()
                payload = response.json()
        except httpx.TimeoutException:
            logger.warning("AI service timed out after %.1fs", self.timeout_seconds)
            return self._failure("The AI service took too long to respond.")
        except httpx.HTTPStatusError as exc:
            logger.warning("AI service returned HTTP %s", exc.response.status_code)
            return self._failure("The AI service rejected the image.")
        except httpx.HTTPError as exc:
            logger.warning("AI service unreachable: %s", exc)
            return self._failure("The AI service is unreachable.")
        except ValueError:
            return self._failure("The AI service returned an unreadable response.")

        return self._parse(payload)

    async def health(self) -> bool:
        try:
            async with httpx.AsyncClient(timeout=3.0) as client:
                response = await client.get(f"{self.base_url}/health")
                return response.status_code == 200
        except httpx.HTTPError:
            return False

    def _failure(self, message: str) -> AnalysisResult:
        return AnalysisResult(
            damage_type=DamageType.UNKNOWN,
            confidence=0.0,
            provider=self.name,
            error_message=message,
        )

    def _parse(self, payload: dict) -> AnalysisResult:
        detections = [
            Detection(
                damage_type=_coerce_damage_type(item.get("damage_type")),
                confidence=float(item.get("confidence", 0.0)),
                bbox_x=float(item.get("bbox_x", 0.0)),
                bbox_y=float(item.get("bbox_y", 0.0)),
                bbox_width=float(item.get("bbox_width", 0.0)),
                bbox_height=float(item.get("bbox_height", 0.0)),
            )
            for item in payload.get("detections", [])
        ]
        return AnalysisResult(
            damage_type=_coerce_damage_type(payload.get("damage_type")),
            confidence=float(payload.get("confidence", 0.0)),
            detections=detections,
            damaged_area_ratio=float(payload.get("damaged_area_ratio", 0.0)),
            model_name=str(payload.get("model_name", "unknown")),
            model_version=str(payload.get("model_version", "0")),
            provider=self.name,
            processing_ms=int(payload.get("processing_ms", 0)),
        )


def _coerce_damage_type(value: object) -> DamageType:
    """Never trust an upstream label; unknown classes degrade to UNKNOWN."""
    try:
        return DamageType(str(value).upper())
    except ValueError:
        return DamageType.UNKNOWN
