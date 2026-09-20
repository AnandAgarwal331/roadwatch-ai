-- Lets a citizen retract a report they submitted by mistake, without
-- erasing it outright: a soft delete (deleted_at) rather than a hard DELETE,
-- so admins can still see and audit it (e.g. from an audit log entry or a
-- direct link) even though it disappears from every listing, the map, and
-- duplicate/history matching for everyone else. New, not a feature FastAPI
-- ever had.
--
-- Only allowed while status is still PENDING/AI_ANALYZED/PRIORITIZED - i.e.
-- before anyone (a repair team or an admin) has acted on it. Once it is
-- ASSIGNED, IN_PROGRESS, RESOLVED, REJECTED or DUPLICATE, the system has
-- already processed it and deleting it out from under that record would
-- corrupt the audit trail (an assigned crew, a resolved repair, an admin's
-- rejection reason) - the reporter would need to contact an administrator
-- at that point, same as any other correction after the fact.
--
-- The allowed-status guard is business logic, not a row-visibility rule, so
-- this is a security-definer RPC rather than a raw RLS delete/update policy -
-- same reasoning as create_complaint and update_own_profile.

alter table public.complaints add column deleted_at timestamptz;

-- Soft-deleted complaints stay invisible to everyone except admins (who
-- bypass this policy entirely via is_admin(), same as every other table's
-- policies in this file) - including the reporter who deleted it.
drop policy "complaints_select_visible" on public.complaints;
create policy "complaints_select_visible" on public.complaints
  for select using (
    public.is_admin()
    or (
      deleted_at is null
      and (
        status not in ('REJECTED', 'DUPLICATE')
        or reporter_id = auth.uid()
        or public.current_role() = 'REPAIR_TEAM'
      )
    )
  );

create function public.delete_own_complaint(p_complaint_id uuid) returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_status text;
begin
  if auth.uid() is null then
    raise exception 'authentication required' using errcode = '28000';
  end if;

  select status into v_status
  from public.complaints
  where id = p_complaint_id and reporter_id = auth.uid() and deleted_at is null;

  -- Same response whether the report doesn't exist, belongs to someone
  -- else, or was already deleted - ids can't be probed for existence.
  if not found then
    raise exception 'report not found' using errcode = 'P0002';
  end if;

  if v_status not in ('PENDING', 'AI_ANALYZED', 'PRIORITIZED') then
    raise exception 'this report has already been processed and can no longer be deleted';
  end if;

  update public.complaints set deleted_at = now(), updated_at = now() where id = p_complaint_id;
end;
$$;

grant execute on function public.delete_own_complaint(uuid) to authenticated;
