-- RoadWatch AI: initial schema, ported from backend/alembic/versions/35bee8be9862_initial_schema.py
--
-- Differences from the FastAPI/Alembic original, both deliberate:
--  * "users" is replaced by "profiles", which extends auth.users (id is the
--    same UUID Supabase Auth assigns) instead of owning its own password.
--    Every FK that pointed at users.id now points at profiles.id.
--  * Enums are plain text + CHECK constraints, matching the original's
--    native_enum=False choice (portable, no ALTER TYPE churn later).

create extension if not exists "pgcrypto"; -- gen_random_uuid()

create table public.repair_teams (
  id uuid primary key default gen_random_uuid(),
  name text not null unique,
  code text not null unique,
  contact_phone text,
  zone text,
  base_latitude double precision,
  base_longitude double precision,
  specialities text,
  max_concurrent_jobs integer not null default 5,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index ix_repair_teams_zone on public.repair_teams (zone);
create index ix_repair_teams_created_at on public.repair_teams (created_at);

create table public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  email text not null,
  full_name text not null,
  phone text,
  role text not null check (role in ('CITIZEN', 'ADMIN', 'REPAIR_TEAM')),
  is_active boolean not null default true,
  team_id uuid references public.repair_teams (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index ix_profiles_role on public.profiles (role);
create index ix_profiles_team_id on public.profiles (team_id);
create index ix_profiles_created_at on public.profiles (created_at);

create table public.seeded_places (
  id uuid primary key default gen_random_uuid(),
  place_type text not null check (place_type in ('HOSPITAL', 'SCHOOL', 'BUS_STOP', 'MAJOR_INTERSECTION', 'EMERGENCY_SERVICE')),
  name text not null,
  latitude double precision not null,
  longitude double precision not null,
  city text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index ix_seeded_places_city on public.seeded_places (city);
create index ix_seeded_places_place_type on public.seeded_places (place_type);
create index ix_seeded_places_lat_lon on public.seeded_places (latitude, longitude);
create index ix_seeded_places_created_at on public.seeded_places (created_at);

create table public.complaints (
  id uuid primary key default gen_random_uuid(),
  complaint_number text not null unique,
  reporter_id uuid references public.profiles (id) on delete set null,
  description text,
  reported_damage_type text check (reported_damage_type in ('POTHOLE', 'CRACKED_ROAD', 'FLOODING', 'DAMAGED_SIDEWALK', 'BROKEN_STREETLIGHT', 'OTHER', 'UNKNOWN')),
  damage_type text not null check (damage_type in ('POTHOLE', 'CRACKED_ROAD', 'FLOODING', 'DAMAGED_SIDEWALK', 'BROKEN_STREETLIGHT', 'OTHER', 'UNKNOWN')),
  road_name text,
  latitude double precision not null,
  longitude double precision not null,
  status text not null check (status in ('PENDING', 'AI_ANALYZED', 'PRIORITIZED', 'ASSIGNED', 'IN_PROGRESS', 'RESOLVED', 'REJECTED', 'DUPLICATE')),
  priority_score double precision not null default 0,
  priority_level text not null check (priority_level in ('LOW', 'MEDIUM', 'HIGH', 'CRITICAL')),
  severity_score double precision not null default 0,
  manual_priority_override double precision,
  report_count integer not null default 1,
  duplicate_of_id uuid references public.complaints (id) on delete set null,
  resolved_at timestamptz,
  rejection_reason text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index ix_complaints_created_at on public.complaints (created_at);
create index ix_complaints_damage_type on public.complaints (damage_type);
create index ix_complaints_duplicate_of_id on public.complaints (duplicate_of_id);
create index ix_complaints_lat_lon on public.complaints (latitude, longitude);
create index ix_complaints_priority_level on public.complaints (priority_level);
create index ix_complaints_priority_score on public.complaints (priority_score);
create index ix_complaints_reporter_id on public.complaints (reporter_id);
create index ix_complaints_status on public.complaints (status);
create index ix_complaints_status_priority on public.complaints (status, priority_score);
create index ix_complaints_type_created on public.complaints (damage_type, created_at);

create table public.audit_logs (
  id uuid primary key default gen_random_uuid(),
  actor_id uuid references public.profiles (id) on delete set null,
  actor_email text,
  action text not null,
  entity_type text not null,
  entity_id uuid,
  complaint_id uuid references public.complaints (id) on delete set null,
  old_value jsonb,
  new_value jsonb,
  note text,
  ip_address text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index ix_audit_logs_action on public.audit_logs (action);
create index ix_audit_logs_actor_id on public.audit_logs (actor_id);
create index ix_audit_logs_complaint_id on public.audit_logs (complaint_id);
create index ix_audit_logs_entity_id on public.audit_logs (entity_id);
create index ix_audit_logs_created_at on public.audit_logs (created_at);

create table public.complaint_images (
  id uuid primary key default gen_random_uuid(),
  complaint_id uuid not null references public.complaints (id) on delete cascade,
  storage_key text not null,
  url text not null,
  content_type text not null,
  size_bytes integer not null,
  width integer,
  height integer,
  kind text not null check (kind in ('REPORT', 'REPAIR_EVIDENCE')),
  perceptual_hash text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index ix_complaint_images_complaint_id on public.complaint_images (complaint_id);
create index ix_complaint_images_perceptual_hash on public.complaint_images (perceptual_hash);
create index ix_complaint_images_created_at on public.complaint_images (created_at);

create table public.complaint_status_history (
  id uuid primary key default gen_random_uuid(),
  complaint_id uuid not null references public.complaints (id) on delete cascade,
  from_status text check (from_status in ('PENDING', 'AI_ANALYZED', 'PRIORITIZED', 'ASSIGNED', 'IN_PROGRESS', 'RESOLVED', 'REJECTED', 'DUPLICATE')),
  to_status text not null check (to_status in ('PENDING', 'AI_ANALYZED', 'PRIORITIZED', 'ASSIGNED', 'IN_PROGRESS', 'RESOLVED', 'REJECTED', 'DUPLICATE')),
  changed_by_id uuid references public.profiles (id) on delete set null,
  note text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index ix_complaint_status_history_complaint_id on public.complaint_status_history (complaint_id);
create index ix_complaint_status_history_created_at on public.complaint_status_history (created_at);

create table public.locations (
  id uuid primary key default gen_random_uuid(),
  complaint_id uuid not null unique references public.complaints (id) on delete cascade,
  latitude double precision not null,
  longitude double precision not null,
  accuracy_meters double precision,
  address text,
  road_name text,
  ward text,
  city text,
  state text,
  postal_code text,
  road_importance double precision not null default 0,
  geocode_source text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index ix_locations_city on public.locations (city);
create index ix_locations_created_at on public.locations (created_at);

create table public.nearby_places (
  id uuid primary key default gen_random_uuid(),
  complaint_id uuid not null references public.complaints (id) on delete cascade,
  place_type text not null check (place_type in ('HOSPITAL', 'SCHOOL', 'BUS_STOP', 'MAJOR_INTERSECTION', 'EMERGENCY_SERVICE')),
  name text not null,
  distance_meters double precision not null,
  latitude double precision not null,
  longitude double precision not null,
  source text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index ix_nearby_places_complaint_id on public.nearby_places (complaint_id);
create index ix_nearby_places_place_type on public.nearby_places (place_type);
create index ix_nearby_places_created_at on public.nearby_places (created_at);

create table public.notifications (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles (id) on delete cascade,
  title text not null,
  body text not null,
  event text not null,
  channel text not null check (channel in ('IN_APP', 'EMAIL', 'SMS', 'PUSH')),
  complaint_id uuid references public.complaints (id) on delete cascade,
  link text,
  is_read boolean not null default false,
  read_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index ix_notifications_user_id on public.notifications (user_id);
create index ix_notifications_complaint_id on public.notifications (complaint_id);
create index ix_notifications_event on public.notifications (event);
create index ix_notifications_is_read on public.notifications (is_read);
create index ix_notifications_created_at on public.notifications (created_at);

create table public.potential_duplicates (
  id uuid primary key default gen_random_uuid(),
  complaint_id uuid not null references public.complaints (id) on delete cascade,
  duplicate_complaint_id uuid not null references public.complaints (id) on delete cascade,
  similarity_score double precision not null,
  distance_meters double precision not null,
  reason text not null,
  status text not null check (status in ('SUGGESTED', 'CONFIRMED', 'REJECTED')),
  reviewed_by_id uuid references public.profiles (id) on delete set null,
  reviewed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint uq_duplicate_pair unique (complaint_id, duplicate_complaint_id)
);
create index ix_potential_duplicates_complaint_id on public.potential_duplicates (complaint_id);
create index ix_potential_duplicates_duplicate_complaint_id on public.potential_duplicates (duplicate_complaint_id);
create index ix_potential_duplicates_status on public.potential_duplicates (status);
create index ix_potential_duplicates_created_at on public.potential_duplicates (created_at);

create table public.priority_assessments (
  id uuid primary key default gen_random_uuid(),
  complaint_id uuid not null references public.complaints (id) on delete cascade,
  severity_factor double precision not null,
  traffic_factor double precision not null,
  location_factor double precision not null,
  history_factor double precision not null,
  severity_points double precision not null,
  traffic_points double precision not null,
  location_points double precision not null,
  history_points double precision not null,
  total_score double precision not null,
  level text not null check (level in ('LOW', 'MEDIUM', 'HIGH', 'CRITICAL')),
  explanation text not null,
  weights jsonb not null,
  signals jsonb not null,
  weather_multiplier double precision not null default 1,
  engine_version text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index ix_priority_assessments_complaint_id on public.priority_assessments (complaint_id);
create index ix_priority_assessments_total_score on public.priority_assessments (total_score);
create index ix_priority_assessments_created_at on public.priority_assessments (created_at);

create table public.repair_assignments (
  id uuid primary key default gen_random_uuid(),
  complaint_id uuid not null references public.complaints (id) on delete cascade,
  team_id uuid not null references public.repair_teams (id) on delete cascade,
  assigned_by_id uuid references public.profiles (id) on delete set null,
  status text not null check (status in ('ASSIGNED', 'IN_PROGRESS', 'COMPLETED', 'VERIFIED', 'CANCELLED')),
  due_at timestamptz,
  started_at timestamptz,
  completed_at timestamptz,
  verified_at timestamptz,
  verified_by_id uuid references public.profiles (id) on delete set null,
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index ix_repair_assignments_complaint_id on public.repair_assignments (complaint_id);
create index ix_repair_assignments_team_id on public.repair_assignments (team_id);
create index ix_repair_assignments_status on public.repair_assignments (status);
create index ix_repair_assignments_due_at on public.repair_assignments (due_at);
create index ix_repair_assignments_created_at on public.repair_assignments (created_at);

create table public.traffic_snapshots (
  id uuid primary key default gen_random_uuid(),
  complaint_id uuid not null references public.complaints (id) on delete cascade,
  level text not null check (level in ('LOW', 'MEDIUM', 'HIGH', 'VERY_HIGH')),
  score double precision not null,
  estimated_vehicles_per_hour integer,
  observed_at timestamptz not null,
  provider text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index ix_traffic_snapshots_complaint_id on public.traffic_snapshots (complaint_id);
create index ix_traffic_snapshots_created_at on public.traffic_snapshots (created_at);

create table public.weather_snapshots (
  id uuid primary key default gen_random_uuid(),
  complaint_id uuid not null references public.complaints (id) on delete cascade,
  condition text not null,
  rainfall_mm_24h double precision not null default 0,
  temperature_c double precision,
  risk_multiplier double precision not null default 1,
  observed_at timestamptz not null,
  provider text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index ix_weather_snapshots_complaint_id on public.weather_snapshots (complaint_id);
create index ix_weather_snapshots_created_at on public.weather_snapshots (created_at);

create table public.ai_analyses (
  id uuid primary key default gen_random_uuid(),
  complaint_id uuid not null references public.complaints (id) on delete cascade,
  image_id uuid references public.complaint_images (id) on delete set null,
  damage_type text not null check (damage_type in ('POTHOLE', 'CRACKED_ROAD', 'FLOODING', 'DAMAGED_SIDEWALK', 'BROKEN_STREETLIGHT', 'OTHER', 'UNKNOWN')),
  confidence double precision not null,
  severity_score double precision not null,
  damaged_area_ratio double precision not null,
  detection_count integer not null default 0,
  is_confident boolean not null default false,
  model_name text not null,
  model_version text not null,
  provider text not null,
  processing_ms integer,
  severity_explanation text,
  error_message text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index ix_ai_analyses_complaint_id on public.ai_analyses (complaint_id);
create index ix_ai_analyses_created_at on public.ai_analyses (created_at);

create table public.repair_evidence (
  id uuid primary key default gen_random_uuid(),
  assignment_id uuid not null references public.repair_assignments (id) on delete cascade,
  submitted_by_id uuid references public.profiles (id) on delete set null,
  storage_key text not null,
  url text not null,
  content_type text not null,
  size_bytes integer not null,
  note text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index ix_repair_evidence_assignment_id on public.repair_evidence (assignment_id);
create index ix_repair_evidence_created_at on public.repair_evidence (created_at);

create table public.ai_detections (
  id uuid primary key default gen_random_uuid(),
  analysis_id uuid not null references public.ai_analyses (id) on delete cascade,
  damage_type text not null check (damage_type in ('POTHOLE', 'CRACKED_ROAD', 'FLOODING', 'DAMAGED_SIDEWALK', 'BROKEN_STREETLIGHT', 'OTHER', 'UNKNOWN')),
  confidence double precision not null,
  bbox_x double precision not null,
  bbox_y double precision not null,
  bbox_width double precision not null,
  bbox_height double precision not null,
  area_ratio double precision not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index ix_ai_detections_analysis_id on public.ai_detections (analysis_id);
create index ix_ai_detections_created_at on public.ai_detections (created_at);

-- Rate limiter replacing backend/app/core/rate_limit.py's in-memory counter
-- (stateless Edge Functions need a shared store; see the migration plan).
create table public.rate_limit_counters (
  bucket_key text primary key,
  window_start timestamptz not null default now(),
  hit_count integer not null default 0
);
create index ix_rate_limit_counters_window_start on public.rate_limit_counters (window_start);
