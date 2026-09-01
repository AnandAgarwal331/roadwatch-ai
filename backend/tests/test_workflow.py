"""Status transitions, assignment, the repair lifecycle and duplicate handling."""

from __future__ import annotations

import uuid

import pytest

from app.core.enums import AssignmentStatus, ComplaintStatus
from tests.factories import make_image_bytes, submit_report


def create_complaint(client, headers, **kwargs) -> dict:
    return submit_report(client, headers, **kwargs).json()["complaint"]


class TestStatusTransitions:
    def test_admin_can_advance_status(self, client, citizen_headers, admin_headers) -> None:
        complaint = create_complaint(client, citizen_headers)

        response = client.patch(
            f"/api/admin/reports/{complaint['id']}/status",
            json={"status": ComplaintStatus.REJECTED.value, "note": "Not a road defect"},
            headers=admin_headers,
        )

        assert response.status_code == 200
        assert response.json()["status"] == ComplaintStatus.REJECTED.value

    def test_illegal_transition_is_refused(self, client, citizen_headers, admin_headers) -> None:
        """PRIORITIZED cannot jump straight to RESOLVED - work must happen first."""
        complaint = create_complaint(client, citizen_headers)

        response = client.patch(
            f"/api/admin/reports/{complaint['id']}/status",
            json={"status": ComplaintStatus.RESOLVED.value},
            headers=admin_headers,
        )

        assert response.status_code == 409
        body = response.json()["error"]
        assert body["code"] == "invalid_status_transition"
        assert "allowed" in body["details"]

    def test_every_change_is_recorded(self, client, citizen_headers, admin_headers) -> None:
        complaint = create_complaint(client, citizen_headers)

        client.patch(
            f"/api/admin/reports/{complaint['id']}/status",
            json={"status": ComplaintStatus.REJECTED.value, "note": "Duplicate of another"},
            headers=admin_headers,
        )
        detail = client.get(
            f"/api/admin/reports/{complaint['id']}", headers=admin_headers
        ).json()

        transitions = [entry["to_status"] for entry in detail["status_history"]]
        assert ComplaintStatus.REJECTED.value in transitions

    def test_citizen_cannot_change_status(self, client, citizen_headers) -> None:
        complaint = create_complaint(client, citizen_headers)

        response = client.patch(
            f"/api/admin/reports/{complaint['id']}/status",
            json={"status": ComplaintStatus.RESOLVED.value},
            headers=citizen_headers,
        )
        assert response.status_code == 403

    def test_rejection_requires_a_reason(self, client, citizen_headers, admin_headers) -> None:
        complaint = create_complaint(client, citizen_headers)

        response = client.post(
            f"/api/admin/reports/{complaint['id']}/reject",
            json={"reason": ""},
            headers=admin_headers,
        )
        assert response.status_code == 422


class TestPriorityOverride:
    def test_admin_can_override(self, client, citizen_headers, admin_headers) -> None:
        complaint = create_complaint(client, citizen_headers)

        response = client.patch(
            f"/api/admin/reports/{complaint['id']}/priority",
            json={"priority_score": 95, "note": "Escalated after site visit"},
            headers=admin_headers,
        )

        assert response.status_code == 200
        body = response.json()
        assert body["priority_score"] == 95
        assert body["priority_level"] == "CRITICAL"
        assert body["manual_priority_override"] == 95

    def test_override_is_audited(self, client, citizen_headers, admin_headers) -> None:
        complaint = create_complaint(client, citizen_headers)
        client.patch(
            f"/api/admin/reports/{complaint['id']}/priority",
            json={"priority_score": 95},
            headers=admin_headers,
        )

        audit = client.get(
            f"/api/admin/audit?complaint_id={complaint['id']}", headers=admin_headers
        ).json()
        actions = [entry["action"] for entry in audit]
        assert "complaint.priority_overridden" in actions

    def test_rejects_an_out_of_range_score(self, client, citizen_headers, admin_headers) -> None:
        complaint = create_complaint(client, citizen_headers)
        response = client.patch(
            f"/api/admin/reports/{complaint['id']}/priority",
            json={"priority_score": 150},
            headers=admin_headers,
        )
        assert response.status_code == 422


