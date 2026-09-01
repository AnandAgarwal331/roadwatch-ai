"""Complaint lifecycle orchestration.

This is the transaction boundary for everything that changes a complaint:
creation, status moves, assignment, repair completion, verification, rejection
and duplicate merges. Routers call into here and stay thin; authorisation is
checked at the router, and the *rules* (which transitions are legal, who gets
notified, what gets audited) live here.
"""

from __future__ import annotations

import uuid
from dataclasses import dataclass
from datetime import UTC, datetime, timedelta

from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.core.enums import (
    STATUS_TRANSITIONS,
    AssignmentStatus,
    ComplaintStatus,
    DamageType,
    ImageKind,
    PriorityLevel,
)
from app.core.errors import (
    ConflictError,
    InvalidStatusTransitionError,
    NotFoundError,
    ValidationError,
)
from app.models.complaint import Complaint, ComplaintImage
from app.models.geo import Location
from app.models.repair import RepairAssignment, RepairEvidence
from app.models.user import User
from app.providers.storage.factory import get_storage_provider
from app.repositories.complaint import ComplaintRepository
from app.repositories.repair import RepairRepository
from app.services.assessment import AssessmentService
from app.services.audit import AuditService
from app.services.duplicates import DuplicateService
from app.services.geo import is_valid_coordinate
from app.services.images import validate_and_process
from app.services.notifications import NotificationService
from app.services.numbering import next_complaint_number

#: Target turnaround per priority band, used to set assignment deadlines.
SLA_HOURS: dict[PriorityLevel, int] = {
    PriorityLevel.CRITICAL: 24,
    PriorityLevel.HIGH: 72,
    PriorityLevel.MEDIUM: 168,
    PriorityLevel.LOW: 336,
}


@dataclass(slots=True)
class CreateComplaintInput:
    latitude: float
    longitude: float
    description: str | None = None
    reported_damage_type: DamageType | None = None
    road_name: str | None = None
    address: str | None = None
    city: str | None = None
    accuracy_meters: float | None = None
    image_bytes: bytes | None = None
    image_content_type: str | None = None
    image_filename: str = "report.jpg"


@dataclass(slots=True)
class CreateComplaintResult:
    complaint: Complaint
    needs_manual_review: bool
    ai_message: str | None
    duplicate_candidates: list


