// Ported from backend/app/repositories/complaint.py. findNearby (used by
// history.ts and duplicates.ts), list() and getFull() are here for the
// citizen-facing complaints routes; map_points() and the admin-only counts
// are ported in Phase 4 alongside the admin/map routes.

import type { SupabaseClient } from "@supabase/supabase-js";
import { boundingBox, haversineMeters } from "../services/geo.ts";
import { CLOSED_STATUSES, type ComplaintStatus, type DamageType, type PriorityLevel } from "../_shared/enums.ts";

export interface ComplaintRow {
  id: string;
  complaint_number: string;
  reporter_id: string | null;
  damage_type: DamageType;
  status: ComplaintStatus;
  latitude: number;
  longitude: number;
  created_at: string;
  duplicate_of_id: string | null;
  report_count: number;
  // ...plus every other complaints column; callers select("*") and get the
  // full row, this interface only names the fields findNearby's callers use.
  [key: string]: unknown;
}

export interface NearbyComplaint {
  complaint: ComplaintRow;
  distanceMeters: number;
}

export interface FindNearbyOptions {
  excludeId?: string;
  since?: Date;
  damageType?: DamageType;
  limit?: number;
}

/**
 * Complaints within radiusMeters, nearest first. Same two-step approach as
 * the Python original: an indexed bounding-box prefilter in SQL, then exact
 * haversine refinement over the small candidate set.
 *
 * Pass the service client (see _shared/supabase.ts) - this is system-level
 * analysis (history/duplicate scoring), not a user-facing read, so it must
 * see complaints regardless of the caller's own RLS visibility.
 */
export async function findNearby(
  client: SupabaseClient,
  latitude: number,
  longitude: number,
  radiusMeters: number,
  opts: FindNearbyOptions = {},
): Promise<NearbyComplaint[]> {
  const limit = opts.limit ?? 200;
  const box = boundingBox(latitude, longitude, radiusMeters);

  let query = client
    .from("complaints")
    .select("*")
    .gte("latitude", box.minLat)
    .lte("latitude", box.maxLat)
    .gte("longitude", box.minLon)
    .lte("longitude", box.maxLon)
    .limit(limit * 4);

  if (opts.excludeId) query = query.neq("id", opts.excludeId);
  if (opts.since) query = query.gte("created_at", opts.since.toISOString());
  if (opts.damageType) query = query.eq("damage_type", opts.damageType);

  const { data, error } = await query;
  if (error) throw error;

  const results: NearbyComplaint[] = [];
  for (const complaint of (data ?? []) as ComplaintRow[]) {
    const distance = haversineMeters(latitude, longitude, complaint.latitude, complaint.longitude);
    if (distance <= radiusMeters) {
      results.push({ complaint, distanceMeters: Math.round(distance * 10) / 10 });
    }
  }

  results.sort((a, b) => a.distanceMeters - b.distanceMeters);
  return results.slice(0, limit);
}

export async function getComplaintById(client: SupabaseClient, id: string): Promise<ComplaintRow | null> {
  const { data, error } = await client.from("complaints").select("*").eq("id", id).maybeSingle();
  if (error) throw error;
  return data as ComplaintRow | null;
}

// -- list() -------------------------------------------------------------

/** Columns a caller may sort by, whitelisted so a query param can never inject an ordering. */
const SORTABLE_FIELDS = new Set([
  "priority_score",
  "created_at",
  "updated_at",
  "severity_score",
  "report_count",
  "status",
  "complaint_number",
]);

export interface ComplaintFilters {
  status?: ComplaintStatus[];
  damageType?: DamageType[];
  priorityLevel?: PriorityLevel[];
  reporterId?: string;
  teamId?: string;
  search?: string;
  near?: { latitude: number; longitude: number; radiusMeters: number };
  createdFrom?: Date;
  createdTo?: Date;
  minPriority?: number;
  maxPriority?: number;
  excludeClosed?: boolean;
  /** [minLat, minLon, maxLat, maxLon] - a map viewport, already normalised. */
  bbox?: [number, number, number, number];
}

// Resolving filters.teamId needs its own query (a subquery PostgREST can't
// express inline), so it happens here, before applyFilters runs. applyFilters
// itself stays a plain synchronous function deliberately: an `async`
// function that `return`s a Postgrest query builder gets its return value
// silently *executed* by the Promise-resolution machinery (the builder is
// "thenable", so awaiting the async function's result awaits the query
// itself and unwraps it to {data, error, count} instead of the builder) -
// confirmed as a real bug via a live smoke test that threw "query.order is
// not a function" one line after this call.
async function resolveTeamComplaintIds(client: SupabaseClient, teamId: string): Promise<string[]> {
  const { data, error } = await client.from("repair_assignments").select("complaint_id").eq("team_id", teamId);
  if (error) throw error;
  return (data ?? []).map((row) => row.complaint_id);
}

