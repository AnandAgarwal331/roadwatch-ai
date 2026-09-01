"""RoadWatch AI - inference service.

A deliberately small service with one job: turn an image into detections. It
holds no database, no auth and no business rules, so it can be scaled, moved to
a GPU host, or replaced entirely without touching the API.

Severity, priority and every other judgement stay in the backend - this service
only reports what it sees.
"""

from __future__ import annotations

import logging
import os
import sys
from contextlib import asynccontextmanager
from dataclasses import asdict

from fastapi import FastAPI, File, HTTPException, UploadFile, status
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel

from app.detector import DAMAGE_CLASSES, DetectorError, HeuristicDetector, YoloDetector

logging.basicConfig(
    level=os.getenv("LOG_LEVEL", "INFO").upper(),
    format="%(asctime)s %(levelname)-8s %(name)s: %(message)s",
    stream=sys.stdout,
)
logger = logging.getLogger("ai-service")

VERSION = "1.0.0"
MAX_UPLOAD_BYTES = int(os.getenv("MAX_UPLOAD_BYTES", str(10 * 1024 * 1024)))
ALLOWED_TYPES = {"image/jpeg", "image/jpg", "image/png", "image/webp"}

_detector: YoloDetector | HeuristicDetector | None = None


def get_detector():
    """Load the trained model if configured, else the development stub."""
    global _detector
    if _detector is not None:
        return _detector

    model_path = os.getenv("AI_MODEL_PATH", "").strip()
    if model_path:
        try:
            _detector = YoloDetector(
                model_path, confidence_threshold=float(os.getenv("AI_CONFIDENCE_THRESHOLD", "0.25"))
            )
            return _detector
        except (DetectorError, OSError, ValueError):
            # A missing or broken checkpoint must not take the service down;
            # degrade loudly to the stub instead.
            logger.exception("Could not load %s; falling back to the development stub", model_path)

    logger.warning(
        "No trained model configured (AI_MODEL_PATH unset). Using the development stub - "
        "output is plausible but NOT a real detection."
    )
    _detector = HeuristicDetector()
    return _detector


@asynccontextmanager
async def lifespan(_: FastAPI):
    get_detector()
    yield


class DetectionResponse(BaseModel):
    damage_type: str
    confidence: float
    bbox_x: float
    bbox_y: float
    bbox_width: float
    bbox_height: float


class AnalyzeResponse(BaseModel):
    damage_type: str
    confidence: float
    detections: list[DetectionResponse]
    damaged_area_ratio: float
    model_name: str
    model_version: str
    processing_ms: int


app = FastAPI(
    title="RoadWatch AI - Inference Service",
    description=(
        "Detects road damage in a photograph.\n\n"
        "**Detections describe what is visible in the image only.** Severity and repair "
        "priority are computed by the RoadWatch backend, not here."
    ),
    version=VERSION,
    lifespan=lifespan,
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=[
        origin.strip()
        for origin in os.getenv("CORS_ORIGINS", "http://localhost:8000").split(",")
        if origin.strip()
    ],
    allow_methods=["GET", "POST"],
    allow_headers=["*"],
)


@app.get("/health", summary="Health and model status")
async def health() -> dict:
    detector = get_detector()
    return {"status": "ok", "version": VERSION, "classes": DAMAGE_CLASSES, **detector.health()}


@app.post("/analyze", response_model=AnalyzeResponse, summary="Detect road damage")
async def analyze(file: UploadFile = File(...)) -> AnalyzeResponse:
    if file.content_type and file.content_type.lower() not in ALLOWED_TYPES:
        raise HTTPException(
            status_code=status.HTTP_415_UNSUPPORTED_MEDIA_TYPE,
            detail="Unsupported image type. Send a JPEG, PNG or WebP.",
        )

    raw = await file.read()
    if not raw:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Empty upload.")
    if len(raw) > MAX_UPLOAD_BYTES:
        raise HTTPException(
            status_code=status.HTTP_413_REQUEST_ENTITY_TOO_LARGE,
            detail=f"Image exceeds the {MAX_UPLOAD_BYTES // (1024 * 1024)}MB limit.",
        )

    try:
        result = get_detector().detect(raw)
    except DetectorError as exc:
        raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_ENTITY, detail=str(exc)) from exc
    except Exception as exc:  # noqa: BLE001 - never leak an internal trace
        logger.exception("Inference failed")
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR, detail="Inference failed."
        ) from exc

    return AnalyzeResponse(**asdict(result))


@app.get("/", include_in_schema=False)
async def root() -> dict:
    return {"service": "roadwatch-ai-inference", "version": VERSION, "docs": "/docs"}
