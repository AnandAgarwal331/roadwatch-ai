-- The dashboard and landing-page figures, computed in one query.
--
-- kpis() used to fetch every complaint's status, then every complaint's
-- priority level, then every resolved complaint's timestamps, and count them
-- in the Edge Function: three full-table downloads, two more count queries
-- after those, and a payload that grew with every report. Two things were
-- wrong with that beyond speed - each round trip to the database costs real
-- time from the Edge Function, and PostgREST silently caps a plain select at
-- 1000 rows (its default max-rows), so past 1000 reports the counts stopped
-- being true.
--
-- This does the counting where the data lives and returns a few dozen bytes,
-- in a single round trip, whatever the table size.
--
-- security invoker (the default) on purpose: the caller's Row Level Security
-- still applies, and only the service role is granted execute. The Edge
-- Function calls it with the service client because these are deliberately
-- system-wide counts (including REJECTED and DUPLICATE reports), not what any
-- one user is allowed to see.

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
    'pending_duplicates', (select count(*) from potential_duplicates where status = 'SUGGESTED')
  );
$$;

revoke all on function public.kpi_summary() from public, anon, authenticated;
grant execute on function public.kpi_summary() to service_role;
