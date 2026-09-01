"""Domain enumerations shared by models, schemas and services."""

from __future__ import annotations

from enum import Enum


class StrEnum(str, Enum):
    def __str__(self) -> str:  # pragma: no cover - trivial
        return self.value


class UserRole(StrEnum):
    CITIZEN = "CITIZEN"
    ADMIN = "ADMIN"
    REPAIR_TEAM = "REPAIR_TEAM"


class DamageType(StrEnum):
    POTHOLE = "POTHOLE"
    CRACKED_ROAD = "CRACKED_ROAD"
    FLOODING = "FLOODING"
    DAMAGED_SIDEWALK = "DAMAGED_SIDEWALK"
    BROKEN_STREETLIGHT = "BROKEN_STREETLIGHT"
    OTHER = "OTHER"
    UNKNOWN = "UNKNOWN"


class ComplaintStatus(StrEnum):
    PENDING = "PENDING"
    AI_ANALYZED = "AI_ANALYZED"
    PRIORITIZED = "PRIORITIZED"
    ASSIGNED = "ASSIGNED"
    IN_PROGRESS = "IN_PROGRESS"
    RESOLVED = "RESOLVED"
    REJECTED = "REJECTED"
    DUPLICATE = "DUPLICATE"


#: Allowed status transitions.  Enforced by ``ComplaintService`` so the
#: lifecycle cannot be short-circuited through the API.
STATUS_TRANSITIONS: dict[ComplaintStatus, set[ComplaintStatus]] = {
    ComplaintStatus.PENDING: {
        ComplaintStatus.AI_ANALYZED,
        ComplaintStatus.PRIORITIZED,
        ComplaintStatus.REJECTED,
        ComplaintStatus.DUPLICATE,
    },
    ComplaintStatus.AI_ANALYZED: {
        ComplaintStatus.PRIORITIZED,
        ComplaintStatus.REJECTED,
        ComplaintStatus.DUPLICATE,
    },
    ComplaintStatus.PRIORITIZED: {
        ComplaintStatus.ASSIGNED,
        ComplaintStatus.REJECTED,
        ComplaintStatus.DUPLICATE,
    },
    ComplaintStatus.ASSIGNED: {
        ComplaintStatus.IN_PROGRESS,
        ComplaintStatus.PRIORITIZED,
        ComplaintStatus.REJECTED,
        ComplaintStatus.DUPLICATE,
    },
    ComplaintStatus.IN_PROGRESS: {
        ComplaintStatus.RESOLVED,
        ComplaintStatus.ASSIGNED,
        ComplaintStatus.REJECTED,
    },
    ComplaintStatus.RESOLVED: {ComplaintStatus.IN_PROGRESS},
    ComplaintStatus.REJECTED: {ComplaintStatus.PENDING, ComplaintStatus.PRIORITIZED},
    ComplaintStatus.DUPLICATE: {ComplaintStatus.PENDING, ComplaintStatus.PRIORITIZED},
}

#: Statuses that mean "no longer needs field work".
CLOSED_STATUSES = {ComplaintStatus.RESOLVED, ComplaintStatus.REJECTED, ComplaintStatus.DUPLICATE}


class PriorityLevel(StrEnum):
    LOW = "LOW"
    MEDIUM = "MEDIUM"
    HIGH = "HIGH"
    CRITICAL = "CRITICAL"


class TrafficLevel(StrEnum):
    LOW = "LOW"
    MEDIUM = "MEDIUM"
    HIGH = "HIGH"
    VERY_HIGH = "VERY_HIGH"


class PlaceType(StrEnum):
    HOSPITAL = "HOSPITAL"
    SCHOOL = "SCHOOL"
    BUS_STOP = "BUS_STOP"
    MAJOR_INTERSECTION = "MAJOR_INTERSECTION"
    EMERGENCY_SERVICE = "EMERGENCY_SERVICE"


class AssignmentStatus(StrEnum):
    ASSIGNED = "ASSIGNED"
    IN_PROGRESS = "IN_PROGRESS"
    COMPLETED = "COMPLETED"
    VERIFIED = "VERIFIED"
    CANCELLED = "CANCELLED"


class DuplicateStatus(StrEnum):
    SUGGESTED = "SUGGESTED"
    CONFIRMED = "CONFIRMED"
    REJECTED = "REJECTED"


class NotificationChannel(StrEnum):
    IN_APP = "IN_APP"
    EMAIL = "EMAIL"
    SMS = "SMS"
    PUSH = "PUSH"


class ImageKind(StrEnum):
    REPORT = "REPORT"
    REPAIR_EVIDENCE = "REPAIR_EVIDENCE"
