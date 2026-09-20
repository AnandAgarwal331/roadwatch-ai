// Ported from backend/app/core/enums.py. Kept as plain string union types
// (not TS enums) since every DB column stores these as plain text/VARCHAR.

export type UserRole = "CITIZEN" | "ADMIN" | "REPAIR_TEAM";

export type DamageType =
  | "POTHOLE"
  | "CRACKED_ROAD"
  | "FLOODING"
  | "DAMAGED_SIDEWALK"
  | "BROKEN_STREETLIGHT"
  | "OTHER"
  | "UNKNOWN";

export type ComplaintStatus =
  | "PENDING"
  | "AI_ANALYZED"
  | "PRIORITIZED"
  | "ASSIGNED"
  | "IN_PROGRESS"
  | "RESOLVED"
  | "REJECTED"
  | "DUPLICATE";

// Allowed status transitions, enforced wherever a status change happens
// (the create_complaint/admin RPCs), so the lifecycle can't be
// short-circuited the same way ComplaintService guarded it in Python.
export const STATUS_TRANSITIONS: Record<ComplaintStatus, ComplaintStatus[]> = {
  PENDING: ["AI_ANALYZED", "PRIORITIZED", "REJECTED", "DUPLICATE"],
  AI_ANALYZED: ["PRIORITIZED", "REJECTED", "DUPLICATE"],
  PRIORITIZED: ["ASSIGNED", "REJECTED", "DUPLICATE"],
  ASSIGNED: ["IN_PROGRESS", "PRIORITIZED", "REJECTED", "DUPLICATE"],
  IN_PROGRESS: ["RESOLVED", "ASSIGNED", "REJECTED"],
  RESOLVED: ["IN_PROGRESS"],
  REJECTED: ["PENDING", "PRIORITIZED"],
  DUPLICATE: ["PENDING", "PRIORITIZED"],
};

export const CLOSED_STATUSES: ComplaintStatus[] = ["RESOLVED", "REJECTED", "DUPLICATE"];

export type PriorityLevel = "LOW" | "MEDIUM" | "HIGH" | "CRITICAL";

export type TrafficLevel = "LOW" | "MEDIUM" | "HIGH" | "VERY_HIGH";

export type PlaceType = "HOSPITAL" | "SCHOOL" | "BUS_STOP" | "MAJOR_INTERSECTION" | "EMERGENCY_SERVICE";

export type AssignmentStatus = "ASSIGNED" | "IN_PROGRESS" | "COMPLETED" | "VERIFIED" | "CANCELLED";

export type DuplicateStatus = "SUGGESTED" | "CONFIRMED" | "REJECTED";

export type NotificationChannel = "IN_APP" | "EMAIL" | "SMS" | "PUSH";

export type ImageKind = "REPORT" | "REPAIR_EVIDENCE";
