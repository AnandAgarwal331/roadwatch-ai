"""The assessment pipeline.

One complaint, one pass::

    image -> AI detection -> visual severity
                                  |
    location -> nearby facilities -> location risk
             -> traffic snapshot  -> traffic factor
             -> previous reports  -> history factor
             -> weather (optional)-> escalation
                                  |
                                  v
                          PriorityService -> persisted PriorityAssessment

Each stage degrades independently. If the detector is down the report still
lands and still gets scored on its location signals - it is simply flagged for
manual review. Losing a citizen's report because an inference container
restarted is not an acceptable failure mode.
"""

from __future__ import annotations

import logging
from dataclasses import dataclass
from datetime import UTC, datetime

from sqlalchemy.orm import Session

from app.core.config import settings
from app.core.enums import ComplaintStatus, DamageType, PlaceType
from app.models.analysis import AIAnalysis, AIDetection, PriorityAssessment
from app.models.complaint import Complaint, ComplaintImage
from app.models.geo import NearbyPlace, TrafficSnapshot, WeatherSnapshot
from app.providers.ai.base import AnalysisResult
from app.providers.ai.factory import get_ai_provider
from app.providers.places.factory import get_places_provider
from app.providers.traffic.factory import get_traffic_provider
from app.providers.weather.factory import get_weather_provider
from app.repositories.complaint import ComplaintRepository
from app.services.history import ComplaintHistoryService
from app.services.location_risk import location_risk_service
from app.services.priority import PriorityInput, PriorityService
from app.services.severity import severity_service

logger = logging.getLogger("roadwatch.assessment")


@dataclass(slots=True)
class AssessmentOutcome:
    complaint: Complaint
    analysis: AIAnalysis | None
    assessment: PriorityAssessment
    #: True when the AI stage failed or was too unsure to classify.
    needs_manual_review: bool
    ai_message: str | None


