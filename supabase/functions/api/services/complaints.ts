// Ported from backend/app/services/complaints.py's ComplaintService.create()
// and .reassess(). Only the citizen-facing creation/re-analysis paths -
// assignment, repair completion, verification and duplicate confirm/reject
// are admin/team flows ported in Phase 4 alongside the admin routes.

import type { SupabaseClient } from "@supabase/supabase-js";
import { ConflictError, InvalidStatusTransitionError, NotFoundError, ValidationError } from "../_shared/errors.ts";
import { serviceClient, userClient } from "../_shared/supabase.ts";
import { STATUS_TRANSITIONS, type ComplaintStatus, type PriorityLevel } from "../_shared/enums.ts";
import type { AuthedProfile } from "../_shared/auth.ts";
import { thresholdsFromSettings } from "./priority.ts";
import { isValidCoordinate } from "./geo.ts";
import { validateAndProcess, type ProcessedImage } from "./images.ts";
import { assess, type AssessmentOutcome } from "./assessment.ts";
import { DuplicateService, type DuplicateCandidate } from "./duplicates.ts";
import * as notifications from "./notifications.ts";
import { recordAudit } from "./audit.ts";
import { getComplaintById, getComplaintFull, type ComplaintRow } from "../repositories/complaint.ts";
import {
  activeAssignmentForComplaint,
  addAssignment,
  addEvidence,
  getTeam,
  teamWorkload,
  updateAssignment,
  type RepairAssignmentRow,
} from "../repositories/repair.ts";

export interface CreateComplaintInput {
  latitude: number;
  longitude: number;
  description?: string | null;
  reportedDamageType?: string | null;
  roadName?: string | null;
  address?: string | null;
  city?: string | null;
  accuracyMeters?: number | null;
  imageBytes?: Uint8Array | null;
  imageContentType?: string | null;
}

export interface CreateComplaintResult {
  complaint: ComplaintRow;
  needsManualReview: boolean;
  aiMessage: string | null;
  duplicateCandidates: DuplicateCandidate[];
}

const EXT_FOR_MIME: Record<string, string> = { "image/jpeg": "jpg", "image/png": "png", "image/webp": "webp" };

/** A rough road classification from its name - a heuristic, not authoritative data. See Python for the same disclaimer. */
function inferRoadImportance(roadName: string | null | undefined): number {
  if (!roadName) return 5.0;
  const name = roadName.toLowerCase();
  if (["nh-", "national highway", "expressway", "bypass"].some((t) => name.includes(t))) return 10.0;
  if (["ring road", "sh-", "state highway", "trunk", "flyover"].some((t) => name.includes(t))) return 8.5;
  if (["main road", "high street", "market", "station road"].some((t) => name.includes(t))) return 7.0;
  if (["cross", "lane", "gali", "alley"].some((t) => name.includes(t))) return 3.5;
  return 5.0;
}

function blankToNull(value: string | null | undefined): string | null {
  const trimmed = (value ?? "").trim();
  return trimmed || null;
}

async function uploadReportPhoto(
  client: SupabaseClient,
  complaintId: string,
  processed: ProcessedImage,
): Promise<{ id: string; url: string; perceptual_hash: string; content_type: string }> {
  const ext = EXT_FOR_MIME[processed.contentType] ?? "jpg";
  const path = `${complaintId}/${crypto.randomUUID()}.${ext}`;

  const { error: uploadErr } = await client.storage
    .from("complaint-photos")
    .upload(path, processed.data, { contentType: processed.contentType });
  if (uploadErr) throw uploadErr;

  const { data: pub } = client.storage.from("complaint-photos").getPublicUrl(path);

  const { data: image, error: insertErr } = await client
    .from("complaint_images")
    .insert({
      complaint_id: complaintId,
      storage_key: path,
      url: pub.publicUrl,
      content_type: processed.contentType,
      size_bytes: processed.data.length,
      width: processed.width,
      height: processed.height,
      kind: "REPORT",
      perceptual_hash: processed.perceptualHash,
    })
    .select()
    .single();
  if (insertErr) throw insertErr;
  return image;
}

