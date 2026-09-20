// Ported from backend/app/api/v1/team.py. A crew member sees only their own
// team's work - the team comes from the authenticated user's profile
// (team_id), never from a request parameter, so one crew cannot read or act
// on another's jobs by guessing an id. Admins may inspect any team.

import { Hono } from "hono";
import { requireTeam, type AuthedProfile } from "../_shared/auth.ts";
import { serviceClient, userClient } from "../_shared/supabase.ts";
import { NotFoundError, PermissionDeniedError, ValidationError } from "../_shared/errors.ts";
import { writeRateLimit } from "../_shared/rate_limit.ts";
import { toTask } from "../_shared/serializers.ts";
import { settings } from "../_shared/config.ts";
import { getTeam, listTeamAssignments, getAssignmentFull, type RepairAssignmentRow } from "../repositories/repair.ts";
import { completeRepair, startRepair, type EvidenceFile } from "../services/complaints.ts";
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
  const completed = tasks.filter((t) => t.status === "COMPLETED" || t.status === "VERIFIED").slice(0, 10);

  return c.json({
    team: repairTeam,
    today,
    critical,
    in_progress: inProgress,
    completed_recently: completed,
    stats: {
      open_jobs: openTasks.length,
      critical_open: critical.length,
      in_progress: inProgress.length,
      overdue: openTasks.filter((t) => t.is_overdue).length,
      completed_total: tasks.filter((t) => t.status === "COMPLETED" || t.status === "VERIFIED").length,
      capacity: repairTeam.max_concurrent_jobs,
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
  return c.json(toTask(assignment));
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
    const bytes = new Uint8Array(await photo.arrayBuffer());
    if (bytes.length > settings.MAX_UPLOAD_BYTES) {
      throw new ValidationError(
        `${photo.name} is too large. Please keep photos under ${Math.round(settings.MAX_UPLOAD_BYTES / (1024 * 1024))}MB.`,
      );
    }
    files.push({ bytes, contentType: photo.type || "application/octet-stream" });
  }

  const hadExistingEvidence = ((assignment as any).evidence ?? []).length > 0;
  const updated = await completeRepair(assignment, user, note, files, hadExistingEvidence);
  return c.json(toTask({ ...updated, complaint: (assignment as any).complaint }));
});
