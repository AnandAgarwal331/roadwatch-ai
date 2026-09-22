// Ported from backend/app/services/notifications.py. Only the in-app
// channel is implemented (matches Python's default `senders=[InAppSender]`
// - email/SMS/push are modelled there as a Protocol with no real sender
// registered yet). Always uses the service client: notifications has no
// client-facing insert policy (RPC/trigger-only, see the RLS migration), and
// listing "every admin" or "every member of a team" must see across the
// caller's own visibility.

import type { SupabaseClient } from "@supabase/supabase-js";
import type { ComplaintRow } from "../repositories/complaint.ts";

interface NotificationPayload {
  event: string;
  title: string;
  body: string;
  link?: string | null;
  complaintId?: string | null;
}

function label(damageType: string): string {
  return damageType.replace(/_/g, " ").toLowerCase();
}

function readable(status: string): string {
  return status.replace(/_/g, " ").toLowerCase();
}

function trimNumber(value: number): string {
  return Number(value.toFixed(6)).toString();
}

async function insertNotification(client: SupabaseClient, userId: string, payload: NotificationPayload): Promise<void> {
  const { error } = await client.from("notifications").insert({
    user_id: userId,
    title: payload.title,
    body: payload.body,
    event: payload.event,
    channel: "IN_APP",
    complaint_id: payload.complaintId ?? null,
    link: payload.link ?? null,
  });
  if (error) {
    // Delivery must never break the request that triggered it.
    console.error("notification insert failed", error);
  }
}

async function notifyRole(client: SupabaseClient, role: string, payload: NotificationPayload): Promise<void> {
  const { data, error } = await client.from("profiles").select("id").eq("role", role).eq("is_active", true);
  if (error) throw error;
  await Promise.all((data ?? []).map((row) => insertNotification(client, row.id, payload)));
}

async function notifyTeam(client: SupabaseClient, teamId: string, payload: NotificationPayload): Promise<void> {
  const { data, error } = await client.from("profiles").select("id").eq("team_id", teamId).eq("is_active", true);
  if (error) throw error;
  await Promise.all((data ?? []).map((row) => insertNotification(client, row.id, payload)));
}

async function notifyUserId(client: SupabaseClient, userId: string | null | undefined, payload: NotificationPayload): Promise<void> {
  if (!userId) return;
  const { data, error } = await client.from("profiles").select("id, is_active").eq("id", userId).maybeSingle();
  if (error) throw error;
  if (!data || !data.is_active) return;
  await insertNotification(client, userId, payload);
}

export async function complaintSubmitted(client: SupabaseClient, complaint: ComplaintRow): Promise<void> {
  await notifyRole(client, "ADMIN", {
    event: "complaint.created",
    title: `New ${String(complaint.priority_level).toLowerCase()} priority report`,
    body:
      `${complaint.complaint_number}: ${label(String(complaint.damage_type))} reported` +
      (complaint.road_name ? ` on ${complaint.road_name}` : "") +
      ` with a priority score of ${trimNumber(Number(complaint.priority_score))}.`,
    link: `/admin/reports/${complaint.id}`,
    complaintId: complaint.id,
  });
}

export async function complaintAssigned(
  client: SupabaseClient,
  complaint: ComplaintRow,
  assignmentId: string,
  teamId: string,
  teamName: string,
): Promise<void> {
  await notifyTeam(client, teamId, {
    event: "assignment.created",
    title: `New ${String(complaint.priority_level).toLowerCase()} priority repair assigned`,
    body: `${complaint.complaint_number} (${label(String(complaint.damage_type))}) has been assigned to your team.`,
    // The crew's job page is keyed by the assignment's own id, not the
    // complaint's - the two are different rows, and a link built from the
    // wrong one 404s the moment it's clicked.
    link: `/team/tasks/${assignmentId}`,
    complaintId: complaint.id,
  });
  await notifyUserId(client, complaint.reporter_id, {
    event: "complaint.assigned",
    title: "Your report has been assigned",
    body: `Your report ${complaint.complaint_number} has been assigned to ${teamName}.`,
    link: `/reports/${complaint.id}`,
    complaintId: complaint.id,
  });
}

export async function complaintStatusChanged(client: SupabaseClient, complaint: ComplaintRow, previous: string): Promise<void> {
  await notifyUserId(client, complaint.reporter_id, {
    event: "complaint.status_changed",
    title: `Report ${complaint.complaint_number} is now ${readable(String(complaint.status))}`,
    body:
      `Your reported ${label(String(complaint.damage_type))} moved from ${readable(previous)} to ` +
      `${readable(String(complaint.status))}.`,
    link: `/reports/${complaint.id}`,
    complaintId: complaint.id,
  });
}

export async function complaintResolved(client: SupabaseClient, complaint: ComplaintRow): Promise<void> {
  await notifyUserId(client, complaint.reporter_id, {
    event: "complaint.resolved",
    title: "Your report has been resolved",
    body:
      `The ${label(String(complaint.damage_type))} you reported (${complaint.complaint_number}) has been ` +
      "repaired and verified. Thank you.",
    link: `/reports/${complaint.id}`,
    complaintId: complaint.id,
  });
}

export async function complaintDeleted(client: SupabaseClient, complaint: ComplaintRow, reason: string): Promise<void> {
  await notifyUserId(client, complaint.reporter_id, {
    event: "complaint.deleted",
    title: "Your report was removed",
    body: `${complaint.complaint_number} was removed by an administrator: ${reason}`,
    complaintId: complaint.id,
  });
}

export async function repairCompleted(client: SupabaseClient, complaint: ComplaintRow, teamName: string): Promise<void> {
  await notifyRole(client, "ADMIN", {
    event: "repair.completed",
    title: "Repair awaiting verification",
    body: `${teamName} marked ${complaint.complaint_number} complete and uploaded evidence. Please verify.`,
    link: `/admin/reports/${complaint.id}`,
    complaintId: complaint.id,
  });
}

export async function reworkRequested(
  client: SupabaseClient,
  complaint: ComplaintRow,
  assignmentId: string,
  teamId: string,
  reason: string,
): Promise<void> {
  await notifyTeam(client, teamId, {
    event: "repair.rework_requested",
    title: "Rework requested",
    body: `The works department sent ${complaint.complaint_number} back: ${reason}`,
    link: `/team/tasks/${assignmentId}`,
    complaintId: complaint.id,
  });
}

export async function repairFlagged(
  client: SupabaseClient,
  complaint: ComplaintRow,
  teamName: string,
  reason: string,
): Promise<void> {
  await notifyRole(client, "ADMIN", {
    event: "repair.flagged",
    title: "Crew flagged a problem with an assignment",
    body: `${teamName} could not proceed with ${complaint.complaint_number}: ${reason}. It is back in the queue, unassigned.`,
    link: `/admin/reports/${complaint.id}`,
    complaintId: complaint.id,
  });
}

export async function assignmentEscalated(
  client: SupabaseClient,
  complaint: ComplaintRow,
  reason: string,
): Promise<void> {
  await notifyRole(client, "ADMIN", {
    event: "repair.escalated",
    title: "🚨 Crew escalated a report as an emergency",
    body: `${complaint.complaint_number}: ${reason}`,
    link: `/admin/reports/${complaint.id}`,
    complaintId: complaint.id,
  });
}