/** Builds the persist_assessment RPC payload from an AssessmentOutcome (see the .sql migration for the shape each field expects). */
function buildPersistPayload(outcome: AssessmentOutcome) {
  const ai = outcome.ai.analysis;
  return {
    p_damage_type: outcome.damageType,
    p_severity_score: outcome.severityScore,
    p_had_analysis: outcome.ai.ran,
    p_ai:
      outcome.ai.ran && ai
        ? {
            confidence: ai.confidence,
            damaged_area_ratio: ai.damagedAreaRatio,
            detection_count: ai.detections.length,
            is_confident: outcome.ai.isConfident,
            model_name: ai.modelName,
            model_version: ai.modelVersion,
            provider: ai.provider,
            processing_ms: ai.processingMs,
            severity_explanation: outcome.ai.severityExplanation,
            error_message: ai.errorMessage ?? null,
            detections: ai.detections.map((d) => ({
              damage_type: d.damageType,
              confidence: d.confidence,
              bbox_x: d.bboxX,
              bbox_y: d.bboxY,
              bbox_width: d.bboxWidth,
              bbox_height: d.bboxHeight,
              area_ratio: Math.max(0.0, Math.min(1.0, d.bboxWidth * d.bboxHeight)),
            })),
          }
        : null,
    p_nearby_places: outcome.nearbyPlaces.map((p) => ({
      place_type: p.placeType,
      name: p.name,
      distance_meters: p.distanceMeters,
      latitude: p.latitude,
      longitude: p.longitude,
      source: p.source,
    })),
    p_traffic: {
      level: outcome.traffic.level,
      score: outcome.traffic.score,
      estimated_vehicles_per_hour: outcome.traffic.estimatedVehiclesPerHour,
      observed_at: outcome.traffic.observedAt,
      provider: outcome.traffic.provider,
    },
    p_weather: outcome.weather
      ? {
          condition: outcome.weather.condition,
          rainfall_mm_24h: outcome.weather.rainfallMm24h,
          temperature_c: outcome.weather.temperatureC,
          multiplier: outcome.weather.multiplier,
          observed_at: outcome.weather.observedAt,
          provider: outcome.weather.provider,
        }
      : null,
    p_priority: {
      total_score: outcome.priority.totalScore,
      level: outcome.priority.level,
      explanation: outcome.priority.explanation,
      weights: outcome.priority.weights,
      signals: outcome.priority.signals,
      weather_multiplier: outcome.priority.weatherMultiplier,
      engine_version: outcome.priority.engineVersion,
      severity_factor: outcome.priority.severityFactor,
      traffic_factor: outcome.priority.trafficFactor,
      location_factor: outcome.priority.locationFactor,
      history_factor: outcome.priority.historyFactor,
      severity_points: outcome.priority.severityPoints,
      traffic_points: outcome.priority.trafficPoints,
      location_points: outcome.priority.locationPoints,
      history_points: outcome.priority.historyPoints,
    },
  };
}

/**
 * Runs the assessment pipeline and atomically persists it via the
 * persist_assessment RPC (called through the citizen's own JWT - the
 * function checks reporter_id = auth.uid() OR is_admin() internally), then
 * detects/records duplicate candidates.
 *
 * The assessment computation itself (AI/traffic/places/weather/history
 * lookups) runs on the service client: it must see complaints regardless of
 * the caller's own RLS visibility, the same unrestricted view the original
 * FastAPI backend's single DB connection always had. See _shared/supabase.ts.
 */
async function fetchRoadImportance(client: SupabaseClient, complaintId: string): Promise<number> {
  const { data } = await client.from("locations").select("road_importance").eq("complaint_id", complaintId).maybeSingle();
  return data?.road_importance ?? 5.0;
}

