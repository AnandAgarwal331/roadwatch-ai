"""Development seed data.

Run with::

    python -m app.seed          # create if empty
    python -m app.seed --reset  # wipe and recreate

Everything here is **synthetic**. The locations use real Bengaluru road and
area names so the map looks like a real city, but no report, resolution or
facility record is government data, and none of it describes an actual road
defect.

Two things make this seed more useful than a pile of INSERTs:

* reports are pushed through the **real assessment pipeline**, so AI analyses,
  severity estimates, nearby-facility lookups, traffic snapshots and priority
  breakdowns are all genuinely computed rather than invented;
* photos are **generated** as synthetic road scenes, so the detection stub has
  real pixels to work with and the UI has real thumbnails.
"""

from __future__ import annotations

import argparse
import asyncio
import io
import random
import sys
from datetime import UTC, datetime, timedelta

from PIL import Image, ImageDraw, ImageFilter
from sqlalchemy import delete, select
from sqlalchemy.orm import Session

from app.core.enums import (
    AssignmentStatus,
    ComplaintStatus,
    DamageType,
    PlaceType,
    UserRole,
)
from app.core.security import hash_password
from app.db.base import Base
from app.db.session import SessionLocal, engine
from app.models.complaint import Complaint, ComplaintImage, ComplaintStatusHistory, PotentialDuplicate
from app.models.geo import Location, NearbyPlace, SeededPlace, TrafficSnapshot, WeatherSnapshot
from app.models.repair import RepairAssignment, RepairEvidence, RepairTeam
from app.models.system import AuditLog, Notification
from app.models.user import User
from app.services.complaints import ComplaintService, CreateComplaintInput

RNG = random.Random(20260215)

DEFAULT_PASSWORD = "Password123"

# -- city fixtures ------------------------------------------------------

CITY = "Bengaluru"
STATE = "Karnataka"

#: (name, latitude, longitude, road_importance hint)
ROADS: list[tuple[str, float, float]] = [
    ("Old Airport Road", 12.9601, 77.6486),
    ("Sarjapur Main Road", 12.9121, 77.6785),
    ("Outer Ring Road", 12.9352, 77.6245),
    ("Hosur Main Road", 12.9081, 77.6104),
    ("Bannerghatta Main Road", 12.8935, 77.5975),
    ("100 Feet Road, Indiranagar", 12.9719, 77.6412),
    ("CMH Road", 12.9784, 77.6408),
    ("Bellandur Gate Junction", 12.9260, 77.6762),
    ("Kanakapura Main Road", 12.8905, 77.5540),
    ("Magadi Main Road", 12.9738, 77.5348),
    ("Tumkur Road", 13.0290, 77.5190),
    ("Whitefield Main Road", 12.9698, 77.7500),
    ("Marathahalli Bridge", 12.9569, 77.7011),
    ("Jayanagar 4th Block Cross", 12.9250, 77.5838),
    ("Koramangala 5th Cross", 12.9345, 77.6265),
    ("Richmond Circle", 12.9622, 77.5975),
    ("Mysore Road", 12.9455, 77.5216),
    ("Yeshwanthpur Main Road", 13.0230, 77.5510),
    ("HSR Layout 27th Main", 12.9116, 77.6412),
    ("Banaswadi Main Road", 13.0140, 77.6510),
]

WARDS = [
    "Indiranagar",
    "Koramangala",
    "HSR Layout",
    "Jayanagar",
    "Whitefield",
    "Rajajinagar",
    "Yelahanka",
    "Basavanagudi",
    "Malleshwaram",
    "Bellandur",
]

