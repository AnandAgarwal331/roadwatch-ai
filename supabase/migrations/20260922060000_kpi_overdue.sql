-- Adds the "overdue" count to kpi_summary(): reports whose active repair has
-- passed its due date. Behind the new "Overdue" tile and report-queue filter
-- (see repositories/repair.ts's complaintIdsOverdue, which finds the same set
-- of complaints for the filtered list; this counts them for the headline
-- figure).
--
-- create or replace, not a new function: same name, arguments and return type
-- as the original in 20260922020000_kpi_summary_rpc.sql (most recently
-- extended by 20260922040000_kpi_awaiting_verification.sql), so callers
-- (analytics.ts's kpiRow()) need no change.

create or replace function public.kpi_summary()
returns jsonb
language sql
stable
set search_path = public
as $$
  select jsonb_build_object(
    'total', (select count(*) from complaints),
    'by_status', coalesce(
      (select jsonb_object_agg(status, n)
         from (select status, count(*) as n from complaints group by status) s),
      '{}'::jsonb),
    'by_priority_level', coalesce(
      (select jsonb_object_agg(priority_level, n)
         from (select priority_level, count(*) as n from complaints group by priority_level) p),
      '{}'::jsonb),
    -- Rows resolved "before" they were created (bad clock, bad data) are left
    -- out, as the old code did. Null when nothing has been resolved yet.
    'average_resolution_hours', (
      select round(avg(extract(epoch from (resolved_at - created_at)) / 3600.0)::numeric, 1)
        from complaints
       where resolved_at is not null and resolved_at >= created_at),
    'last_7_days', (select count(*) from complaints where created_at >= now() - interval '7 days'),
    'last_30_days', (select count(*) from complaints where created_at >= now() - interval '30 days'),
    'pending_duplicates', (select count(*) from potential_duplicates where status = 'SUGGESTED'),
    'awaiting_verification', (select count(*) from repair_assignments where status = 'COMPLETED'),
    'overdue', (
      select count(distinct complaint_id) from repair_assignments
       where status in ('ASSIGNED', 'IN_PROGRESS') and due_at is not null and due_at < now())
  );
$$;