function applyFilters(query: any, filters: ComplaintFilters, teamComplaintIds: string[] | null) {
  if (filters.status !== undefined) query = query.in("status", filters.status);
  if (filters.damageType !== undefined) query = query.in("damage_type", filters.damageType);
  if (filters.priorityLevel !== undefined) query = query.in("priority_level", filters.priorityLevel);
  if (filters.reporterId) query = query.eq("reporter_id", filters.reporterId);
  if (teamComplaintIds !== null) query = query.in("id", teamComplaintIds);
  if (filters.excludeClosed) query = query.not("status", "in", `(${CLOSED_STATUSES.join(",")})`);
  if (filters.createdFrom) query = query.gte("created_at", filters.createdFrom.toISOString());
  if (filters.createdTo) query = query.lte("created_at", filters.createdTo.toISOString());
  if (filters.minPriority !== undefined) query = query.gte("priority_score", filters.minPriority);
  if (filters.maxPriority !== undefined) query = query.lte("priority_score", filters.maxPriority);
  if (filters.search) {
    const pattern = `%${filters.search.trim().toLowerCase()}%`;
    query = query.or(
      `complaint_number.ilike.${pattern},description.ilike.${pattern},road_name.ilike.${pattern}`,
    );
  }
  if (filters.near) {
    const box = boundingBox(filters.near.latitude, filters.near.longitude, filters.near.radiusMeters);
    query = query
      .gte("latitude", box.minLat)
      .lte("latitude", box.maxLat)
      .gte("longitude", box.minLon)
      .lte("longitude", box.maxLon);
  }
  if (filters.bbox) {
    const [minLat, minLon, maxLat, maxLon] = filters.bbox;
    query = query.gte("latitude", minLat).lte("latitude", maxLat).gte("longitude", minLon).lte("longitude", maxLon);
  }
  return query;
}

/** Lightweight projection for the map: no image/history eager-loading, ordered by priority. */
export async function mapPoints(client: SupabaseClient, filters: ComplaintFilters, limit = 2000): Promise<ComplaintRow[]> {
  const teamComplaintIds = filters.teamId ? await resolveTeamComplaintIds(client, filters.teamId) : null;
  let query = client.from("complaints").select("*");
  query = applyFilters(query, filters, teamComplaintIds);
  query = query.order("priority_score", { ascending: false }).limit(limit);
  const { data, error } = await query;
  if (error) throw error;
  return (data ?? []) as ComplaintRow[];
}

/** One page of complaints plus the total matching `filters`, mirroring ComplaintRepository.list(). */
export async function listComplaints(
  client: SupabaseClient,
  filters: ComplaintFilters,
  opts: { page?: number; pageSize?: number; sortBy?: string; sortDir?: "asc" | "desc" } = {},
): Promise<{ items: ComplaintRow[]; total: number }> {
  const page = Math.max(1, opts.page ?? 1);
  const pageSize = opts.pageSize ?? 20;
  const sortBy = SORTABLE_FIELDS.has(opts.sortBy ?? "") ? opts.sortBy! : "priority_score";
  const ascending = (opts.sortDir ?? "desc") === "asc";

  const teamComplaintIds = filters.teamId ? await resolveTeamComplaintIds(client, filters.teamId) : null;
  let query = client
    .from("complaints")
    .select("*, images:complaint_images(*), location:locations(*), assignments:repair_assignments(*)", {
      count: "exact",
    });
  query = applyFilters(query, filters, teamComplaintIds);
  query = query
    .order(sortBy, { ascending })
    .order("created_at", { ascending: false })
    .order("id", { ascending: true })
    .range((page - 1) * pageSize, (page - 1) * pageSize + pageSize - 1);

  const { data, error, count } = await query;
  if (error) throw error;

  let items = (data ?? []) as ComplaintRow[];
  if (filters.near) {
    const { latitude, longitude } = filters.near;
    items = [...items].sort(
      (a, b) =>
        haversineMeters(latitude, longitude, a.latitude, a.longitude) -
        haversineMeters(latitude, longitude, b.latitude, b.longitude),
    );
  }

  return { items, total: count ?? 0 };
}

// -- getFull() ------------------------------------------------------------

const DETAIL_SELECT =
  "*, images:complaint_images(*), location:locations(*), nearby_places(*), " +
  "traffic_snapshots(*), status_history:complaint_status_history(*), " +
  "assessments:priority_assessments(*), analyses:ai_analyses(*, detections:ai_detections(*)), " +
  "assignments:repair_assignments(*), reporter:profiles(*)";

/** A complaint with every related row, mirroring ComplaintRepository.get(full=True). */
export async function getComplaintFull(client: SupabaseClient, id: string): Promise<ComplaintRow | null> {
  const { data, error } = await client.from("complaints").select(DETAIL_SELECT).eq("id", id).maybeSingle();
  if (error) throw error;
  return data as ComplaintRow | null;
}

export async function getComplaintFullByNumber(client: SupabaseClient, number: string): Promise<ComplaintRow | null> {
  const { data, error } = await client
    .from("complaints")
    .select(DETAIL_SELECT)
    .eq("complaint_number", number)
    .maybeSingle();
  if (error) throw error;
  return data as ComplaintRow | null;
}
