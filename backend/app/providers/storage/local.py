"""Local-filesystem storage for development.

Files are written under ``STORAGE_LOCAL_DIR`` and served by the API at
``STORAGE_PUBLIC_BASE_URL``. Keys are generated server-side and validated on
read, so a caller-supplied key can never escape the storage root.
"""

from __future__ import annotations

import uuid
from datetime import UTC, datetime
from pathlib import Path

from app.core.errors import NotFoundError, UpstreamServiceError
from app.providers.storage.base import StoredObject

_EXTENSIONS = {
    "image/jpeg": ".jpg",
    "image/jpg": ".jpg",
    "image/png": ".png",
    "image/webp": ".webp",
}


class LocalStorageProvider:
    name = "local"

    def __init__(self, root_dir: str, public_base_url: str) -> None:
        self.root = Path(root_dir).resolve()
        self.public_base_url = public_base_url.rstrip("/")
        self.root.mkdir(parents=True, exist_ok=True)

    def save(self, data: bytes, *, filename: str, content_type: str, folder: str) -> StoredObject:
        # The extension comes from the validated MIME type, never from the
        # user-supplied filename - that is how ".jpg.php" style tricks get in.
        extension = _EXTENSIONS.get(content_type.lower(), ".bin")
        stamp = datetime.now(UTC).strftime("%Y/%m")
        safe_folder = "".join(ch for ch in folder if ch.isalnum() or ch in "-_") or "misc"
        key = f"{safe_folder}/{stamp}/{uuid.uuid4().hex}{extension}"

        destination = self._resolve(key)
        destination.parent.mkdir(parents=True, exist_ok=True)
        try:
            destination.write_bytes(data)
        except OSError as exc:
            raise UpstreamServiceError("Could not save the uploaded file.") from exc

        return StoredObject(
            storage_key=key,
            url=self.url_for(key),
            size_bytes=len(data),
            content_type=content_type,
        )

    def load(self, storage_key: str) -> bytes:
        path = self._resolve(storage_key)
        if not path.is_file():
            raise NotFoundError("File not found.")
        return path.read_bytes()

    def delete(self, storage_key: str) -> None:
        path = self._resolve(storage_key)
        path.unlink(missing_ok=True)

    def url_for(self, storage_key: str) -> str:
        return f"{self.public_base_url}/{storage_key.lstrip('/')}"

    def _resolve(self, storage_key: str) -> Path:
        """Resolve a key inside the storage root, refusing traversal."""
        candidate = (self.root / storage_key.lstrip("/")).resolve()
        if not candidate.is_relative_to(self.root):
            raise NotFoundError("File not found.")
        return candidate