async function runAssessment(
  req: Request,
  complaint: ComplaintRow,
  image: { id: string; content_type: string; perceptual_hash: string } | null,
  imageBytes: Uint8Array | undefined,
  roadImportance: number,
): Promise<{ outcome: AssessmentOutcome; candidates: DuplicateCandidate[] }> {
  const sClient = serviceClient();
  const uClient = userClient(req);

  const outcome = await assess(sClient, {
    complaint,
    imageBytes,
    imageContentType: image?.content_type,
    imageId: image?.id,
    roadImportance,
  });

  const { error: persistErr } = await uClient.rpc("persist_assessment", {
    p_complaint_id: complaint.id,
    p_image_id: image?.id ?? null,
    ...buildPersistPayload(outcome),
  });
  if (persistErr) throw persistErr;

  const duplicates = new DuplicateService(sClient);
  const complaintImages = image ? [{ kind: "REPORT", perceptual_hash: image.perceptual_hash }] : [];
  const persistedComplaint: ComplaintRow = { ...complaint, damage_type: outcome.damageType };
  const candidates = await duplicates.findCandidates(persistedComplaint, complaintImages);
  await duplicates.recordCandidates(persistedComplaint, candidates);

  return { outcome, candidates };
}

export async function createComplaint(req: Request, input: CreateComplaintInput): Promise<CreateComplaintResult> {
  if (!isValidCoordinate(input.latitude, input.longitude)) {
    throw new ValidationError("Those coordinates are not valid. Please pick a point on the map.");
  }

  let processed: ProcessedImage | null = null;
  if (input.imageBytes && input.imageBytes.length > 0) {
    processed = await validateAndProcess(input.imageBytes, input.imageContentType || "application/octet-stream");
  }

  const uClient = userClient(req);
  const { data: created, error: createErr } = await uClient.rpc("create_complaint", {
    p_latitude: input.latitude,
    p_longitude: input.longitude,
    p_description: blankToNull(input.description),
    p_reported_damage_type: input.reportedDamageType || null,
    p_road_name: blankToNull(input.roadName),
    p_address: blankToNull(input.address),
    p_city: blankToNull(input.city),
    p_accuracy_meters: input.accuracyMeters ?? null,
    p_road_importance: inferRoadImportance(input.roadName),
  });
  if (createErr) throw createErr;
  const complaintId = created.id as string;

  let image: { id: string; url: string; perceptual_hash: string; content_type: string } | null = null;
  if (processed) {
    image = await uploadReportPhoto(uClient, complaintId, processed);
  }

  const complaint = await getComplaintById(uClient, complaintId);
  if (!complaint) throw new Error("complaint vanished immediately after creation");
  const roadImportance = await fetchRoadImportance(uClient, complaintId);

  const { outcome, candidates } = await runAssessment(req, complaint, image, processed?.data, roadImportance);
  await notifications.complaintSubmitted(serviceClient(), { ...complaint, damage_type: outcome.damageType, priority_score: outcome.priority.totalScore, priority_level: outcome.priority.level });

  const full = await getComplaintFull(uClient, complaintId);
  if (!full) throw new Error("complaint vanished after assessment");

  return {
    complaint: full,
    needsManualReview: outcome.needsManualReview,
    aiMessage: outcome.ai.message,
    duplicateCandidates: candidates,
  };
}

// -- admin / team flows ---------------------------------------------------
//
// Everything below is ported from ComplaintService's status/assignment/
// duplicate methods in complaints.py. All run on the service client: the
// caller has already been through requireAdmin()/requireTeam() (see
// _shared/auth.ts) before any of these are invoked, so this is the same
// "authorize in code, then get a system-wide connection" pattern the
// assessment pipeline uses - not a raw table write reachable by an
// unprivileged client under RLS. Unlike the SQLAlchemy original these are
// sequential awaits, not one DB transaction; a crash mid-sequence could
// leave a partial write (e.g. the complaint updated but the status-history
// row missing). Accepted for the same reason the create-flow's duplicate
// detection/notification steps already are: these are single-admin-request
// side effects after the record's core state has already changed, not the
// atomic multi-table write persist_assessment/create_complaint protect.

