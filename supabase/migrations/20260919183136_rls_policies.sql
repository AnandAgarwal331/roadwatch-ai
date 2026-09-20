-- Row Level Security for every table. Edge Functions authenticate as the
-- calling user (publishable/anon key + their JWT via PostgREST/postgrest-js),
-- so RLS -- not a privileged bypass connection -- is the real authorization
-- boundary. Anything too complex for a row-level policy (creating a
-- complaint, completing a repair, admin status transitions) goes through a
-- `security definer` RPC function instead of a raw table write; those are
-- added in later migrations as each flow gets ported.

-- Helper functions, security definer so they can read profiles without
-- recursing into profiles' own RLS.
create function public.current_role() returns text
  language sql security definer stable set search_path = public as $$
    select role from profiles where id = auth.uid()
  $$;

create function public.current_team_id() returns uuid
  language sql security definer stable set search_path = public as $$
    select team_id from profiles where id = auth.uid()
  $$;

create function public.is_admin() returns boolean
  language sql security definer stable set search_path = public as $$
    select coalesce(public.current_role() = 'ADMIN', false)
  $$;

-- Auto-create a profile row when Supabase Auth creates a new user (covers
-- future signups; migrated existing users get their profile row written
-- directly by the one-time migration script alongside the auth.users insert).
create function public.handle_new_user() returns trigger
  language plpgsql security definer set search_path = public as $$
  begin
    insert into public.profiles (id, email, full_name, role)
    values (new.id, new.email, coalesce(new.raw_user_meta_data->>'full_name', ''), 'CITIZEN');
    return new;
  end;
  $$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- profiles ------------------------------------------------------------
alter table public.profiles enable row level security;

create policy "profiles_select_own_or_admin" on public.profiles
  for select using (id = auth.uid() or public.is_admin());

create policy "profiles_update_admin" on public.profiles
  for update using (public.is_admin());
-- Self-service edits to name/phone go through a security-definer RPC
-- (added when /me PATCH is ported) rather than a raw UPDATE policy, so role
-- and team_id can't be self-granted.

-- repair_teams ----------------------------------------------------------
alter table public.repair_teams enable row level security;

create policy "repair_teams_select_staff" on public.repair_teams
  for select using (
    public.is_admin()
    or (public.current_role() = 'REPAIR_TEAM' and id = public.current_team_id())
  );

create policy "repair_teams_write_admin" on public.repair_teams
  for all using (public.is_admin()) with check (public.is_admin());

-- seeded_places -----------------------------------------------------------
alter table public.seeded_places enable row level security;

create policy "seeded_places_select_all" on public.seeded_places
  for select using (true);
-- No client writes; populated by the seed/migration script only.

-- complaints --------------------------------------------------------------
alter table public.complaints enable row level security;

create policy "complaints_select_visible" on public.complaints
  for select using (
    status not in ('REJECTED', 'DUPLICATE')
    or reporter_id = auth.uid()
    or public.is_admin()
    or public.current_role() = 'REPAIR_TEAM'
  );

create policy "complaints_insert_own" on public.complaints
  for insert with check (reporter_id = auth.uid());
-- The real creation path is the create_complaint() RPC (runs the AI/priority
-- pipeline atomically); this policy is a defense-in-depth fallback.

create policy "complaints_update_admin" on public.complaints
  for update using (public.is_admin());
-- Status-machine-guarded transitions are enforced in RPCs, not here.

-- complaint_images ----------------------------------------------------------
alter table public.complaint_images enable row level security;

create policy "complaint_images_select_visible" on public.complaint_images
  for select using (
    exists (
      select 1 from public.complaints c
      where c.id = complaint_images.complaint_id
        and (c.status not in ('REJECTED', 'DUPLICATE') or c.reporter_id = auth.uid() or public.is_admin() or public.current_role() = 'REPAIR_TEAM')
    )
  );

create policy "complaint_images_insert_own" on public.complaint_images
  for insert with check (
    exists (select 1 from public.complaints c where c.id = complaint_images.complaint_id and c.reporter_id = auth.uid())
  );

-- complaint_status_history --------------------------------------------------
alter table public.complaint_status_history enable row level security;

create policy "complaint_status_history_select_visible" on public.complaint_status_history
  for select using (
    exists (
      select 1 from public.complaints c
      where c.id = complaint_status_history.complaint_id
        and (c.reporter_id = auth.uid() or public.is_admin() or public.current_role() = 'REPAIR_TEAM')
    )
  );
-- Inserts only via RPC (status-change functions), no client policy.

-- locations / nearby_places / traffic_snapshots / weather_snapshots --------
-- All four are analysis support data with the same visibility as their
-- parent complaint, and are only ever written by the assessment pipeline RPC.
alter table public.locations enable row level security;
create policy "locations_select_visible" on public.locations
  for select using (
    exists (select 1 from public.complaints c where c.id = locations.complaint_id
      and (c.status not in ('REJECTED', 'DUPLICATE') or c.reporter_id = auth.uid() or public.is_admin() or public.current_role() = 'REPAIR_TEAM'))
  );

