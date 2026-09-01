"""S3-compatible object storage (AWS S3, Cloudflare R2, MinIO, Supabase Storage).

``boto3`` is intentionally not a hard dependency: development runs on local
storage, and pulling the AWS SDK into every install for a code path most people
never exercise is not worth it. Set ``STORAGE_PROVIDER=s3`` and
``pip install boto3`` to use this.
"""

from __future__ import annotations

import uuid
from datetime import UTC, datetime

from app.core.errors import NotFoundError, UpstreamServiceError
from app.providers.storage.base import StoredObject

_EXTENSIONS = {
    "image/jpeg": ".jpg",
    "image/jpg": ".jpg",
    "image/png": ".png",
    "image/webp": ".webp",
}


class S3StorageProvider:
    name = "s3"

    def __init__(
        self,
        bucket: str,
        public_base_url: str = "",
        region: str | None = None,
        endpoint_url: str | None = None,
    ) -> None:
        try:
            import boto3  # noqa: PLC0415 - optional dependency, imported on use
        except ImportError as exc:  # pragma: no cover - depends on the install
            raise UpstreamServiceError(
                "S3 storage is configured but boto3 is not installed. Run: pip install boto3"
            ) from exc

        if not bucket:
            raise UpstreamServiceError("STORAGE_BUCKET must be set when STORAGE_PROVIDER=s3")

        self.bucket = bucket
        self.public_base_url = public_base_url.rstrip("/")
        self._client = boto3.client("s3", region_name=region, endpoint_url=endpoint_url)

    def save(self, data: bytes, *, filename: str, content_type: str, folder: str) -> StoredObject:
        extension = _EXTENSIONS.get(content_type.lower(), ".bin")
        stamp = datetime.now(UTC).strftime("%Y/%m")
        key = f"{folder}/{stamp}/{uuid.uuid4().hex}{extension}"
        try:
            self._client.put_object(
                Bucket=self.bucket,
                Key=key,
                Body=data,
                ContentType=content_type,
                CacheControl="public, max-age=31536000, immutable",
            )
        except Exception as exc:  # noqa: BLE001 - botocore raises a wide family
            raise UpstreamServiceError("Could not save the uploaded file.") from exc

        return StoredObject(
            storage_key=key, url=self.url_for(key), size_bytes=len(data), content_type=content_type
        )

    def load(self, storage_key: str) -> bytes:
        try:
            response = self._client.get_object(Bucket=self.bucket, Key=storage_key)
            return response["Body"].read()
        except Exception as exc:  # noqa: BLE001
            raise NotFoundError("File not found.") from exc

    def delete(self, storage_key: str) -> None:
        try:
            self._client.delete_object(Bucket=self.bucket, Key=storage_key)
        except Exception as exc:  # noqa: BLE001
            raise UpstreamServiceError("Could not delete the file.") from exc

    def url_for(self, storage_key: str) -> str:
        if self.public_base_url:
            return f"{self.public_base_url}/{storage_key}"
        return f"https://{self.bucket}.s3.amazonaws.com/{storage_key}"