class TestAssignment:
    def test_admin_assigns_a_team(self, client, citizen_headers, admin_headers, team) -> None:
        complaint = create_complaint(client, citizen_headers)

        response = client.post(
            f"/api/admin/reports/{complaint['id']}/assign",
            json={"team_id": str(team.id)},
            headers=admin_headers,
        )

        assert response.status_code == 200
        assert response.json()["status"] == AssignmentStatus.ASSIGNED.value

    def test_assignment_moves_the_complaint(self, client, citizen_headers, admin_headers, team) -> None:
        complaint = create_complaint(client, citizen_headers)
        client.post(
            f"/api/admin/reports/{complaint['id']}/assign",
            json={"team_id": str(team.id)},
            headers=admin_headers,
        )

        detail = client.get(f"/api/admin/reports/{complaint['id']}", headers=admin_headers).json()
        assert detail["status"] == ComplaintStatus.ASSIGNED.value

    def test_assignment_sets_a_deadline(self, client, citizen_headers, admin_headers, team) -> None:
        complaint = create_complaint(client, citizen_headers)
        response = client.post(
            f"/api/admin/reports/{complaint['id']}/assign",
            json={"team_id": str(team.id)},
            headers=admin_headers,
        )
        assert response.json()["due_at"] is not None

    def test_double_assignment_to_the_same_team_conflicts(
        self, client, citizen_headers, admin_headers, team
    ) -> None:
        complaint = create_complaint(client, citizen_headers)
        payload = {"team_id": str(team.id)}
        client.post(
            f"/api/admin/reports/{complaint['id']}/assign", json=payload, headers=admin_headers
        )
        second = client.post(
            f"/api/admin/reports/{complaint['id']}/assign", json=payload, headers=admin_headers
        )
        assert second.status_code == 409

    def test_unknown_team_returns_404(self, client, citizen_headers, admin_headers) -> None:
        complaint = create_complaint(client, citizen_headers)
        response = client.post(
            f"/api/admin/reports/{complaint['id']}/assign",
            json={"team_id": str(uuid.uuid4())},
            headers=admin_headers,
        )
        assert response.status_code == 404

    def test_capacity_limit_is_enforced(
        self, client, db, citizen_headers, admin_headers, team
    ) -> None:
        team.max_concurrent_jobs = 1
        db.commit()

        first = create_complaint(client, citizen_headers, latitude=12.95)
        second = create_complaint(client, citizen_headers, latitude=12.99)

        client.post(
            f"/api/admin/reports/{first['id']}/assign",
            json={"team_id": str(team.id)},
            headers=admin_headers,
        )
        response = client.post(
            f"/api/admin/reports/{second['id']}/assign",
            json={"team_id": str(team.id)},
            headers=admin_headers,
        )

        assert response.status_code == 409
        assert "limit" in response.json()["error"]["details"]

    def test_citizen_cannot_assign(self, client, citizen_headers, team) -> None:
        complaint = create_complaint(client, citizen_headers)
        response = client.post(
            f"/api/admin/reports/{complaint['id']}/assign",
            json={"team_id": str(team.id)},
            headers=citizen_headers,
        )
        assert response.status_code == 403


