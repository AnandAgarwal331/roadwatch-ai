"""Duplicate complaint detection.

Four independent signals are blended into a 0-1 similarity:

* **proximity** - how close the two reports are on the ground (the strongest
  signal, and the only mandatory one);
* **damage type** - the same class, a related class, or unrelated;
* **recency** - reports days apart are more likely the same defect than reports
  months apart;
* **image similarity** - perceptual-hash distance between the two photos, used
  only when both reports carry one.

Nothing is ever deleted or merged automatically. Detection produces a
*suggestion* an administrator confirms or rejects, because wrongly discarding a
citizen's report is a far worse failure than showing an extra card in a review
queue.
"""

from __future__ import annotations

import uuid
from dataclasses import dataclass
from datetime import UTC, datetime, timedelta

from sqlalchemy.orm import Session

from app.core.config import settings
from app.core.enums import DamageType, DuplicateStatus
from app.models.complaint import Complaint, PotentialDuplicate
from app.repositories.complaint import ComplaintRepository
from app.repositories.system import DuplicateRepository
from app.services.images import image_similarity

#: Below this, the pair is not recorded at all.
SUGGESTION_THRESHOLD = 0.55

#: Blend weights (sum to 1.0). Distance dominates deliberately.
WEIGHT_DISTANCE = 0.45
WEIGHT_TYPE = 0.25
WEIGHT_RECENCY = 0.15
WEIGHT_IMAGE = 0.15

#: Damage classes that plausibly describe the same defect.
RELATED_TYPES: dict[DamageType, set[DamageType]] = {
    DamageType.POTHOLE: {DamageType.CRACKED_ROAD, DamageType.DAMAGED_SIDEWALK},
    DamageType.CRACKED_ROAD: {DamageType.POTHOLE, DamageType.DAMAGED_SIDEWALK},
    DamageType.DAMAGED_SIDEWALK: {DamageType.CRACKED_ROAD, DamageType.POTHOLE},
    DamageType.FLOODING: {DamageType.POTHOLE},
}


@dataclass(slots=True)
class DuplicateCandidate:
    complaint: Complaint
    similarity: float
    distance_meters: float
    reason: str


