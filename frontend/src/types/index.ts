/**
 * Wire types mirroring the FastAPI schemas.
 *
 * Kept hand-written rather than generated so the frontend has one obvious
 * place to look; `docs/API.md` and the live OpenAPI schema at `/docs` are the
 * source of truth if these ever drift.
 */

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

export type PriorityLevel = "LOW" | "MEDIUM" | "HIGH" | "CRITICAL";

export type TrafficLevel = "LOW" | "MEDIUM" | "HIGH" | "VERY_HIGH";

export type PlaceType =
  | "HOSPITAL"
  | "SCHOOL"
  | "BUS_STOP"
  | "MAJOR_INTERSECTION"
  | "EMERGENCY_SERVICE";

export type AssignmentStatus =
  | "ASSIGNED"
  | "IN_PROGRESS"
  | "COMPLETED"
  | "VERIFIED"
  | "CANCELLED";

export interface User {
  id: string;
  email: string;
  full_name: string;
  phone: string | null;
  role: UserRole;
  is_active: boolean;
  team_id: string | null;
  created_at: string;
}

export interface AuthResponse {
  access_token: string;
  token_type: string;
  expires_in: number;
  user: User;
}

export interface Detection {
  id: string;
  damage_type: DamageType;
  confidence: number;
  bbox_x: number;
  bbox_y: number;
  bbox_width: number;
  bbox_height: number;
  area_ratio: number;
}

export interface AIAnalysis {
  id: string;
  damage_type: DamageType;
  confidence: number;
  severity_score: number;
  damaged_area_ratio: number;
  detection_count: number;
  is_confident: boolean;
  model_name: string;
  model_version: string;
  provider: string;
  processing_ms: number | null;
  severity_explanation: string | null;
  error_message: string | null;
  detections: Detection[];
  created_at: string;
}

export interface PriorityFactor {
  key: "severity" | "traffic" | "location" | "history";
  label: string;
  value: number;
  weight: number;
  points: number;
  max_points: number;
  note: string;
}

export interface PriorityAssessment {
  id: string;
  total_score: number;
  level: PriorityLevel;
  explanation: string;
  factors: PriorityFactor[];
  weights: Record<string, number>;
  signals: Record<string, unknown>;
  weather_multiplier: number;
  engine_version: string;
  created_at: string;
  disclaimer: string;
}

export interface ComplaintImage {
  id: string;
  url: string;
  content_type: string;
  width: number | null;
  height: number | null;
  kind: "REPORT" | "REPAIR_EVIDENCE";
  created_at: string;
}

export interface ComplaintLocation {
  latitude: number;
  longitude: number;
  accuracy_meters: number | null;
  address: string | null;
  road_name: string | null;
  city: string | null;
  road_importance: number;
}

export interface NearbyPlace {
  place_type: PlaceType;
  name: string;
  distance_meters: number;
  latitude: number;
  longitude: number;
}

export interface TrafficSnapshot {
  level: TrafficLevel;
  score: number;
  estimated_vehicles_per_hour: number | null;
  observed_at: string;
  provider: string;
}

export interface StatusHistoryEntry {
  id: string;
  from_status: ComplaintStatus | null;
  to_status: ComplaintStatus;
  note: string | null;
  created_at: string;
}

export interface AssignmentSummary {
  id: string;
  team_id: string;
  status: AssignmentStatus;
  due_at: string | null;
  started_at: string | null;
  completed_at: string | null;
  verified_at: string | null;
  notes: string | null;
  created_at: string;
  repair_details: RepairDetails | null;
  rework_count: number;
  rework_reason: string | null;
  is_emergency: boolean;
  emergency_reason: string | null;
  evidence: RepairEvidence[];
}

