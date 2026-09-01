"""Human-friendly complaint numbers, e.g. ``RW-2026-001024``.

The UUID primary key is what the system uses internally; this is what a citizen
reads over the phone. Numbers restart each calendar year.

The sequence is derived from the highest number already issued this year and
written under the table's unique constraint, so a collision from two concurrent
submissions surfaces as an ``IntegrityError`` and is retried rather than
silently issuing a duplicate.
"""

from __future__ import annotations

from datetime import UTC, datetime

from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.models.complaint import Complaint

PREFIX = "RW"
SEQUENCE_WIDTH = 6


def next_complaint_number(db: Session, year: int | None = None) -> str:
    year = year or datetime.now(UTC).year
    prefix = f"{PREFIX}-{year}-"

    highest = db.execute(
        select(func.max(Complaint.complaint_number)).where(Complaint.complaint_number.like(f"{prefix}%"))
    ).scalar_one_or_none()

    sequence = 1
    if highest:
        try:
            sequence = int(highest.rsplit("-", 1)[1]) + 1
        except (IndexError, ValueError):
            # A malformed row must not stop new reports; fall back to counting.
            sequence = (
                int(
                    db.execute(
                        select(func.count(Complaint.id)).where(
                            Complaint.complaint_number.like(f"{prefix}%")
                        )
                    ).scalar_one()
                )
                + 1
            )

    return f"{prefix}{sequence:0{SEQUENCE_WIDTH}d}"
