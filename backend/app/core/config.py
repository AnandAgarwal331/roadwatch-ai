"""Central application configuration.

Everything that varies between environments lives here and is sourced from the
environment (see ``.env.example``).  Nothing in this file may contain a real
secret; defaults are development-only and the application refuses to boot with
the default secret when ``ENVIRONMENT=production``.
"""

from __future__ import annotations

from functools import lru_cache
from pathlib import Path

from pydantic import field_validator
from pydantic_settings import BaseSettings, SettingsConfigDict

BACKEND_ROOT = Path(__file__).resolve().parents[2]
DEV_SECRET = "dev-secret-change-me"


class Settings(BaseSettings):
    model_config = SettingsConfigDict(
        env_file=(BACKEND_ROOT / ".env", BACKEND_ROOT.parent / ".env"),
        env_file_encoding="utf-8",
        extra="ignore",
    )

    # -- Application ----------------------------------------------------
    ENVIRONMENT: str = "development"
    PROJECT_NAME: str = "RoadWatch AI"
    API_V1_PREFIX: str = "/api"
    LOG_LEVEL: str = "INFO"

    # -- Database -------------------------------------------------------
    # Postgres in production; a local SQLite file keeps the project
    # runnable on a machine without a Postgres server.
    DATABASE_URL: str = f"sqlite:///{(BACKEND_ROOT / 'roadwatch.db').as_posix()}"
    SQL_ECHO: bool = False

    # -- Auth -----------------------------------------------------------
    AUTH_SECRET: str = DEV_SECRET
    JWT_ALGORITHM: str = "HS256"
    ACCESS_TOKEN_TTL_MINUTES: int = 60 * 12

    # -- CORS -----------------------------------------------------------
    CORS_ORIGINS: str = "http://localhost:3000,http://127.0.0.1:3000"

    # -- Storage --------------------------------------------------------
    STORAGE_PROVIDER: str = "local"  # local | s3
    STORAGE_LOCAL_DIR: str = str(BACKEND_ROOT / "uploads")
    #: Where uploaded files are reachable from: the local /media mount, or the
    #: bucket's public URL (an R2 public bucket URL, S3 custom domain, etc).
    STORAGE_PUBLIC_BASE_URL: str = "/media"
    STORAGE_BUCKET: str = ""
    #: S3-compatible endpoint for non-AWS providers, e.g. R2's
    #: https://<account_id>.r2.cloudflarestorage.com. Left blank, boto3 talks to
    #: AWS S3 directly.
    STORAGE_S3_ENDPOINT_URL: str = ""
    #: R2 has no regions and expects the literal string "auto"; AWS needs a real
    #: region name (e.g. us-east-1).
    STORAGE_S3_REGION: str = "auto"
    MAX_UPLOAD_BYTES: int = 10 * 1024 * 1024
    ALLOWED_IMAGE_TYPES: str = "image/jpeg,image/png,image/webp"
    IMAGE_MAX_DIMENSION: int = 1600

    # -- AI service -----------------------------------------------------
    AI_PROVIDER: str = "mock"  # mock | http
    AI_SERVICE_URL: str = "http://localhost:8001"
    AI_SERVICE_TIMEOUT_SECONDS: float = 20.0
    AI_MODEL_PATH: str = ""
    AI_MIN_CONFIDENCE: float = 0.45

    # -- Traffic / places / weather providers ---------------------------
    TRAFFIC_PROVIDER: str = "mock"  # mock | http
    TRAFFIC_API_KEY: str = ""
    TRAFFIC_API_URL: str = ""
    PLACES_PROVIDER: str = "seeded"  # seeded | overpass
    PLACES_API_URL: str = "https://overpass-api.de/api/interpreter"
    MAP_PROVIDER_KEY: str = ""
    WEATHER_ENABLED: bool = False
    WEATHER_PROVIDER: str = "mock"
    WEATHER_API_KEY: str = ""

    # -- Domain tuning --------------------------------------------------
    NEARBY_RADIUS_METERS: int = 500
    DUPLICATE_RADIUS_METERS: int = 40
    DUPLICATE_WINDOW_DAYS: int = 30
    HISTORY_RADIUS_METERS: int = 50

    PRIORITY_WEIGHT_SEVERITY: float = 4.0
    PRIORITY_WEIGHT_TRAFFIC: float = 2.5
    PRIORITY_WEIGHT_LOCATION: float = 2.0
    PRIORITY_WEIGHT_HISTORY: float = 1.5

    PRIORITY_THRESHOLD_MEDIUM: float = 40.0
    PRIORITY_THRESHOLD_HIGH: float = 70.0
    PRIORITY_THRESHOLD_CRITICAL: float = 85.0

    # -- Rate limiting --------------------------------------------------
    RATE_LIMIT_ENABLED: bool = True
    RATE_LIMIT_AUTH_PER_MINUTE: int = 10
    RATE_LIMIT_WRITE_PER_MINUTE: int = 30

    @field_validator("ENVIRONMENT")
    @classmethod
    def _normalise_env(cls, value: str) -> str:
        return value.strip().lower()

    @property
    def cors_origin_list(self) -> list[str]:
        return [origin.strip() for origin in self.CORS_ORIGINS.split(",") if origin.strip()]

    @property
    def allowed_image_types(self) -> set[str]:
        return {item.strip().lower() for item in self.ALLOWED_IMAGE_TYPES.split(",") if item.strip()}

    @property
    def is_production(self) -> bool:
        return self.ENVIRONMENT == "production"

    @property
    def is_sqlite(self) -> bool:
        return self.DATABASE_URL.startswith("sqlite")

    def validate_runtime(self) -> None:
        """Fail fast on unsafe production configuration."""
        if self.is_production and self.AUTH_SECRET == DEV_SECRET:
            raise RuntimeError("AUTH_SECRET must be set to a unique value when ENVIRONMENT=production")
        if self.is_production and self.is_sqlite:
            raise RuntimeError("SQLite is not supported in production; set DATABASE_URL to PostgreSQL")


@lru_cache
def get_settings() -> Settings:
    return Settings()


settings: Settings = get_settings()