class TestRepairLifecycle:
    @pytest.fixture
    def assigned(self, client, citizen_headers, admin_headers, team) -> dict:
        complaint = create_complaint(client, citizen_headers)
        assignment = client.post(
            f"/api/admin/reports/{complaint['id']}/assign",
            json={"team_id": str(team.id)},
            headers=admin_headers,
        ).json()
        return {"complaint": complaint, "assignment": assignment}

    def test_crew_sees_the_job(self, client, crew_headers, assigned) -> None:
        tasks = client.get("/api/team/tasks", headers=crew_headers).json()
        assert any(task["id"] == assigned["assignment"]["id"] for task in tasks)

    def test_status_filter_narrows_the_list(self, client, crew_headers, assigned) -> None:
        # A list parameter declared without Query() is read from the body, so a
        # GET would silently ignore it and hand the crew every job back under
        # every filter tab. Assert the filter actually excludes something.
        matching = client.get(
            "/api/team/tasks", params={"status_filter": "ASSIGNED"}, headers=crew_headers
        )
        other = client.get(
            "/api/team/tasks", params={"status_filter": "VERIFIED"}, headers=crew_headers
        )

        assert matching.status_code == 200
        assert [task["id"] for task in matching.json()] == [assigned["assignment"]["id"]]
        assert other.json() == []

    def test_status_filter_accepts_several_values(self, client, crew_headers, assigned) -> None:
        response = client.get(
            "/api/team/tasks",
            params=[("status_filter", "ASSIGNED"), ("status_filter", "IN_PROGRESS")],
            headers=crew_headers,
        )

        assert response.status_code == 200
        assert any(task["id"] == assigned["assignment"]["id"] for task in response.json())

    def test_status_filter_rejects_a_value_that_is_not_a_status(
        self, client, crew_headers, assigned
    ) -> None:
        response = client.get(
            "/api/team/tasks", params={"status_filter": "NOT_A_STATUS"}, headers=crew_headers
        )

        assert response.status_code == 422

    def test_crew_dashboard_loads(self, client, crew_headers, assigned) -> None:
        response = client.get("/api/team/dashboard", headers=crew_headers)

        assert response.status_code == 200
        assert response.json()["stats"]["open_jobs"] >= 1

    def test_crew_starts_the_repair(self, client, crew_headers, assigned) -> None:
        response = client.post(
            f"/api/team/tasks/{assigned['assignment']['id']}/start", headers=crew_headers
        )

        assert response.status_code == 200
        assert response.json()["status"] == AssignmentStatus.IN_PROGRESS.value

    def test_starting_moves_the_complaint_to_in_progress(
        self, client, crew_headers, admin_headers, assigned
    ) -> None:
        client.post(f"/api/team/tasks/{assigned['assignment']['id']}/start", headers=crew_headers)

        detail = client.get(
            f"/api/admin/reports/{assigned['complaint']['id']}", headers=admin_headers
        ).json()
        assert detail["status"] == ComplaintStatus.IN_PROGRESS.value

    def test_completion_requires_evidence(self, client, crew_headers, assigned) -> None:
        client.post(f"/api/team/tasks/{assigned['assignment']['id']}/start", headers=crew_headers)

        response = client.post(
            f"/api/team/tasks/{assigned['assignment']['id']}/complete",
            data={"note": "Done"},
            headers=crew_headers,
        )

        assert response.status_code == 422
        assert "photo" in response.json()["error"]["message"].lower()

    def test_crew_completes_with_evidence(self, client, crew_headers, assigned) -> None:
        client.post(f"/api/team/tasks/{assigned['assignment']['id']}/start", headers=crew_headers)

        response = client.post(
            f"/api/team/tasks/{assigned['assignment']['id']}/complete",
            data={"note": "Patched and compacted."},
            files={"photos": ("done.jpg", make_image_bytes(), "image/jpeg")},
            headers=crew_headers,
        )

        assert response.status_code == 200
        body = response.json()
        assert body["status"] == AssignmentStatus.COMPLETED.value
        assert len(body["evidence"]) == 1

    def test_admin_verifies_and_the_complaint_resolves(
        self, client, crew_headers, admin_headers, assigned
    ) -> None:
        assignment_id = assigned["assignment"]["id"]
        complaint_id = assigned["complaint"]["id"]

        client.post(f"/api/team/tasks/{assignment_id}/start", headers=crew_headers)
        client.post(
            f"/api/team/tasks/{assignment_id}/complete",
            data={"note": "Done"},
            files={"photos": ("done.jpg", make_image_bytes(), "image/jpeg")},
            headers=crew_headers,
        )

        response = client.post(
            f"/api/admin/reports/{complaint_id}/verify",
            json={"note": "Inspected on site"},
            headers=admin_headers,
        )

        assert response.status_code == 200
        assert response.json()["status"] == ComplaintStatus.RESOLVED.value
        assert response.json()["resolved_at"] is not None

    def test_cannot_verify_before_completion(self, client, admin_headers, assigned) -> None:
        response = client.post(
            f"/api/admin/reports/{assigned['complaint']['id']}/verify",
            json={},
            headers=admin_headers,
        )
        assert response.status_code == 409

    def test_crew_cannot_see_another_teams_job(
        self, client, db, assigned, admin_headers
    ) -> None:
        from app.core.enums import UserRole
        from app.models.repair import RepairTeam
        from tests.conftest import _make_user, auth_header

        other_team = RepairTeam(name="Other Crew", code="RT-OTHER", max_concurrent_jobs=3)
        db.add(other_team)
        db.commit()
        db.refresh(other_team)

        outsider = _make_user(db, UserRole.REPAIR_TEAM, "outsider@example.com", team_id=other_team.id)
        outsider_headers = auth_header(client, outsider.email)

        response = client.get(
            f"/api/team/tasks/{assigned['assignment']['id']}", headers=outsider_headers
        )
        assert response.status_code == 404

    def test_citizen_sees_the_resolution(
        self, client, citizen_headers, crew_headers, admin_headers, assigned
    ) -> None:
        assignment_id = assigned["assignment"]["id"]
        complaint_id = assigned["complaint"]["id"]

        client.post(f"/api/team/tasks/{assignment_id}/start", headers=crew_headers)
        client.post(
            f"/api/team/tasks/{assignment_id}/complete",
            data={"note": "Done"},
            files={"photos": ("done.jpg", make_image_bytes(), "image/jpeg")},
            headers=crew_headers,
        )
        client.post(f"/api/admin/reports/{complaint_id}/verify", json={}, headers=admin_headers)

        mine = client.get("/api/complaints/mine", headers=citizen_headers).json()
        assert mine["items"][0]["status"] == ComplaintStatus.RESOLVED.value

    def test_citizen_is_notified(
        self, client, citizen_headers, crew_headers, admin_headers, assigned
    ) -> None:
        assignment_id = assigned["assignment"]["id"]
        complaint_id = assigned["complaint"]["id"]

        client.post(f"/api/team/tasks/{assignment_id}/start", headers=crew_headers)
        client.post(
            f"/api/team/tasks/{assignment_id}/complete",
            data={"note": "Done"},
            files={"photos": ("done.jpg", make_image_bytes(), "image/jpeg")},
            headers=crew_headers,
        )
        client.post(f"/api/admin/reports/{complaint_id}/verify", json={}, headers=admin_headers)

        notifications = client.get("/api/notifications", headers=citizen_headers).json()
        events = [item["event"] for item in notifications["items"]]
        assert "complaint.resolved" in events