function readableStatus(value: string): string {
  return value.replace(/_/g, " ").toLowerCase();
}

function levelForScore(score: number): PriorityLevel {
  const t = thresholdsFromSettings();
  if (score >= t.critical) return "CRITICAL";
  if (score >= t.high) return "HIGH";
  if (score >= t.medium) return "MEDIUM";
  return "LOW";
}

const SLA_HOURS: Record<PriorityLevel, number> = { CRITICAL: 24, HIGH: 72, MEDIUM: 168, LOW: 336 };

async function recordStatus(
  client: SupabaseClient,
  complaintId: string,
  fromStatus: ComplaintStatus | null,
  toStatus: ComplaintStatus,
  changedById: string | null,
  note: string | null,
): Promise<void> {
  const { error } = await client.from("complaint_status_history").insert({
    complaint_id: complaintId,
    from_status: fromStatus,
    to_status: toStatus,
    changed_by_id: changedById,
    note,
  });
  if (error) throw error;
}

export async function changeStatus(
  complaint: ComplaintRow,
  newStatus: ComplaintStatus,
  actor: AuthedProfile,
  note: string | null = null,
): Promise<ComplaintRow> {
  const client = serviceClient();
  const current = complaint.status as ComplaintStatus;
  if (newStatus === current) return complaint;

  const allowed = STATUS_TRANSITIONS[current] ?? [];
  if (!allowed.includes(newStatus)) {
    throw new InvalidStatusTransitionError(
      `A complaint cannot move from ${readableStatus(current)} to ${readableStatus(newStatus)}.`,
      { from: current, to: newStatus, allowed: [...allowed].sort() },
    );
  }

  const patch: Record<string, unknown> = { status: newStatus };
  if (newStatus === "RESOLVED") patch.resolved_at = new Date().toISOString();
  else if (current === "RESOLVED") patch.resolved_at = null;

  const { data: updated, error } = await client.from("complaints").update(patch).eq("id", complaint.id).select().single();
  if (error) throw error;

  // Three independent writes - none reads another's result, all three only
  // need the already-committed `updated` row - so they run concurrently
  // rather than adding three sequential round trips to the response time.
  await Promise.all([
    recordStatus(client, complaint.id, current, newStatus, actor.id, note),
    recordAudit(client, {
      actor,
      action: "complaint.status_changed",
      entityType: "complaint",
      entityId: complaint.id,
      complaintId: complaint.id,
      oldValue: { status: current },
      newValue: { status: newStatus },
      note,
    }),
    newStatus === "RESOLVED"
      ? notifications.complaintResolved(client, updated)
      : notifications.complaintStatusChanged(client, updated, current),
  ]);

  return updated;
}

export async function rejectComplaint(complaint: ComplaintRow, reason: string, actor: AuthedProfile): Promise<ComplaintRow> {
  const trimmed = reason.trim();
  if (!trimmed) throw new ValidationError("Please give a reason for rejecting this report.");

  const client = serviceClient();
  const { error } = await client.from("complaints").update({ rejection_reason: trimmed }).eq("id", complaint.id);
  if (error) throw error;

  return changeStatus({ ...complaint, rejection_reason: trimmed }, "REJECTED", actor, trimmed);
}

export async function overridePriority(
  complaint: ComplaintRow,
  score: number,
  actor: AuthedProfile,
  note: string | null = null,
): Promise<ComplaintRow> {
  if (score < 0 || score > 100) throw new ValidationError("A priority score must be between 0 and 100.");

  const client = serviceClient();
  const level = levelForScore(score);
  const previous = { priority_score: complaint.priority_score, level: complaint.priority_level };

  const { data: updated, error } = await client
    .from("complaints")
    .update({ manual_priority_override: score, priority_score: score, priority_level: level })
    .eq("id", complaint.id)
    .select()
    .single();
  if (error) throw error;

  await recordAudit(client, {
    actor,
    action: "complaint.priority_overridden",
    entityType: "complaint",
    entityId: complaint.id,
    complaintId: complaint.id,
    oldValue: previous,
    newValue: { priority_score: score, level },
    note,
  });

  return updated;
}