class AssessmentService:
    def __init__(self, db: Session) -> None:
        self.db = db
        self.complaints = ComplaintRepository(db)
        self.history = ComplaintHistoryService(self.complaints)
        self.priority = PriorityService()

    async def assess(
        self,
        complaint: Complaint,
        *,
        image: ComplaintImage | None = None,
        image_bytes: bytes | None = None,
        now: datetime | None = None,
    ) -> AssessmentOutcome:
        now = now or datetime.now(UTC)

        analysis_row, ai_result, needs_review, ai_message = await self._run_ai(
            complaint, image, image_bytes
        )

        severity = severity_service.estimate(ai_result) if ai_result else None
        severity_score = severity.score if severity else 0.0

        if analysis_row is not None and severity is not None:
            analysis_row.severity_score = severity.score
            analysis_row.severity_explanation = severity.explanation

        # The AI verdict wins unless it was unusable, in which case fall back to
        # what the citizen selected rather than discarding their input.
        if ai_result and ai_result.succeeded and ai_result.damage_type != DamageType.UNKNOWN:
            complaint.damage_type = ai_result.damage_type
        elif complaint.reported_damage_type:
            complaint.damage_type = complaint.reported_damage_type
        else:
            complaint.damage_type = DamageType.UNKNOWN

        complaint.severity_score = severity_score

        location = self._assess_location(complaint)
        traffic = await self._assess_traffic(complaint, now)
        history = self.history.analyse(
            complaint.latitude, complaint.longitude, exclude_id=complaint.id, now=now
        )
        weather_multiplier = await self._assess_weather(complaint, now)

        severity_note = (
            severity.explanation.split(". ")[0].replace("Visual severity estimate: ", "")
            if severity
            else "no usable visual assessment"
        )
        traffic_note = f"traffic on this stretch is {traffic.level.value.replace('_', ' ').lower()}"
        location_note = location.explanation.rstrip(".")
        history_note = history.explanation.rstrip(".")

        result = self.priority.calculate(
            PriorityInput(
                severity=severity_score,
                traffic=traffic.score,
                location=location.score,
                history=history.score,
                severity_note=severity_note,
                traffic_note=traffic_note,
                location_note=location_note,
                history_note=history_note,
                weather_multiplier=weather_multiplier,
                signals={
                    # Persisted so the detail view can show each factor's own
                    # sentence, not just the combined explanation.
                    "notes": {
                        "severity": severity_note,
                        "traffic": traffic_note,
                        "location": location_note,
                        "history": history_note,
                    },
                    "severity": severity.components if severity else {},
                    "traffic": {
                        "level": traffic.level.value,
                        "vehicles_per_hour": traffic.estimated_vehicles_per_hour,
                        "provider": traffic.provider,
                    },
                    "location": {
                        "nearest_by_type": location.nearest_by_type,
                        "place_count": location.place_count,
                        "radius_meters": settings.NEARBY_RADIUS_METERS,
                    },
                    "history": history.as_signals(),
                    "ai": {
                        "confident": not needs_review,
                        "confidence": round(ai_result.confidence, 4) if ai_result else 0.0,
                        "detections": len(ai_result.detections) if ai_result else 0,
                        "damaged_area_ratio": (
                            round(ai_result.damaged_area_ratio, 4) if ai_result else 0.0
                        ),
                    },
                },
            )
        )

        assessment = PriorityAssessment(
            complaint_id=complaint.id,
            severity_factor=result.severity_factor,
            traffic_factor=result.traffic_factor,
            location_factor=result.location_factor,
            history_factor=result.history_factor,
            severity_points=result.points("severity"),
            traffic_points=result.points("traffic"),
            location_points=result.points("location"),
            history_points=result.points("history"),
            total_score=result.total_score,
            level=result.level,
            explanation=result.explanation,
            weights=result.weights,
            signals=result.signals,
            weather_multiplier=result.weather_multiplier,
            engine_version=result.engine_version,
        )
        self.db.add(assessment)

        complaint.priority_score = result.total_score
        complaint.priority_level = result.level

        self._advance_status(complaint, analysis_row is not None)
        self.db.flush()

        return AssessmentOutcome(
            complaint=complaint,
            analysis=analysis_row,
            assessment=assessment,
            needs_manual_review=needs_review,
            ai_message=ai_message,
        )

    # -- stages ---------------------------------------------------------

    async def _run_ai(
        self,
        complaint: Complaint,
        image: ComplaintImage | None,
        image_bytes: bytes | None,
    ) -> tuple[AIAnalysis | None, AnalysisResult | None, bool, str | None]:
        if image is None or image_bytes is None:
            return None, None, True, "No photo was provided, so no AI analysis was performed."

        provider = get_ai_provider()
        try:
            result = await provider.analyze(image_bytes, image.content_type)
        except Exception:  # noqa: BLE001 - a provider bug must not lose the report
            logger.exception("AI provider raised unexpectedly")
            result = AnalysisResult(
                damage_type=DamageType.UNKNOWN,
                confidence=0.0,
                provider=getattr(provider, "name", "unknown"),
                error_message="The AI service failed unexpectedly.",
            )

        confident = (
            result.succeeded
            and result.confidence >= settings.AI_MIN_CONFIDENCE
            and result.damage_type != DamageType.UNKNOWN
        )

        analysis_row = AIAnalysis(
            complaint_id=complaint.id,
            image_id=image.id,
            damage_type=result.damage_type,
            confidence=round(result.confidence, 4),
            severity_score=0.0,  # filled in by the severity stage
            damaged_area_ratio=round(result.damaged_area_ratio, 4),
            detection_count=len(result.detections),
            is_confident=confident,
            model_name=result.model_name,
            model_version=result.model_version,
            provider=result.provider,
            processing_ms=result.processing_ms,
            error_message=result.error_message,
        )
        self.db.add(analysis_row)
        self.db.flush()

        for detection in result.detections:
            self.db.add(
                AIDetection(
                    analysis_id=analysis_row.id,
                    damage_type=detection.damage_type,
                    confidence=round(detection.confidence, 4),
                    bbox_x=detection.bbox_x,
                    bbox_y=detection.bbox_y,
                    bbox_width=detection.bbox_width,
                    bbox_height=detection.bbox_height,
                    area_ratio=round(detection.area_ratio, 4),
                )
            )

        message = None
        if not result.succeeded:
            message = (
                "AI analysis is temporarily unavailable. Your report has been submitted and will "
                "be reviewed manually."
            )
        elif not confident:
            message = (
                "AI could not confidently identify the issue. Your report has been submitted for "
                "manual review."
            )

        return analysis_row, result, not confident, message

    def _assess_location(self, complaint: Complaint):
        radius = settings.NEARBY_RADIUS_METERS
        provider = get_places_provider(self.db)
        try:
            places = provider.find_nearby(complaint.latitude, complaint.longitude, radius)
        except Exception:  # noqa: BLE001 - degrade to "nothing known nearby"
            logger.exception("Nearby places lookup failed")
            places = []

        # Replace any previous snapshot so re-assessment does not duplicate rows.
        for existing in list(complaint.nearby_places):
            self.db.delete(existing)
        complaint.nearby_places.clear()

        for place in places:
            self.db.add(
                NearbyPlace(
                    complaint_id=complaint.id,
                    place_type=place.place_type,
                    name=place.name,
                    distance_meters=place.distance_meters,
                    latitude=place.latitude,
                    longitude=place.longitude,
                    source=place.source,
                )
            )

        road_importance = complaint.location.road_importance if complaint.location else 5.0
        return location_risk_service.assess(places, radius, road_importance)

    async def _assess_traffic(self, complaint: Complaint, now: datetime):
        provider = get_traffic_provider()
        reading = await provider.get_traffic(complaint.latitude, complaint.longitude, now)
        self.db.add(
            TrafficSnapshot(
                complaint_id=complaint.id,
                level=reading.level,
                score=reading.score,
                estimated_vehicles_per_hour=reading.estimated_vehicles_per_hour,
                observed_at=reading.observed_at,
                provider=reading.provider,
            )
        )
        return reading

    async def _assess_weather(self, complaint: Complaint, now: datetime) -> float:
        provider = get_weather_provider()
        if provider is None:
            return 1.0
        try:
            reading = await provider.get_weather(complaint.latitude, complaint.longitude, now)
        except Exception:  # noqa: BLE001 - optional signal, never fatal
            logger.exception("Weather lookup failed")
            return 1.0

        multiplier = reading.risk_multiplier(complaint.damage_type)
        self.db.add(
            WeatherSnapshot(
                complaint_id=complaint.id,
                condition=reading.condition,
                rainfall_mm_24h=reading.rainfall_mm_24h,
                temperature_c=reading.temperature_c,
                risk_multiplier=multiplier,
                observed_at=reading.observed_at,
                provider=reading.provider,
            )
        )
        return multiplier

    def _advance_status(self, complaint: Complaint, had_analysis: bool) -> None:
        """Move a freshly-scored complaint to PRIORITIZED.

        Only from the early lifecycle states - re-scoring a job already assigned
        or in progress must not yank it back out of a crew's queue.
        """
        if complaint.status in (
            ComplaintStatus.PENDING,
            ComplaintStatus.AI_ANALYZED,
            ComplaintStatus.PRIORITIZED,
        ):
            previous = complaint.status
            if had_analysis and previous == ComplaintStatus.PENDING:
                self.complaints.record_status(
                    complaint, previous, ComplaintStatus.AI_ANALYZED, note="AI analysis completed"
                )
                previous = ComplaintStatus.AI_ANALYZED

            if previous != ComplaintStatus.PRIORITIZED:
                self.complaints.record_status(
                    complaint,
                    previous,
                    ComplaintStatus.PRIORITIZED,
                    note=f"Priority score {complaint.priority_score:g} ({complaint.priority_level.value})",
                )
            complaint.status = ComplaintStatus.PRIORITIZED


def place_type_label(place_type: PlaceType) -> str:
    return place_type.value.replace("_", " ").title()
