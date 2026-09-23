-- repair_assignments itself was still admin/own-team only, one level above
-- repair_evidence (widened by the previous migration). Live verification of
-- the review workflow showed that even with repair_evidence opened up, an
-- anonymous or reporter request never saw any assignment at all: the
-- postgrest embed on complaints (assignments:repair_assignments(*, ...))
-- came back empty before RLS ever got down to the evidence rows.
--
-- Add the same "public once the report is, or you're the reporter" path
-- everything else on a complaint already has (locations, nearby_places,
-- complaint_images, ...), alongside the existing admin/own-team access -
-- which stays exactly as it was for a crew's own job list.
drop policy if exists "repair_assignments_select_scoped" on public.repair_assignments;

create policy "repair_assignments_select_visible" on public.repair_assignments
  for select using (
    public.is_admin()
    or (public.current_role() = 'REPAIR_TEAM' and team_id = public.current_team_id())
    or exists (
      select 1 from public.complaints c
      where c.id = repair_assignments.complaint_id
        and (c.status not in ('REJECTED', 'DUPLICATE') or c.reporter_id = auth.uid())
    )
  );