export async function assignTeam(
  complaint: ComplaintRow,
  teamId: string,
  actor: AuthedProfile,
  dueAt: string | null,
  note: string | null,
): Promise<RepairAssignmentRow> {
  const client = serviceClient();
  const team = await getTeam(client, teamId);
  if (!team) throw new NotFoundError("That repair team does not exist.");
  if (!team.is_active) throw new ConflictError(`${team.name} is currently inactive and cannot take new work.`);

  const closed: ComplaintStatus[] = ["RESOLVED", "REJECTED", "DUPLICATE"];
  if (closed.includes(complaint.status as ComplaintStatus)) {
    throw new ConflictError(`${complaint.complaint_number} is ${readableStatus(complaint.status as string)} and cannot be assigned.`);
  }

  const existing = await activeAssignmentForComplaint(client, complaint.id);
  if (existing) {
    if (existing.team_id === teamId) {
      throw new ConflictError(`${complaint.complaint_number} is already assigned to ${team.name}.`);
    }
    await updateAssignment(client, existing.id, { status: "CANCELLED", notes: `Reassigned to ${team.name}` });
  }

  const workload = await teamWorkload(client, teamId);
  if (workload >= team.max_concurrent_jobs) {
    throw new ConflictError(`${team.name} already has ${workload} open jobs (limit ${team.max_concurrent_jobs}).`, {
      open_jobs: workload,
      limit: team.max_concurrent_jobs,
    });
  }

  const due = dueAt ?? new Date(Date.now() + (SLA_HOURS[complaint.priority_level as PriorityLevel] ?? 168) * 3_600_000).toISOString();
  const assignment = await addAssignment(client, {
    complaint_id: complaint.id,
    team_id: team.id,
    assigned_by_id: actor.id,
    status: "ASSIGNED",
    due_at: due,
    notes: note ?? null,
  });

  // Independent writes/side effects, run concurrently rather than as four
  // sequential round trips - none of them reads another's result, they all
  // just need values already in scope (complaint, team, assignment).
  const updatedComplaint: ComplaintRow = { ...complaint, status: "ASSIGNED" };
  const sideEffects: PromiseLike<unknown>[] = [
    recordAudit(client, {
      actor,
      action: "complaint.assigned",
      entityType: "repair_assignment",
      entityId: assignment.id,
      complaintId: complaint.id,
      oldValue: { team_id: existing?.team_id ?? null },
      newValue: { team_id: team.id, team_name: team.name },
      note,
    }),
    notifications.complaintAssigned(client, updatedComplaint, team.id, team.name as string),
  ];
  if (complaint.status !== "ASSIGNED") {
    sideEffects.push(client.from("complaints").update({ status: "ASSIGNED" }).eq("id", complaint.id));
    sideEffects.push(recordStatus(client, complaint.id, complaint.status as ComplaintStatus, "ASSIGNED", actor.id, `Assigned to ${team.name}`));
  }
  await Promise.all(sideEffects);

  return assignment;
}

export async function startRepair(assignment: RepairAssignmentRow, actor: AuthedProfile): Promise<RepairAssignmentRow> {
  if (assignment.status === "IN_PROGRESS") return assignment;
  if (assignment.status !== "ASSIGNED") {
    throw new ConflictError(`This job is ${readableStatus(assignment.status)} and cannot be started.`);
  }

  const client = serviceClient();
  const now = new Date().toISOString();
  const updated = await updateAssignment(client, assignment.id, { status: "IN_PROGRESS", started_at: now });

  const complaint = (assignment as any).complaint ?? (await getComplaintById(client, assignment.complaint_id));
  if (complaint && complaint.status !== "IN_PROGRESS") {
    await Promise.all([
      client.from("complaints").update({ status: "IN_PROGRESS" }).eq("id", assignment.complaint_id),
      recordStatus(client, assignment.complaint_id, complaint.status, "IN_PROGRESS", actor.id, "Repair work started"),
      notifications.complaintStatusChanged(client, { ...complaint, status: "IN_PROGRESS" }, complaint.status),
    ]);
  }

  return updated;
}