FACILITIES: list[tuple[PlaceType, str, float, float]] = [
    (PlaceType.HOSPITAL, "St. Martha's Hospital", 12.9612, 77.5905),
    (PlaceType.HOSPITAL, "Manipal Hospital, Old Airport Road", 12.9584, 77.6494),
    (PlaceType.HOSPITAL, "Sagar Hospital, Banashankari", 12.9128, 77.5686),
    (PlaceType.HOSPITAL, "Sakra World Hospital, Bellandur", 12.9273, 77.6779),
    (PlaceType.HOSPITAL, "Columbia Asia, Whitefield", 12.9705, 77.7482),
    (PlaceType.SCHOOL, "National Public School, Indiranagar", 12.9731, 77.6395),
    (PlaceType.SCHOOL, "Bishop Cotton Boys' School", 12.9640, 77.5990),
    (PlaceType.SCHOOL, "Delhi Public School, Sarjapur", 12.9105, 77.6802),
    (PlaceType.SCHOOL, "Vidya Niketan School, Jayanagar", 12.9262, 77.5851),
    (PlaceType.SCHOOL, "Ryan International, Kundalahalli", 12.9682, 77.7148),
    (PlaceType.SCHOOL, "Kendriya Vidyalaya, Malleshwaram", 13.0035, 77.5712),
    (PlaceType.EMERGENCY_SERVICE, "Indiranagar Police Station", 12.9749, 77.6415),
    (PlaceType.EMERGENCY_SERVICE, "Koramangala Fire Station", 12.9338, 77.6252),
    (PlaceType.EMERGENCY_SERVICE, "Whitefield Police Station", 12.9691, 77.7495),
    (PlaceType.EMERGENCY_SERVICE, "Banashankari Fire Station", 12.9155, 77.5735),
    (PlaceType.MAJOR_INTERSECTION, "Silk Board Junction", 12.9172, 77.6229),
    (PlaceType.MAJOR_INTERSECTION, "Marathahalli Junction", 12.9562, 77.7016),
    (PlaceType.MAJOR_INTERSECTION, "Richmond Circle", 12.9627, 77.5972),
    (PlaceType.MAJOR_INTERSECTION, "Hebbal Flyover", 13.0358, 77.5912),
    (PlaceType.MAJOR_INTERSECTION, "Bellandur Gate", 12.9256, 77.6757),
]

BUS_STOP_ANCHORS = [
    ("Indiranagar Metro Bus Stop", 12.9784, 77.6390),
    ("Koramangala Water Tank Stop", 12.9349, 77.6270),
    ("HSR BDA Complex Stop", 12.9110, 77.6420),
    ("Marathahalli Bridge Stop", 12.9575, 77.7005),
    ("Jayanagar 4th Block Stop", 12.9256, 77.5842),
    ("Bellandur Gate Stop", 12.9262, 77.6768),
    ("Whitefield TTMC Stop", 12.9700, 77.7492),
    ("Yeshwanthpur TTMC Stop", 13.0235, 77.5515),
    ("Banaswadi Ring Road Stop", 13.0132, 77.6516),
    ("Mysore Road Satellite Stop", 12.9448, 77.5222),
]

DESCRIPTIONS: dict[DamageType, list[str]] = {
    DamageType.POTHOLE: [
        "Deep pothole in the left lane, two-wheelers are swerving into traffic to avoid it.",
        "Large pothole right after the junction. It floods and becomes invisible after rain.",
        "Pothole has widened over the last month. An auto lost a wheel cover here yesterday.",
        "Crater near the bus stop, passengers stepping off the bus land straight into it.",
    ],
    DamageType.CRACKED_ROAD: [
        "Long crack running along the carriageway, edges are breaking away.",
        "Surface cracking across the full lane width after the last resurfacing.",
        "Network of cracks near the service road merge, getting worse each week.",
    ],
    DamageType.FLOODING: [
        "Water logs up to knee height here after even moderate rain. Drain is blocked.",
        "Stagnant water across the full width of the road for the third day.",
        "Storm water drain overflowing onto the carriageway near the junction.",
    ],
    DamageType.DAMAGED_SIDEWALK: [
        "Footpath slabs are broken and lifted, elderly residents are walking on the road instead.",
        "Missing paver blocks leaving an open gap next to the drain.",
        "Sidewalk edge has collapsed near the school gate.",
    ],
    DamageType.BROKEN_STREETLIGHT: [
        "Streetlight has been out for two weeks, the stretch is completely dark at night.",
        "Pole is leaning and the fixture is hanging loose over the footpath.",
        "Three consecutive lights not working near the park entrance.",
    ],
}

