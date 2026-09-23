-- Widen repair_evidence's read policy to match every other piece of a
-- complaint's supporting data (locations, nearby_places, traffic_snapshots,
-- complaint_images, ...): visible to the public once the report itself is
-- visible, not just to the assigned crew and admins.
--
-- Without this, a citizen could never see their own report's before/after
-- repair photos - the public report page's evidence section would come back
-- empty for everyone except an admin or the exact crew that did the work,
-- even after the report is resolved and verified.
drop policy if exists "repair_evidence_select_scoped" on public.repair_evidence;

create policy "repair_evidence_select_visible" on public.repair_evidence
  for select using (
    exists (
      select 1
      from public.repair_assignments ra
      join public.complaints c on c.id = ra.complaint_id
      where ra.id = repair_evidence.assignment_id
        and (
          c.status not in ('REJECTED', 'DUPLICATE')
          or c.reporter_id = auth.uid()
          or public.is_admin()
          or public.current_role() = 'REPAIR_TEAM'
        )
    )
  );

-- The storage bucket itself was still marked private, so the row above
-- being readable did not mean the photo behind its url actually loaded -
-- getPublicUrl() only produces a working link on a public bucket, and the
-- upload code already calls it as though this one were public (same as
-- complaint-photos). Flip it to match what the code already assumes, and
-- what the product already does for the original report photo: viewable by
-- anyone who has the link, same trust model as complaint-photos.
update storage.buckets set public = true where id = 'repair-evidence';

drop policy if exists "repair_evidence_select_scoped" on storage.objects;

create policy "repair_evidence_select_public" on storage.objects
  for select using (bucket_id = 'repair-evidence');
-- Redundant with the bucket's public flag, kept for the same reason
-- complaint_photos_select_public is: authenticated reads through an Edge
-- Function behave the same way as anonymous ones.
