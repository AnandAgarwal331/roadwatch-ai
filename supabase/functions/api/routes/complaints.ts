// Ported from backend/app/api/v1/complaints.py. Citizen-facing complaint
// endpoints: submit a report, browse the public feed, view one report's
// detail/priority breakdown, and re-run analysis.

import { Hono } from "hono";
import { AuthenticationError, NotFoundError, PermissionDeniedError, ValidationError } from "../_shared/errors.ts";
import { userClient, currentUserId } from "../_shared/supabase.ts";
import { writeRateLimit } from "../_shared/rate_limit.ts";
import { toDetail, toDuplicateCandidate, toPriorityResponse, toSummary, nextStep } from "../_shared/serializers.ts";
import { CLOSED_STATUSES, type ComplaintStatus, type DamageType, type PriorityLevel } from "../_shared/enums.ts";
import { listComplaints, getComplaintFull, type ComplaintFilters } from "../repositories/complaint.ts";
import { createComplaint, reassessComplaint } from "../services/complaints.ts";

export const complaints = new Hono();

//: Statuses a citizen browsing the public feed should not see.
const PUBLIC_HIDDEN = new Set<ComplaintStatus>(["REJECTED", "DUPLICATE"]);
const ALL_STATUSES: ComplaintStatus[] = [
  "PENDING", "AI_ANALYZED", "PRIORITIZED", "ASSIGNED", "IN_PROGRESS", "RESOLVED", "REJECTED", "DUPLICATE",
];

interface FieldError {
  field: string;
  message: string;
}

function fail(errors: FieldError[]): never {
  throw new ValidationError("Some fields need attention.", { fields: errors });
}

async function currentRole(req: Request, userId: string): Promise<string | null> {
  const { data } = await userClient(req).from("profiles").select("role").eq("id", userId).maybeSingle();
  return data?.role ?? null;
}

function parseNumber(value: FormDataEntryValue | null, field: string, opts: { min?: number; max?: number; required?: boolean }, errors: FieldError[]): number | undefined {
  if (value === null || value === "") {
    if (opts.required) errors.push({ field, message: "Field required" });
    return undefined;
  }
  const num = Number(value);
  if (Number.isNaN(num)) {
    errors.push({ field, message: "Input should be a valid number" });
    return undefined;
  }
  if (opts.min !== undefined && num < opts.min) errors.push({ field, message: `Input should be greater than or equal to ${opts.min}` });
  if (opts.max !== undefined && num > opts.max) errors.push({ field, message: `Input should be less than or equal to ${opts.max}` });
  return num;
}

function blankToNull(value: FormDataEntryValue | null): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed || null;
}

complaints.post("/", async (c) => {
  const req = c.req.raw;
  const uClient = userClient(req);
  await writeRateLimit(uClient, req);

  const userId = await currentUserId(req);
  if (!userId) throw new AuthenticationError("Please sign in to submit a report.");

  const form = await c.req.raw.formData();
  const errors: FieldError[] = [];
  const latitude = parseNumber(form.get("latitude"), "latitude", { min: -90, max: 90, required: true }, errors);
  const longitude = parseNumber(form.get("longitude"), "longitude", { min: -180, max: 180, required: true }, errors);
  const accuracyMeters = parseNumber(form.get("accuracy_meters"), "accuracy_meters", { min: 0, max: 100_000 }, errors);
  const description = blankToNull(form.get("description"));
  const roadName = blankToNull(form.get("road_name"));
  const address = blankToNull(form.get("address"));
  const city = blankToNull(form.get("city"));
  let reportedDamageType = blankToNull(form.get("reported_damage_type"));
  if (reportedDamageType === "null" || reportedDamageType === "undefined") reportedDamageType = null;
  if (errors.length > 0) fail(errors);

  const photo = form.get("photo");
  let imageBytes: Uint8Array | null = null;
  let imageContentType: string | null = null;
  if (photo instanceof File && photo.name) {
    const buf = await photo.arrayBuffer();
    imageBytes = new Uint8Array(buf);
    if (imageBytes.length > 0) {
      const maxBytes = 10 * 1024 * 1024;
      if (imageBytes.length > maxBytes) {
        throw new ValidationError(`That image is too large. Please upload a file under ${Math.round(maxBytes / (1024 * 1024))}MB.`);
      }
      imageContentType = photo.type || null;
    }
  }

  const result = await createComplaint(req, {
    latitude: latitude!,
    longitude: longitude!,
    description,
    reportedDamageType,
    roadName,
    address,
    city,
    accuracyMeters,
    imageBytes,
    imageContentType,
  });

  const detail = toDetail(result.complaint, { includeReporter: false });
  return c.json(
    {
      complaint: detail,
      needs_manual_review: result.needsManualReview,
      ai_message: result.aiMessage,
      duplicate_candidates: result.duplicateCandidates.map(toDuplicateCandidate),
      next_step: nextStep(result.complaint, result.needsManualReview),
    },
    201,
  );
});

