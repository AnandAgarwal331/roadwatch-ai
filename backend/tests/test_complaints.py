"""Complaint creation, validation, visibility and the full pipeline."""

from __future__ import annotations

from app.core.enums import ComplaintStatus, PriorityLevel
from tests.factories import make_image_bytes, submit_report


class TestSubmission:
    def test_creates_a_complaint_with_a_number(self, client, citizen_headers) -> None:
        response = submit_report(client, citizen_headers)

        assert response.status_code == 201
        complaint = response.json()["complaint"]
        assert complaint["complaint_number"].startswith("RW-")
        assert complaint["id"]

    def test_complaint_numbers_are_sequential_and_unique(self, client, citizen_headers) -> None:
        numbers = [
            submit_report(client, citizen_headers).json()["complaint"]["complaint_number"]
            for _ in range(4)
        ]
        assert len(set(numbers)) == 4
        assert numbers == sorted(numbers)

    def test_runs_the_full_pipeline(self, client, citizen_headers) -> None:
        """AI analysis, severity, location, traffic and priority all populated."""
        complaint = submit_report(client, citizen_headers).json()["complaint"]

        assert complaint["latest_analysis"] is not None
        assert complaint["latest_analysis"]["severity_score"] > 0
        assert complaint["priority"] is not None
        assert complaint["priority"]["total_score"] > 0
        assert complaint["traffic"] is not None
        assert complaint["severity_score"] > 0

    def test_priority_breakdown_has_all_four_factors(self, client, citizen_headers) -> None:
        priority = submit_report(client, citizen_headers).json()["complaint"]["priority"]

        keys = {factor["key"] for factor in priority["factors"]}
        assert keys == {"severity", "traffic", "location", "history"}

    def test_breakdown_points_sum_to_the_total(self, client, citizen_headers) -> None:
        priority = submit_report(client, citizen_headers).json()["complaint"]["priority"]

        total = sum(factor["points"] for factor in priority["factors"])
        assert abs(total - priority["total_score"]) < 0.05

    def test_priority_carries_the_disclaimer(self, client, citizen_headers) -> None:
        priority = submit_report(client, citizen_headers).json()["complaint"]["priority"]
        assert "authorized personnel" in priority["disclaimer"]

    def test_advances_to_prioritized(self, client, citizen_headers) -> None:
        complaint = submit_report(client, citizen_headers).json()["complaint"]
        assert complaint["status"] == ComplaintStatus.PRIORITIZED.value

    def test_records_the_status_history(self, client, citizen_headers) -> None:
        complaint = submit_report(client, citizen_headers).json()["complaint"]

        statuses = [entry["to_status"] for entry in complaint["status_history"]]
        assert ComplaintStatus.PENDING.value in statuses
        assert ComplaintStatus.PRIORITIZED.value in statuses

    def test_finds_nearby_facilities(self, client, db, citizen_headers) -> None:
        from app.core.enums import PlaceType
        from app.models.geo import SeededPlace

        db.add(
            SeededPlace(
                place_type=PlaceType.HOSPITAL,
                name="Test Hospital",
                latitude=12.9584,
                longitude=77.6496,
                city="Bengaluru",
            )
        )
        db.commit()

        complaint = submit_report(client, citizen_headers).json()["complaint"]
        names = [place["name"] for place in complaint["nearby_places"]]
        assert "Test Hospital" in names

    def test_stores_the_photo(self, client, citizen_headers) -> None:
        complaint = submit_report(client, citizen_headers).json()["complaint"]

        assert len(complaint["images"]) == 1
        assert complaint["images"][0]["url"]
        assert complaint["images"][0]["content_type"] == "image/jpeg"

    def test_gives_the_citizen_a_next_step(self, client, citizen_headers) -> None:
        body = submit_report(client, citizen_headers).json()
        assert len(body["next_step"]) > 20

    def test_requires_authentication(self, client) -> None:
        assert submit_report(client, {}).status_code == 401

    def test_submits_without_a_photo(self, client, citizen_headers) -> None:
        """A report with no photo is still accepted and scored on location."""
        response = client.post(
            "/api/complaints",
            data={
                "latitude": "12.9584",
                "longitude": "77.6494",
                "reported_damage_type": "POTHOLE",
                "description": "Pothole with no photo available.",
            },
            headers=citizen_headers,
        )

        assert response.status_code == 201
        body = response.json()
        assert body["needs_manual_review"] is True
        assert body["complaint"]["priority"]["total_score"] >= 0