export interface ComplaintSummary {
  id: string;
  complaint_number: string;
  damage_type: DamageType;
  status: ComplaintStatus;
  priority_score: number;
  priority_level: PriorityLevel;
  severity_score: number;
  report_count: number;
  latitude: number;
  longitude: number;
  road_name: string | null;
  description: string | null;
  thumbnail_url: string | null;
  created_at: string;
  updated_at: string;
  /**
   * The status of this report's active repair, admin views only (the public
   * feed, a citizen's own reports, and a crew's task list all omit it - `undefined`
   * there, never a guess). `"COMPLETED"` is the one that means "your turn to
   * approve": see `AssignmentStatusBadge`.
   */
  assignment_status?: AssignmentStatus | null;
  /** Admin views only, alongside `assignment_status` - the active repair has passed its due date. */
  is_overdue?: boolean;
}

export interface ComplaintDetail extends ComplaintSummary {
  reported_damage_type: DamageType | null;
  resolved_at: string | null;
  rejection_reason: string | null;
  manual_priority_override: number | null;
  duplicate_of_id: string | null;
  location: ComplaintLocation | null;
  images: ComplaintImage[];
  latest_analysis: AIAnalysis | null;
  priority: PriorityAssessment | null;
  nearby_places: NearbyPlace[];
  traffic: TrafficSnapshot | null;
  status_history: StatusHistoryEntry[];
  assignment: AssignmentSummary | null;
  reporter: { id: string; full_name: string; email: string } | null;
}

export interface DuplicateCandidate {
  complaint_id: string;
  complaint_number: string;
  similarity: number;
  distance_meters: number;
  reason: string;
  status: ComplaintStatus;
  created_at: string;
}

export interface DuplicateLink {
  id: string;
  complaint_id: string;
  complaint_number: string;
  duplicate_complaint_id: string;
  duplicate_complaint_number: string;
  similarity_score: number;
  distance_meters: number;
  reason: string;
  status: "SUGGESTED" | "CONFIRMED" | "REJECTED";
  created_at: string;
}

export interface ComplaintCreateResponse {
  complaint: ComplaintDetail;
  needs_manual_review: boolean;
  ai_message: string | null;
  duplicate_candidates: DuplicateCandidate[];
  next_step: string;
}

export interface MapIssue {
  id: string;
  complaint_number: string;
  latitude: number;
  longitude: number;
  damage_type: DamageType;
  status: ComplaintStatus;
  priority_level: PriorityLevel;
  priority_score: number;
  severity_score: number;
  report_count: number;
  road_name: string | null;
  created_at: string;
}

export interface PageMeta {
  total: number;
  page: number;
  page_size: number;
  pages: number;
  has_next: boolean;
  has_previous: boolean;
}

export interface Paginated<T> {
  items: T[];
  meta: PageMeta;
}

export interface Kpis {
  total_reports: number;
  critical: number;
  high: number;
  in_progress: number;
  resolved: number;
  pending_review: number;
  unresolved: number;
  average_resolution_hours: number | null;
  resolution_rate: number;
  reports_last_7_days: number;
  reports_last_30_days: number;
  pending_duplicates: number;
  /** Repairs a crew has marked done that no admin has approved yet. */
  awaiting_verification: number;
  /** Reports whose active repair has passed its due date. */
  overdue: number;
}

export interface DashboardResponse {
  kpis: Kpis;
  priority_queue: ComplaintSummary[];
  recent_reports: ComplaintSummary[];
  status_distribution: { status: string; count: number }[];
  priority_distribution: { level: string; count: number }[];
}

export interface AnalyticsResponse {
  kpis: Kpis;
  reports_over_time: { date: string; reported: number; resolved: number; critical: number }[];
  by_damage_type: { damage_type: string; count: number }[];
  by_area: { area: string; count: number; average_priority: number }[];
  priority_distribution: { level: string; count: number }[];
  status_distribution: { status: string; count: number }[];
  top_roads: {
    road_name: string;
    count: number;
    average_priority: number;
    max_priority: number;
  }[];
  repeat_locations: {
    latitude: number;
    longitude: number;
    road_name: string | null;
    report_count: number;
    unresolved: number;
    max_priority: number;
    spread_meters: number;
  }[];
  team_performance: {
    team_id: string;
    team_name: string;
    zone: string | null;
    total_assigned: number;
    completed: number;
    open_jobs: number;
    capacity: number;
    average_completion_hours: number | null;
    on_time_rate: number | null;
    rework_rate: number | null;
  }[];
  resolution_by_priority: {
    level: string;
    resolved_count: number;
    average_hours: number | null;
  }[];
}

