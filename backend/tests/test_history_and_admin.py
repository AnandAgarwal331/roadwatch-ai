"""Complaint-history scoring and the admin dashboard/analytics surfaces."""

from __future__ import annotations

from datetime import UTC, datetime, timedelta

from app.core.enums import ComplaintStatus, DamageType, PriorityLevel
from app.models.complaint import Complaint
from app.repositories.complaint import ComplaintRepository
from app.services.history import ComplaintHistoryService
from tests.factories import submit_report


def add_complaint(
    db,
    latitude: float,
    longitude: float,
    *,
    status: ComplaintStatus = ComplaintStatus.PRIORITIZED,
    days_ago: int = 1,
    number: str | None = None,
) -> Complaint:
    complaint = Complaint(
        complaint_number=number or f"RW-2026-{abs(hash((latitude, longitude, days_ago))) % 999999:06d}",
        latitude=latitude,
        longitude=longitude,
        damage_type=DamageType.POTHOLE,
        status=status,
        created_at=datetime.now(UTC) - timedelta(days=days_ago),
    )
    db.add(complaint)
    db.commit()
    return complaint


class TestComplaintHistory:
    def test_no_neighbours_scores_zero(self, db) -> None:
        service = ComplaintHistoryService(ComplaintRepository(db))
        result = service.analyse(12.9584, 77.6494)

        assert result.score == 0.0
        assert result.total_previous == 0
        assert "No previous reports" in result.explanation

    def test_counts_nearby_reports(self, db) -> None:
        for index in range(3):
            add_complaint(db, 12.9584 + index * 0.00005, 77.6494, days_ago=2)

        result = ComplaintHistoryService(ComplaintRepository(db)).analyse(12.9584, 77.6494)
        assert result.total_previous == 3
        assert result.last_7_days == 3
        assert result.score > 0

    def test_ignores_reports_outside_the_radius(self, db) -> None:
        add_complaint(db, 13.5, 78.5, days_ago=1)

        result = ComplaintHistoryService(ComplaintRepository(db)).analyse(12.9584, 77.6494)
        assert result.total_previous == 0

    def test_recent_reports_weigh_more_than_old_ones(self, db) -> None:
        repository = ComplaintRepository(db)
        service = ComplaintHistoryService(repository)

        add_complaint(db, 12.9584, 77.6494, days_ago=2)
        recent = service.analyse(12.9584, 77.6494).score

        db.query(Complaint).delete()
        db.commit()

        add_complaint(db, 12.9584, 77.6494, days_ago=300)
        old = service.analyse(12.9584, 77.6494).score

        assert recent > old

    def test_unresolved_weighs_more_than_resolved(self, db) -> None:
        service = ComplaintHistoryService(ComplaintRepository(db))

        add_complaint(db, 12.9584, 77.6494, status=ComplaintStatus.PRIORITIZED, days_ago=3)
        unresolved = service.analyse(12.9584, 77.6494).score

        db.query(Complaint).delete()
        db.commit()

        add_complaint(db, 12.9584, 77.6494, status=ComplaintStatus.RESOLVED, days_ago=3)
        resolved = service.analyse(12.9584, 77.6494).score

        assert unresolved > resolved

    def test_score_is_capped_at_ten(self, db) -> None:
        for index in range(40):
            add_complaint(db, 12.9584 + index * 0.000002, 77.6494, days_ago=1)

        result = ComplaintHistoryService(ComplaintRepository(db)).analyse(12.9584, 77.6494)
        assert result.score == 10.0

    def test_excludes_the_complaint_itself(self, db) -> None:
        complaint = add_complaint(db, 12.9584, 77.6494, days_ago=1)

        result = ComplaintHistoryService(ComplaintRepository(db)).analyse(
            12.9584, 77.6494, exclude_id=complaint.id
        )
        assert result.total_previous == 0


class TestAdminDashboard:
    def test_returns_kpis_and_queue(self, client, citizen_headers, admin_headers) -> None:
        submit_report(client, citizen_headers)
        response = client.get("/api/admin/dashboard", headers=admin_headers)

        assert response.status_code == 200
        body = response.json()
        assert body["kpis"]["total_reports"] >= 1
        assert isinstance(body["priority_queue"], list)
        assert isinstance(body["status_distribution"], list)

    def test_queue_is_sorted_by_priority(self, client, citizen_headers, admin_headers) -> None:
        for index in range(4):
            submit_report(client, citizen_headers, latitude=12.95 + index * 0.01)

        queue = client.get("/api/admin/dashboard", headers=admin_headers).json()["priority_queue"]
        scores = [item["priority_score"] for item in queue]
        assert scores == sorted(scores, reverse=True)

    def test_queue_excludes_closed_reports(self, client, citizen_headers, admin_headers) -> None:
        complaint = submit_report(client, citizen_headers).json()["complaint"]
        client.post(
            f"/api/admin/reports/{complaint['id']}/reject",
            json={"reason": "Not a defect"},
            headers=admin_headers,
        )

        queue = client.get("/api/admin/dashboard", headers=admin_headers).json()["priority_queue"]
        assert complaint["id"] not in [item["id"] for item in queue]


