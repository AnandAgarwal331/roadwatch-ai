"""Helpers for building test fixtures."""

from __future__ import annotations

import io

from PIL import Image, ImageDraw


def make_image_bytes(
    width: int = 320,
    height: int = 240,
    fmt: str = "JPEG",
    *,
    with_damage: bool = True,
    colour: tuple[int, int, int] = (110, 110, 114),
) -> bytes:
    """A small synthetic road photo."""
    image = Image.new("RGB", (width, height), colour)
    if with_damage:
        draw = ImageDraw.Draw(image)
        draw.ellipse(
            [width // 4, height // 3, width // 4 + width // 3, height // 3 + height // 4],
            fill=(22, 20, 20),
        )
    buffer = io.BytesIO()
    image.save(buffer, format=fmt)
    return buffer.getvalue()


def make_oversized_bytes(size: int) -> bytes:
    return b"\xff" * size


def submit_report(
    client,
    headers: dict[str, str],
    *,
    latitude: float = 12.9584,
    longitude: float = 77.6494,
    damage_type: str = "POTHOLE",
    road_name: str = "Old Airport Road",
    description: str = "Deep pothole in the left lane.",
    photo: bytes | None = None,
):
    """Submit a complaint through the real HTTP endpoint."""
    files = {"photo": ("road.jpg", photo if photo is not None else make_image_bytes(), "image/jpeg")}
    data = {
        "latitude": str(latitude),
        "longitude": str(longitude),
        "reported_damage_type": damage_type,
        "road_name": road_name,
        "description": description,
        "city": "Bengaluru",
    }
    return client.post("/api/complaints", data=data, files=files, headers=headers)
