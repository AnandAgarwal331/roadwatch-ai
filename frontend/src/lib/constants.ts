/**
 * Domain vocabulary shared by every surface.
 *
 * Labels, colours and icons for statuses, priorities and damage types live
 * here so the queue, the map, the charts and the citizen views cannot drift
 * apart.
 */

import type {
  AssignmentStatus,
  ComplaintStatus,
  DamageType,
  PlaceType,
  PriorityLevel,
  TrafficLevel,
} from "@/types";

export const DAMAGE_TYPE_LABELS: Record<DamageType, string> = {
  POTHOLE: "Pothole",
  CRACKED_ROAD: "Cracked road",
  FLOODING: "Flooding",
  DAMAGED_SIDEWALK: "Damaged sidewalk",
  BROKEN_STREETLIGHT: "Broken streetlight",
  OTHER: "Other hazard",
  UNKNOWN: "Unclassified",
};

/** Damage types a citizen can pick from, in the order shown. */
export const REPORTABLE_DAMAGE_TYPES: DamageType[] = [
  "POTHOLE",
  "CRACKED_ROAD",
  "FLOODING",
  "DAMAGED_SIDEWALK",
  "BROKEN_STREETLIGHT",
  "OTHER",
];

export const STATUS_LABELS: Record<ComplaintStatus, string> = {
  PENDING: "Pending",
  AI_ANALYZED: "AI analysed",
  PRIORITIZED: "Prioritised",
  ASSIGNED: "Assigned",
  IN_PROGRESS: "In progress",
  RESOLVED: "Resolved",
  REJECTED: "Rejected",
  DUPLICATE: "Duplicate",
};

/** Tailwind classes per status badge. */
export const STATUS_STYLES: Record<ComplaintStatus, string> = {
  PENDING: "bg-muted text-muted-foreground border-border",
  AI_ANALYZED: "bg-sky-50 text-sky-700 border-sky-200 dark:bg-sky-950/50 dark:text-sky-300 dark:border-sky-900",
  PRIORITIZED:
    "bg-indigo-50 text-indigo-700 border-indigo-200 dark:bg-indigo-950/50 dark:text-indigo-300 dark:border-indigo-900",
  ASSIGNED:
    "bg-violet-50 text-violet-700 border-violet-200 dark:bg-violet-950/50 dark:text-violet-300 dark:border-violet-900",
  IN_PROGRESS:
    "bg-amber-50 text-amber-700 border-amber-200 dark:bg-amber-950/50 dark:text-amber-300 dark:border-amber-900",
  RESOLVED:
    "bg-emerald-50 text-emerald-700 border-emerald-200 dark:bg-emerald-950/50 dark:text-emerald-300 dark:border-emerald-900",
  REJECTED: "bg-muted text-muted-foreground border-border line-through decoration-1",
  DUPLICATE:
    "bg-slate-100 text-slate-600 border-slate-200 dark:bg-slate-900 dark:text-slate-400 dark:border-slate-800",
};

/** The lifecycle in order, for the timeline. */
export const STATUS_FLOW: ComplaintStatus[] = [
  "PENDING",
  "AI_ANALYZED",
  "PRIORITIZED",
  "ASSIGNED",
  "IN_PROGRESS",
  "RESOLVED",
];

export const PRIORITY_LABELS: Record<PriorityLevel, string> = {
  LOW: "Low",
  MEDIUM: "Medium",
  HIGH: "High",
  CRITICAL: "Critical",
};

export const PRIORITY_STYLES: Record<PriorityLevel, string> = {
  CRITICAL: "bg-priority-critical/10 text-priority-critical border-priority-critical/30",
  HIGH: "bg-priority-high/10 text-priority-high border-priority-high/30",
  MEDIUM: "bg-priority-medium/10 text-priority-medium border-priority-medium/30",
  LOW: "bg-priority-low/10 text-priority-low border-priority-low/30",
};

/**
 * Solid fills for map markers and priority chips.
 *
 * This is a *status* palette, not a categorical one: four reserved states that
 * always ship beside a written label (see `PriorityBadge` and the map legend),
 * never colour alone. The steps were checked against the light chart surface -
 * all four clear 3:1 - and MEDIUM was darkened away from HIGH, which in the
 * previous amber pairing were only 10.1 apart and read as the same colour.
 *
 * For charts that encode priority as a *magnitude*, use `PRIORITY_RAMP`
 * instead: an ordinal scale wants one hue with monotone lightness, not four
 * competing hues.
 */
export const PRIORITY_HEX: Record<PriorityLevel, string> = {
  CRITICAL: "#c1121f",
  HIGH: "#e2680e",
  MEDIUM: "#9a6f08",
  LOW: "#1c7e9c",
};

/**
 * Ordinal severity ramp for charts - one hue, LOW (lightest) to CRITICAL
 * (darkest), so the bars read as a scale rather than as four categories.
 * Both modes are stepped separately rather than flipped, and each was checked
 * for monotone lightness, a >= 0.06 gap between steps and a pale end that still
 * clears its own surface.
 */