class TestAdminReports:
    def test_lists_all_reports(self, client, citizen_headers, admin_headers) -> None:
        submit_report(client, citizen_headers)
        response = client.get("/api/admin/reports", headers=admin_headers)

        assert response.status_code == 200
        assert response.json()["meta"]["total"] >= 1

    def test_admin_sees_rejected_reports(self, client, citizen_headers, admin_headers) -> None:
        complaint = submit_report(client, citizen_headers).json()["complaint"]
        client.post(
            f"/api/admin/reports/{complaint['id']}/reject",
            json={"reason": "Not a defect"},
            headers=admin_headers,
        )

        listed = client.get("/api/admin/reports?status=REJECTED", headers=admin_headers).json()
        assert listed["meta"]["total"] == 1

        public = client.get("/api/complaints?status=REJECTED").json()
        assert public["meta"]["total"] == 0

    def test_search_by_complaint_number(self, client, citizen_headers, admin_headers) -> None:
        complaint = submit_report(client, citizen_headers).json()["complaint"]

        results = client.get(
            f"/api/admin/reports?search={complaint['complaint_number']}", headers=admin_headers
        ).json()
        assert results["meta"]["total"] == 1

    def test_search_input_is_not_interpolated(self, client, citizen_headers, admin_headers) -> None:
        """An injection attempt is treated as an ordinary search string."""
        submit_report(client, citizen_headers)

        response = client.get(
            "/api/admin/reports?search=' OR 1=1; DROP TABLE complaints;--", headers=admin_headers
        )

        assert response.status_code == 200
        assert response.json()["meta"]["total"] == 0
        assert client.get("/api/admin/reports", headers=admin_headers).json()["meta"]["total"] >= 1


class TestAnalytics:
    def test_returns_every_section(self, client, citizen_headers, admin_headers) -> None:
        submit_report(client, citizen_headers)
        response = client.get("/api/admin/analytics", headers=admin_headers)

        assert response.status_code == 200
        body = response.json()
        for section in (
            "kpis",
            "reports_over_time",
            "by_damage_type",
            "by_area",
            "priority_distribution",
            "status_distribution",
            "top_roads",
            "repeat_locations",
            "team_performance",
            "resolution_by_priority",
        ):
            assert section in body, section

    def test_time_series_has_no_gaps(self, client, citizen_headers, admin_headers) -> None:
        submit_report(client, citizen_headers)
        series = client.get("/api/admin/analytics?days=14", headers=admin_headers).json()[
            "reports_over_time"
        ]

        assert len(series) == 14
        assert all("date" in point and "reported" in point for point in series)

    def test_priority_distribution_covers_all_levels(self, client, admin_headers) -> None:
        distribution = client.get("/api/admin/analytics", headers=admin_headers).json()[
            "priority_distribution"
        ]
        assert {item["level"] for item in distribution} == {level.value for level in PriorityLevel}

    def test_repeat_locations_cluster_nearby_reports(
        self, client, citizen_headers, admin_headers
    ) -> None:
        for offset in range(3):
            submit_report(
                client, citizen_headers, latitude=12.9584 + offset * 0.00004, longitude=77.6494
            )

        clusters = client.get("/api/admin/analytics", headers=admin_headers).json()[
            "repeat_locations"
        ]
        assert any(cluster["report_count"] >= 2 for cluster in clusters)


class TestSettingsEndpoint:
    def test_exposes_live_scoring_configuration(self, client, admin_headers) -> None:
        response = client.get("/api/admin/settings", headers=admin_headers)

        assert response.status_code == 200
        body = response.json()
        assert body["priority_weights"]["severity"] == 4.0
        assert body["priority_thresholds"]["critical"] == 85.0
        assert body["engine_version"] == "weighted-v1"


class TestTeamsAdmin:
    def test_lists_teams_with_workload(self, client, admin_headers, team) -> None:
        response = client.get("/api/admin/teams", headers=admin_headers)

        assert response.status_code == 200
        body = response.json()
        assert body[0]["open_jobs"] == 0
        assert body[0]["max_concurrent_jobs"] == team.max_concurrent_jobs

    def test_creates_a_team(self, client, admin_headers) -> None:
        response = client.post(
            "/api/admin/teams",
            json={"name": "New Crew", "code": "rt-new", "zone": "West", "max_concurrent_jobs": 4},
            headers=admin_headers,
        )

        assert response.status_code == 200
        assert response.json()["code"] == "RT-NEW"

    def test_rejects_a_duplicate_code(self, client, admin_headers, team) -> None:
        response = client.post(
            "/api/admin/teams", json={"name": "Clash", "code": team.code}, headers=admin_headers
        )
        assert response.status_code == 409

    def test_updates_a_team(self, client, admin_headers, team) -> None:
        response = client.patch(
            f"/api/admin/teams/{team.id}", json={"is_active": False}, headers=admin_headers
        )

        assert response.status_code == 200
        assert response.json()["is_active"] is False


class TestHealth:
    def test_reports_status(self, client) -> None:
        response = client.get("/health")

        assert response.status_code == 200
        body = response.json()
        assert body["status"] == "ok"
        assert body["database"] == "up"