export interface RepairTeam {
  id: string;
  name: string;
  code: string;
  zone: string | null;
  contact_phone: string | null;
  specialities: string | null;
  max_concurrent_jobs: number;
  is_active: boolean;
  base_latitude: number | null;
  base_longitude: number | null;
  created_at: string;
}

export interface RepairTeamWithLoad extends RepairTeam {
  open_jobs: number;
  completed_jobs: number;
  members: { id: string; full_name: string; email: string }[];
}

export interface RepairEvidence {
  id: string;
  url: string;
  content_type: string;
  note: string | null;
  created_at: string;
}

export interface RepairDetails {
  repair_type: string | null;
  materials: string | null;
  quantity: string | null;
  equipment: string | null;
  workers_count: number | null;
  cost_amount: number | null;
}

export interface Task {
  id: string;
  status: AssignmentStatus;
  due_at: string | null;
  started_at: string | null;
  completed_at: string | null;
  verified_at: string | null;
  notes: string | null;
  created_at: string;
  /**
   * `ComplaintDetail` on `GET /team/tasks/:id` (the AI priority explanation,
   * traffic, nearby places - see `toTaskDetail`), the leaner `ComplaintSummary`
   * shape everywhere else (dashboard cards, the job list). `ComplaintDetail`
   * extends `ComplaintSummary`, so every field this type declares is safe to
   * read regardless of which endpoint produced it; only the richer ones may
   * be absent outside the single-job view.
   */
  complaint: ComplaintSummary | ComplaintDetail;
  evidence: RepairEvidence[];
  is_overdue: boolean;
  repair_details: RepairDetails | null;
  rework_count: number;
  rework_reason: string | null;
  reworked_at: string | null;
  flag_reason: string | null;
  flagged_at: string | null;
  is_emergency: boolean;
  emergency_reason: string | null;
  escalated_at: string | null;
}

export interface TeamDashboard {
  team: RepairTeam;
  today: Task[];
  critical: Task[];
  in_progress: Task[];
  completed_recently: Task[];
  stats: {
    open_jobs: number;
    critical_open: number;
    emergency_open: number;
    in_progress: number;
    overdue: number;
    completed_total: number;
    capacity: number;
    average_completion_hours: number | null;
    completion_rate: number | null;
  };
}

export interface Notification {
  id: string;
  title: string;
  body: string;
  event: string;
  link: string | null;
  complaint_id: string | null;
  is_read: boolean;
  created_at: string;
}

export interface NotificationList {
  items: Notification[];
  unread_count: number;
}

export interface AuditEntry {
  id: string;
  actor_email: string | null;
  action: string;
  entity_type: string;
  entity_id: string | null;
  complaint_id: string | null;
  old_value: Record<string, unknown> | null;
  new_value: Record<string, unknown> | null;
  note: string | null;
  created_at: string;
}

export interface SystemSettings {
  priority_weights: Record<string, number>;
  priority_thresholds: Record<string, number>;
  /** Target hours to resolve a job, by priority level - what "overdue" is measured against. */
  sla_hours: Record<string, number>;
  nearby_radius_meters: number;
  duplicate_radius_meters: number;
  duplicate_window_days: number;
  history_radius_meters: number;
  ai_provider: string;
  ai_min_confidence: number;
  traffic_provider: string;
  places_provider: string;
  storage_provider: string;
  weather_enabled: boolean;
  weather_provider: string;
  max_upload_mb: number;
  engine_version: string;
}

/** The shape every plain-confirmation endpoint returns. */
export interface MessageResponse {
  message: string;
  detail?: string | null;
}

export interface ApiErrorBody {
  error: {
    code: string;
    message: string;
    details?: Record<string, unknown>;
  };
}
