"""Model -> schema conversion.

Kept out of the routers so the wire format is defined in exactly one place, and
so the rule that citizens never see reporter identities on public endpoints is
enforced by a single parameter rather than remembered at each call site.
"""

from __future__ import annotations

from datetime import UTC, datetime

from app.core.enums import AssignmentStatus, ImageKind
from app.models.complaint import Complaint, PotentialDuplicate
from app.models.repair import RepairAssignment
from app.schemas.admin import RepairEvidenceResponse, TaskResponse
from app.schemas.complaint import (
    AIAnalysisResponse,
    AssignmentSummary,
    ComplaintDetail,
    ComplaintImageResponse,
    ComplaintSummary,
    DuplicateCandidateResponse,
    DuplicateLinkResponse,
    LocationResponse,
    MapIssue,
    NearbyPlaceResponse,
    PriorityAssessmentResponse,
    PriorityFactorResponse,
    ReporterSummary,
    StatusHistoryResponse,
    TrafficSnapshotResponse,
)


def thumbnail_url(complaint: Complaint) -> str | None:
    for image in complaint.images:
        if image.kind == ImageKind.REPORT:
            return image.url
    return complaint.images[0].url if complaint.images else None


def to_summary(complaint: Complaint) -> ComplaintSummary:
    return ComplaintSummary(
        id=complaint.id,
        complaint_number=complaint.complaint_number,
        damage_type=complaint.damage_type,
        status=complaint.status,
        priority_score=complaint.priority_score,
        priority_level=complaint.priority_level,
        severity_score=complaint.severity_score,
        report_count=complaint.report_count,
        latitude=complaint.latitude,
        longitude=complaint.longitude,
        road_name=complaint.road_name,
        description=complaint.description,
        thumbnail_url=thumbnail_url(complaint),
        created_at=complaint.created_at,
        updated_at=complaint.updated_at,
    )


def to_map_issue(complaint: Complaint) -> MapIssue:
    return MapIssue(
        id=complaint.id,
        complaint_number=complaint.complaint_number,
        latitude=complaint.latitude,
        longitude=complaint.longitude,
        damage_type=complaint.damage_type,
        status=complaint.status,
        priority_level=complaint.priority_level,
        priority_score=complaint.priority_score,
        severity_score=complaint.severity_score,
        report_count=complaint.report_count,
        road_name=complaint.road_name,
        created_at=complaint.created_at,
    )


def to_priority_response(complaint: Complaint) -> PriorityAssessmentResponse | None:
    assessment = complaint.latest_assessment
    if assessment is None:
        return None

    weights = assessment.weights or {}
    factors = [
        PriorityFactorResponse(
            key="severity",
            label="Visual severity",
            value=assessment.severity_factor,
            weight=float(weights.get("severity", 4.0)),
            points=assessment.severity_points,
            max_points=round(float(weights.get("severity", 4.0)) * 10, 2),
            note=_note(assessment, "severity"),
        ),
        PriorityFactorResponse(
            key="traffic",
            label="Traffic",
            value=assessment.traffic_factor,
            weight=float(weights.get("traffic", 2.5)),
            points=assessment.traffic_points,
            max_points=round(float(weights.get("traffic", 2.5)) * 10, 2),
            note=_note(assessment, "traffic"),
        ),
        PriorityFactorResponse(
            key="location",
            label="Location risk",
            value=assessment.location_factor,
            weight=float(weights.get("location", 2.0)),
            points=assessment.location_points,
            max_points=round(float(weights.get("location", 2.0)) * 10, 2),
            note=_note(assessment, "location"),
        ),
        PriorityFactorResponse(
            key="history",
            label="Complaint history",
            value=assessment.history_factor,
            weight=float(weights.get("history", 1.5)),
            points=assessment.history_points,
            max_points=round(float(weights.get("history", 1.5)) * 10, 2),
            note=_note(assessment, "history"),
        ),
    ]

    return PriorityAssessmentResponse(
        id=assessment.id,
        total_score=assessment.total_score,
        level=assessment.level,
        explanation=assessment.explanation,
        factors=factors,
        weights=weights,
        signals=assessment.signals or {},
        weather_multiplier=assessment.weather_multiplier,
        engine_version=assessment.engine_version,
        created_at=assessment.created_at,
    )


