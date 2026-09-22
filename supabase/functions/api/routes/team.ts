// Ported from backend/app/api/v1/team.py. A crew member sees only their own
// team's work - the team comes from the authenticated user's profile
// (team_id), never from a request parameter, so one crew cannot read or act
// on another's jobs by guessing an id. Admins may inspect any team.

import { Hono } from "hono";
import { requireTeam, type AuthedProfile } from "../_shared/auth.ts";
import { serviceClient, userClient } from "../_shared/supabase.ts";
import { NotFoundError, PermissionDeniedError, ValidationError } from "../_shared/errors.ts";
import { writeRateLimit } from "../_shared/rate_limit.ts";
import { toTask, toTaskDetail } from "../_shared/serializers.ts";
import { settings } from "../_shared/config.ts";
import { getTeam, listTeamAssignments, getAssignmentFull, type RepairAssignmentRow, type RepairDetails } from "../repositories/repair.ts";
import { completeRepair, escalateAssignment, flagAssignment, startRepair, type EvidenceFile } from "../services/complaints.ts";
import type { AssignmentStatus } from "../_shared/enums.ts";

export const team = new Hono();

function resolveTeamId(user: AuthedProfile, requested: string | null): string {
  if (user.role === "ADMIN" && requested) return requested;
  if (!user.team_id) {
    throw new PermissionDeniedError(
      "Your account is not linked to a repair team. Ask an administrator to assign you to one.",
    );
  }
  return user.team_id;
}

async function loadAssignment(assignmentId: string, user: AuthedProfile): Promise<RepairAssignmentRow> {
  const assignment = await getAssignmentFull(serviceClient(), assignmentId);
  if (!assignment) throw new NotFoundError("That job could not be found.");
  // Same message as "not found" so ids cannot be probed for existence.
  if (user.role !== "ADMIN" && assignment.team_id !== user.team_id) {
    throw new NotFoundError("That job could not be found.");
  }
  return assignment;
}

team.get("/dashboard", async (c) => {
  const req = c.req.raw;
  const user = await requireTeam(req);
  const url = new URL(req.url);
  const resolved = resolveTeamId(user, url.searchParams.get("team_id"));

  const client = serviceClient();
  const repairTeam = await getTeam(client, resolved);
  if (!repairTeam) throw new NotFoundError("That team does not exist.");

  const assignments = await listTeamAssignments(client, resolved, { limit: 200 });
  const now = new Date();
  const endOfDay = new Date(now);
  endOfDay.setUTCHours(23, 59, 59, 999);

  const tasks = assignments.map(toTask);
  const openTasks = tasks.filter((t) => t.status === "ASSIGNED" || t.status === "IN_PROGRESS");
  const today = openTasks.filter((t) => !t.due_at || new Date(t.due_at as string) <= endOfDay);
  const critical = openTasks.filter((t) => (t.complaint as any)?.priority_level === "CRITICAL");
  const inProgress = openTasks.filter((t) => t.status === "IN_PROGRESS");
  const emergencyOpen = openTasks.filter((t) => t.is_emergency);
  const allCompleted = tasks.filter((t) => t.status === "COMPLETED" || t.status === "VERIFIED");

  const durations = allCompleted
    .filter((t) => t.completed_at && t.created_at)
    .map((t) => (new Date(t.completed_at as string).getTime() - new Date(t.created_at as string).getTime()) / 3_600_000);
  const everAssigned = tasks.filter((t) => t.status !== "CANCELLED").length;

  return c.json({
    team: repairTeam,
    today,
    critical,
    in_progress: inProgress,
    completed_recently: allCompleted.slice(0, 10),
    stats: {
      open_jobs: openTasks.length,
      critical_open: critical.length,
      emergency_open: emergencyOpen.length,
      in_progress: inProgress.length,
      overdue: openTasks.filter((t) => t.is_overdue).length,
      completed_total: allCompleted.length,
      capacity: repairTeam.max_concurrent_jobs,
      average_completion_hours: durations.length
        ? Math.round((durations.reduce((a, b) => a + b, 0) / durations.length) * 10) / 10
        : null,
      // Of everything the crew has ever taken on (a flagged/cancelled job was
      // never really "their" work to finish), how much is done - not a
      // point-in-time open/closed split, but the whole track record.
      completion_rate: everAssigned ? Math.round((allCompleted.length / everAssigned) * 1000) / 10 : null,
    },
  });
});

