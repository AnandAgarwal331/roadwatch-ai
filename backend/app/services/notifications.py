"""Notification dispatch.

In-app notifications are written to the database today. Email, SMS and push are
deliberately modelled as additional *channels* over the same records rather than
a separate mechanism: adding a delivery worker later means implementing
:class:`NotificationChannelSender` and registering it, with no change to the
call sites that raise the events.
"""

from __future__ import annotations

import logging
import uuid
from dataclasses import dataclass
from typing import Protocol, runtime_checkable

from sqlalchemy.orm import Session

from app.core.enums import NotificationChannel, UserRole
from app.models.system import Notification
from app.models.user import User
from app.repositories.system import NotificationRepository
from app.repositories.user import UserRepository

logger = logging.getLogger("roadwatch.notifications")


@dataclass(slots=True)
class NotificationPayload:
    event: str
    title: str
    body: str
    link: str | None = None
    complaint_id: uuid.UUID | None = None


@runtime_checkable
class NotificationChannelSender(Protocol):
    """Delivers a notification over one channel."""

    channel: NotificationChannel

    def send(self, user: User, payload: NotificationPayload) -> None:
        ...


class InAppSender:
    """Persists the notification for the in-app inbox."""

    channel = NotificationChannel.IN_APP

    def __init__(self, db: Session) -> None:
        self.repository = NotificationRepository(db)

    def send(self, user: User, payload: NotificationPayload) -> None:
        self.repository.add(
            Notification(
                user_id=user.id,
                title=payload.title,
                body=payload.body,
                event=payload.event,
                channel=self.channel,
                complaint_id=payload.complaint_id,
                link=payload.link,
            )
        )


class LoggingSender:
    """Stand-in for a real email/SMS gateway.

    Writes what *would* have been sent to the application log, so the
    integration point is exercised in development without a paid provider.
    """

    def __init__(self, channel: NotificationChannel) -> None:
        self.channel = channel

    def send(self, user: User, payload: NotificationPayload) -> None:
        logger.info(
            "[%s] to %s: %s - %s", self.channel.value, user.email, payload.title, payload.body
        )


class NotificationService:
    def __init__(self, db: Session, senders: list[NotificationChannelSender] | None = None) -> None:
        self.db = db
        self.users = UserRepository(db)
        self.senders = senders or [InAppSender(db)]

    def notify(self, user: User | None, payload: NotificationPayload) -> None:
        if user is None or not user.is_active:
            return
        for sender in self.senders:
            try:
                sender.send(user, payload)
            except Exception:  # noqa: BLE001 - delivery must never break the request
                logger.exception("Notification delivery failed on channel %s", sender.channel)

    def notify_user_id(self, user_id: uuid.UUID | None, payload: NotificationPayload) -> None:
        if user_id is None:
            return
        self.notify(self.users.get(user_id), payload)

    def notify_role(self, role: UserRole, payload: NotificationPayload) -> None:
        for user in self.users.list_by_role(role):
            self.notify(user, payload)

    def notify_team(self, team_id: uuid.UUID, payload: NotificationPayload) -> None:
        for user in self.users.list_by_team(team_id):
            self.notify(user, payload)

    # -- domain events --------------------------------------------------

    def complaint_submitted(self, complaint) -> None:
        link = f"/admin/reports/{complaint.id}"
        self.notify_role(
            UserRole.ADMIN,
            NotificationPayload(
                event="complaint.created",
                title=f"New {complaint.priority_level.value.lower()} priority report",
                body=(
                    f"{complaint.complaint_number}: "
                    f"{_label(complaint.damage_type)} reported"
                    f"{f' on {complaint.road_name}' if complaint.road_name else ''} "
                    f"with a priority score of {complaint.priority_score:g}."
                ),
                link=link,
                complaint_id=complaint.id,
            ),
        )

    def complaint_assigned(self, complaint, team_id: uuid.UUID, team_name: str) -> None:
        self.notify_team(
            team_id,
            NotificationPayload(
                event="assignment.created",
                title=f"New {complaint.priority_level.value.lower()} priority repair assigned",
                body=(
                    f"{complaint.complaint_number} ({_label(complaint.damage_type)}) "
                    f"has been assigned to your team."
                ),
                link=f"/team/tasks/{complaint.id}",
                complaint_id=complaint.id,
            ),
        )
        self.notify_user_id(
            complaint.reporter_id,
            NotificationPayload(
                event="complaint.assigned",
                title="Your report has been assigned",
                body=f"Your report {complaint.complaint_number} has been assigned to {team_name}.",
                link=f"/reports/{complaint.id}",
                complaint_id=complaint.id,
            ),
        )

    def complaint_status_changed(self, complaint, previous: str) -> None:
        self.notify_user_id(
            complaint.reporter_id,
            NotificationPayload(
                event="complaint.status_changed",
                title=f"Report {complaint.complaint_number} is now {_readable(complaint.status.value)}",
                body=(
                    f"Your reported {_label(complaint.damage_type)} moved from "
                    f"{_readable(previous)} to {_readable(complaint.status.value)}."
                ),
                link=f"/reports/{complaint.id}",
                complaint_id=complaint.id,
            ),
        )

    def complaint_resolved(self, complaint) -> None:
        self.notify_user_id(
            complaint.reporter_id,
            NotificationPayload(
                event="complaint.resolved",
                title="Your report has been resolved",
                body=(
                    f"The {_label(complaint.damage_type)} you reported "
                    f"({complaint.complaint_number}) has been repaired and verified. Thank you."
                ),
                link=f"/reports/{complaint.id}",
                complaint_id=complaint.id,
            ),
        )

    def repair_completed(self, complaint, team_name: str) -> None:
        self.notify_role(
            UserRole.ADMIN,
            NotificationPayload(
                event="repair.completed",
                title="Repair awaiting verification",
                body=(
                    f"{team_name} marked {complaint.complaint_number} complete and uploaded evidence. "
                    "Please verify."
                ),
                link=f"/admin/reports/{complaint.id}",
                complaint_id=complaint.id,
            ),
        )


def _label(damage_type) -> str:
    return str(damage_type.value if hasattr(damage_type, "value") else damage_type).replace(
        "_", " "
    ).lower()


def _readable(status: str) -> str:
    return status.replace("_", " ").lower()