def to_detail(complaint: Complaint, *, include_reporter: bool = False) -> ComplaintDetail:
    analysis = complaint.latest_analysis
    traffic = complaint.traffic_snapshots[-1] if complaint.traffic_snapshots else None
    assignment = complaint.active_assignment

    return ComplaintDetail(
        **to_summary(complaint).model_dump(),
        reported_damage_type=complaint.reported_damage_type,
        resolved_at=complaint.resolved_at,
        rejection_reason=complaint.rejection_reason,
        manual_priority_override=complaint.manual_priority_override,
        duplicate_of_id=complaint.duplicate_of_id,
        location=(
            LocationResponse.model_validate(complaint.location) if complaint.location else None
        ),
        images=[ComplaintImageResponse.model_validate(image) for image in complaint.images],
        latest_analysis=(AIAnalysisResponse.model_validate(analysis) if analysis else None),
        priority=to_priority_response(complaint),
        nearby_places=[
            NearbyPlaceResponse.model_validate(place)
            for place in sorted(complaint.nearby_places, key=lambda item: item.distance_meters)
        ],
        traffic=(TrafficSnapshotResponse.model_validate(traffic) if traffic else None),
        status_history=[
            StatusHistoryResponse.model_validate(entry) for entry in complaint.status_history
        ],
        assignment=(AssignmentSummary.model_validate(assignment) if assignment else None),
        reporter=(
            ReporterSummary.model_validate(complaint.reporter)
            if include_reporter and complaint.reporter
            else None
        ),
    )


def to_duplicate_candidate(candidate) -> DuplicateCandidateResponse:
    return DuplicateCandidateResponse(
        complaint_id=candidate.complaint.id,
        complaint_number=candidate.complaint.complaint_number,
        similarity=candidate.similarity,
        distance_meters=candidate.distance_meters,
        reason=candidate.reason,
        status=candidate.complaint.status,
        created_at=candidate.complaint.created_at,
    )


def to_duplicate_link(link: PotentialDuplicate) -> DuplicateLinkResponse:
    return DuplicateLinkResponse(
        id=link.id,
        complaint_id=link.complaint_id,
        complaint_number=link.complaint.complaint_number if link.complaint else "",
        duplicate_complaint_id=link.duplicate_complaint_id,
        duplicate_complaint_number=(
            link.duplicate_complaint.complaint_number if link.duplicate_complaint else ""
        ),
        similarity_score=link.similarity_score,
        distance_meters=link.distance_meters,
        reason=link.reason,
        status=link.status,
        created_at=link.created_at,
    )


def to_task(assignment: RepairAssignment) -> TaskResponse:
    now = datetime.now(UTC)
    due = assignment.due_at
    if due is not None and due.tzinfo is None:
        due = due.replace(tzinfo=UTC)

    overdue = bool(
        due
        and due < now
        and assignment.status in (AssignmentStatus.ASSIGNED, AssignmentStatus.IN_PROGRESS)
    )

    return TaskResponse(
        id=assignment.id,
        status=assignment.status,
        due_at=assignment.due_at,
        started_at=assignment.started_at,
        completed_at=assignment.completed_at,
        verified_at=assignment.verified_at,
        notes=assignment.notes,
        created_at=assignment.created_at,
        complaint=to_summary(assignment.complaint),
        evidence=[RepairEvidenceResponse.model_validate(item) for item in assignment.evidence],
        is_overdue=overdue,
    )


def _note(assessment, key: str) -> str:
    """Recover the per-factor sentence from the stored explanation."""
    signals = assessment.signals or {}
    notes = signals.get("notes") if isinstance(signals, dict) else None
    if isinstance(notes, dict) and key in notes:
        return str(notes[key])
    return ""
