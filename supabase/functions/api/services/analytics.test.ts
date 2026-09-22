// The counting itself now happens in the kpi_summary() database function, which
// needs a database to exercise. What is tested here is everything around it:
// that a single call feeds every figure, and that its raw counts become the
// numbers the dashboard and the public landing page show.

import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import type { SupabaseClient } from "@supabase/supabase-js";
import { kpis, priorityDistribution, statusDistribution, teamPerformance } from "./analytics.ts";

interface Row {
  total: number;
  by_status: Record<string, number>;
  by_priority_level: Record<string, number>;
  average_resolution_hours: number | null;
  last_7_days: number;
  last_30_days: number;
  pending_duplicates: number;
  awaiting_verification: number;
  overdue: number;
}

const ROW: Row = {
  total: 200,
  by_status: { PENDING: 10, AI_ANALYZED: 5, PRIORITIZED: 15, ASSIGNED: 20, IN_PROGRESS: 30, RESOLVED: 100, REJECTED: 12, DUPLICATE: 8 },
  by_priority_level: { CRITICAL: 7, HIGH: 40, MEDIUM: 90, LOW: 63 },
  average_resolution_hours: 52.3,
  last_7_days: 14,
  last_30_days: 61,
  pending_duplicates: 3,
  awaiting_verification: 5,
  overdue: 9,
};

function fakeClient(row: Row | null, error: unknown = null): { client: SupabaseClient; calls: string[] } {
  const calls: string[] = [];
  const client = {
    rpc(name: string) {
      calls.push(name);
      return Promise.resolve({ data: row, error });
    },
    // deno-lint-ignore no-explicit-any
  } as any as SupabaseClient;
  return { client, calls };
}

Deno.test("every headline figure comes from one database call", async () => {
  const { client, calls } = fakeClient(ROW);
  await kpis(client);
  assertEquals(calls, ["kpi_summary"]);
});

Deno.test("counts become the dashboard figures", async () => {
  const summary = await kpis(fakeClient(ROW).client);

  assertEquals(summary.totalReports, 200);
  assertEquals(summary.critical, 7);
  assertEquals(summary.high, 40);
  assertEquals(summary.inProgress, 30);
  assertEquals(summary.resolved, 100);
  assertEquals(summary.pendingReview, 30); // PENDING + AI_ANALYZED + PRIORITIZED
  assertEquals(summary.averageResolutionHours, 52.3);
  assertEquals(summary.reportsLast7Days, 14);
  assertEquals(summary.reportsLast30Days, 61);
  assertEquals(summary.pendingDuplicates, 3);
  assertEquals(summary.awaitingVerification, 5);
  assertEquals(summary.overdue, 9);
});

Deno.test("unresolved excludes every closed status, not just resolved ones", async () => {
  // 200 total - 100 resolved - 12 rejected - 8 duplicate = 80 still open.
  const summary = await kpis(fakeClient(ROW).client);
  assertEquals(summary.unresolved, 80);
});

Deno.test("resolution rate is resolved over total, to one decimal", async () => {
  assertEquals((await kpis(fakeClient(ROW).client)).resolutionRate, 50);
  const oddRow = { ...ROW, total: 3, by_status: { RESOLVED: 1 } };
  assertEquals((await kpis(fakeClient(oddRow).client)).resolutionRate, 33.3);
});

Deno.test("an empty database gives zeros, not NaN or a crash", async () => {
  const empty: Row = { total: 0, by_status: {}, by_priority_level: {}, average_resolution_hours: null, last_7_days: 0, last_30_days: 0, pending_duplicates: 0, awaiting_verification: 0, overdue: 0 };
  const summary = await kpis(fakeClient(empty).client);

  assertEquals(summary.totalReports, 0);
  assertEquals(summary.unresolved, 0);
  assertEquals(summary.resolutionRate, 0);
  assertEquals(summary.averageResolutionHours, null);
  assertEquals(summary.critical, 0);
});

Deno.test("a database error is raised, not hidden behind zeros", async () => {
  let raised = false;
  try {
    await kpis(fakeClient(null, new Error("function kpi_summary() does not exist")).client);
  } catch {
    raised = true;
  }
  assertEquals(raised, true);
});

Deno.test("the distributions list every level and status, including ones with no reports", async () => {
  const sparse: Row = { ...ROW, by_status: { PENDING: 4 }, by_priority_level: { HIGH: 2 } };

  const priority = await priorityDistribution(fakeClient(sparse).client);
  assertEquals(priority, [
    { level: "CRITICAL", count: 0 },
    { level: "HIGH", count: 2 },
    { level: "MEDIUM", count: 0 },
    { level: "LOW", count: 0 },
  ]);

  const status = await statusDistribution(fakeClient(sparse).client);
  assertEquals(status.length, 8);
  assertEquals(status.find((s) => s.status === "PENDING")?.count, 4);
  assertEquals(status.find((s) => s.status === "RESOLVED")?.count, 0);
});

// teamPerformance() - a fake client for the two plain selects it makes
// (repair_teams, then repair_assignments), distinct from kpiRow()'s single
// RPC call above.
function teamPerformanceClient(
  teams: Record<string, unknown>[],
  assignments: Record<string, unknown>[],
): SupabaseClient {
  const client = {
    from(table: string) {
      const rows = table === "repair_teams" ? teams : assignments;
      return {
        select(_cols: string) {
          const result = Promise.resolve({ data: rows, error: null });
          // repair_teams is the only one of the two calls that chains .order().
          return Object.assign(result, { order: () => result });
        },
      };
    },
    // deno-lint-ignore no-explicit-any
  } as any as SupabaseClient;
  return client;
}

Deno.test("teamPerformance() counts a job resubmitted after rework as reworked, whether or not it has since been verified", async () => {
  const teams = [{ id: "t1", name: "Crew 1", zone: null, max_concurrent_jobs: 5 }];
  const assignments = [
    { team_id: "t1", status: "COMPLETED", rework_count: 0, created_at: "2026-01-01T00:00:00Z", completed_at: "2026-01-02T00:00:00Z" },
    { team_id: "t1", status: "VERIFIED", rework_count: 1, created_at: "2026-01-01T00:00:00Z", completed_at: "2026-01-03T00:00:00Z" },
  ];

  const [result] = await teamPerformance(teamPerformanceClient(teams, assignments));
  assertEquals(result.completed, 2);
  assertEquals(result.rework_rate, 50); // 1 of 2 completed jobs was reworked at least once
});

Deno.test("teamPerformance() rework rate is null, not a division by zero, for a team with nothing completed yet", async () => {
  const teams = [{ id: "t1", name: "Crew 1", zone: null, max_concurrent_jobs: 5 }];
  const assignments = [{ team_id: "t1", status: "ASSIGNED", rework_count: 0, created_at: "2026-01-01T00:00:00Z", completed_at: null }];

  const [result] = await teamPerformance(teamPerformanceClient(teams, assignments));
  assertEquals(result.rework_rate, null);
});

Deno.test("teamPerformance() a team with no rework at all reports a 0% rate, not null", async () => {
  const teams = [{ id: "t1", name: "Crew 1", zone: null, max_concurrent_jobs: 5 }];
  const assignments = [
    { team_id: "t1", status: "COMPLETED", rework_count: 0, created_at: "2026-01-01T00:00:00Z", completed_at: "2026-01-02T00:00:00Z" },
  ];

  const [result] = await teamPerformance(teamPerformanceClient(teams, assignments));
  assertEquals(result.rework_rate, 0);
});
