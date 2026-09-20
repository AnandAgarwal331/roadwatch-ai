// Ported from backend/app/services/analytics.py. Only kpis() so far (needed
// by the public /stats/public endpoint); the admin-only breakdowns
// (reports_over_time, by_damage_type, repeat_locations, team_performance,
// ...) are ported alongside the admin analytics routes.
//
// Always called with the service client: these are aggregate counts over
// every complaint regardless of status, the same unrestricted view Python's
// single DB connection had - RLS would otherwise silently undercount by
// excluding REJECTED/DUPLICATE rows from a citizen or anon caller's view.

import type { SupabaseClient } from "@supabase/supabase-js";
import type { ComplaintStatus, PriorityLevel } from "../_shared/enums.ts";
import { CLOSED_STATUSES } from "../_shared/enums.ts";
import { haversineMeters } from "./geo.ts";

export interface KpiSummary {
  totalReports: number;
  critical: number;
  high: number;
  inProgress: number;
  resolved: number;
  pendingReview: number;
  unresolved: number;
  averageResolutionHours: number | null;
  resolutionRate: number;
  reportsLast7Days: number;
  reportsLast30Days: number;
  pendingDuplicates: number;
}

function round(value: number, decimals: number): number {
  const f = 10 ** decimals;
  return Math.round(value * f) / f;
}

async function countWhere(client: SupabaseClient, filter: (q: any) => any): Promise<number> {
  let query = client.from("complaints").select("*", { count: "exact", head: true });
  query = filter(query);
  const { count, error } = await query;
  if (error) throw error;
  return count ?? 0;
}

async function countByStatus(client: SupabaseClient): Promise<Record<string, number>> {
  const { data, error } = await client.from("complaints").select("status");
  if (error) throw error;
  const counts: Record<string, number> = {};
  for (const row of data ?? []) counts[row.status] = (counts[row.status] ?? 0) + 1;
  return counts;
}

async function countByPriorityLevel(client: SupabaseClient): Promise<Record<string, number>> {
  const { data, error } = await client.from("complaints").select("priority_level");
  if (error) throw error;
  const counts: Record<string, number> = {};
  for (const row of data ?? []) counts[row.priority_level] = (counts[row.priority_level] ?? 0) + 1;
  return counts;
}

async function averageResolutionHours(client: SupabaseClient): Promise<number | null> {
  const { data, error } = await client.from("complaints").select("created_at, resolved_at").not("resolved_at", "is", null);
  if (error) throw error;
  const durations = (data ?? [])
    .map((row) => (new Date(row.resolved_at).getTime() - new Date(row.created_at).getTime()) / 3_600_000)
    .filter((h) => h >= 0);
  if (durations.length === 0) return null;
  return round(durations.reduce((a, b) => a + b, 0) / durations.length, 1);
}

async function pendingDuplicatesCount(client: SupabaseClient): Promise<number> {
  const { count, error } = await client
    .from("potential_duplicates")
    .select("*", { count: "exact", head: true })
    .eq("status", "SUGGESTED");
  if (error) throw error;
  return count ?? 0;
}

export async function kpis(client: SupabaseClient, now: Date = new Date()): Promise<KpiSummary> {
  const [total, byStatus, byLevel, avgResolution, pendingDuplicates] = await Promise.all([
    countWhere(client, (q) => q),
    countByStatus(client),
    countByPriorityLevel(client),
    averageResolutionHours(client),
    pendingDuplicatesCount(client),
  ]);

  const resolved = byStatus["RESOLVED"] ?? 0;
  const closed = (CLOSED_STATUSES as ComplaintStatus[]).reduce((sum, s) => sum + (byStatus[s] ?? 0), 0);
  const since = (days: number) => new Date(now.getTime() - days * 86_400_000).toISOString();

  const [last7, last30] = await Promise.all([
    countWhere(client, (q) => q.gte("created_at", since(7))),
    countWhere(client, (q) => q.gte("created_at", since(30))),
  ]);

  return {
    totalReports: total,
    critical: byLevel["CRITICAL" as PriorityLevel] ?? 0,
    high: byLevel["HIGH" as PriorityLevel] ?? 0,
    inProgress: byStatus["IN_PROGRESS"] ?? 0,
    resolved,
    pendingReview: (byStatus["PENDING"] ?? 0) + (byStatus["AI_ANALYZED"] ?? 0) + (byStatus["PRIORITIZED"] ?? 0),
    unresolved: total - closed,
    averageResolutionHours: avgResolution,
    resolutionRate: total ? round((resolved / total) * 100, 1) : 0.0,
    reportsLast7Days: last7,
    reportsLast30Days: last30,
    pendingDuplicates,
  };
}

// -- the admin-only breakdowns (services/analytics.py's remaining methods) --

