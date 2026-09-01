"""FastAPI application entrypoint."""

from __future__ import annotations

import logging
from contextlib import asynccontextmanager
from pathlib import Path

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from sqlalchemy import text

from app.api.v1.router import api_router
from app.core.config import settings
from app.core.errors import register_exception_handlers
from app.core.logging import configure_logging
from app.db.session import engine
from app.schemas.common import HealthResponse

logger = logging.getLogger("roadwatch")

VERSION = "1.0.0"

DESCRIPTION = """
AI-assisted road damage reporting and prioritisation for citizens and municipal authorities.

**Priority scores produced by this API are AI-assisted recommendations.** They are intended to
help authorities triage work, not to replace inspection. Final repair priority should be reviewed
by authorized personnel.

Severity values are *visual* estimates derived from a photograph. A standard RGB photo carries no
depth information, so nothing here should be read as a measurement of pothole depth or structural
condition.
"""


@asynccontextmanager
async def lifespan(_: FastAPI):
    configure_logging()
    settings.validate_runtime()

    try:
        with engine.connect() as connection:
            connection.execute(text("SELECT 1"))
        logger.info("Database reachable (%s)", "sqlite" if settings.is_sqlite else "postgresql")
    except Exception:  # noqa: BLE001 - log and keep serving /health
        logger.exception("Database is not reachable at startup")

    logger.info(
        "RoadWatch AI %s starting | env=%s ai=%s traffic=%s places=%s storage=%s",
        VERSION,
        settings.ENVIRONMENT,
        settings.AI_PROVIDER,
        settings.TRAFFIC_PROVIDER,
        settings.PLACES_PROVIDER,
        settings.STORAGE_PROVIDER,
    )
    yield
    logger.info("RoadWatch AI shutting down")


app = FastAPI(
    title=settings.PROJECT_NAME,
    description=DESCRIPTION,
    version=VERSION,
    lifespan=lifespan,
    docs_url="/docs",
    redoc_url="/redoc",
    openapi_url="/openapi.json",
)

# Credentials are allowed, so the origin list must stay explicit - a wildcard
# with credentials is both invalid and unsafe.
app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.cors_origin_list,
    allow_credentials=True,
    allow_methods=["GET", "POST", "PATCH", "PUT", "DELETE", "OPTIONS"],
    allow_headers=["Authorization", "Content-Type", "Accept"],
    max_age=3600,
)

register_exception_handlers(app)
app.include_router(api_router, prefix=settings.API_V1_PREFIX)

# Uploaded images in development. In production these are served by the object
# store / CDN instead, and this mount is simply unused.
if settings.STORAGE_PROVIDER == "local":
    upload_dir = Path(settings.STORAGE_LOCAL_DIR)
    upload_dir.mkdir(parents=True, exist_ok=True)
    app.mount(
        settings.STORAGE_PUBLIC_BASE_URL,
        StaticFiles(directory=str(upload_dir)),
        name="media",
    )


@app.get("/health", response_model=HealthResponse, tags=["system"], summary="Health check")
async def health() -> HealthResponse:
    database = "up"
    try:
        with engine.connect() as connection:
            connection.execute(text("SELECT 1"))
    except Exception:  # noqa: BLE001 - health must report, not raise
        database = "down"

    ai_status = "unknown"
    try:
        from app.providers.ai.factory import get_ai_provider

        ai_status = "up" if await get_ai_provider().health() else "down"
    except Exception:  # noqa: BLE001
        ai_status = "down"

    return HealthResponse(
        status="ok" if database == "up" else "degraded",
        environment=settings.ENVIRONMENT,
        database=database,
        ai_provider=settings.AI_PROVIDER,
        ai_service=ai_status,
        version=VERSION,
    )


@app.get("/", tags=["system"], include_in_schema=False)
async def root() -> dict:
    return {
        "name": settings.PROJECT_NAME,
        "version": VERSION,
        "docs": "/docs",
        "health": "/health",
        "notice": (
            "Priority scores are AI-assisted recommendations for review by authorized personnel."
        ),
    }
