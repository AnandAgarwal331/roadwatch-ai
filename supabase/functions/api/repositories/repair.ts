// Ported from backend/app/repositories/repair.py.

import type { SupabaseClient } from "@supabase/supabase-js";
import type { AssignmentStatus } from "../_shared/enums.ts";

const OPEN_ASSIGNMENT_STATUSES: AssignmentStatus[] = ["ASSIGNED", "IN_PROGRESS"];

export interface RepairTeamRow {
  id: string;
  name: string;
  code: string;
  is_active: boolean;
  max_concurrent_jobs: number;
  [key: string]: unknown;
}

export interface RepairDetails {
  repair_type?: string | null;
  materials?: string | null;
  quantity?: string | null;
  equipment?: string | null;
  workers_count?: number | null;
  cost_amount?: number | null;
  notes?: string | null;
}

export interface RepairAssignmentRow {
  id: string;
  complaint_id: string;
  team_id: string;
  status: AssignmentStatus;
  due_at: string | null;
  started_at: string | null;
  completed_at: string | null;
  created_at: string;
  repair_details: RepairDetails | null;
  rework_count: number;
  rework_reason: string | null;
  reworked_at: string | null;
  flag_reason: string | null;
  flagged_at: string | null;
  is_emergency: boolean;
  emergency_reason: string | null;
  escalated_at: string | null;
  [key: string]: unknown;
}

// -- teams ------------------------------------------------------------

export async function getTeam(client: SupabaseClient, teamId: string): Promise<RepairTeamRow | null> {
  const { data, error } = await client.from("repair_teams").select("*").eq("id", teamId).maybeSingle();
  if (error) throw error;
  return data;
}

export async function listTeams(client: SupabaseClient, opts: { activeOnly?: boolean } = {}): Promise<RepairTeamRow[]> {
  let query = client.from("repair_teams").select("*").order("name", { ascending: true });
  if (opts.activeOnly) query = query.eq("is_active", true);
  const { data, error } = await query;
  if (error) throw error;
  return data ?? [];
}

export async function addTeam(client: SupabaseClient, team: Record<string, unknown>): Promise<RepairTeamRow> {
  const { data, error } = await client.from("repair_teams").insert(team).select().single();
  if (error) throw error;
  return data;
}

export async function updateTeam(client: SupabaseClient, teamId: string, patch: Record<string, unknown>): Promise<RepairTeamRow> {
  const { data, error } = await client.from("repair_teams").update(patch).eq("id", teamId).select().single();
  if (error) throw error;
  return data;
}

export async function teamWorkload(client: SupabaseClient, teamId: string): Promise<number> {
  const { count, error } = await client
    .from("repair_assignments")
    .select("*", { count: "exact", head: true })
    .eq("team_id", teamId)
    .in("status", OPEN_ASSIGNMENT_STATUSES);
  if (error) throw error;
  return count ?? 0;
}

export async function workloadByTeam(client: SupabaseClient): Promise<Record<string, number>> {
  const { data, error } = await client.from("repair_assignments").select("team_id").in("status", OPEN_ASSIGNMENT_STATUSES);
  if (error) throw error;
  const counts: Record<string, number> = {};
  for (const row of data ?? []) counts[row.team_id] = (counts[row.team_id] ?? 0) + 1;
  return counts;
}

/**
 * Every complaint with a repair a team has marked done but an admin has not
 * yet verified - the queue behind "Awaiting verification" in the admin
 * report list (see `ComplaintFilters.awaitingVerification` in
 * `repositories/complaint.ts`). The matching headline count is computed in
 * SQL instead, by `kpi_summary()`.
 */
export async function complaintIdsAwaitingVerification(client: SupabaseClient): Promise<string[]> {
  const { data, error } = await client.from("repair_assignments").select("complaint_id").eq("status", "COMPLETED");
  if (error) throw error;
  return (data ?? []).map((row) => row.complaint_id);
}

/**
 * Every complaint whose active repair has passed its due date - the "SLA
 * missed" queue behind the admin report list's "Overdue" filter and the
 * `overdue` kpi_summary() count. `due_at` is set once, when a team is
 * assigned (see `SLA_HOURS` in services/complaints.ts), so this only needs
 * to compare it against now - the same definition `is_overdue` already uses
 * per-job in `toTask`.
 */
