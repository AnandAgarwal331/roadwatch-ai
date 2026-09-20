// Ported from backend/app/api/v1/public.py. Only aggregate counts safe to
// show anyone - no per-report detail, no reporter identities.

import { Hono } from "hono";
import { serviceClient } from "../_shared/supabase.ts";
import { kpis } from "../services/analytics.ts";

export const publicStats = new Hono();

publicStats.get("/public", async (c) => {
  const summary = await kpis(serviceClient());
  return c.json({
    total_reports: summary.totalReports,
    resolved: summary.resolved,
    unresolved: summary.unresolved,
    resolution_rate: summary.resolutionRate,
    reports_last_7_days: summary.reportsLast7Days,
    average_resolution_hours: summary.averageResolutionHours,
  });
});
