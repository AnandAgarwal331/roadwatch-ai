// Ported from backend/app/api/v1/admin.py. Every route here starts with
// requireAdmin(req) - FastAPI enforced this as a router-level dependency so
// a new endpoint couldn't be added unprotected by accident; Hono has no
// exact equivalent for a sub-router, so each handler calls it explicitly as
// its first line instead. Every write here runs on the service client,
// after that same admin check - the same "authorize in code, then get a
// system-wide connection" pattern used throughout Phase 3/4.

import { Hono } from "hono";
import { requireAdmin } from "../_shared/auth.ts";
import { serviceClient } from "../_shared/supabase.ts";
import { ConflictError, NotFoundError, ValidationError } from "../_shared/errors.ts";
import { settings } from "../_shared/config.ts";
import { ENGINE_VERSION } from "../services/priority.ts";
import { toDetail, toDuplicateLink, toSummary, paginated } from "../_shared/serializers.ts";
import { getComplaintFull, listComplaints, type ComplaintFilters } from "../repositories/complaint.ts";
import {
  activeAssignmentForComplaint,
  addTeam,
  completedCount,
  getTeam,
  listTeams,
  updateTeam,
  workloadByTeam,
} from "../repositories/repair.ts";
import * as analytics from "../services/analytics.ts";
import { DuplicateService } from "../services/duplicates.ts";
import { listRecentAudit, recordAudit } from "../services/audit.ts";
import { planUserUpdate } from "../services/users.ts";
import {
  assignTeam,
  changeStatus,
  confirmDuplicate,
  overridePriority,
  rejectComplaint,
  rejectDuplicate,
  reassessComplaint,
  verifyRepair,
} from "../services/complaints.ts";
import type { ComplaintStatus, DamageType, PriorityLevel } from "../_shared/enums.ts";

export const admin = new Hono();

function clientIp(req: Request): string | null {
  const forwarded = req.headers.get("x-forwarded-for") ?? "";
  return forwarded ? forwarded.split(",")[0].trim() : null;
}

function kpisToWire(k: analytics.KpiSummary) {
  return {
    total_reports: k.totalReports,
    critical: k.critical,
    high: k.high,
    in_progress: k.inProgress,
    resolved: k.resolved,
    pending_review: k.pendingReview,
    unresolved: k.unresolved,
    average_resolution_hours: k.averageResolutionHours,
    resolution_rate: k.resolutionRate,
    reports_last_7_days: k.reportsLast7Days,
    reports_last_30_days: k.reportsLast30Days,
    pending_duplicates: k.pendingDuplicates,
  };
}

async function loadFullOrThrow(id: string) {
  const complaint = await getComplaintFull(serviceClient(), id);
  if (!complaint) throw new NotFoundError("That report could not be found.");
  return complaint;
}

// -- dashboard & analytics ------------------------------------------------

admin.get("/dashboard", async (c) => {
  await requireAdmin(c.req.raw);
  const client = serviceClient();
  const [queue, recent, kpis, statusDist, priorityDist] = await Promise.all([
    listComplaints(client, { excludeClosed: true }, { page: 1, pageSize: 10, sortBy: "priority_score", sortDir: "desc" }),
    listComplaints(client, {}, { page: 1, pageSize: 8, sortBy: "created_at", sortDir: "desc" }),
    analytics.kpis(client),
    analytics.statusDistribution(client),
    analytics.priorityDistribution(client),
  ]);

  return c.json({
    kpis: kpisToWire(kpis),
    priority_queue: queue.items.map(toSummary),
    recent_reports: recent.items.map(toSummary),
    status_distribution: statusDist,
    priority_distribution: priorityDist,
  });
});

admin.get("/analytics", async (c) => {
  await requireAdmin(c.req.raw);
  const days = Math.min(365, Math.max(7, Number(new URL(c.req.url).searchParams.get("days") ?? "30")));
  const client = serviceClient();
  const [kpis, over_time, damage, area, priorityDist, statusDist, roads, repeats, teams, resByPriority] = await Promise.all([
    analytics.kpis(client),
    analytics.reportsOverTime(client, days),
    analytics.byDamageType(client),
    analytics.byArea(client),
    analytics.priorityDistribution(client),
    analytics.statusDistribution(client),
    analytics.topRoads(client),
    analytics.repeatLocations(client),
    analytics.teamPerformance(client),
    analytics.resolutionByPriority(client),
  ]);

  return c.json({
    kpis: kpisToWire(kpis),
    reports_over_time: over_time,
    by_damage_type: damage,
    by_area: area,
    priority_distribution: priorityDist,
    status_distribution: statusDist,
    top_roads: roads,
    repeat_locations: repeats,
    team_performance: teams,
    resolution_by_priority: resByPriority,
  });
});

