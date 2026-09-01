"""Model package.

Importing this module registers every mapper on the shared ``Base`` metadata,
which Alembic autogenerate and ``Base.metadata.create_all`` both rely on.
"""

from app.db.base import Base
from app.models.analysis import AIAnalysis, AIDetection, PriorityAssessment
from app.models.complaint import (
    Complaint,
    ComplaintImage,
    ComplaintStatusHistory,
    PotentialDuplicate,
)
from app.models.geo import (
    Location,
    NearbyPlace,
    SeededPlace,
    TrafficSnapshot,
    WeatherSnapshot,
)
from app.models.repair import RepairAssignment, RepairEvidence, RepairTeam
from app.models.system import AuditLog, Notification
from app.models.user import User

__all__ = [
    "AIAnalysis",
    "AIDetection",
    "AuditLog",
    "Base",
    "Complaint",
    "ComplaintImage",
    "ComplaintStatusHistory",
    "Location",
    "NearbyPlace",
    "Notification",
    "PotentialDuplicate",
    "PriorityAssessment",
    "RepairAssignment",
    "RepairEvidence",
    "RepairTeam",
    "SeededPlace",
    "TrafficSnapshot",
    "User",
    "WeatherSnapshot",
]