CITIZENS = [
    ("priya.sharma@example.com", "Priya Sharma"),
    ("arjun.rao@example.com", "Arjun Rao"),
    ("fatima.khan@example.com", "Fatima Khan"),
    ("vikram.nair@example.com", "Vikram Nair"),
    ("meera.iyer@example.com", "Meera Iyer"),
    ("sanjay.gupta@example.com", "Sanjay Gupta"),
    ("ananya.reddy@example.com", "Ananya Reddy"),
    ("rahul.desai@example.com", "Rahul Desai"),
]

TEAMS = [
    ("North Zone Road Crew", "RT-NORTH", "North Bengaluru", 13.0290, 77.5510, "POTHOLE,CRACKED_ROAD", 6),
    ("South Zone Road Crew", "RT-SOUTH", "South Bengaluru", 12.9081, 77.5975, "POTHOLE,DAMAGED_SIDEWALK", 6),
    ("East Zone Road Crew", "RT-EAST", "East Bengaluru", 12.9698, 77.7100, "POTHOLE,CRACKED_ROAD", 5),
    ("Drainage & Flooding Unit", "RT-DRAIN", "City-wide", 12.9352, 77.6245, "FLOODING", 4),
    ("Street Lighting Unit", "RT-LIGHT", "City-wide", 12.9719, 77.6412, "BROKEN_STREETLIGHT", 5),
]

TEAM_MEMBERS = [
    ("ravi.kumar@roadwatch.example", "Ravi Kumar", 0),
    ("suresh.babu@roadwatch.example", "Suresh Babu", 1),
    ("imran.pasha@roadwatch.example", "Imran Pasha", 2),
    ("lakshmi.devi@roadwatch.example", "Lakshmi Devi", 3),
    ("george.mathew@roadwatch.example", "George Mathew", 4),
]


# -- synthetic imagery --------------------------------------------------


#: How extensive the drawn damage is. Real reports span trivial to dangerous,
#: and the detector must see that range or every severity lands mid-scale.
EXTENTS = ("minor", "moderate", "major", "severe")
_EXTENT_SCALE = {"minor": 0.55, "moderate": 1.0, "major": 1.6, "severe": 2.3, "extreme": 3.1}
_EXTENT_COUNT = {"minor": 1, "moderate": 2, "major": 3, "severe": 4, "extreme": 5}