admin.get("/settings", async (c) => {
  await requireAdmin(c.req.raw);
  return c.json({
    priority_weights: {
      severity: settings.PRIORITY_WEIGHT_SEVERITY,
      traffic: settings.PRIORITY_WEIGHT_TRAFFIC,
      location: settings.PRIORITY_WEIGHT_LOCATION,
      history: settings.PRIORITY_WEIGHT_HISTORY,
    },
    priority_thresholds: {
      medium: settings.PRIORITY_THRESHOLD_MEDIUM,
      high: settings.PRIORITY_THRESHOLD_HIGH,
      critical: settings.PRIORITY_THRESHOLD_CRITICAL,
    },
    nearby_radius_meters: settings.NEARBY_RADIUS_METERS,
    duplicate_radius_meters: settings.DUPLICATE_RADIUS_METERS,
    duplicate_window_days: settings.DUPLICATE_WINDOW_DAYS,
    history_radius_meters: settings.HISTORY_RADIUS_METERS,
    ai_provider: settings.AI_PROVIDER,
    ai_min_confidence: settings.AI_MIN_CONFIDENCE,
    traffic_provider: settings.TRAFFIC_PROVIDER,
    places_provider: settings.PLACES_PROVIDER,
    storage_provider: "supabase",
    weather_enabled: settings.WEATHER_ENABLED,
    max_upload_mb: Math.round((settings.MAX_UPLOAD_BYTES / (1024 * 1024)) * 10) / 10,
    engine_version: ENGINE_VERSION,
  });
});

// -- complaints -------------------------------------------------------------

admin.get("/reports", async (c) => {
  await requireAdmin(c.req.raw);
  const url = new URL(c.req.url);
  const page = Math.max(1, Number(url.searchParams.get("page") ?? "1"));
  const pageSize = Math.min(100, Math.max(1, Number(url.searchParams.get("page_size") ?? "20")));
  const status = url.searchParams.getAll("status") as ComplaintStatus[];
  const damageType = url.searchParams.getAll("damage_type") as DamageType[];
  const priorityLevel = url.searchParams.getAll("priority_level") as PriorityLevel[];

  const filters: ComplaintFilters = {
    status: status.length > 0 ? status : undefined,
    damageType: damageType.length > 0 ? damageType : undefined,
    priorityLevel: priorityLevel.length > 0 ? priorityLevel : undefined,
    search: url.searchParams.get("search") ?? undefined,
    excludeClosed: url.searchParams.get("exclude_closed") === "true",
  };

  const { items, total } = await listComplaints(serviceClient(), filters, {
    page,
    pageSize,
    sortBy: url.searchParams.get("sort_by") ?? "priority_score",
    sortDir: (url.searchParams.get("sort_dir") ?? "desc") as "asc" | "desc",
  });

  return c.json(paginated(items.map(toSummary), total, page, pageSize));
});

admin.get("/reports/:id", async (c) => {
  await requireAdmin(c.req.raw);
  return c.json(toDetail(await loadFullOrThrow(c.req.param("id")), { includeReporter: true }));
});

admin.patch("/reports/:id/status", async (c) => {
  const actor = await requireAdmin(c.req.raw);
  const id = c.req.param("id");
  const complaint = await loadFullOrThrow(id);
  const body = await c.req.json();
  await changeStatus(complaint, body.status, actor, body.note ?? null);
  return c.json(toDetail(await loadFullOrThrow(id), { includeReporter: true }));
});

admin.post("/reports/:id/reject", async (c) => {
  const actor = await requireAdmin(c.req.raw);
  const id = c.req.param("id");
  const complaint = await loadFullOrThrow(id);
  const body = await c.req.json();
  if (typeof body.reason !== "string" || body.reason.trim().length < 3) {
    throw new ValidationError("Please give a reason for rejecting this report.");
  }
  await rejectComplaint(complaint, body.reason, actor);
  return c.json(toDetail(await loadFullOrThrow(id), { includeReporter: true }));
});