const PRIORITY_LEVELS_DESC: PriorityLevel[] = ["CRITICAL", "HIGH", "MEDIUM", "LOW"];
const ALL_STATUSES: ComplaintStatus[] = [
  "PENDING", "AI_ANALYZED", "PRIORITIZED", "ASSIGNED", "IN_PROGRESS", "RESOLVED", "REJECTED", "DUPLICATE",
];

/** Daily counts for the last `days` days, gap-filled so the chart has no missing days. */
export async function reportsOverTime(client: SupabaseClient, days = 30, now: Date = new Date()): Promise<Record<string, unknown>[]> {
  const start = new Date(now.getTime() - (days - 1) * 86_400_000);
  start.setUTCHours(0, 0, 0, 0);

  const { data: created, error: createdErr } = await client
    .from("complaints")
    .select("created_at, priority_level")
    .gte("created_at", start.toISOString());
  if (createdErr) throw createdErr;

  const { data: resolved, error: resolvedErr } = await client
    .from("complaints")
    .select("resolved_at")
    .not("resolved_at", "is", null)
    .gte("resolved_at", start.toISOString());
  if (resolvedErr) throw resolvedErr;

  const dayKey = (iso: string) => iso.slice(0, 10);
  const createdByDay: Record<string, number> = {};
  const criticalByDay: Record<string, number> = {};
  for (const row of created ?? []) {
    const key = dayKey(row.created_at);
    createdByDay[key] = (createdByDay[key] ?? 0) + 1;
    if (row.priority_level === "CRITICAL") criticalByDay[key] = (criticalByDay[key] ?? 0) + 1;
  }
  const resolvedByDay: Record<string, number> = {};
  for (const row of resolved ?? []) {
    const key = dayKey(row.resolved_at);
    resolvedByDay[key] = (resolvedByDay[key] ?? 0) + 1;
  }

  const series: Record<string, unknown>[] = [];
  for (let offset = 0; offset < days; offset++) {
    const day = new Date(start.getTime() + offset * 86_400_000).toISOString().slice(0, 10);
    series.push({
      date: day,
      reported: createdByDay[day] ?? 0,
      resolved: resolvedByDay[day] ?? 0,
      critical: criticalByDay[day] ?? 0,
    });
  }
  return series;
}

export async function byDamageType(client: SupabaseClient): Promise<Record<string, unknown>[]> {
  const { data, error } = await client.from("complaints").select("damage_type");
  if (error) throw error;
  const counts: Record<string, number> = {};
  for (const row of data ?? []) counts[row.damage_type] = (counts[row.damage_type] ?? 0) + 1;
  return Object.entries(counts)
    .sort((a, b) => b[1] - a[1])
    .map(([damage_type, count]) => ({ damage_type, count }));
}

export async function priorityDistribution(client: SupabaseClient): Promise<Record<string, unknown>[]> {
  const counts = await countByPriorityLevel(client);
  return PRIORITY_LEVELS_DESC.map((level) => ({ level, count: counts[level] ?? 0 }));
}

export async function statusDistribution(client: SupabaseClient): Promise<Record<string, unknown>[]> {
  const counts = await countByStatus(client);
  return ALL_STATUSES.map((status) => ({ status, count: counts[status] ?? 0 }));
}

/** Volume by administrative area, from the resolved location record. */
export async function byArea(client: SupabaseClient, limit = 10): Promise<Record<string, unknown>[]> {
  const { data, error } = await client.from("locations").select("city, complaint_id, complaints(priority_score)");
  if (error) throw error;

  const grouped: Record<string, { count: number; totalPriority: number }> = {};
  for (const row of (data ?? []) as any[]) {
    const area = row.city ?? "Unknown";
    const bucket = grouped[area] ?? { count: 0, totalPriority: 0 };
    bucket.count += 1;
    bucket.totalPriority += Number(row.complaints?.priority_score ?? 0);
    grouped[area] = bucket;
  }

  return Object.entries(grouped)
    .map(([area, { count, totalPriority }]) => ({ area, count, average_priority: round(totalPriority / count, 1) }))
    .sort((a, b) => (b.count as number) - (a.count as number))
    .slice(0, limit);
}

/** Roads generating the most reports - the recurring-failure list. */
export async function topRoads(client: SupabaseClient, limit = 10): Promise<Record<string, unknown>[]> {
  const { data, error } = await client.from("complaints").select("road_name, priority_score").not("road_name", "is", null).neq("road_name", "");
  if (error) throw error;

  const grouped: Record<string, number[]> = {};
  for (const row of data ?? []) {
    (grouped[row.road_name] ??= []).push(row.priority_score);
  }

  return Object.entries(grouped)
    .map(([road_name, scores]) => ({
      road_name,
      count: scores.length,
      average_priority: round(scores.reduce((a, b) => a + b, 0) / scores.length, 1),
      max_priority: round(Math.max(...scores), 1),
    }))
    .sort((a, b) => (b.count as number) - (a.count as number) || (b.average_priority as number) - (a.average_priority as number))
    .slice(0, limit);
}

const CLUSTER_PRECISION = 0.0005;

