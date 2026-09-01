"""Image validation, normalisation and perceptual hashing."""

from __future__ import annotations

import io

import pytest
from PIL import Image

from app.core.errors import ValidationError
from app.services.images import (
    hamming_distance,
    image_similarity,
    validate_and_process,
)
from tests.factories import make_image_bytes


class TestValidation:
    def test_accepts_jpeg(self) -> None:
        result = validate_and_process(make_image_bytes(), "image/jpeg")
        assert result.width > 0
        assert result.size_bytes > 0

    def test_accepts_png(self) -> None:
        result = validate_and_process(make_image_bytes(fmt="PNG"), "image/png")
        assert result.width > 0

    def test_rejects_empty_input(self) -> None:
        with pytest.raises(ValidationError, match="empty"):
            validate_and_process(b"", "image/jpeg")

    def test_rejects_a_file_that_is_not_an_image(self) -> None:
        """A script renamed .jpg must fail on content, not just declared type."""
        with pytest.raises(ValidationError, match="could not be read as an image"):
            validate_and_process(b"#!/bin/sh\necho pwned", "image/jpeg")

    def test_rejects_a_disallowed_declared_type(self) -> None:
        with pytest.raises(ValidationError, match="not supported"):
            validate_and_process(make_image_bytes(), "application/pdf")

    def test_rejects_a_gif_declared_as_jpeg(self) -> None:
        """Content, not the declared type, decides."""
        buffer = io.BytesIO()
        Image.new("RGB", (40, 40), (10, 20, 30)).save(buffer, format="GIF")

        with pytest.raises(ValidationError, match="not supported"):
            validate_and_process(buffer.getvalue(), "image/jpeg")

    def test_rejects_an_oversized_file(self) -> None:
        with pytest.raises(ValidationError, match="under"):
            validate_and_process(make_image_bytes(), "image/jpeg", max_bytes=100)

    def test_rejects_truncated_image_data(self) -> None:
        truncated = make_image_bytes()[:120]
        with pytest.raises(ValidationError):
            validate_and_process(truncated, "image/jpeg")


class TestNormalisation:
    def test_downscales_a_large_image(self) -> None:
        result = validate_and_process(
            make_image_bytes(3000, 2000), "image/jpeg", max_dimension=800
        )
        assert max(result.width, result.height) <= 800

    def test_compresses_the_payload(self) -> None:
        original = make_image_bytes(2400, 1800)
        result = validate_and_process(original, "image/jpeg", max_dimension=1200)
        assert result.size_bytes < len(original)

    def test_strips_exif_metadata(self) -> None:
        """Re-encoding must drop EXIF, including GPS tags the citizen did not intend to share."""
        image = Image.new("RGB", (200, 150), (120, 120, 120))
        buffer = io.BytesIO()
        exif = image.getexif()
        exif[271] = "TestCamera"
        image.save(buffer, format="JPEG", exif=exif)

        result = validate_and_process(buffer.getvalue(), "image/jpeg")

        with Image.open(io.BytesIO(result.data)) as processed:
            assert not dict(processed.getexif())


class TestPerceptualHash:
    def test_hash_is_stable(self) -> None:
        data = make_image_bytes()
        assert (
            validate_and_process(data, "image/jpeg").perceptual_hash
            == validate_and_process(data, "image/jpeg").perceptual_hash
        )

    def test_identical_images_are_maximally_similar(self) -> None:
        data = make_image_bytes()
        first = validate_and_process(data, "image/jpeg").perceptual_hash
        second = validate_and_process(data, "image/jpeg").perceptual_hash
        assert image_similarity(first, second) == 1.0

    def test_rescaled_image_stays_similar(self) -> None:
        """The near-duplicate case: the same photo at a different resolution."""
        original = validate_and_process(make_image_bytes(640, 480), "image/jpeg")
        rescaled = validate_and_process(make_image_bytes(320, 240), "image/jpeg")

        assert image_similarity(original.perceptual_hash, rescaled.perceptual_hash) > 0.85

    def test_different_images_are_less_similar(self) -> None:
        plain = validate_and_process(
            make_image_bytes(with_damage=False, colour=(200, 200, 200)), "image/jpeg"
        )
        damaged = validate_and_process(make_image_bytes(with_damage=True), "image/jpeg")

        assert image_similarity(plain.perceptual_hash, damaged.perceptual_hash) < 0.95

    def test_similarity_is_none_when_a_hash_is_missing(self) -> None:
        assert image_similarity(None, "abc") is None
        assert image_similarity("abc", None) is None

    def test_hamming_distance_handles_bad_input(self) -> None:
        assert hamming_distance("zzz", "yyy") == 64
