"""Authentication and authorisation."""

from __future__ import annotations

from app.core.enums import UserRole
from tests.conftest import TEST_PASSWORD, auth_header

REGISTRATION = {
    "email": "new.citizen@example.com",
    "password": "Password123",
    "full_name": "New Citizen",
    "phone": "+91 98450 55555",
}


class TestRegistration:
    def test_registers_and_returns_a_token(self, client) -> None:
        response = client.post("/api/auth/register", json=REGISTRATION)

        assert response.status_code == 201
        body = response.json()
        assert body["access_token"]
        assert body["user"]["email"] == "new.citizen@example.com"
        assert body["user"]["role"] == UserRole.CITIZEN.value

    def test_never_returns_the_password(self, client) -> None:
        response = client.post("/api/auth/register", json=REGISTRATION)
        assert "password" not in response.text.lower().replace("password123", "")

    def test_rejects_a_duplicate_email(self, client) -> None:
        client.post("/api/auth/register", json=REGISTRATION)
        response = client.post("/api/auth/register", json=REGISTRATION)

        assert response.status_code == 409
        assert response.json()["error"]["code"] == "conflict"

    def test_email_is_case_insensitive(self, client) -> None:
        client.post("/api/auth/register", json=REGISTRATION)
        response = client.post(
            "/api/auth/register", json={**REGISTRATION, "email": "NEW.CITIZEN@example.com"}
        )
        assert response.status_code == 409

    def test_rejects_a_weak_password(self, client) -> None:
        response = client.post(
            "/api/auth/register", json={**REGISTRATION, "password": "password"}
        )
        assert response.status_code == 422

    def test_rejects_a_short_password(self, client) -> None:
        response = client.post("/api/auth/register", json={**REGISTRATION, "password": "Pa1"})
        assert response.status_code == 422

    def test_rejects_an_invalid_email(self, client) -> None:
        response = client.post("/api/auth/register", json={**REGISTRATION, "email": "not-an-email"})
        assert response.status_code == 422

    def test_cannot_self_assign_a_privileged_role(self, client) -> None:
        """Role is never taken from the request body."""
        response = client.post("/api/auth/register", json={**REGISTRATION, "role": "ADMIN"})

        assert response.status_code == 201
        assert response.json()["user"]["role"] == UserRole.CITIZEN.value


class TestLogin:
    def test_signs_in_with_valid_credentials(self, client, citizen) -> None:
        response = client.post(
            "/api/auth/login", json={"email": citizen.email, "password": TEST_PASSWORD}
        )
        assert response.status_code == 200
        assert response.json()["access_token"]

    def test_rejects_a_wrong_password(self, client, citizen) -> None:
        response = client.post(
            "/api/auth/login", json={"email": citizen.email, "password": "WrongPassword1"}
        )
        assert response.status_code == 401

    def test_does_not_reveal_whether_an_account_exists(self, client, citizen) -> None:
        """Both failures must be indistinguishable, or the endpoint enumerates users."""
        wrong_password = client.post(
            "/api/auth/login", json={"email": citizen.email, "password": "WrongPassword1"}
        )
        no_such_user = client.post(
            "/api/auth/login", json={"email": "nobody@example.com", "password": "WrongPassword1"}
        )

        assert wrong_password.status_code == no_such_user.status_code == 401
        assert wrong_password.json() == no_such_user.json()

    def test_rejects_a_deactivated_account(self, client, db, citizen) -> None:
        citizen.is_active = False
        db.commit()

        response = client.post(
            "/api/auth/login", json={"email": citizen.email, "password": TEST_PASSWORD}
        )
        assert response.status_code == 401


class TestCurrentUser:
    def test_returns_the_signed_in_user(self, client, citizen, citizen_headers) -> None:
        response = client.get("/api/auth/me", headers=citizen_headers)

        assert response.status_code == 200
        assert response.json()["email"] == citizen.email

    def test_requires_a_token(self, client) -> None:
        assert client.get("/api/auth/me").status_code == 401

    def test_rejects_a_malformed_token(self, client) -> None:
        response = client.get("/api/auth/me", headers={"Authorization": "Bearer not.a.token"})
        assert response.status_code == 401

    def test_rejects_a_token_signed_with_another_key(self, client, citizen) -> None:
        import jwt

        forged = jwt.encode(
            {"sub": str(citizen.id), "role": "ADMIN", "typ": "access", "exp": 9999999999},
            "attacker-secret",
            algorithm="HS256",
        )
        response = client.get("/api/auth/me", headers={"Authorization": f"Bearer {forged}"})
        assert response.status_code == 401

    def test_deactivation_takes_effect_before_token_expiry(self, client, db, citizen) -> None:
        headers = auth_header(client, citizen.email)
        citizen.is_active = False
        db.commit()

        assert client.get("/api/auth/me", headers=headers).status_code == 403

    def test_role_is_read_from_the_database_not_the_token(self, client, db, citizen) -> None:
        """A stale role claim must not grant admin access."""
        import jwt

        from app.core.config import settings

        token = jwt.encode(
            {
                "sub": str(citizen.id),
                "role": "ADMIN",  # lie
                "typ": "access",
                "exp": 9999999999,
            },
            settings.AUTH_SECRET,
            algorithm="HS256",
        )
        response = client.get("/api/admin/dashboard", headers={"Authorization": f"Bearer {token}"})
        assert response.status_code == 403


class TestProfile:
    def test_updates_the_profile(self, client, citizen_headers) -> None:
        response = client.patch(
            "/api/auth/me", json={"full_name": "Updated Name"}, headers=citizen_headers
        )
        assert response.status_code == 200
        assert response.json()["full_name"] == "Updated Name"

    def test_changes_the_password(self, client, citizen, citizen_headers) -> None:
        response = client.post(
            "/api/auth/change-password",
            json={"current_password": TEST_PASSWORD, "new_password": "BrandNew123"},
            headers=citizen_headers,
        )
        assert response.status_code == 200

        assert (
            client.post(
                "/api/auth/login", json={"email": citizen.email, "password": "BrandNew123"}
            ).status_code
            == 200
        )

    def test_rejects_a_wrong_current_password(self, client, citizen_headers) -> None:
        response = client.post(
            "/api/auth/change-password",
            json={"current_password": "Wrong123", "new_password": "BrandNew123"},
            headers=citizen_headers,
        )
        assert response.status_code == 401


class TestRoleGuards:
    def test_citizen_cannot_reach_admin_endpoints(self, client, citizen_headers) -> None:
        for path in (
            "/api/admin/dashboard",
            "/api/admin/reports",
            "/api/admin/analytics",
            "/api/admin/teams",
            "/api/admin/audit",
            "/api/admin/duplicates",
        ):
            assert client.get(path, headers=citizen_headers).status_code == 403, path

    def test_anonymous_cannot_reach_admin_endpoints(self, client) -> None:
        assert client.get("/api/admin/dashboard").status_code == 401

    def test_admin_can_reach_admin_endpoints(self, client, admin_headers) -> None:
        assert client.get("/api/admin/dashboard", headers=admin_headers).status_code == 200

    def test_citizen_cannot_reach_team_endpoints(self, client, citizen_headers) -> None:
        assert client.get("/api/team/tasks", headers=citizen_headers).status_code == 403

    def test_crew_can_reach_team_endpoints(self, client, crew_headers) -> None:
        assert client.get("/api/team/tasks", headers=crew_headers).status_code == 200