admin.patch("/reports/:id/priority", async (c) => {
  const actor = await requireAdmin(c.req.raw);
  const id = c.req.param("id");
  const complaint = await loadFullOrThrow(id);
  const body = await c.req.json();
  await overridePriority(complaint, Number(body.priority_score), actor, body.note ?? null);
  return c.json(toDetail(await loadFullOrThrow(id), { includeReporter: true }));
});

admin.post("/reports/:id/assign", async (c) => {
  const actor = await requireAdmin(c.req.raw);
  const id = c.req.param("id");
  const complaint = await loadFullOrThrow(id);
  const body = await c.req.json();
  if (typeof body.team_id !== "string") throw new ValidationError("A team_id is required.");
  const assignment = await assignTeam(complaint, body.team_id, actor, body.due_at ?? null, body.note ?? null);
  return c.json(assignment);
});

admin.post("/reports/:id/verify", async (c) => {
  const actor = await requireAdmin(c.req.raw);
  const id = c.req.param("id");
  await loadFullOrThrow(id);
  const body = await c.req.json().catch(() => ({}));

  const assignment = await activeAssignmentForComplaint(serviceClient(), id);
  if (!assignment) throw new ConflictError("There is no completed repair to verify for this report.");

  await verifyRepair(assignment, actor, body.note ?? null);
  return c.json(toDetail(await loadFullOrThrow(id), { includeReporter: true }));
});

admin.post("/reports/:id/reassess", async (c) => {
  await requireAdmin(c.req.raw);
  const id = c.req.param("id");
  await loadFullOrThrow(id);
  const updated = await reassessComplaint(c.req.raw, id);
  return c.json(toDetail(updated, { includeReporter: true }));
});

// -- duplicates ---------------------------------------------------------

admin.get("/duplicates", async (c) => {
  await requireAdmin(c.req.raw);
  const limit = Math.min(200, Math.max(1, Number(new URL(c.req.url).searchParams.get("limit") ?? "50")));
  const links = await new DuplicateService(serviceClient()).listPending(limit);
  return c.json(links.map(toDuplicateLink));
});

admin.get("/reports/:id/duplicates", async (c) => {
  await requireAdmin(c.req.raw);
  const links = await new DuplicateService(serviceClient()).listForComplaint(c.req.param("id"));
  return c.json(links.map(toDuplicateLink));
});

admin.post("/duplicates/:id/confirm", async (c) => {
  const actor = await requireAdmin(c.req.raw);
  const { canonical, duplicate } = await confirmDuplicate(c.req.param("id"), actor);
  return c.json({
    message: `${duplicate.complaint_number} linked to ${canonical.complaint_number}.`,
    detail: `${canonical.complaint_number} now represents ${canonical.report_count} reports.`,
  });
});

admin.post("/duplicates/:id/reject", async (c) => {
  const actor = await requireAdmin(c.req.raw);
  await rejectDuplicate(c.req.param("id"), actor);
  return c.json({ message: "Marked as separate issues." });
});

// -- teams ----------------------------------------------------------------

admin.get("/teams", async (c) => {
  await requireAdmin(c.req.raw);
  const client = serviceClient();
  const [teams, workload] = await Promise.all([listTeams(client), workloadByTeam(client)]);

  const results = await Promise.all(
    teams.map(async (t) => {
      const { data: members, error } = await client
        .from("profiles")
        .select("id, full_name, email")
        .eq("team_id", t.id)
        .eq("is_active", true);
      if (error) throw error;
      return {
        ...t,
        open_jobs: workload[t.id] ?? 0,
        completed_jobs: await completedCount(client, t.id),
        members: members ?? [],
      };
    }),
  );
  return c.json(results);
});

