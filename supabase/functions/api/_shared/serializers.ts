// Ported from backend/app/api/serializers.py. Builds the same wire-format
// JSON (snake_case field names) the FastAPI Pydantic response models
// produced, so the frontend's existing types keep working unchanged after
// cutover. Works on the raw rows PostgREST returns from
// repositories/complaint.ts's list()/getFull() (nested nulls-instead-of-
// undefined arrays), not on Python ORM objects.

import type { ComplaintRow } from "../repositories/complaint.ts";
import type { DuplicateCandidate } from "../services/duplicates.ts";
import type { PriorityLevel } from "./enums.ts";

// deno-lint-ignore no-explicit-any
function byCreatedAtAsc(rows: any[] | null | undefined): any[] {
  return [...(rows ?? [])].sort(
    (a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime(),
  );
}

function thumbnailUrl(images: { kind: string; url: string }[] | null | undefined): string | null {
  const list = images ?? [];
  const report = list.find((img) => img.kind === "REPORT");
  if (report) return report.url;
  return list.length > 0 ? list[0].url : null;
}

// deno-lint-ignore no-explicit-any
export function toSummary(complaint: any): Record<string, unknown> {
  return {
    id: complaint.id,
    complaint_number: complaint.complaint_number,
    damage_type: complaint.damage_type,
    status: complaint.status,
    priority_score: complaint.priority_score,
    priority_level: complaint.priority_level,
    severity_score: complaint.severity_score,
    report_count: complaint.report_count,
    latitude: complaint.latitude,
    longitude: complaint.longitude,
    road_name: complaint.road_name,
    description: complaint.description,
    thumbnail_url: thumbnailUrl(complaint.images),
    created_at: complaint.created_at,
    updated_at: complaint.updated_at,
  };
}

const FACTOR_LABELS: Record<string, string> = {
  severity: "Visual severity",
  traffic: "Traffic",
  location: "Location risk",
  history: "Complaint history",
};
const DEFAULT_WEIGHTS: Record<string, number> = { severity: 4.0, traffic: 2.5, location: 2.0, history: 1.5 };

// deno-lint-ignore no-explicit-any
function noteFor(assessment: any, key: string): string {
  const notes = assessment.signals?.notes;
  if (notes && typeof notes === "object" && key in notes) return String(notes[key]);
  return "";
}

// deno-lint-ignore no-explicit-any
export function toPriorityResponse(complaint: any): Record<string, unknown> | null {
  const assessments = byCreatedAtAsc(complaint.assessments);
  const assessment = assessments[assessments.length - 1];
  if (!assessment) return null;

  const weights = assessment.weights ?? {};
  const factors = (["severity", "traffic", "location", "history"] as const).map((key) => {
    const weight = Number(weights[key] ?? DEFAULT_WEIGHTS[key]);
    return {
      key,
      label: FACTOR_LABELS[key],
      value: assessment[`${key}_factor`],
      weight,
      points: assessment[`${key}_points`],
      max_points: Math.round(weight * 10 * 100) / 100,
      note: noteFor(assessment, key),
    };
  });

  return {
    id: assessment.id,
    total_score: assessment.total_score,
    level: assessment.level as PriorityLevel,
    explanation: assessment.explanation,
    factors,
    weights,
    signals: assessment.signals ?? {},
    weather_multiplier: assessment.weather_multiplier,
    engine_version: assessment.engine_version,
    created_at: assessment.created_at,
    disclaimer:
      "AI-assisted priority recommendation. Final repair priority should be reviewed by authorized personnel.",
  };
}

const OPEN_ASSIGNMENT_STATUSES = new Set(["ASSIGNED", "IN_PROGRESS", "COMPLETED"]);

// deno-lint-ignore no-explicit-any
function activeAssignment(assignments: any[] | null | undefined): Record<string, unknown> | null {
  const ordered = byCreatedAtAsc(assignments ?? []);
  for (let i = ordered.length - 1; i >= 0; i--) {
    if (OPEN_ASSIGNMENT_STATUSES.has(ordered[i].status)) return ordered[i];
  }
  return null;
}

export interface ToDetailOptions {
  includeReporter?: boolean;
}

// deno-lint-ignore no-explicit-any
export function toDetail(complaint: any, opts: ToDetailOptions = {}): Record<string, unknown> {
  const analyses = byCreatedAtAsc(complaint.analyses);
  const latestAnalysis = analyses[analyses.length - 1] ?? null;
  const trafficSnapshots = byCreatedAtAsc(complaint.traffic_snapshots);
  const traffic = trafficSnapshots[trafficSnapshots.length - 1] ?? null;
  const assignment = activeAssignment(complaint.assignments);
  const nearbyPlaces = [...(complaint.nearby_places ?? [])].sort(
    (a, b) => a.distance_meters - b.distance_meters,
  );

  return {
    ...toSummary(complaint),
    reported_damage_type: complaint.reported_damage_type ?? null,
    resolved_at: complaint.resolved_at ?? null,
    rejection_reason: complaint.rejection_reason ?? null,
    manual_priority_override: complaint.manual_priority_override ?? null,
    duplicate_of_id: complaint.duplicate_of_id ?? null,
    location: complaint.location ?? null,
    images: complaint.images ?? [],
    latest_analysis: latestAnalysis,
    priority: toPriorityResponse(complaint),
    nearby_places: nearbyPlaces,
    traffic,
    status_history: byCreatedAtAsc(complaint.status_history),
    assignment,
    reporter: opts.includeReporter && complaint.reporter ? complaint.reporter : null,
  };
}

// deno-lint-ignore no-explicit-any
export function toMapIssue(complaint: any): Record<string, unknown> {
  return {
    id: complaint.id,
    complaint_number: complaint.complaint_number,
    latitude: complaint.latitude,
    longitude: complaint.longitude,
    damage_type: complaint.damage_type,
    status: complaint.status,
    priority_level: complaint.priority_level,
    priority_score: complaint.priority_score,
    severity_score: complaint.severity_score,
    report_count: complaint.report_count,
    road_name: complaint.road_name,
    created_at: complaint.created_at,
  };
}

// deno-lint-ignore no-explicit-any
export function toDuplicateLink(link: any): Record<string, unknown> {
  return {
    id: link.id,
    complaint_id: link.complaint_id,
    complaint_number: link.complaint?.complaint_number ?? "",
    duplicate_complaint_id: link.duplicate_complaint_id,
    duplicate_complaint_number: link.duplicate_complaint?.complaint_number ?? "",
    similarity_score: link.similarity_score,
    distance_meters: link.distance_meters,
    reason: link.reason,
    status: link.status,
    created_at: link.created_at,
  };
}

const OPEN_TASK_STATUSES = new Set(["ASSIGNED", "IN_PROGRESS"]);

// deno-lint-ignore no-explicit-any
export function toTask(assignment: any): Record<string, unknown> {
  const due = assignment.due_at ? new Date(assignment.due_at) : null;
  const overdue = Boolean(due && due.getTime() < Date.now() && OPEN_TASK_STATUSES.has(assignment.status));

  return {
    id: assignment.id,
    status: assignment.status,
    due_at: assignment.due_at ?? null,
    started_at: assignment.started_at ?? null,
    completed_at: assignment.completed_at ?? null,
    verified_at: assignment.verified_at ?? null,
    notes: assignment.notes ?? null,
    created_at: assignment.created_at,
    complaint: toSummary(assignment.complaint),
    evidence: assignment.evidence ?? [],
    is_overdue: overdue,
  };
}

export function toDuplicateCandidate(candidate: DuplicateCandidate): Record<string, unknown> {
  return {
    complaint_id: candidate.complaint.id,
    complaint_number: candidate.complaint.complaint_number,
    similarity: candidate.similarity,
    distance_meters: candidate.distanceMeters,
    reason: candidate.reason,
    status: candidate.complaint.status,
    created_at: candidate.complaint.created_at,
  };
}

/**
 * The `{ items, meta }` envelope the frontend's `Paginated<T>` type expects
 * (ported from FastAPI's `PageMeta` response model) - `meta.pages`, not
 * `total_pages`, and `has_next`/`has_previous` alongside it.
 */
export function paginated<T>(
  items: T[],
  total: number,
  page: number,
  pageSize: number,
): { items: T[]; meta: Record<string, unknown> } {
  const pages = Math.max(1, Math.ceil(total / pageSize));
  return {
    items,
    meta: {
      total,
      page,
      page_size: pageSize,
      pages,
      has_next: page < pages,
      has_previous: page > 1,
    },
  };
}

// deno-lint-ignore no-explicit-any
export function nextStep(complaint: any, needsManualReview: boolean): string {
  if (needsManualReview) {
    return (
      "A municipal reviewer will confirm the damage type manually. You can track progress " +
      "from My Reports."
    );
  }
  if (complaint.priority_level === "CRITICAL") {
    return (
      "This report is queued as critical and will be reviewed by the works department as a " +
      "priority. You will be notified when a repair team is assigned."
    );
  }
  return "Your report is in the prioritisation queue. You will be notified when a repair team is assigned.";
}