def make_road_image(damage_type: DamageType, seed: int, extent: str = "moderate") -> bytes:
    """Draw a plausible road scene so the detector has real pixels to read."""
    rng = random.Random(seed)
    scale = _EXTENT_SCALE.get(extent, 1.0)
    blobs = _EXTENT_COUNT.get(extent, 2)
    width, height = 640, 480
    image = Image.new("RGB", (width, height), (108, 108, 112))
    draw = ImageDraw.Draw(image)

    # Asphalt gradient: lighter towards the horizon.
    for y in range(height):
        shade = int(74 + (y / height) * 46)
        draw.line([(0, y), (width, y)], fill=(shade, shade, shade + 4))

    # Speckle for texture.
    for _ in range(2600):
        x, y = rng.randrange(width), rng.randrange(height)
        tone = rng.randint(-22, 22)
        base = image.getpixel((x, y))
        draw.point((x, y), fill=tuple(max(0, min(255, channel + tone)) for channel in base))

    # Lane marking.
    for y in range(0, height, 60):
        draw.rectangle([width // 2 - 6, y, width // 2 + 6, y + 34], fill=(214, 210, 196))

    if damage_type == DamageType.POTHOLE:
        for _ in range(blobs):
            cx, cy = rng.randint(120, 520), rng.randint(180, 400)
            radius = int(rng.randint(38, 92) * scale)
            draw.ellipse(
                [cx - radius, cy - radius // 2, cx + radius, cy + radius // 2],
                fill=(26, 24, 24),
                outline=(64, 60, 58),
                width=5,
            )
            draw.ellipse(
                [cx - radius // 2, cy - radius // 4, cx + radius // 2, cy + radius // 4],
                fill=(12, 11, 11),
            )
    elif damage_type == DamageType.CRACKED_ROAD:
        for _ in range(int(rng.randint(5, 10) * scale)):
            x, y = rng.randint(60, 560), rng.randint(140, 420)
            points = [(x, y)]
            for _ in range(rng.randint(6, 14)):
                x += rng.randint(-26, 32)
                y += rng.randint(-14, 20)
                points.append((x, y))
            draw.line(
                points, fill=(30, 28, 28), width=int(rng.randint(3, 7) * scale), joint="curve"
            )
    elif damage_type == DamageType.FLOODING:
        top = int(max(90, rng.randint(200, 260) - (scale - 1.0) * 110))
        draw.rectangle([0, top, width, height], fill=(72, 96, 128))
        for _ in range(140):
            x, y = rng.randrange(width), rng.randrange(top, height)
            draw.ellipse([x, y, x + rng.randint(8, 30), y + rng.randint(3, 9)], fill=(96, 124, 158))
        draw.rectangle([0, top - 5, width, top + 4], fill=(84, 108, 140))
    elif damage_type == DamageType.DAMAGED_SIDEWALK:
        draw.rectangle([0, 0, width, 190], fill=(146, 142, 134))
        for x in range(0, width, 66):
            draw.rectangle([x + 2, 20, x + 60, 170], outline=(112, 108, 102), width=3)
        for _ in range(blobs + 1):
            x = rng.randint(0, width - 70)
            draw.rectangle(
                [
                    x,
                    rng.randint(30, 120),
                    x + int(rng.randint(40, 70) * scale),
                    rng.randint(140, 180),
                ],
                fill=(58, 54, 50),
            )
    elif damage_type == DamageType.BROKEN_STREETLIGHT:
        image = Image.new("RGB", (width, height), (18, 20, 28))
        draw = ImageDraw.Draw(image)
        for y in range(height):
            shade = int(14 + (y / height) * 26)
            draw.line([(0, y), (width, y)], fill=(shade, shade, shade + 8))
        draw.rectangle([300, 60, 316, 400], fill=(44, 46, 52))
        draw.rectangle([230, 52, 320, 70], fill=(52, 54, 60))
        draw.ellipse([222, 44, 262, 78], fill=(34, 34, 38), outline=(70, 70, 76), width=3)

    image = image.filter(ImageFilter.GaussianBlur(0.6))
    buffer = io.BytesIO()
    image.save(buffer, format="JPEG", quality=85)
    return buffer.getvalue()


# -- seeding ------------------------------------------------------------


def reset_database(db: Session) -> None:
    """Delete seeded rows, children first."""
    for model in (
        RepairEvidence,
        RepairAssignment,
        PotentialDuplicate,
        Notification,
        AuditLog,
        ComplaintStatusHistory,
        NearbyPlace,
        TrafficSnapshot,
        WeatherSnapshot,
        Location,
        ComplaintImage,
    ):
        db.execute(delete(model))
    db.execute(delete(Complaint))
    db.execute(delete(User))
    db.execute(delete(RepairTeam))
    db.execute(delete(SeededPlace))
    db.commit()


def seed_places(db: Session) -> None:
    for place_type, name, latitude, longitude in FACILITIES:
        db.add(
            SeededPlace(
                place_type=place_type, name=name, latitude=latitude, longitude=longitude, city=CITY
            )
        )

    for name, latitude, longitude in BUS_STOP_ANCHORS:
        db.add(
            SeededPlace(
                place_type=PlaceType.BUS_STOP,
                name=name,
                latitude=latitude,
                longitude=longitude,
                city=CITY,
            )
        )
        # A few satellite stops around each anchor, as a real network has.
        for index in range(2):
            db.add(
                SeededPlace(
                    place_type=PlaceType.BUS_STOP,
                    name=f"{name.rsplit(' Stop', 1)[0]} Stop {index + 2}",
                    latitude=latitude + RNG.uniform(-0.004, 0.004),
                    longitude=longitude + RNG.uniform(-0.004, 0.004),
                    city=CITY,
                )
            )
    db.commit()


def seed_users(db: Session) -> tuple[User, list[User], list[RepairTeam]]:
    password = hash_password(DEFAULT_PASSWORD)

    admin = User(
        email="admin@roadwatch.example",
        hashed_password=password,
        full_name="Deepa Menon",
        phone="+91 98450 10001",
        role=UserRole.ADMIN,
    )
    db.add(admin)

    citizens = []
    for index, (email, name) in enumerate(CITIZENS):
        user = User(
            email=email,
            hashed_password=password,
            full_name=name,
            phone=f"+91 98450 2{index:04d}",
            role=UserRole.CITIZEN,
        )
        db.add(user)
        citizens.append(user)

    teams = []
    for name, code, zone, latitude, longitude, specialities, capacity in TEAMS:
        team = RepairTeam(
            name=name,
            code=code,
            zone=zone,
            contact_phone=f"+91 80 2{RNG.randint(1000000, 9999999)}",
            base_latitude=latitude,
            base_longitude=longitude,
            specialities=specialities,
            max_concurrent_jobs=capacity,
        )
        db.add(team)
        teams.append(team)

    db.flush()

    for email, name, team_index in TEAM_MEMBERS:
        db.add(
            User(
                email=email,
                hashed_password=password,
                full_name=name,
                phone=f"+91 98450 3{team_index:04d}",
                role=UserRole.REPAIR_TEAM,
                team_id=teams[team_index].id,
            )
        )

    db.commit()
    db.refresh(admin)
    for user in citizens:
        db.refresh(user)
    for team in teams:
        db.refresh(team)
    return admin, citizens, teams


async def seed_complaints(
    db: Session, admin: User, citizens: list[User], teams: list[RepairTeam]
) -> list[Complaint]:
    """Create reports through the real pipeline, then walk some through the lifecycle."""
    service = ComplaintService(db)
    now = datetime.now(UTC)
    created: list[Complaint] = []

    plan: list[tuple[DamageType, int]] = []
    # A realistic mix: potholes dominate, streetlights are the long tail.
    for damage_type, count in (
        (DamageType.POTHOLE, 14),
        (DamageType.CRACKED_ROAD, 8),
        (DamageType.FLOODING, 6),
        (DamageType.DAMAGED_SIDEWALK, 6),
        (DamageType.BROKEN_STREETLIGHT, 4),
    ):
        plan.extend([(damage_type, index) for index in range(count)])
    RNG.shuffle(plan)

    async def submit(
        damage_type: DamageType,
        latitude: float,
        longitude: float,
        road_name: str,
        *,
        extent: str,
        age_days: float,
        seed: int,
        description: str | None = None,
        reporter: User | None = None,
    ) -> Complaint:
        result = await service.create(
            CreateComplaintInput(
                latitude=latitude,
                longitude=longitude,
                description=description or RNG.choice(DESCRIPTIONS[damage_type]),
                reported_damage_type=damage_type,
                road_name=road_name,
                address=f"{road_name}, {RNG.choice(WARDS)}, {CITY}, {STATE}",
                city=CITY,
                accuracy_meters=round(RNG.uniform(4, 18), 1),
                image_bytes=make_road_image(damage_type, seed=seed, extent=extent),
                image_content_type="image/jpeg",
                image_filename=f"{damage_type.value.lower()}-{seed}.jpg",
            ),
            reporter=reporter or RNG.choice(citizens),
        )
        complaint = result.complaint
        _backdate(db, complaint, now - timedelta(days=age_days, hours=RNG.randint(0, 23)))
        created.append(complaint)
        return complaint

    # -- hotspots: the same defect reported repeatedly and never fixed -------
    # These are what drive the complaint-history factor and the "repeat
    # locations" analytics; a city's worst spots are worst precisely because
    # they keep coming back.
    # The first two sit a short walk from a hospital entrance and a school gate.
    # That is the case this whole system exists to surface: severe damage,
    # heavy traffic, a critical facility next door, and repeated reports.
    hotspots = [
        (DamageType.POTHOLE, "Old Airport Road", 12.9587, 77.6490, "extreme", 5),
        (DamageType.FLOODING, "100 Feet Road, Indiranagar", 12.9728, 77.6397, "severe", 4),
        (DamageType.POTHOLE, "Silk Board Junction", 12.9172, 77.6229, "major", 4),
        (DamageType.DAMAGED_SIDEWALK, "Sarjapur Main Road", 12.9108, 77.6798, "major", 3),
    ]
    for spot_index, (damage_type, road_name, lat, lon, extent, count) in enumerate(hotspots):
        for repeat in range(count):
            # Within ~25m of each other: the same defect, seen by different people.
            await submit(
                damage_type,
                lat + RNG.uniform(-0.00018, 0.00018),
                lon + RNG.uniform(-0.00018, 0.00018),
                road_name,
                extent=extent if repeat == 0 else RNG.choice(("severe", extent)),
                age_days=max(0, 26 - repeat * 6 - RNG.randint(0, 3)),
                seed=5000 + spot_index * 97 + repeat,
                description=(
                    RNG.choice(DESCRIPTIONS[damage_type])
                    if repeat == 0
                    else "Reported before and still not repaired. Getting worse every week."
                ),
            )

    # -- the general backlog, spread across the city ------------------------
    for index, (damage_type, _) in enumerate(plan):
        road_name, base_lat, base_lon = ROADS[index % len(ROADS)]

        # A third of reports sit close to a hospital, school or junction -
        # those are busy places, and busy places generate complaints.
        if index % 3 == 0:
            _, _, facility_lat, facility_lon = FACILITIES[index % len(FACILITIES)]
            latitude = facility_lat + RNG.uniform(-0.0018, 0.0018)
            longitude = facility_lon + RNG.uniform(-0.0018, 0.0018)
        else:
            latitude = base_lat + RNG.uniform(-0.0032, 0.0032)
            longitude = base_lon + RNG.uniform(-0.0032, 0.0032)

        await submit(
            damage_type,
            latitude,
            longitude,
            road_name,
            extent=RNG.choices(EXTENTS, weights=[0.28, 0.36, 0.24, 0.12])[0],
            age_days=RNG.choice([0, 1, 2, 3, 5, 7, 9, 12, 15, 18, 22, 26, 30, 38, 45, 55]),
            seed=index * 977 + 13,
            reporter=citizens[index % len(citizens)],
        )

    db.commit()

    # Near-identical follow-ups, so the duplicate review queue has real material.
    for source in created[:4]:
        await submit(
            source.damage_type,
            source.latitude + RNG.uniform(-0.00012, 0.00012),
            source.longitude + RNG.uniform(-0.00012, 0.00012),
            source.road_name or "Unnamed Road",
            extent="major",
            age_days=RNG.randint(0, 3),
            seed=abs(hash(str(source.id))) % 9973,
            description="Same issue reported again - still not repaired.",
        )

    db.commit()
    _walk_lifecycle(db, service, created, admin, teams, now)
    return created


def _backdate(db: Session, complaint: Complaint, created_at: datetime) -> None:
    """Shift a complaint and its children back in time for realistic history."""
    complaint.created_at = created_at
    complaint.updated_at = created_at
    for entry in complaint.status_history:
        entry.created_at = created_at
    for image in complaint.images:
        image.created_at = created_at
    for analysis in complaint.analyses:
        analysis.created_at = created_at
    for assessment in complaint.assessments:
        assessment.created_at = created_at
    db.flush()


def _walk_lifecycle(
    db: Session,
    service: ComplaintService,
    complaints: list[Complaint],
    admin: User,
    teams: list[RepairTeam],
    now: datetime,
) -> None:
    """Move a realistic share of reports through assignment, work and resolution."""
    team_for = {
        DamageType.FLOODING: teams[3],
        DamageType.BROKEN_STREETLIGHT: teams[4],
    }

    ranked = sorted(complaints, key=lambda item: item.priority_score, reverse=True)

    for index, complaint in enumerate(ranked):
        if complaint.status == ComplaintStatus.DUPLICATE:
            continue

        # Roughly: top of the queue gets worked, the tail stays queued.
        roll = index / max(1, len(ranked))
        if roll > 0.62:
            continue

        team = team_for.get(complaint.damage_type, teams[index % 3])
        if db.execute(
            select(RepairAssignment).where(
                RepairAssignment.team_id == team.id,
                RepairAssignment.status.in_(
                    (AssignmentStatus.ASSIGNED, AssignmentStatus.IN_PROGRESS)
                ),
            )
        ).scalars().first() is not None and roll > 0.4:
            # Respect crew capacity: skip rather than overload.
            continue

        try:
            assignment = service.assign(complaint, team.id, admin)
        except Exception:  # noqa: BLE001 - capacity limits are expected here
            continue

        assigned_at = _utc(complaint.created_at) + timedelta(hours=RNG.randint(2, 30))
        assignment.created_at = assigned_at

        if roll > 0.45:
            continue  # left as ASSIGNED

        service.start_repair(assignment, admin)
        assignment.started_at = assigned_at + timedelta(hours=RNG.randint(1, 20))

        if roll > 0.30:
            continue  # left IN_PROGRESS

        service.complete_repair(
            assignment,
            admin,
            note="Surface patched and compacted. Area cleaned and reopened to traffic.",
            evidence_files=[
                (
                    make_road_image(DamageType.CRACKED_ROAD, seed=index * 31 + 7),
                    "image/jpeg",
                    "evidence.jpg",
                )
            ],
        )
        completed_at = (assignment.started_at or assigned_at) + timedelta(hours=RNG.randint(3, 60))
        assignment.completed_at = completed_at

        if roll > 0.16:
            continue  # awaiting admin verification

        service.verify_repair(assignment, admin, note="Site inspected, repair verified.")
        assignment.verified_at = completed_at + timedelta(hours=RNG.randint(2, 24))
        complaint.resolved_at = assignment.verified_at
        db.flush()

    db.commit()


def _utc(value: datetime) -> datetime:
    return value if value.tzinfo else value.replace(tzinfo=UTC)


async def run(reset: bool) -> None:
    Base.metadata.create_all(engine)

    with SessionLocal() as db:
        if reset:
            print("Resetting existing data...")
            reset_database(db)
        elif db.execute(select(User).limit(1)).scalars().first() is not None:
            print("Database already contains data. Use --reset to wipe and reseed.")
            return

        print("Seeding facilities...")
        seed_places(db)

        print("Seeding users and repair teams...")
        admin, citizens, teams = seed_users(db)

        print("Seeding complaints through the assessment pipeline (this takes a moment)...")
        complaints = await seed_complaints(db, admin, citizens, teams)

        duplicates = db.execute(select(PotentialDuplicate)).scalars().all()
        resolved = sum(1 for item in complaints if item.status == ComplaintStatus.RESOLVED)

        print()
        print(f"  {len(complaints)} complaints")
        print(f"  {resolved} resolved")
        print(f"  {len(duplicates)} duplicate suggestions")
        print(f"  {len(citizens)} citizens, {len(teams)} repair teams")
        print()
        print("Sign in with:")
        print(f"  admin    admin@roadwatch.example / {DEFAULT_PASSWORD}")
        print(f"  citizen  {CITIZENS[0][0]} / {DEFAULT_PASSWORD}")
        print(f"  crew     {TEAM_MEMBERS[0][0]} / {DEFAULT_PASSWORD}")
        print()
        print("All data is synthetic and is not government data.")


def main() -> int:
    parser = argparse.ArgumentParser(description="Seed RoadWatch AI development data")
    parser.add_argument("--reset", action="store_true", help="wipe existing data first")
    args = parser.parse_args()

    asyncio.run(run(args.reset))
    return 0


if __name__ == "__main__":
    sys.exit(main())