/**
 * Spots reported more than once - where repairs are not holding. Coordinates
 * are snapped to a ~55m grid, then neighbouring cells are merged, so two
 * reports either side of a grid boundary still cluster.
 */
export async function repeatLocations(client: SupabaseClient, limit = 10, minReports = 2): Promise<Record<string, unknown>[]> {
  const { data, error } = await client.from("complaints").select("latitude, longitude, road_name, priority_score, status");
  if (error) throw error;

  const buckets = new Map<string, { latitude: number; longitude: number; road_name: string | null; priority_score: number; status: string }[]>();
  for (const row of data ?? []) {
    const key = `${Math.round(row.latitude / CLUSTER_PRECISION)}:${Math.round(row.longitude / CLUSTER_PRECISION)}`;
    (buckets.get(key) ?? buckets.set(key, []).get(key)!).push(row);
  }

  const clusters: Record<string, unknown>[] = [];
  for (const entries of buckets.values()) {
    if (entries.length < minReports) continue;
    const centreLat = entries.reduce((s, e) => s + e.latitude, 0) / entries.length;
    const centreLon = entries.reduce((s, e) => s + e.longitude, 0) / entries.length;
    const spread = Math.max(...entries.map((e) => haversineMeters(centreLat, centreLon, e.latitude, e.longitude)));
    const roadCounts: Record<string, number> = {};
    for (const e of entries) if (e.road_name) roadCounts[e.road_name] = (roadCounts[e.road_name] ?? 0) + 1;
    const topRoad = Object.entries(roadCounts).sort((a, b) => b[1] - a[1])[0]?.[0] ?? null;
    const unresolved = entries.filter((e) => !(CLOSED_STATUSES as string[]).includes(e.status)).length;

    clusters.push({
      latitude: round(centreLat, 6),
      longitude: round(centreLon, 6),
      road_name: topRoad,
      report_count: entries.length,
      unresolved,
      max_priority: round(Math.max(...entries.map((e) => e.priority_score)), 1),
      spread_meters: round(spread, 1),
    });
  }

  clusters.sort((a, b) => (b.report_count as number) - (a.report_count as number) || (b.max_priority as number) - (a.max_priority as number));
  return clusters.slice(0, limit);
}

export async function teamPerformance(client: SupabaseClient): Promise<Record<string, unknown>[]> {
  const { data: teams, error: teamsErr } = await client.from("repair_teams").select("*").order("name", { ascending: true });
  if (teamsErr) throw teamsErr;
  const { data: assignments, error: assignmentsErr } = await client.from("repair_assignments").select("*");
  if (assignmentsErr) throw assignmentsErr;

  const byTeam = new Map<string, any[]>();
  for (const a of assignments ?? []) (byTeam.get(a.team_id) ?? byTeam.set(a.team_id, []).get(a.team_id)!).push(a);

  const results = (teams ?? []).map((team) => {
    const items = byTeam.get(team.id) ?? [];
    const completed = items.filter((i) => i.status === "COMPLETED" || i.status === "VERIFIED");
    const openJobs = items.filter((i) => i.status === "ASSIGNED" || i.status === "IN_PROGRESS");

    const durations = completed
      .filter((i) => i.completed_at && i.created_at)
      .map((i) => (new Date(i.completed_at).getTime() - new Date(i.created_at).getTime()) / 3_600_000);
    const onTime = completed.filter((i) => i.due_at && i.completed_at && new Date(i.completed_at) <= new Date(i.due_at));

    return {
      team_id: team.id,
      team_name: team.name,
      zone: team.zone,
      total_assigned: items.length,
      completed: completed.length,
      open_jobs: openJobs.length,
      capacity: team.max_concurrent_jobs,
      average_completion_hours: durations.length ? round(durations.reduce((a, b) => a + b, 0) / durations.length, 1) : null,
      on_time_rate: completed.length ? round((onTime.length / completed.length) * 100, 1) : null,
    };
  });

  results.sort((a, b) => (b.completed as number) - (a.completed as number));
  return results;
}

/** Are the urgent ones actually being done first? */
export async function resolutionByPriority(client: SupabaseClient): Promise<Record<string, unknown>[]> {
  const { data, error } = await client
    .from("complaints")
    .select("priority_level, created_at, resolved_at")
    .not("resolved_at", "is", null);
  if (error) throw error;

  const grouped: Record<string, number[]> = {};
  for (const row of data ?? []) {
    if (row.created_at && row.resolved_at) {
      (grouped[row.priority_level] ??= []).push((new Date(row.resolved_at).getTime() - new Date(row.created_at).getTime()) / 3_600_000);
    }
  }

  return PRIORITY_LEVELS_DESC.map((level) => {
    const hours = grouped[level] ?? [];
    return {
      level,
      resolved_count: hours.length,
      average_hours: hours.length ? round(hours.reduce((a, b) => a + b, 0) / hours.length, 1) : null,
    };
  });
}