export interface EvidenceFile {
  bytes: Uint8Array;
  contentType: string;
}

export async function completeRepair(
  assignment: RepairAssignmentRow,
  actor: AuthedProfile,
  note: string | null,
  evidenceFiles: EvidenceFile[],
  hadExistingEvidence: boolean,
): Promise<RepairAssignmentRow> {
  if (assignment.status === "VERIFIED") throw new ConflictError("This job has already been verified.");
  if (!["ASSIGNED", "IN_PROGRESS"].includes(assignment.status)) {
    throw new ConflictError(`This job is ${readableStatus(assignment.status)} and cannot be completed.`);
  }
  if (evidenceFiles.length === 0 && !hadExistingEvidence) {
    throw new ValidationError("Please upload at least one photo showing the completed repair.");
  }

  const client = serviceClient();
  // Each photo's upload + row insert is independent of the others - was a
  // sequential loop, now concurrent, so uploading several evidence photos
  // costs one round trip's worth of time instead of one per photo.
  await Promise.all(
    evidenceFiles.map(async (file) => {
      const processed = await validateAndProcess(file.bytes, file.contentType);
      const ext = EXT_FOR_MIME[processed.contentType] ?? "jpg";
      const path = `${assignment.id}/${crypto.randomUUID()}.${ext}`;
      const { error: uploadErr } = await client.storage.from("repair-evidence").upload(path, processed.data, { contentType: processed.contentType });
      if (uploadErr) throw uploadErr;
      const { data: pub } = client.storage.from("repair-evidence").getPublicUrl(path);
      await addEvidence(client, {
        assignment_id: assignment.id,
        submitted_by_id: actor.id,
        storage_key: path,
        url: pub.publicUrl,
        content_type: processed.contentType,
        size_bytes: processed.data.length,
        note,
      });
    }),
  );

  const now = new Date().toISOString();
  const patch: Record<string, unknown> = { status: "COMPLETED", completed_at: now };
  if (!assignment.started_at) patch.started_at = now;
  if (note) patch.notes = note;
  const updated = await updateAssignment(client, assignment.id, patch);

  const complaint = (assignment as any).complaint ?? (await getComplaintById(client, assignment.complaint_id));
  const teamName = (assignment as any).team?.name ?? "The crew";

  // Independent writes/side effects, run concurrently - see changeStatus's
  // own comment on this pattern.
  const sideEffects: PromiseLike<unknown>[] = [
    recordAudit(client, {
      actor,
      action: "repair.completed",
      entityType: "repair_assignment",
      entityId: assignment.id,
      complaintId: assignment.complaint_id,
      newValue: { status: "COMPLETED" },
      note,
    }),
    notifications.repairCompleted(client, complaint ?? { id: assignment.complaint_id, complaint_number: "" }, teamName),
  ];
  if (complaint && complaint.status !== "IN_PROGRESS") {
    sideEffects.push(client.from("complaints").update({ status: "IN_PROGRESS" }).eq("id", assignment.complaint_id));
    sideEffects.push(recordStatus(client, assignment.complaint_id, complaint.status, "IN_PROGRESS", actor.id, "Repair completed, awaiting verification"));
  }
  await Promise.all(sideEffects);

  return updated;
}