export const PRIORITY_RAMP: Record<PriorityLevel, string> = {
  LOW: "#f0a08c",
  MEDIUM: "#e06a4a",
  HIGH: "#c3341c",
  CRITICAL: "#8a1c0c",
};

export const PRIORITY_RAMP_DARK: Record<PriorityLevel, string> = {
  LOW: "#9c4430",
  MEDIUM: "#c26244",
  HIGH: "#e0855f",
  CRITICAL: "#f5ad8e",
};

export const PRIORITY_ORDER: PriorityLevel[] = ["CRITICAL", "HIGH", "MEDIUM", "LOW"];

export const TRAFFIC_LABELS: Record<TrafficLevel, string> = {
  LOW: "Low",
  MEDIUM: "Medium",
  HIGH: "High",
  VERY_HIGH: "Very high",
};

export const PLACE_TYPE_LABELS: Record<PlaceType, string> = {
  HOSPITAL: "Hospital",
  SCHOOL: "School",
  BUS_STOP: "Bus stop",
  MAJOR_INTERSECTION: "Major intersection",
  EMERGENCY_SERVICE: "Emergency service",
};

/**
 * Categorical series colours - assigned in this fixed order, never cycled.
 *
 * Three slots, deliberately. Blue/vermillion/green is the Okabe-Ito core, and
 * it is the largest set that stays separable here for every kind of colour
 * vision when any series may sit beside any other: all pairs clear the CVD
 * threshold and the normal-vision floor in both modes. A fourth measure does
 * not get an invented hue - it becomes a second chart, a small multiple, or
 * folds into `CHART_OTHER`.
 *
 * Dark mode is stepped, not flipped: only the blue moves, to hold its
 * lightness inside the darker band and keep 3:1 against the dark surface.
 */
export const CHART_COLORS = ["#0072b2", "#d55e00", "#009e73"] as const;
export const CHART_COLORS_DARK = ["#1a83c4", "#d55e00", "#009e73"] as const;

/** The residual bucket. Grey reads as "everything else", not as a category. */
export const CHART_OTHER = "#8b93a1";

/** Single hue for magnitude bars, where the category is already on the axis. */
export const CHART_SEQUENTIAL = "#0072b2";
export const CHART_SEQUENTIAL_DARK = "#1a83c4";

/** The disclaimer shown wherever a score appears. Worded once, used everywhere. */
export const PRIORITY_DISCLAIMER =
  "AI-assisted priority recommendation. Final repair priority should be reviewed by authorized personnel.";

export const SEVERITY_DISCLAIMER =
  "Visual severity is estimated from the photograph by AI. It is not an engineering inspection and does not measure physical depth.";

/** Map default: central Bengaluru, matching the seeded sample data. */
export const DEFAULT_MAP_CENTER: [number, number] = [12.9538, 77.6309];
export const DEFAULT_MAP_ZOOM = 12;

export const MAX_UPLOAD_MB = 10;
export const ACCEPTED_IMAGE_TYPES = ["image/jpeg", "image/png", "image/webp"];

export const ASSIGNMENT_STATUS_LABELS: Record<AssignmentStatus, string> = {
  ASSIGNED: "Assigned",
  IN_PROGRESS: "In progress",
  COMPLETED: "Awaiting verification",
  VERIFIED: "Verified",
  CANCELLED: "Cancelled",
};

export const ASSIGNMENT_STATUS_STYLES: Record<AssignmentStatus, string> = {
  ASSIGNED:
    "bg-violet-50 text-violet-700 border-violet-200 dark:bg-violet-950/50 dark:text-violet-300 dark:border-violet-900",
  IN_PROGRESS:
    "bg-amber-50 text-amber-700 border-amber-200 dark:bg-amber-950/50 dark:text-amber-300 dark:border-amber-900",
  COMPLETED:
    "bg-sky-50 text-sky-700 border-sky-200 dark:bg-sky-950/50 dark:text-sky-300 dark:border-sky-900",
  VERIFIED:
    "bg-emerald-50 text-emerald-700 border-emerald-200 dark:bg-emerald-950/50 dark:text-emerald-300 dark:border-emerald-900",
  CANCELLED: "bg-muted text-muted-foreground border-border line-through decoration-1",
};

/** Audit actions rendered as sentences, so the trail reads without decoding. */
export const AUDIT_ACTION_LABELS: Record<string, string> = {
  "complaint.created": "Report submitted",
  "complaint.status_changed": "Status changed",
  "complaint.rejected": "Report rejected",
  "complaint.priority_overridden": "Priority overridden",
  "complaint.reassessed": "Assessment re-run",
  "complaint.assigned": "Assigned to a crew",
  "repair.started": "Repair started",
  "repair.completed": "Repair completed",
  "repair.verified": "Repair verified",
  "duplicate.confirmed": "Merged as duplicate",
  "duplicate.rejected": "Marked as separate",
  "team.created": "Team created",
  "team.updated": "Team updated",
};