class ComplaintService:
    def __init__(self, db: Session) -> None:
        self.db = db
        self.repository = ComplaintRepository(db)
        self.repairs = RepairRepository(db)
        self.assessment = AssessmentService(db)
        self.duplicates = DuplicateService(db)
        self.notifications = NotificationService(db)
        self.audit = AuditService(db)

    # -- creation -------------------------------------------------------

    async def create(self, data: CreateComplaintInput, reporter: User | None) -> CreateComplaintResult:
        if not is_valid_coordinate(data.latitude, data.longitude):
            raise ValidationError("Those coordinates are not valid. Please pick a point on the map.")

        image: ComplaintImage | None = None
        processed = None
        if data.image_bytes:
            processed = validate_and_process(
                data.image_bytes, data.image_content_type or "application/octet-stream"
            )

        complaint = Complaint(
            complaint_number=self._reserve_number(),
            reporter_id=reporter.id if reporter else None,
            description=(data.description or "").strip() or None,
            reported_damage_type=data.reported_damage_type,
            damage_type=data.reported_damage_type or DamageType.UNKNOWN,
            road_name=(data.road_name or "").strip() or None,
            latitude=data.latitude,
            longitude=data.longitude,
            status=ComplaintStatus.PENDING,
        )
        self.repository.add(complaint)

        self.db.add(
            Location(
                complaint_id=complaint.id,
                latitude=data.latitude,
                longitude=data.longitude,
                accuracy_meters=data.accuracy_meters,
                address=(data.address or "").strip() or None,
                road_name=(data.road_name or "").strip() or None,
                city=(data.city or "").strip() or None,
                road_importance=_infer_road_importance(data.road_name),
                geocode_source="client",
            )
        )
        self.repository.record_status(
            complaint, None, ComplaintStatus.PENDING, changed_by_id=complaint.reporter_id,
            note="Report submitted",
        )

        if processed is not None:
            storage = get_storage_provider()
            stored = storage.save(
                processed.data,
                filename=data.image_filename,
                content_type=processed.content_type,
                folder="complaints",
            )
            image = ComplaintImage(
                complaint_id=complaint.id,
                storage_key=stored.storage_key,
                url=stored.url,
                content_type=stored.content_type,
                size_bytes=stored.size_bytes,
                width=processed.width,
                height=processed.height,
                kind=ImageKind.REPORT,
                perceptual_hash=processed.perceptual_hash,
            )
            self.repository.add_image(image)
            complaint.images.append(image)

        outcome = await self.assessment.assess(
            complaint,
            image=image,
            image_bytes=processed.data if processed else None,
        )

        candidates = self.duplicates.detect_and_record(complaint)
        self.notifications.complaint_submitted(complaint)

        self.db.commit()
        self.db.refresh(complaint)

        return CreateComplaintResult(
            complaint=complaint,
            needs_manual_review=outcome.needs_manual_review,
            ai_message=outcome.ai_message,
            duplicate_candidates=candidates,
        )

    async def reassess(self, complaint: Complaint, actor: User | None = None) -> Complaint:
        """Re-run the pipeline, e.g. after weights change or a retry."""
        image = next((img for img in complaint.images if img.kind == ImageKind.REPORT), None)
        image_bytes = None
        if image is not None:
            try:
                image_bytes = get_storage_provider().load(image.storage_key)
            except NotFoundError:
                image_bytes = None

        previous_score = complaint.priority_score
        await self.assessment.assess(complaint, image=image, image_bytes=image_bytes)

        self.audit.record(
            actor=actor,
            action="complaint.reassessed",
            entity_type="complaint",
            entity_id=complaint.id,
            complaint_id=complaint.id,
            old_value={"priority_score": previous_score},
            new_value={"priority_score": complaint.priority_score},
        )
        self.db.commit()
        self.db.refresh(complaint)
        return complaint

    # -- status ---------------------------------------------------------

    def change_status(
        self,
        complaint: Complaint,
        new_status: ComplaintStatus,
        actor: User | None,
        note: str | None = None,
    ) -> Complaint:
        current = complaint.status
        if new_status == current:
            return complaint

        allowed = STATUS_TRANSITIONS.get(current, set())
        if new_status not in allowed:
            raise InvalidStatusTransitionError(
                f"A complaint cannot move from {_readable(current)} to {_readable(new_status)}.",
                details={
                    "from": current.value,
                    "to": new_status.value,
                    "allowed": sorted(status.value for status in allowed),
                },
            )

        complaint.status = new_status
        if new_status == ComplaintStatus.RESOLVED:
            complaint.resolved_at = datetime.now(UTC)
        elif current == ComplaintStatus.RESOLVED:
            # Re-opening: clear the resolution timestamp so analytics stay honest.
            complaint.resolved_at = None

        self.repository.record_status(
            complaint, current, new_status, changed_by_id=actor.id if actor else None, note=note
        )
        self.audit.record(
            actor=actor,
            action="complaint.status_changed",
            entity_type="complaint",
            entity_id=complaint.id,
            complaint_id=complaint.id,
            old_value={"status": current.value},
            new_value={"status": new_status.value},
            note=note,
        )

        if new_status == ComplaintStatus.RESOLVED:
            self.notifications.complaint_resolved(complaint)
        else:
            self.notifications.complaint_status_changed(complaint, current.value)

        self.db.commit()
        self.db.refresh(complaint)
        return complaint

    def reject(self, complaint: Complaint, reason: str, actor: User | None) -> Complaint:
        if not reason.strip():
            raise ValidationError("Please give a reason for rejecting this report.")
        complaint.rejection_reason = reason.strip()
        return self.change_status(complaint, ComplaintStatus.REJECTED, actor, note=reason.strip())

    def override_priority(
        self, complaint: Complaint, score: float, actor: User | None, note: str | None = None
    ) -> Complaint:
        """Let an authorised officer overrule the recommendation.

        The AI-assisted score stays on the assessment record; this only changes
        what the queue sorts by, and the override is audited.
        """
        if not 0 <= score <= 100:
            raise ValidationError("A priority score must be between 0 and 100.")

        from app.services.priority import PriorityThresholds

        previous = {"priority_score": complaint.priority_score, "level": complaint.priority_level.value}
        complaint.manual_priority_override = score
        complaint.priority_score = score
        complaint.priority_level = PriorityThresholds.from_settings().level_for(score)

        self.audit.record(
            actor=actor,
            action="complaint.priority_overridden",
            entity_type="complaint",
            entity_id=complaint.id,
            complaint_id=complaint.id,
            old_value=previous,
            new_value={"priority_score": score, "level": complaint.priority_level.value},
            note=note,
        )
        self.db.commit()
        self.db.refresh(complaint)
        return complaint

    # -- assignment -----------------------------------------------------

    def assign(
        self,
        complaint: Complaint,
        team_id: uuid.UUID,
        actor: User | None,
        due_at: datetime | None = None,
        note: str | None = None,
    ) -> RepairAssignment:
        team = self.repairs.get_team(team_id)
        if team is None:
            raise NotFoundError("That repair team does not exist.")
        if not team.is_active:
            raise ConflictError(f"{team.name} is currently inactive and cannot take new work.")

        closed = (ComplaintStatus.RESOLVED, ComplaintStatus.REJECTED, ComplaintStatus.DUPLICATE)
        if complaint.status in closed:
            raise ConflictError(
                f"{complaint.complaint_number} is {_readable(complaint.status)} and cannot be assigned."
            )

        existing = self.repairs.active_assignment_for_complaint(complaint.id)
        if existing is not None:
            if existing.team_id == team_id:
                raise ConflictError(f"{complaint.complaint_number} is already assigned to {team.name}.")
            # Reassignment: release the previous crew rather than double-booking.
            existing.status = AssignmentStatus.CANCELLED
            existing.notes = f"Reassigned to {team.name}"

        workload = self.repairs.team_workload(team_id)
        if workload >= team.max_concurrent_jobs:
            raise ConflictError(
                f"{team.name} already has {workload} open jobs (limit {team.max_concurrent_jobs}).",
                details={"open_jobs": workload, "limit": team.max_concurrent_jobs},
            )

        assignment = self.repairs.add_assignment(
            RepairAssignment(
                complaint_id=complaint.id,
                team_id=team.id,
                assigned_by_id=actor.id if actor else None,
                status=AssignmentStatus.ASSIGNED,
                due_at=due_at or self._default_due(complaint),
                notes=note,
            )
        )

        if complaint.status != ComplaintStatus.ASSIGNED:
            previous = complaint.status
            complaint.status = ComplaintStatus.ASSIGNED
            self.repository.record_status(
                complaint,
                previous,
                ComplaintStatus.ASSIGNED,
                changed_by_id=actor.id if actor else None,
                note=f"Assigned to {team.name}",
            )

        self.audit.record(
            actor=actor,
            action="complaint.assigned",
            entity_type="repair_assignment",
            entity_id=assignment.id,
            complaint_id=complaint.id,
            old_value={"team_id": str(existing.team_id) if existing else None},
            new_value={"team_id": str(team.id), "team_name": team.name},
            note=note,
        )
        self.notifications.complaint_assigned(complaint, team.id, team.name)

        self.db.commit()
        self.db.refresh(assignment)
        return assignment

    def start_repair(self, assignment: RepairAssignment, actor: User | None) -> RepairAssignment:
        if assignment.status == AssignmentStatus.IN_PROGRESS:
            return assignment
        if assignment.status != AssignmentStatus.ASSIGNED:
            raise ConflictError(f"This job is {_readable(assignment.status)} and cannot be started.")

        now = datetime.now(UTC)
        assignment.status = AssignmentStatus.IN_PROGRESS
        assignment.started_at = now

        complaint = assignment.complaint
        if complaint.status != ComplaintStatus.IN_PROGRESS:
            previous = complaint.status
            complaint.status = ComplaintStatus.IN_PROGRESS
            self.repository.record_status(
                complaint,
                previous,
                ComplaintStatus.IN_PROGRESS,
                changed_by_id=actor.id if actor else None,
                note="Repair work started",
            )
            self.notifications.complaint_status_changed(complaint, previous.value)

        self.db.commit()
        self.db.refresh(assignment)
        return assignment

    def complete_repair(
        self,
        assignment: RepairAssignment,
        actor: User | None,
        note: str | None = None,
        evidence_files: list[tuple[bytes, str, str]] | None = None,
    ) -> RepairAssignment:
        """Crew marks the job done and uploads evidence; an admin verifies later."""
        if assignment.status == AssignmentStatus.VERIFIED:
            raise ConflictError("This job has already been verified.")
        if assignment.status not in (AssignmentStatus.ASSIGNED, AssignmentStatus.IN_PROGRESS):
            raise ConflictError(f"This job is {_readable(assignment.status)} and cannot be completed.")

        files = evidence_files or []
        if not files and not assignment.evidence:
            raise ValidationError("Please upload at least one photo showing the completed repair.")

        storage = get_storage_provider()
        for raw, content_type, _filename in files:
            processed = validate_and_process(raw, content_type)
            stored = storage.save(
                processed.data,
                filename="evidence.jpg",
                content_type=processed.content_type,
                folder="evidence",
            )
            self.repairs.add_evidence(
                RepairEvidence(
                    assignment_id=assignment.id,
                    submitted_by_id=actor.id if actor else None,
                    storage_key=stored.storage_key,
                    url=stored.url,
                    content_type=stored.content_type,
                    size_bytes=stored.size_bytes,
                    note=note,
                )
            )

        now = datetime.now(UTC)
        assignment.status = AssignmentStatus.COMPLETED
        assignment.completed_at = now
        if assignment.started_at is None:
            assignment.started_at = now
        if note:
            assignment.notes = note

        complaint = assignment.complaint
        if complaint.status != ComplaintStatus.IN_PROGRESS:
            previous = complaint.status
            complaint.status = ComplaintStatus.IN_PROGRESS
            self.repository.record_status(
                complaint,
                previous,
                ComplaintStatus.IN_PROGRESS,
                changed_by_id=actor.id if actor else None,
                note="Repair completed, awaiting verification",
            )

        self.audit.record(
            actor=actor,
            action="repair.completed",
            entity_type="repair_assignment",
            entity_id=assignment.id,
            complaint_id=complaint.id,
            new_value={"status": AssignmentStatus.COMPLETED.value},
            note=note,
        )
        self.notifications.repair_completed(complaint, assignment.team.name)

        self.db.commit()
        self.db.refresh(assignment)
        return assignment

    def verify_repair(
        self, assignment: RepairAssignment, actor: User | None, note: str | None = None
    ) -> RepairAssignment:
        """Admin signs off a completed repair, which resolves the complaint."""
        if assignment.status != AssignmentStatus.COMPLETED:
            raise ConflictError(
                "Only a job the crew has marked complete can be verified.",
                details={"status": assignment.status.value},
            )

        now = datetime.now(UTC)
        assignment.status = AssignmentStatus.VERIFIED
        assignment.verified_at = now
        assignment.verified_by_id = actor.id if actor else None

        complaint = assignment.complaint
        previous = complaint.status
        complaint.status = ComplaintStatus.RESOLVED
        complaint.resolved_at = now
        self.repository.record_status(
            complaint,
            previous,
            ComplaintStatus.RESOLVED,
            changed_by_id=actor.id if actor else None,
            note=note or "Repair verified",
        )

        self.audit.record(
            actor=actor,
            action="repair.verified",
            entity_type="repair_assignment",
            entity_id=assignment.id,
            complaint_id=complaint.id,
            old_value={"status": previous.value},
            new_value={"status": ComplaintStatus.RESOLVED.value},
            note=note,
        )
        self.notifications.complaint_resolved(complaint)

        self.db.commit()
        self.db.refresh(assignment)
        return assignment

    # -- duplicates -----------------------------------------------------

    def confirm_duplicate(self, link_id: uuid.UUID, actor: User | None):
        link = self.duplicates.duplicates.get(link_id)
        if link is None:
            raise NotFoundError("That duplicate suggestion no longer exists.")

        canonical, duplicate = self.duplicates.confirm(link, actor.id if actor else None)
        self.repository.record_status(
            duplicate,
            None,
            ComplaintStatus.DUPLICATE,
            changed_by_id=actor.id if actor else None,
            note=f"Merged into {canonical.complaint_number}",
        )
        self.audit.record(
            actor=actor,
            action="complaint.duplicate_confirmed",
            entity_type="complaint",
            entity_id=duplicate.id,
            complaint_id=canonical.id,
            new_value={
                "canonical": canonical.complaint_number,
                "duplicate": duplicate.complaint_number,
                "report_count": canonical.report_count,
            },
        )
        self.db.commit()
        self.db.refresh(canonical)
        return canonical, duplicate

    def reject_duplicate(self, link_id: uuid.UUID, actor: User | None):
        link = self.duplicates.duplicates.get(link_id)
        if link is None:
            raise NotFoundError("That duplicate suggestion no longer exists.")

        self.duplicates.reject(link, actor.id if actor else None)
        self.audit.record(
            actor=actor,
            action="complaint.duplicate_rejected",
            entity_type="potential_duplicate",
            entity_id=link.id,
            complaint_id=link.complaint_id,
        )
        self.db.commit()
        return link

    # -- internals ------------------------------------------------------

    def _default_due(self, complaint: Complaint) -> datetime:
        hours = SLA_HOURS.get(complaint.priority_level, 168)
        return datetime.now(UTC) + timedelta(hours=hours)

    def _reserve_number(self, attempts: int = 5) -> str:
        """Allocate the next number, retrying if another request took it first."""
        for attempt in range(attempts):
            number = next_complaint_number(self.db)
            existing = self.repository.get_by_number(number)
            if existing is None:
                return number
            if attempt == attempts - 1:  # pragma: no cover - contention guard
                raise IntegrityError("complaint number", None, Exception("exhausted retries"))
        raise ConflictError("Could not allocate a complaint number. Please try again.")


def _infer_road_importance(road_name: str | None) -> float:
    """Rough road classification from its name.

    A placeholder for a real road-network layer: "NH-48" or "Ring Road" implies
    a far busier corridor than "3rd Cross Lane". Documented as a heuristic so it
    is not mistaken for authoritative classification data.
    """
    if not road_name:
        return 5.0
    name = road_name.lower()
    if any(token in name for token in ("nh-", "national highway", "expressway", "bypass")):
        return 10.0
    if any(token in name for token in ("ring road", "sh-", "state highway", "trunk", "flyover")):
        return 8.5
    if any(token in name for token in ("main road", "high street", "market", "station road")):
        return 7.0
    if any(token in name for token in ("cross", "lane", "gali", "alley")):
        return 3.5
    return 5.0


def _readable(value) -> str:
    return str(value.value if hasattr(value, "value") else value).replace("_", " ").lower()