export async function verifyRepair(assignment: RepairAssignmentRow, actor: AuthedProfile, note: string | null): Promise<RepairAssignmentRow> {
  if (assignment.status !== "COMPLETED") {
    throw new ConflictError("Only a job the crew has marked complete can be verified.", { status: assignment.status });
  }

  const client = serviceClient();
  const now = new Date().toISOString();

  // updateAssignment and the previous-status read touch different rows and
  // don't depend on each other, so they run concurrently. The complaints
  // UPDATE below must NOT join that pair, though - it would race the
  // previous-status SELECT (both hit the same row) and could read the
  // already-RESOLVED value instead of the true "before" status.
  const [updated, previousComplaint] = await Promise.all([
    updateAssignment(client, assignment.id, { status: "VERIFIED", verified_at: now, verified_by_id: actor.id }),
    getComplaintById(client, assignment.complaint_id),
  ]);
  const previousStatus = previousComplaint?.status as ComplaintStatus;

  const { data: complaint, error } = await client
    .from("complaints")
    .update({ status: "RESOLVED", resolved_at: now })
    .eq("id", assignment.complaint_id)
    .select()
    .single();
  if (error) throw error;

  // Independent writes/side effects, run concurrently - see changeStatus's
  // own comment on this pattern.
  await Promise.all([
    recordStatus(client, assignment.complaint_id, previousStatus, "RESOLVED", actor.id, note ?? "Repair verified"),
    recordAudit(client, {
      actor,
      action: "repair.verified",
      entityType: "repair_assignment",
      entityId: assignment.id,
      complaintId: assignment.complaint_id,
      oldValue: { status: previousStatus },
      newValue: { status: "RESOLVED" },
      note,
    }),
    notifications.complaintResolved(client, complaint),
  ]);

  return updated;
}

export async function confirmDuplicate(linkId: string, actor: AuthedProfile): Promise<{ canonical: ComplaintRow; duplicate: ComplaintRow }> {
  const client = serviceClient();
  const duplicates = new DuplicateService(client);
  const link = await duplicates.getLink(linkId);
  if (!link) throw new NotFoundError("That duplicate suggestion no longer exists.");

  const { canonical, duplicate } = await duplicates.confirm(linkId, actor.id);

  await Promise.all([
    recordStatus(client, duplicate.id, null, "DUPLICATE", actor.id, `Merged into ${canonical.complaint_number}`),
    recordAudit(client, {
      actor,
      action: "complaint.duplicate_confirmed",
      entityType: "complaint",
      entityId: duplicate.id,
      complaintId: canonical.id,
      newValue: { canonical: canonical.complaint_number, duplicate: duplicate.complaint_number, report_count: canonical.report_count },
    }),
  ]);

  return { canonical, duplicate };
}

export async function rejectDuplicate(linkId: string, actor: AuthedProfile): Promise<void> {
  const client = serviceClient();
  const duplicates = new DuplicateService(client);
  const link = await duplicates.getLink(linkId);
  if (!link) throw new NotFoundError("That duplicate suggestion no longer exists.");

  await duplicates.reject(linkId, actor.id);
  await recordAudit(client, {
    actor,
    action: "complaint.duplicate_rejected",
    entityType: "potential_duplicate",
    entityId: linkId,
    complaintId: link.complaint_id as string,
  });
}

export async function reassessComplaint(req: Request, complaintId: string): Promise<ComplaintRow> {
  const uClient = userClient(req);
  const sClient = serviceClient();

  const complaint = await getComplaintById(uClient, complaintId);
  if (!complaint) throw new Error("complaint not found");

  const { data: images } = await uClient
    .from("complaint_images")
    .select("id, storage_key, content_type, perceptual_hash")
    .eq("complaint_id", complaintId)
    .eq("kind", "REPORT")
    .limit(1);
  const image = images?.[0] ?? null;

  let imageBytes: Uint8Array | undefined;
  if (image) {
    const { data: blob, error: downloadErr } = await sClient.storage.from("complaint-photos").download(image.storage_key);
    if (!downloadErr && blob) imageBytes = new Uint8Array(await blob.arrayBuffer());
  }

  const roadImportance = await fetchRoadImportance(uClient, complaintId);
  await runAssessment(req, complaint, image, imageBytes, roadImportance);

  const full = await getComplaintFull(uClient, complaintId);
  if (!full) throw new Error("complaint vanished after re-assessment");
  return full;
}
