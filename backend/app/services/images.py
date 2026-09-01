"""Image validation, normalisation and perceptual hashing.

Uploads are the main untrusted input this system takes, so validation is
deliberately layered:

1. **size** - rejected before the bytes are ever decoded;
2. **declared MIME type** - must be on the allowlist;
3. **actual content** - the file is decoded and verified to be a real image of
   the claimed format. A ``.jpg`` that is actually a script fails here, which is
   the check that matters; the declared type alone proves nothing.

Accepted images are then re-encoded: the pixels are rewritten, which strips EXIF
(including GPS tags a citizen did not intend to publish) and any smuggled
payload, and downscales oversized photos so neither storage nor the detector is
handed a 12MP original.
"""

from __future__ import annotations

import io
from dataclasses import dataclass

from PIL import Image, ImageOps, UnidentifiedImageError

from app.core.config import settings
from app.core.errors import ValidationError

#: PIL format name -> canonical MIME type.
_FORMAT_TO_MIME = {"JPEG": "image/jpeg", "PNG": "image/png", "WEBP": "image/webp"}
_MIME_ALIASES = {"image/jpg": "image/jpeg"}


@dataclass(slots=True)
class ProcessedImage:
    data: bytes
    content_type: str
    width: int
    height: int
    size_bytes: int
    perceptual_hash: str


def validate_and_process(
    raw: bytes,
    declared_content_type: str,
    *,
    max_bytes: int | None = None,
    max_dimension: int | None = None,
) -> ProcessedImage:
    """Validate an upload and return a normalised, EXIF-stripped copy."""
    max_bytes = max_bytes or settings.MAX_UPLOAD_BYTES
    max_dimension = max_dimension or settings.IMAGE_MAX_DIMENSION

    if not raw:
        raise ValidationError("The uploaded file is empty.")

    if len(raw) > max_bytes:
        limit_mb = max_bytes / (1024 * 1024)
        actual_mb = len(raw) / (1024 * 1024)
        raise ValidationError(
            f"That image is {actual_mb:.1f}MB. Please upload a file under {limit_mb:.0f}MB.",
            details={"max_bytes": max_bytes, "size_bytes": len(raw)},
        )

    declared = _MIME_ALIASES.get((declared_content_type or "").lower(), (declared_content_type or "").lower())
    allowed = settings.allowed_image_types
    if declared and declared not in allowed:
        raise ValidationError(
            "That file type is not supported. Please upload a JPEG, PNG or WebP image.",
            details={"allowed": sorted(allowed)},
        )

    try:
        with Image.open(io.BytesIO(raw)) as probe:
            # verify() catches truncated and malformed files, but leaves the
            # instance unusable - hence the second open below.
            probe.verify()
            detected_format = (probe.format or "").upper()
    except (UnidentifiedImageError, OSError, ValueError) as exc:
        raise ValidationError(
            "That file could not be read as an image. It may be corrupted or not a real photo."
        ) from exc

    actual_mime = _FORMAT_TO_MIME.get(detected_format)
    if actual_mime is None or actual_mime not in allowed:
        raise ValidationError(
            "That file type is not supported. Please upload a JPEG, PNG or WebP image.",
            details={"detected": detected_format or "unknown", "allowed": sorted(allowed)},
        )

    try:
        with Image.open(io.BytesIO(raw)) as image:
            image.load()
            # Honour the EXIF orientation flag before discarding EXIF entirely.
            image = ImageOps.exif_transpose(image)
            has_alpha = image.mode in ("RGBA", "LA", "P")
            working = image.convert("RGBA" if has_alpha and actual_mime == "image/png" else "RGB")
            working.thumbnail((max_dimension, max_dimension), Image.LANCZOS)
            phash = _difference_hash(working)
            data, content_type = _encode(working, actual_mime)
            width, height = working.size
    except (OSError, ValueError) as exc:
        raise ValidationError("That image could not be processed. Please try a different photo.") from exc

    return ProcessedImage(
        data=data,
        content_type=content_type,
        width=width,
        height=height,
        size_bytes=len(data),
        perceptual_hash=phash,
    )


def _encode(image: Image.Image, mime: str) -> tuple[bytes, str]:
    """Re-encode, preferring JPEG for photographs and PNG only for alpha."""
    buffer = io.BytesIO()
    if mime == "image/png" and image.mode == "RGBA":
        image.save(buffer, format="PNG", optimize=True)
        return buffer.getvalue(), "image/png"

    rgb = image.convert("RGB")
    rgb.save(buffer, format="JPEG", quality=82, optimize=True, progressive=True)
    return buffer.getvalue(), "image/jpeg"


def _difference_hash(image: Image.Image, size: int = 8) -> str:
    """64-bit dHash.

    Compares each pixel with its right-hand neighbour on a 9x8 greyscale
    thumbnail. Robust to rescaling, re-compression and mild brightness shifts -
    which is exactly the near-duplicate case here: two people photographing the
    same pothole minutes apart.
    """
    thumb = image.convert("L").resize((size + 1, size), Image.LANCZOS)
    pixels = list(thumb.getdata())

    bits = 0
    index = 0
    for row in range(size):
        offset = row * (size + 1)
        for col in range(size):
            if pixels[offset + col] > pixels[offset + col + 1]:
                bits |= 1 << index
            index += 1

    return f"{bits:016x}"


def hamming_distance(hash_a: str, hash_b: str) -> int:
    """Differing bits between two hex hashes; 64 (max) if either is unusable."""
    try:
        return bin(int(hash_a, 16) ^ int(hash_b, 16)).count("1")
    except (TypeError, ValueError):
        return 64


def image_similarity(hash_a: str | None, hash_b: str | None) -> float | None:
    """0-1 visual similarity, or ``None`` when either hash is missing."""
    if not hash_a or not hash_b:
        return None
    return round(1.0 - (hamming_distance(hash_a, hash_b) / 64.0), 4)
