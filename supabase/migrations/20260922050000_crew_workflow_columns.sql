-- Three crew-workflow capabilities that had no column to record them in:
--
-- 1. Structured repair details entered on completion (repair type, materials,
--    quantity, equipment, workers, cost) - previously only a free-text note.
-- 2. A supervisor rejecting a completed-but-unverified repair and sending it
--    back to the crew ("rework"), as distinct from a first-time repair.
-- 3. A crew flagging a problem with an assignment before or during work
--    (wrong location, already repaired, duplicate, ...), and a crew manually
--    escalating one as an emergency.
--
-- All nullable or defaulted, so every existing row (and every code path that
-- doesn't yet set them) is unaffected. See services/complaints.ts for the
-- functions that write them (rejectRepair, flagAssignment, escalateAssignment).

alter table public.repair_assignments
  add column repair_details jsonb,
  add column rework_count integer not null default 0,
  add column rework_reason text,
  add column reworked_at timestamptz,
  add column flag_reason text,
  add column flagged_at timestamptz,
  add column flagged_by_id uuid references public.profiles (id) on delete set null,
  add column is_emergency boolean not null default false,
  add column emergency_reason text,
  add column escalated_at timestamptz,
  add column escalated_by_id uuid references public.profiles (id) on delete set null;

comment on column public.repair_assignments.repair_details is
  'Structured completion details a crew enters alongside evidence photos: {repair_type, materials, quantity, equipment, workers_count, cost_amount, notes}. All fields optional free text/numbers - not a fixed catalogue.';