class DuplicateService:
    def __init__(self, db: Session) -> None:
        self.db = db
        self.complaints = ComplaintRepository(db)
        self.duplicates = DuplicateRepository(db)

    def find_candidates(
        self,
        complaint: Complaint,
        *,
        radius_meters: int | None = None,
        window_days: int | None = None,
        now: datetime | None = None,
    ) -> list[DuplicateCandidate]:
        radius = radius_meters or settings.DUPLICATE_RADIUS_METERS
        window = window_days or settings.DUPLICATE_WINDOW_DAYS
        now = now or datetime.now(UTC)

        neighbours = self.complaints.find_nearby(
            complaint.latitude,
            complaint.longitude,
            radius,
            exclude_id=complaint.id,
            since=now - timedelta(days=window),
        )

        candidate_hash = _primary_hash(complaint)
        candidates: list[DuplicateCandidate] = []

        for item in neighbours:
            other = item.complaint
            if other.duplicate_of_id == complaint.id or complaint.duplicate_of_id == other.id:
                continue

            similarity, reason = self._score(
                complaint, other, item.distance_meters, radius, window, candidate_hash, now
            )
            if similarity >= SUGGESTION_THRESHOLD:
                candidates.append(
                    DuplicateCandidate(
                        complaint=other,
                        similarity=round(similarity, 4),
                        distance_meters=item.distance_meters,
                        reason=reason,
                    )
                )

        candidates.sort(key=lambda item: item.similarity, reverse=True)
        return candidates

    def record_candidates(self, complaint: Complaint, candidates: list[DuplicateCandidate]) -> int:
        """Persist new suggestions; returns how many were created."""
        created = 0
        for candidate in candidates:
            if self.duplicates.find_pair(complaint.id, candidate.complaint.id):
                continue
            self.duplicates.add(
                PotentialDuplicate(
                    complaint_id=complaint.id,
                    duplicate_complaint_id=candidate.complaint.id,
                    similarity_score=candidate.similarity,
                    distance_meters=candidate.distance_meters,
                    reason=candidate.reason,
                    status=DuplicateStatus.SUGGESTED,
                )
            )
            created += 1
        return created

    def detect_and_record(self, complaint: Complaint) -> list[DuplicateCandidate]:
        candidates = self.find_candidates(complaint)
        self.record_candidates(complaint, candidates)
        return candidates

    def confirm(
        self, link: PotentialDuplicate, reviewer_id: uuid.UUID | None, now: datetime | None = None
    ) -> tuple[Complaint, Complaint]:
        """Link a duplicate to its canonical complaint.

        The *older* report is treated as canonical - it holds the original
        history - and the newer one is marked ``DUPLICATE`` and pointed at it.
        The canonical report's ``report_count`` grows, which is what makes
        "17 reports, priority 94" meaningful.
        """
        from app.core.enums import ComplaintStatus

        first = self.complaints.get(link.complaint_id)
        second = self.complaints.get(link.duplicate_complaint_id)
        if first is None or second is None:  # pragma: no cover - FK protected
            raise ValueError("One of the linked complaints no longer exists")

        canonical, duplicate = (
            (first, second) if _created(first) <= _created(second) else (second, first)
        )

        duplicate.duplicate_of_id = canonical.id
        duplicate.status = ComplaintStatus.DUPLICATE
        canonical.report_count = (canonical.report_count or 1) + max(1, duplicate.report_count or 1)

        link.status = DuplicateStatus.CONFIRMED
        link.reviewed_by_id = reviewer_id
        link.reviewed_at = now or datetime.now(UTC)

        return canonical, duplicate

    def reject(
        self, link: PotentialDuplicate, reviewer_id: uuid.UUID | None, now: datetime | None = None
    ) -> PotentialDuplicate:
        link.status = DuplicateStatus.REJECTED
        link.reviewed_by_id = reviewer_id
        link.reviewed_at = now or datetime.now(UTC)
        return link

    # -- scoring --------------------------------------------------------

    def _score(
        self,
        complaint: Complaint,
        other: Complaint,
        distance: float,
        radius: int,
        window_days: int,
        candidate_hash: str | None,
        now: datetime,
    ) -> tuple[float, str]:
        reasons: list[str] = []

        distance_score = max(0.0, 1.0 - (distance / radius)) if radius else 0.0
        reasons.append(f"{distance:.0f}m apart")

        type_score, type_reason = _type_score(complaint.damage_type, other.damage_type)
        reasons.append(type_reason)

        age_days = abs((now - _created(other)).total_seconds()) / 86400
        recency_score = max(0.0, 1.0 - (age_days / window_days)) if window_days else 0.0
        reasons.append(f"reported {_humanise_days(age_days)}")

        other_hash = _primary_hash(other)
        similarity = image_similarity(candidate_hash, other_hash)

        if similarity is None:
            # With no image signal, redistribute its weight over the rest so a
            # missing photo cannot look like evidence of difference.
            total_weight = WEIGHT_DISTANCE + WEIGHT_TYPE + WEIGHT_RECENCY
            score = (
                distance_score * WEIGHT_DISTANCE
                + type_score * WEIGHT_TYPE
                + recency_score * WEIGHT_RECENCY
            ) / total_weight
        else:
            score = (
                distance_score * WEIGHT_DISTANCE
                + type_score * WEIGHT_TYPE
                + recency_score * WEIGHT_RECENCY
                + similarity * WEIGHT_IMAGE
            )
            if similarity >= 0.85:
                reasons.append(f"photos look {similarity:.0%} alike")

        return score, "This may be the same road issue: " + ", ".join(reasons) + "."


def _type_score(left: DamageType, right: DamageType) -> tuple[float, float | str]:
    if left == right:
        label = left.value.replace("_", " ").lower()
        return 1.0, f"both reported as {label}"
    if right in RELATED_TYPES.get(left, set()):
        return 0.6, "closely related damage types"
    return 0.15, "different damage types"


def _primary_hash(complaint: Complaint) -> str | None:
    from app.core.enums import ImageKind

    for image in complaint.images:
        if image.kind == ImageKind.REPORT and image.perceptual_hash:
            return image.perceptual_hash
    return None


def _created(complaint: Complaint) -> datetime:
    value = complaint.created_at
    return value if value.tzinfo else value.replace(tzinfo=UTC)


def _humanise_days(days: float) -> str:
    if days < 1:
        return "within the last day"
    if days < 2:
        return "about a day apart"
    return f"about {int(round(days))} days apart"
