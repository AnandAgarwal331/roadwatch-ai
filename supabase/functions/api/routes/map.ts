// Ported from backend/app/api/v1/map.py. Same public-visibility rule as the
// complaints feed (REJECTED/DUPLICATE hidden from anonymous and citizen
// viewers), but a lean projection with a viewport bounding box instead of
// pages, and a hard cap on marker count.

import { Hono } from "hono";
import { optionalUser } from "../_shared/auth.ts";
import { userClient } from "../_shared/supabase.ts";
import { toMapIssue } from "../_shared/serializers.ts";
import { mapPoints, type ComplaintFilters } from "../repositories/complaint.ts";
import type { ComplaintStatus, DamageType, PriorityLevel } from "../_shared/enums.ts";

export const map = new Hono();

const PUBLIC_HIDDEN = new Set<ComplaintStatus>(["REJECTED", "DUPLICATE"]);
const ALL_STATUSES: ComplaintStatus[] = [
  "PENDING", "AI_ANALYZED", "PRIORITIZED", "ASSIGNED", "IN_PROGRESS", "RESOLVED", "REJECTED", "DUPLICATE",
];

map.get("/issues", async (c) => {
  const req = c.req.raw;
  const url = new URL(req.url);
  const user = await optionalUser(req);
  const isStaff = user !== null && (user.role === "ADMIN" || user.role === "REPAIR_TEAM");

  const statusParam = url.searchParams.getAll("status") as ComplaintStatus[];
  const statuses = isStaff
    ? statusParam.length > 0 ? statusParam : undefined
    : (statusParam.length > 0 ? statusParam : ALL_STATUSES).filter((s) => !PUBLIC_HIDDEN.has(s));

  const minLat = url.searchParams.get("min_lat");
  const minLon = url.searchParams.get("min_lon");
  const maxLat = url.searchParams.get("max_lat");
  const maxLon = url.searchParams.get("max_lon");
  let bbox: [number, number, number, number] | undefined;
  if (minLat !== null && minLon !== null && maxLat !== null && maxLon !== null) {
    const a = Number(minLat), b = Number(minLon), x = Number(maxLat), y = Number(maxLon);
    bbox = [Math.min(a, x), Math.min(b, y), Math.max(a, x), Math.max(b, y)];
  }

  const createdFromParam = url.searchParams.get("created_from");
  const createdToParam = url.searchParams.get("created_to");
  const limit = Math.min(5000, Math.max(1, Number(url.searchParams.get("limit") ?? "1000")));

  const filters: ComplaintFilters = {
    status: statuses,
    damageType: url.searchParams.getAll("damage_type") as DamageType[],
    priorityLevel: url.searchParams.getAll("priority_level") as PriorityLevel[],
    createdFrom: createdFromParam ? new Date(createdFromParam) : undefined,
    createdTo: createdToParam ? new Date(createdToParam) : undefined,
    excludeClosed: url.searchParams.get("exclude_closed") === "true",
    bbox,
  };
  if (filters.damageType?.length === 0) filters.damageType = undefined;
  if (filters.priorityLevel?.length === 0) filters.priorityLevel = undefined;

  const items = await mapPoints(userClient(req), filters, limit);
  return c.json(items.map(toMapIssue));
});