complaints.get("/", async (c) => {
  const req = c.req.raw;
  const uClient = userClient(req);
  const url = new URL(req.url);

  const page = Math.max(1, Number(url.searchParams.get("page") ?? "1"));
  const pageSize = Math.min(100, Math.max(1, Number(url.searchParams.get("page_size") ?? "20")));
  const sortBy = url.searchParams.get("sort_by") ?? "created_at";
  const sortDir = (url.searchParams.get("sort_dir") ?? "desc") as "asc" | "desc";

  const statusParam = url.searchParams.getAll("status") as ComplaintStatus[];
  const visible = (statusParam.length > 0 ? statusParam : ALL_STATUSES).filter((s) => !PUBLIC_HIDDEN.has(s));
  const damageType = url.searchParams.getAll("damage_type") as DamageType[];
  const priorityLevel = url.searchParams.getAll("priority_level") as PriorityLevel[];
  const search = url.searchParams.get("search") ?? undefined;
  const nearLat = url.searchParams.get("near_lat");
  const nearLon = url.searchParams.get("near_lon");
  const radiusMeters = Number(url.searchParams.get("radius_meters") ?? "2000");

  const filters: ComplaintFilters = {
    status: visible,
    damageType: damageType.length > 0 ? damageType : undefined,
    priorityLevel: priorityLevel.length > 0 ? priorityLevel : undefined,
    search,
    near: nearLat !== null && nearLon !== null ? { latitude: Number(nearLat), longitude: Number(nearLon), radiusMeters } : undefined,
  };

  const { items, total } = await listComplaints(uClient, filters, { page, pageSize, sortBy, sortDir });
  return c.json({
    items: items.map(toSummary),
    total,
    page,
    page_size: pageSize,
    total_pages: Math.max(1, Math.ceil(total / pageSize)),
  });
});

complaints.get("/mine", async (c) => {
  const req = c.req.raw;
  const uClient = userClient(req);
  const userId = await currentUserId(req);
  if (!userId) throw new AuthenticationError("Please sign in to view your reports.");

  const url = new URL(req.url);
  const page = Math.max(1, Number(url.searchParams.get("page") ?? "1"));
  const pageSize = Math.min(100, Math.max(1, Number(url.searchParams.get("page_size") ?? "20")));
  const sortBy = url.searchParams.get("sort_by") ?? "created_at";
  const sortDir = (url.searchParams.get("sort_dir") ?? "desc") as "asc" | "desc";
  const statusParam = url.searchParams.getAll("status") as ComplaintStatus[];

  const filters: ComplaintFilters = { reporterId: userId, status: statusParam.length > 0 ? statusParam : undefined };
  const { items, total } = await listComplaints(uClient, filters, { page, pageSize, sortBy, sortDir });
  return c.json({
    items: items.map(toSummary),
    total,
    page,
    page_size: pageSize,
    total_pages: Math.max(1, Math.ceil(total / pageSize)),
  });
});

complaints.get("/:id", async (c) => {
  const req = c.req.raw;
  const uClient = userClient(req);
  const id = c.req.param("id");
  const userId = await currentUserId(req);

  const complaint = await getComplaintFull(uClient, id);
  if (!complaint) throw new NotFoundError("That report could not be found.");

  const isOwner = userId !== null && complaint.reporter_id === userId;
  const role = userId ? await currentRole(req, userId) : null;
  const isStaff = role === "ADMIN" || role === "REPAIR_TEAM";

  if (PUBLIC_HIDDEN.has(complaint.status) && !(isOwner || isStaff)) {
    throw new NotFoundError("That report could not be found.");
  }

  return c.json(toDetail(complaint, { includeReporter: isOwner || isStaff }));
});

complaints.get("/:id/priority", async (c) => {
  const req = c.req.raw;
  const uClient = userClient(req);
  const id = c.req.param("id");

  const complaint = await getComplaintFull(uClient, id);
  if (!complaint) throw new NotFoundError("That report could not be found.");

  const response = toPriorityResponse(complaint);
  if (!response) throw new NotFoundError("This report has not been scored yet.");
  return c.json(response);
});

complaints.post("/:id/analyze", async (c) => {
  const req = c.req.raw;
  const uClient = userClient(req);
  await writeRateLimit(uClient, req);

  const id = c.req.param("id");
  const userId = await currentUserId(req);
  if (!userId) throw new AuthenticationError("Please sign in.");

  const complaint = await getComplaintFull(uClient, id);
  if (!complaint) throw new NotFoundError("That report could not be found.");

  const role = await currentRole(req, userId);
  if (role !== "ADMIN" && complaint.reporter_id !== userId) {
    throw new PermissionDeniedError("You can only re-analyse your own reports.");
  }
  if (CLOSED_STATUSES.includes(complaint.status) && role !== "ADMIN") {
    throw new ValidationError("This report is closed and cannot be re-analysed.");
  }

  const updated = await reassessComplaint(req, id);
  return c.json(toDetail(updated, { includeReporter: true }));
});