export async function complaintIdsOverdue(client: SupabaseClient): Promise<string[]> {
  const { data, error } = await client
    .from("repair_assignments")
    .select("complaint_id")
    .in("status", ["ASSIGNED", "IN_PROGRESS"])
    .not("due_at", "is", null)
    .lt("due_at", new Date().toISOString());
  if (error) throw error;
  return (data ?? []).map((row) => row.complaint_id);
}

export async function completedCount(client: SupabaseClient, teamId: string): Promise<number> {
  const { count, error } = await client
    .from("repair_assignments")
    .select("*", { count: "exact", head: true })
    .eq("team_id", teamId)
    .in("status", ["COMPLETED", "VERIFIED"]);
  if (error) throw error;
  return count ?? 0;
}

// -- assignments --------------------------------------------------------

// The nested complaint carries everything the AI priority explanation (the
// "why" behind the score, not just the number) and the on-site context
// (traffic, nearby hospital/school) need - the same data admin's toDetail()
// shows, minus the two things a crew has no reason to see: the reporter's
// identity, and this same assignment nested back inside itself.
const ASSIGNMENT_DETAIL_SELECT =
  "*, evidence:repair_evidence(*), team:repair_teams(*), " +
  "complaint:complaints(*, images:complaint_images(*), location:locations(*), " +
  "nearby_places(*), traffic_snapshots(*), " +
  "assessments:priority_assessments(*), analyses:ai_analyses(*, detections:ai_detections(*)))";

export async function getAssignmentFull(client: SupabaseClient, assignmentId: string): Promise<RepairAssignmentRow | null> {
  const { data, error } = await client.from("repair_assignments").select(ASSIGNMENT_DETAIL_SELECT).eq("id", assignmentId).maybeSingle();
  if (error) throw error;
  // supabase-js's select-string type parser can't resolve this multi-level
  // embed statically (produces GenericStringError instead of a real row
  // type) - the runtime shape is correct, only the inferred type is wrong.
  return data as unknown as RepairAssignmentRow | null;
}

/** Highest-priority work first, then the earliest deadline - sorted client-side since PostgREST can't order a parent by an embedded child's column. */
export async function listTeamAssignments(
  client: SupabaseClient,
  teamId: string,
  opts: { statuses?: AssignmentStatus[]; limit?: number } = {},
): Promise<RepairAssignmentRow[]> {
  let query = client
    .from("repair_assignments")
    .select("*, evidence:repair_evidence(*), complaint:complaints(*, images:complaint_images(*), location:locations(*))")
    .eq("team_id", teamId)
    .limit(opts.limit ?? 100);
  if (opts.statuses) query = query.in("status", opts.statuses);
  const { data, error } = await query;
  if (error) throw error;

  const rows = (data ?? []) as RepairAssignmentRow[];
  rows.sort((a, b) => {
    const scoreDiff = (b.complaint as any)?.priority_score - (a.complaint as any)?.priority_score;
    if (scoreDiff !== 0) return scoreDiff;
    if (a.due_at === null) return b.due_at === null ? 0 : 1;
    if (b.due_at === null) return -1;
    return new Date(a.due_at).getTime() - new Date(b.due_at).getTime();
  });
  return rows;
}

export async function activeAssignmentForComplaint(client: SupabaseClient, complaintId: string): Promise<RepairAssignmentRow | null> {
  const { data, error } = await client
    .from("repair_assignments")
    .select("*")
    .eq("complaint_id", complaintId)
    .in("status", ["ASSIGNED", "IN_PROGRESS", "COMPLETED"])
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) throw error;
  return data;
}

export async function addAssignment(client: SupabaseClient, assignment: Record<string, unknown>): Promise<RepairAssignmentRow> {
  const { data, error } = await client.from("repair_assignments").insert(assignment).select().single();
  if (error) throw error;
  return data;
}

export async function updateAssignment(client: SupabaseClient, assignmentId: string, patch: Record<string, unknown>): Promise<RepairAssignmentRow> {
  const { data, error } = await client.from("repair_assignments").update(patch).eq("id", assignmentId).select().single();
  if (error) throw error;
  return data;
}

export async function addEvidence(client: SupabaseClient, evidence: Record<string, unknown>): Promise<Record<string, unknown>> {
  const { data, error } = await client.from("repair_evidence").insert(evidence).select().single();
  if (error) throw error;
  return data;
}