admin.post("/teams", async (c) => {
  const actor = await requireAdmin(c.req.raw);
  const req = c.req.raw;
  const body = await req.json();
  if (typeof body.name !== "string" || body.name.trim().length < 2) throw new ValidationError("A team name is required.");
  if (typeof body.code !== "string" || body.code.trim().length < 2) throw new ValidationError("A team code is required.");

  const client = serviceClient();
  const code = body.code.trim().toUpperCase();
  const existing = await listTeams(client);
  if (existing.some((t) => t.code === code)) throw new ConflictError(`A team with the code ${code} already exists.`);

  const team = await addTeam(client, {
    name: body.name.trim(),
    code,
    zone: body.zone ?? null,
    contact_phone: body.contact_phone ?? null,
    specialities: body.specialities ?? null,
    max_concurrent_jobs: body.max_concurrent_jobs ?? 5,
    base_latitude: body.base_latitude ?? null,
    base_longitude: body.base_longitude ?? null,
  });

  await recordAudit(client, {
    actor,
    action: "team.created",
    entityType: "repair_team",
    entityId: team.id,
    newValue: { name: team.name, code: team.code },
    ipAddress: clientIp(req),
  });

  return c.json(team);
});

admin.patch("/teams/:id", async (c) => {
  const actor = await requireAdmin(c.req.raw);
  const req = c.req.raw;
  const id = c.req.param("id");
  const client = serviceClient();
  const team = await getTeam(client, id);
  if (!team) throw new NotFoundError("That team does not exist.");

  const body = await req.json();
  const changes: Record<string, unknown> = {};
  const before: Record<string, unknown> = {};
  for (const key of ["name", "zone", "contact_phone", "specialities", "max_concurrent_jobs", "is_active"]) {
    if (body[key] !== undefined && body[key] !== null) {
      changes[key] = body[key];
      before[key] = team[key];
    }
  }

  const updated = await updateTeam(client, id, changes);

  await recordAudit(client, {
    actor,
    action: "team.updated",
    entityType: "repair_team",
    entityId: id,
    oldValue: before,
    newValue: changes,
    ipAddress: clientIp(req),
  });

  return c.json(updated);
});

// -- users ------------------------------------------------------------------

admin.get("/users", async (c) => {
  await requireAdmin(c.req.raw);
  const url = new URL(c.req.url);
  const search = (url.searchParams.get("search") ?? "").trim().replace(/[%,()]/g, "");
  const role = url.searchParams.get("role");
  const limit = Math.min(200, Math.max(1, Number(url.searchParams.get("limit") ?? "100")));

  let query = serviceClient()
    .from("profiles")
    .select("id, email, full_name, phone, role, is_active, team_id, created_at")
    .order("created_at", { ascending: false })
    .limit(limit);
  if (role && ["CITIZEN", "ADMIN", "REPAIR_TEAM"].includes(role)) query = query.eq("role", role);
  if (search) query = query.or(`email.ilike.%${search}%,full_name.ilike.%${search}%`);

  const { data, error } = await query;
  if (error) throw error;
  return c.json(data ?? []);
});

admin.patch("/users/:id", async (c) => {
  const actor = await requireAdmin(c.req.raw);
  const req = c.req.raw;
  const client = serviceClient();

  const { data: target, error: findErr } = await client
    .from("profiles")
    .select("id, email, role, team_id, is_active")
    .eq("id", c.req.param("id"))
    .maybeSingle();
  if (findErr) throw findErr;
  if (!target) throw new NotFoundError("That account does not exist.");

  const body = await req.json().catch(() => ({}));
  const teams = await listTeams(client);
  const teamIds = new Set(teams.map((t) => t.id));
  const changes = planUserUpdate(actor.id, target, body, (id) => teamIds.has(id));

  const { data: updated, error } = await client
    .from("profiles")
    .update({ ...changes, updated_at: new Date().toISOString() })
    .eq("id", target.id)
    .select("id, email, full_name, phone, role, is_active, team_id, created_at")
    .single();
  if (error) throw error;

  const before: Record<string, unknown> = {};
  for (const key of Object.keys(changes)) before[key] = (target as Record<string, unknown>)[key];
  await recordAudit(client, {
    actor,
    action: "user.updated",
    entityType: "profile",
    entityId: target.id,
    oldValue: before,
    newValue: changes as Record<string, unknown>,
    note: target.email,
    ipAddress: clientIp(req),
  });

  return c.json(updated);
});

// -- audit ------------------------------------------------------------------

admin.get("/audit", async (c) => {
  await requireAdmin(c.req.raw);
  const url = new URL(c.req.url);
  const complaintId = url.searchParams.get("complaint_id") ?? undefined;
  const limit = Math.min(500, Math.max(1, Number(url.searchParams.get("limit") ?? "100")));
  const entries = await listRecentAudit(serviceClient(), { complaintId, limit });
  return c.json(entries);
});
