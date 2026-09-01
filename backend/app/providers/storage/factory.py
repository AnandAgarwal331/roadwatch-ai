"""Selects the storage provider from configuration."""

from __future__ import annotations

import logging
from functools import lru_cache

from app.core.config import settings
from app.providers.storage.base import StorageProvider
from app.providers.storage.local import LocalStorageProvider

logger = logging.getLogger("roadwatch.storage")


@lru_cache
def get_storage_provider() -> StorageProvider:
    provider = settings.STORAGE_PROVIDER.strip().lower()
    if provider == "s3":
        from app.providers.storage.s3 import S3StorageProvider  # noqa: PLC0415 - optional path

        return S3StorageProvider(settings.STORAGE_BUCKET, settings.STORAGE_PUBLIC_BASE_URL)
    if provider != "local":
        logger.warning("Unknown STORAGE_PROVIDER %r; using local storage", provider)
    return LocalStorageProvider(settings.STORAGE_LOCAL_DIR, settings.STORAGE_PUBLIC_BASE_URL)