class TestValidation:
    def test_rejects_an_invalid_latitude(self, client, citizen_headers) -> None:
        response = submit_report(client, citizen_headers, latitude=95.0)
        assert response.status_code == 422

    def test_rejects_an_invalid_longitude(self, client, citizen_headers) -> None:
        response = submit_report(client, citizen_headers, longitude=200.0)
        assert response.status_code == 422

    def test_rejects_a_non_image_file(self, client, citizen_headers) -> None:
        response = client.post(
            "/api/complaints",
            data={"latitude": "12.96", "longitude": "77.64"},
            files={"photo": ("evil.jpg", b"#!/bin/sh\nrm -rf /", "image/jpeg")},
            headers=citizen_headers,
        )

        assert response.status_code == 422
        assert "could not be read as an image" in response.json()["error"]["message"]

    def test_rejects_a_disallowed_mime_type(self, client, citizen_headers) -> None:
        response = client.post(
            "/api/complaints",
            data={"latitude": "12.96", "longitude": "77.64"},
            files={"photo": ("doc.pdf", b"%PDF-1.4 fake", "application/pdf")},
            headers=citizen_headers,
        )
        assert response.status_code == 422

    def test_rejects_an_oversized_file(self, client, citizen_headers) -> None:
        from app.core.config import settings

        oversized = b"\xff" * (settings.MAX_UPLOAD_BYTES + 1024)
        response = client.post(
            "/api/complaints",
            data={"latitude": "12.96", "longitude": "77.64"},
            files={"photo": ("big.jpg", oversized, "image/jpeg")},
            headers=citizen_headers,
        )

        assert response.status_code == 422
        assert "too large" in response.json()["error"]["message"]

    def test_accepts_png(self, client, citizen_headers) -> None:
        response = submit_report(
            client, citizen_headers, photo=make_image_bytes(fmt="PNG")
        )
        assert response.status_code == 201

    def test_never_returns_a_stack_trace(self, client, citizen_headers) -> None:
        response = client.post(
            "/api/complaints",
            data={"latitude": "12.96", "longitude": "77.64"},
            files={"photo": ("x.jpg", b"not an image at all", "image/jpeg")},
            headers=citizen_headers,
        )
        assert "Traceback" not in response.text
        assert "File \"" not in response.text


class TestVisibility:
    def test_lists_public_reports(self, client, citizen_headers) -> None:
        submit_report(client, citizen_headers)
        response = client.get("/api/complaints")

        assert response.status_code == 200
        assert response.json()["meta"]["total"] >= 1

    def test_my_reports_only_returns_own(self, client, citizen_headers, other_citizen) -> None:
        from tests.conftest import auth_header

        submit_report(client, citizen_headers)
        other_headers = auth_header(client, other_citizen.email)
        submit_report(client, other_headers, latitude=12.90, longitude=77.60)

        mine = client.get("/api/complaints/mine", headers=citizen_headers).json()
        assert mine["meta"]["total"] == 1

    def test_pagination_metadata(self, client, citizen_headers) -> None:
        for index in range(5):
            submit_report(client, citizen_headers, latitude=12.95 + index * 0.01)

        page = client.get("/api/complaints?page=1&page_size=2").json()
        assert len(page["items"]) == 2
        assert page["meta"]["total"] >= 5
        assert page["meta"]["has_next"] is True
        assert page["meta"]["has_previous"] is False

    def test_filters_by_damage_type(self, client, citizen_headers) -> None:
        submit_report(client, citizen_headers)
        response = client.get("/api/complaints?damage_type=POTHOLE")

        assert response.status_code == 200
        for item in response.json()["items"]:
            assert item["damage_type"] == "POTHOLE"

    def test_sorting_by_priority(self, client, citizen_headers) -> None:
        for index in range(4):
            submit_report(client, citizen_headers, latitude=12.95 + index * 0.01)

        items = client.get("/api/complaints?sort_by=priority_score&sort_dir=desc").json()["items"]
        scores = [item["priority_score"] for item in items]
        assert scores == sorted(scores, reverse=True)

    def test_detail_is_publicly_readable(self, client, citizen_headers) -> None:
        complaint_id = submit_report(client, citizen_headers).json()["complaint"]["id"]
        response = client.get(f"/api/complaints/{complaint_id}")
        assert response.status_code == 200

    def test_detail_hides_the_reporter_from_the_public(self, client, citizen_headers) -> None:
        complaint_id = submit_report(client, citizen_headers).json()["complaint"]["id"]
        assert client.get(f"/api/complaints/{complaint_id}").json()["reporter"] is None

    def test_owner_sees_the_reporter(self, client, citizen_headers) -> None:
        complaint_id = submit_report(client, citizen_headers).json()["complaint"]["id"]
        detail = client.get(f"/api/complaints/{complaint_id}", headers=citizen_headers).json()
        assert detail["reporter"] is not None

    def test_unknown_id_returns_404(self, client) -> None:
        import uuid

        response = client.get(f"/api/complaints/{uuid.uuid4()}")
        assert response.status_code == 404
        assert response.json()["error"]["code"] == "not_found"


class TestPriorityEndpoint:
    def test_returns_the_breakdown(self, client, citizen_headers) -> None:
        complaint_id = submit_report(client, citizen_headers).json()["complaint"]["id"]
        response = client.get(f"/api/complaints/{complaint_id}/priority")

        assert response.status_code == 200
        body = response.json()
        assert len(body["factors"]) == 4
        assert body["level"] in {level.value for level in PriorityLevel}
        assert body["explanation"]


class TestMap:
    def test_returns_markers(self, client, citizen_headers) -> None:
        submit_report(client, citizen_headers)
        response = client.get("/api/map/issues")

        assert response.status_code == 200
        assert len(response.json()) >= 1
        assert "latitude" in response.json()[0]

    def test_filters_by_bounding_box(self, client, citizen_headers) -> None:
        submit_report(client, citizen_headers, latitude=12.9584, longitude=77.6494)

        inside = client.get(
            "/api/map/issues?min_lat=12.9&min_lon=77.6&max_lat=13.0&max_lon=77.7"
        ).json()
        outside = client.get(
            "/api/map/issues?min_lat=20.0&min_lon=80.0&max_lat=21.0&max_lon=81.0"
        ).json()

        assert len(inside) >= 1
        assert len(outside) == 0
