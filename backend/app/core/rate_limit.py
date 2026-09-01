"""A small in-process rate limiter.

Deliberately simple: a fixed-window counter held in memory, enough to blunt
credential stuffing and upload floods on a single instance. Behind more than one
worker this should be swapped for a shared Redis counter - the dependency
signature stays the same, only ``_hits`` changes.
"""

from __future__ import annotations

import threading
import time
from collections import defaultdict

from fastapi import Request

from app.core.config import settings
from app.core.errors import RateLimitError

_lock = threading.Lock()
_hits: dict[str, list[float]] = defaultdict(list)
#: Prune idle buckets once the table grows past this, so memory stays bounded.
_MAX_BUCKETS = 10_000


def _client_key(request: Request, scope: str) -> str:
    forwarded = request.headers.get("x-forwarded-for", "")
    ip = forwarded.split(",")[0].strip() if forwarded else (request.client.host if request.client else "-")
    return f"{scope}:{ip}"


def _prune(now: float, window: float) -> None:
    stale = [key for key, hits in _hits.items() if not hits or now - hits[-1] > window]
    for key in stale:
        _hits.pop(key, None)


def enforce(request: Request, scope: str, limit_per_minute: int) -> None:
    """Raise :class:`RateLimitError` when the caller exceeds ``limit_per_minute``."""
    if not settings.RATE_LIMIT_ENABLED or limit_per_minute <= 0:
        return

    window = 60.0
    now = time.monotonic()
    key = _client_key(request, scope)

    with _lock:
        if len(_hits) > _MAX_BUCKETS:
            _prune(now, window)
        bucket = [ts for ts in _hits[key] if now - ts < window]
        if len(bucket) >= limit_per_minute:
            retry_after = int(window - (now - bucket[0])) + 1
            _hits[key] = bucket
            raise RateLimitError(
                "Too many requests. Please wait a moment and try again.",
                details={"retry_after_seconds": retry_after},
            )
        bucket.append(now)
        _hits[key] = bucket


def reset() -> None:
    """Clear all counters (used by the test-suite)."""
    with _lock:
        _hits.clear()


def rate_limit(scope: str, limit_per_minute: int):
    """Build a FastAPI dependency: ``Depends(rate_limit("auth", 10))``.

    A closure rather than a callable class on purpose: FastAPI resolves a
    dependency's annotations through its ``__globals__``, which a class
    *instance* does not have. With ``from __future__ import annotations`` in
    force, an instance dependency would silently have ``request`` treated as a
    query parameter and every guarded endpoint would reject valid requests.
    """

    def dependency(request: Request) -> None:
        enforce(request, scope, limit_per_minute)

    return dependency


auth_rate_limit = rate_limit("auth", settings.RATE_LIMIT_AUTH_PER_MINUTE)
write_rate_limit = rate_limit("write", settings.RATE_LIMIT_WRITE_PER_MINUTE)