class TestDuplicates:
    def test_near_identical_reports_are_flagged(self, client, citizen_headers) -> None:
        photo = make_image_bytes()
        submit_report(client, citizen_headers, latitude=12.9584, longitude=77.6494, photo=photo)
        second = submit_report(
            client, citizen_headers, latitude=12.95841, longitude=77.64941, photo=photo
        ).json()

        assert len(second["duplicate_candidates"]) >= 1
        assert "same road issue" in second["duplicate_candidates"][0]["reason"]

    def test_distant_reports_are_not_flagged(self, client, citizen_headers) -> None:
        submit_report(client, citizen_headers, latitude=12.9584, longitude=77.6494)
        second = submit_report(client, citizen_headers, latitude=13.5, longitude=78.5).json()

        assert second["duplicate_candidates"] == []

    def test_duplicates_are_never_auto_deleted(self, client, citizen_headers) -> None:
        photo = make_image_bytes()
        first = submit_report(
            client, citizen_headers, latitude=12.9584, longitude=77.6494, photo=photo
        ).json()["complaint"]
        submit_report(client, citizen_headers, latitude=12.95841, longitude=77.64941, photo=photo)

        assert client.get(f"/api/complaints/{first['id']}").status_code == 200

    def test_admin_confirms_a_duplicate(self, client, citizen_headers, admin_headers) -> None:
        photo = make_image_bytes()
        submit_report(client, citizen_headers, latitude=12.9584, longitude=77.6494, photo=photo)
        submit_report(client, citizen_headers, latitude=12.95841, longitude=77.64941, photo=photo)

        pending = client.get("/api/admin/duplicates", headers=admin_headers).json()
        assert len(pending) >= 1

        response = client.post(
            f"/api/admin/duplicates/{pending[0]['id']}/confirm", headers=admin_headers
        )
        assert response.status_code == 200
        assert "linked to" in response.json()["message"]

    def test_confirming_raises_the_report_count(self, client, citizen_headers, admin_headers) -> None:
        photo = make_image_bytes()
        first = submit_report(
            client, citizen_headers, latitude=12.9584, longitude=77.6494, photo=photo
        ).json()["complaint"]
        submit_report(client, citizen_headers, latitude=12.95841, longitude=77.64941, photo=photo)

        pending = client.get("/api/admin/duplicates", headers=admin_headers).json()
        client.post(f"/api/admin/duplicates/{pending[0]['id']}/confirm", headers=admin_headers)

        detail = client.get(f"/api/admin/reports/{first['id']}", headers=admin_headers).json()
        assert detail["report_count"] >= 2

    def test_admin_rejects_a_suggestion(self, client, citizen_headers, admin_headers) -> None:
        photo = make_image_bytes()
        submit_report(client, citizen_headers, latitude=12.9584, longitude=77.6494, photo=photo)
        submit_report(client, citizen_headers, latitude=12.95841, longitude=77.64941, photo=photo)

        pending = client.get("/api/admin/duplicates", headers=admin_headers).json()
        response = client.post(
            f"/api/admin/duplicates/{pending[0]['id']}/reject", headers=admin_headers
        )

        assert response.status_code == 200
        remaining = client.get("/api/admin/duplicates", headers=admin_headers).json()
        assert len(remaining) < len(pending)