alter table public.nearby_places enable row level security;
create policy "nearby_places_select_visible" on public.nearby_places
  for select using (
    exists (select 1 from public.complaints c where c.id = nearby_places.complaint_id
      and (c.status not in ('REJECTED', 'DUPLICATE') or c.reporter_id = auth.uid() or public.is_admin() or public.current_role() = 'REPAIR_TEAM'))
  );

alter table public.traffic_snapshots enable row level security;
create policy "traffic_snapshots_select_visible" on public.traffic_snapshots
  for select using (
    exists (select 1 from public.complaints c where c.id = traffic_snapshots.complaint_id
      and (c.status not in ('REJECTED', 'DUPLICATE') or c.reporter_id = auth.uid() or public.is_admin() or public.current_role() = 'REPAIR_TEAM'))
  );

alter table public.weather_snapshots enable row level security;
create policy "weather_snapshots_select_visible" on public.weather_snapshots
  for select using (
    exists (select 1 from public.complaints c where c.id = weather_snapshots.complaint_id
      and (c.status not in ('REJECTED', 'DUPLICATE') or c.reporter_id = auth.uid() or public.is_admin() or public.current_role() = 'REPAIR_TEAM'))
  );

-- ai_analyses / ai_detections ------------------------------------------------
alter table public.ai_analyses enable row level security;
create policy "ai_analyses_select_visible" on public.ai_analyses
  for select using (
    exists (select 1 from public.complaints c where c.id = ai_analyses.complaint_id
      and (c.reporter_id = auth.uid() or public.is_admin() or public.current_role() = 'REPAIR_TEAM'))
  );

alter table public.ai_detections enable row level security;
create policy "ai_detections_select_visible" on public.ai_detections
  for select using (
    exists (
      select 1 from public.ai_analyses a
      join public.complaints c on c.id = a.complaint_id
      where a.id = ai_detections.analysis_id
        and (c.reporter_id = auth.uid() or public.is_admin() or public.current_role() = 'REPAIR_TEAM')
    )
  );

-- priority_assessments --------------------------------------------------------
alter table public.priority_assessments enable row level security;
create policy "priority_assessments_select_visible" on public.priority_assessments
  for select using (
    exists (select 1 from public.complaints c where c.id = priority_assessments.complaint_id
      and (c.reporter_id = auth.uid() or public.is_admin() or public.current_role() = 'REPAIR_TEAM'))
  );

-- potential_duplicates (admin duplicate-review feature only) ------------------
alter table public.potential_duplicates enable row level security;
create policy "potential_duplicates_admin_only" on public.potential_duplicates
  for all using (public.is_admin()) with check (public.is_admin());

-- repair_assignments ------------------------------------------------------------
alter table public.repair_assignments enable row level security;

create policy "repair_assignments_select_scoped" on public.repair_assignments
  for select using (
    public.is_admin()
    or (public.current_role() = 'REPAIR_TEAM' and team_id = public.current_team_id())
  );

create policy "repair_assignments_write_admin" on public.repair_assignments
  for insert with check (public.is_admin());

create policy "repair_assignments_update_scoped" on public.repair_assignments
  for update using (
    public.is_admin()
    or (public.current_role() = 'REPAIR_TEAM' and team_id = public.current_team_id())
  );

-- repair_evidence ----------------------------------------------------------------
alter table public.repair_evidence enable row level security;

create policy "repair_evidence_select_scoped" on public.repair_evidence
  for select using (
    public.is_admin()
    or exists (
      select 1 from public.repair_assignments ra
      where ra.id = repair_evidence.assignment_id
        and public.current_role() = 'REPAIR_TEAM'
        and ra.team_id = public.current_team_id()
    )
  );

create policy "repair_evidence_insert_scoped" on public.repair_evidence
  for insert with check (
    submitted_by_id = auth.uid()
    and exists (
      select 1 from public.repair_assignments ra
      where ra.id = repair_evidence.assignment_id
        and ra.team_id = public.current_team_id()
    )
  );

-- notifications --------------------------------------------------------------------
alter table public.notifications enable row level security;

create policy "notifications_select_own" on public.notifications
  for select using (user_id = auth.uid());

create policy "notifications_update_own" on public.notifications
  for update using (user_id = auth.uid());
-- Inserts only via RPC/triggers on the events that create them.

-- audit_logs ----------------------------------------------------------------------
alter table public.audit_logs enable row level security;

create policy "audit_logs_select_admin" on public.audit_logs
  for select using (public.is_admin());
-- Inserts only via RPC (every admin action writes its own audit row).

-- rate_limit_counters --------------------------------------------------------------
-- Internal bookkeeping only: RLS enabled, no policies at all, so anon and
-- authenticated get a hard deny via PostgREST. Only security-definer
-- functions (owned by postgres) can read/write it.
alter table public.rate_limit_counters enable row level security;