team.get("/tasks", async (c) => {
  const req = c.req.raw;
  const user = await requireTeam(req);
  const url = new URL(req.url);
  const resolved = resolveTeamId(user, url.searchParams.get("team_id"));
  const statuses = url.searchParams.getAll("status_filter") as AssignmentStatus[];

  const assignments = await listTeamAssignments(serviceClient(), resolved, {
    statuses: statuses.length > 0 ? statuses : undefined,
  });
  return c.json(assignments.map(toTask));
});

team.get("/tasks/:id", async (c) => {
  const user = await requireTeam(c.req.raw);
  const assignment = await loadAssignment(c.req.param("id"), user);
  return c.json(toTaskDetail(assignment));
});

team.post("/tasks/:id/start", async (c) => {
  const req = c.req.raw;
  const user = await requireTeam(req);
  await writeRateLimit(userClient(req), req);

  const assignment = await loadAssignment(c.req.param("id"), user);
  const updated = await startRepair(assignment, user);
  return c.json(toTask({ ...updated, complaint: (assignment as any).complaint }));
});

team.post("/tasks/:id/complete", async (c) => {
  const req = c.req.raw;
  const user = await requireTeam(req);
  await writeRateLimit(userClient(req), req);

  const assignment = await loadAssignment(c.req.param("id"), user);

  const form = await req.formData();
  const note = (form.get("note") as string | null)?.trim() || null;
  const photoEntries = form.getAll("photos").filter((f): f is File => f instanceof File && Boolean(f.name));

  const files: EvidenceFile[] = [];
  for (const photo of photoEntries) {
    if (photo.size > settings.MAX_UPLOAD_BYTES) {
      throw new ValidationError(
        `${photo.name} is too large. Please keep photos under ${Math.round(settings.MAX_UPLOAD_BYTES / (1024 * 1024))}MB.`,
      );
    }
    const bytes = new Uint8Array(await photo.arrayBuffer());
    files.push({ bytes, contentType: photo.type || "application/octet-stream" });
  }

  const hadExistingEvidence = ((assignment as any).evidence ?? []).length > 0;
  const updated = await completeRepair(assignment, user, note, files, hadExistingEvidence, repairDetailsFromForm(form));
  return c.json(toTask({ ...updated, complaint: (assignment as any).complaint }));
});

/**
 * The structured "what it took" fields alongside the free-text note - every
 * field optional, so a crew in a hurry can still submit with just a photo
 * and a note, same as before this existed. `null` (not an object of nulls)
 * when nothing was filled in, so `completeRepair` leaves the column alone
 * rather than overwriting a previous submission's details with blanks.
 */
function repairDetailsFromForm(form: FormData): RepairDetails | null {
  const text = (key: string) => (form.get(key) as string | null)?.trim() || null;
  const workersRaw = text("workers_count");
  const workers = workersRaw !== null ? Number(workersRaw) : null;
  const costRaw = text("cost_amount");
  const cost = costRaw !== null ? Number(costRaw) : null;

  const details: RepairDetails = {
    repair_type: text("repair_type"),
    materials: text("materials"),
    quantity: text("quantity"),
    equipment: text("equipment"),
    workers_count: workers !== null && Number.isFinite(workers) && workers >= 0 ? workers : null,
    cost_amount: cost !== null && Number.isFinite(cost) && cost >= 0 ? cost : null,
  };
  return Object.values(details).some((value) => value !== null) ? details : null;
}

team.post("/tasks/:id/flag", async (c) => {
  const req = c.req.raw;
  const user = await requireTeam(req);
  await writeRateLimit(userClient(req), req);

  const assignment = await loadAssignment(c.req.param("id"), user);
  const body = await req.json().catch(() => ({}));
  if (typeof body.reason !== "string" || body.reason.trim().length < 3) {
    throw new ValidationError("Please explain what is wrong with this assignment.");
  }

  const updated = await flagAssignment(assignment, user, body.reason.trim());
  return c.json(toTask({ ...updated, complaint: (assignment as any).complaint }));
});

team.post("/tasks/:id/escalate", async (c) => {
  const req = c.req.raw;
  const user = await requireTeam(req);
  await writeRateLimit(userClient(req), req);

  const assignment = await loadAssignment(c.req.param("id"), user);
  const body = await req.json().catch(() => ({}));
  if (typeof body.reason !== "string" || body.reason.trim().length < 3) {
    throw new ValidationError("Please say what makes this an emergency.");
  }

  const updated = await escalateAssignment(assignment, user, body.reason.trim());
  return c.json(toTask({ ...updated, complaint: (assignment as any).complaint }));
});
