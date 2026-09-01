"""Test fixtures.

The environment is configured **before** any application module is imported,
because settings (and the engine built from them) are resolved at import time.
Each test gets a fresh SQLite file and a clean rate-limiter, so tests neither
touch the development database nor leak state into one another.
"""

from __future__ import annotations

import os
import tempfile
import uuid
from pathlib import Path

import pytest

_TMP = Path(tempfile.mkdtemp(prefix="roadwatch-tests-"))

os.environ.update(
    {
        "ENVIRONMENT": "test",
        "DATABASE_URL": f"sqlite:///{(_TMP / 'test.db').as_posix()}",
        "AUTH_SECRET": "test-secret-not-for-production",
        "STORAGE_PROVIDER": "local",
        "STORAGE_LOCAL_DIR": str(_TMP / "uploads"),
        "AI_PROVIDER": "mock",
        "TRAFFIC_PROVIDER": "mock",
        "PLACES_PROVIDER": "seeded",
        "WEATHER_ENABLED": "false",
        "RATE_LIMIT_ENABLED": "false",
    }
)

from fastapi.testclient import TestClient  # noqa: E402
from sqlalchemy import create_engine  # noqa: E402
from sqlalchemy.orm import sessionmaker  # noqa: E402

from app.api.deps import get_session  # noqa: E402
from app.core.enums import UserRole  # noqa: E402
from app.core.security import hash_password  # noqa: E402
from app.db.base import Base  # noqa: E402
from app.db.session import get_db  # noqa: E402
from app.main import app  # noqa: E402
from app.models.repair import RepairTeam  # noqa: E402
from app.models.user import User  # noqa: E402
from tests.factories import make_image_bytes  # noqa: E402

TEST_PASSWORD = "Password123"


@pytest.fixture
def db_path(tmp_path) -> Path:
    return tmp_path / "roadwatch-test.db"


@pytest.fixture
def engine(db_path):
    engine = create_engine(
        f"sqlite:///{db_path.as_posix()}", connect_args={"check_same_thread": False}, future=True
    )
    Base.metadata.create_all(engine)
    yield engine
    engine.dispose()


@pytest.fixture
def session_factory(engine):
    return sessionmaker(bind=engine, autoflush=False, autocommit=False, expire_on_commit=False)


@pytest.fixture
def db(session_factory):
    session = session_factory()
    try:
        yield session
    finally:
        session.close()


@pytest.fixture
def client(session_factory, tmp_path, monkeypatch):
    """TestClient wired to an isolated database and upload directory."""
    from app.core.config import settings
    from app.core.rate_limit import reset
    from app.providers.storage.factory import get_storage_provider
    from app.providers.storage.local import LocalStorageProvider

    reset()

    upload_dir = tmp_path / "uploads"
    upload_dir.mkdir(parents=True, exist_ok=True)
    monkeypatch.setattr(settings, "STORAGE_LOCAL_DIR", str(upload_dir))
    get_storage_provider.cache_clear()
    get_storage_provider.__wrapped__ = None  # type: ignore[attr-defined]

    def _storage_override():
        return LocalStorageProvider(str(upload_dir), settings.STORAGE_PUBLIC_BASE_URL)

    monkeypatch.setattr(
        "app.providers.storage.factory.get_storage_provider", _storage_override
    )
    monkeypatch.setattr("app.services.complaints.get_storage_provider", _storage_override)

    def _override():
        session = session_factory()
        try:
            yield session
        finally:
            session.close()

    app.dependency_overrides[get_session] = _override
    app.dependency_overrides[get_db] = _override

    with TestClient(app) as test_client:
        yield test_client

    app.dependency_overrides.clear()
    get_storage_provider.cache_clear()


# -- user fixtures ------------------------------------------------------


def _make_user(db, role: UserRole, email: str | None = None, team_id=None) -> User:
    user = User(
        email=email or f"{role.value.lower()}-{uuid.uuid4().hex[:8]}@example.com",
        hashed_password=hash_password(TEST_PASSWORD),
        full_name=f"Test {role.value.title()}",
        role=role,
        team_id=team_id,
    )
    db.add(user)
    db.commit()
    db.refresh(user)
    return user


@pytest.fixture
def citizen(db) -> User:
    return _make_user(db, UserRole.CITIZEN, "citizen@example.com")


@pytest.fixture
def other_citizen(db) -> User:
    return _make_user(db, UserRole.CITIZEN, "other@example.com")


@pytest.fixture
def admin(db) -> User:
    return _make_user(db, UserRole.ADMIN, "admin@example.com")


@pytest.fixture
def team(db) -> RepairTeam:
    team = RepairTeam(
        name="Test Crew",
        code="RT-TEST",
        zone="Test Zone",
        base_latitude=12.96,
        base_longitude=77.64,
        max_concurrent_jobs=5,
    )
    db.add(team)
    db.commit()
    db.refresh(team)
    return team


@pytest.fixture
def crew(db, team) -> User:
    return _make_user(db, UserRole.REPAIR_TEAM, "crew@example.com", team_id=team.id)


def auth_header(client: TestClient, email: str, password: str = TEST_PASSWORD) -> dict[str, str]:
    response = client.post("/api/auth/login", json={"email": email, "password": password})
    assert response.status_code == 200, response.text
    return {"Authorization": f"Bearer {response.json()['access_token']}"}


@pytest.fixture
def citizen_headers(client, citizen) -> dict[str, str]:
    return auth_header(client, citizen.email)


@pytest.fixture
def admin_headers(client, admin) -> dict[str, str]:
    return auth_header(client, admin.email)


@pytest.fixture
def crew_headers(client, crew) -> dict[str, str]:
    return auth_header(client, crew.email)


@pytest.fixture
def road_photo() -> bytes:
    return make_image_bytes()
