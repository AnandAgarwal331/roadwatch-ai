"""Data access for repair teams and assignments."""

from __future__ import annotations

import uuid

from sqlalchemy import func, select
from sqlalchemy.orm import Session, selectinload

from app.core.enums import AssignmentStatus
from app.models.complaint import Complaint
from app.models.repair import RepairAssignment, RepairEvidence, RepairTeam

#: Assignments that still occupy a crew's capacity.
OPEN_ASSIGNMENT_STATUSES = (AssignmentStatus.ASSIGNED, AssignmentStatus.IN_PROGRESS)


class RepairRepository:
    def __init__(self, db: Session) -> None:
        self.db = db

    # -- teams ----------------------------------------------------------

    def get_team(self, team_id: uuid.UUID) -> RepairTeam | None:
        return self.db.get(RepairTeam, team_id)

    def list_teams(self, *, active_only: bool = False) -> list[RepairTeam]:
        stmt = select(RepairTeam).order_by(RepairTeam.name)
        if active_only:
            stmt = stmt.where(RepairTeam.is_active.is_(True))
        return list(self.db.execute(stmt).scalars().all())

    def add_team(self, team: RepairTeam) -> RepairTeam:
        self.db.add(team)
        self.db.flush()
        return team

    def team_workload(self, team_id: uuid.UUID) -> int:
        """Open jobs currently held by a crew."""
        stmt = select(func.count(RepairAssignment.id)).where(
            RepairAssignment.team_id == team_id,
            RepairAssignment.status.in_(OPEN_ASSIGNMENT_STATUSES),
        )
        return int(self.db.execute(stmt).scalar_one())

    def workload_by_team(self) -> dict[uuid.UUID, int]:
        rows = self.db.execute(
            select(RepairAssignment.team_id, func.count(RepairAssignment.id))
            .where(RepairAssignment.status.in_(OPEN_ASSIGNMENT_STATUSES))
            .group_by(RepairAssignment.team_id)
        ).all()
        return {team_id: int(count) for team_id, count in rows}

    # -- assignments ----------------------------------------------------

    def get_assignment(self, assignment_id: uuid.UUID) -> RepairAssignment | None:
        stmt = (
            select(RepairAssignment)
            .where(RepairAssignment.id == assignment_id)
            .options(
                selectinload(RepairAssignment.evidence),
                selectinload(RepairAssignment.complaint).selectinload(Complaint.images),
                selectinload(RepairAssignment.complaint).selectinload(Complaint.location),
                selectinload(RepairAssignment.team),
            )
        )
        return self.db.execute(stmt).scalars().first()

    def list_team_assignments(
        self,
        team_id: uuid.UUID,
        *,
        statuses: list[AssignmentStatus] | None = None,
        limit: int = 100,
    ) -> list[RepairAssignment]:
        stmt = (
            select(RepairAssignment)
            .where(RepairAssignment.team_id == team_id)
            .options(
                selectinload(RepairAssignment.complaint).selectinload(Complaint.images),
                selectinload(RepairAssignment.complaint).selectinload(Complaint.location),
                selectinload(RepairAssignment.evidence),
            )
        )
        if statuses:
            stmt = stmt.where(RepairAssignment.status.in_(statuses))
        # Highest-priority work first, then the earliest deadline.
        stmt = (
            stmt.join(Complaint, Complaint.id == RepairAssignment.complaint_id)
            .order_by(Complaint.priority_score.desc(), RepairAssignment.due_at.asc().nulls_last())
            .limit(limit)
        )
        return list(self.db.execute(stmt).scalars().unique().all())

    def active_assignment_for_complaint(self, complaint_id: uuid.UUID) -> RepairAssignment | None:
        stmt = (
            select(RepairAssignment)
            .where(
                RepairAssignment.complaint_id == complaint_id,
                RepairAssignment.status.in_(
                    (
                        AssignmentStatus.ASSIGNED,
                        AssignmentStatus.IN_PROGRESS,
                        AssignmentStatus.COMPLETED,
                    )
                ),
            )
            .order_by(RepairAssignment.created_at.desc())
        )
        return self.db.execute(stmt).scalars().first()

    def add_assignment(self, assignment: RepairAssignment) -> RepairAssignment:
        self.db.add(assignment)
        self.db.flush()
        return assignment

    def add_evidence(self, evidence: RepairEvidence) -> RepairEvidence:
        self.db.add(evidence)
        self.db.flush()
        return evidence

    def completed_count(self, team_id: uuid.UUID) -> int:
        stmt = select(func.count(RepairAssignment.id)).where(
            RepairAssignment.team_id == team_id,
            RepairAssignment.status.in_((AssignmentStatus.COMPLETED, AssignmentStatus.VERIFIED)),
        )
        return int(self.db.execute(stmt).scalar_one())
