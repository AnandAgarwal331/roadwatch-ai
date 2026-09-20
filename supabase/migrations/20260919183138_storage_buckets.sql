-- Storage buckets replacing Cloudflare R2. Object path convention:
--   complaint-photos/{complaint_id}/{uuid}.{ext}
--   repair-evidence/{assignment_id}/{uuid}.{ext}
-- The leading path segment is the linking id, read via storage.foldername()
-- in policies below so access mirrors the corresponding table's RLS rule.

insert into storage.buckets (id, name, public)
values
  ('complaint-photos', 'complaint-photos', true),
  ('repair-evidence', 'repair-evidence', false);

-- complaint-photos: public bucket (served directly via public URL, same as
-- today's R2 public dev URL), but writes are still gated so only the
-- reporter of the matching complaint can upload into it.
create policy "complaint_photos_insert_own" on storage.objects
  for insert with check (
    bucket_id = 'complaint-photos'
    and exists (
      select 1 from public.complaints c
      where c.id::text = (storage.foldername(name))[1]
        and c.reporter_id = auth.uid()
    )
  );

create policy "complaint_photos_select_public" on storage.objects
  for select using (bucket_id = 'complaint-photos');
-- Redundant with the bucket's public flag, but keeps authenticated reads
-- (e.g. from an Edge Function using the caller's JWT) working the same way.

-- repair-evidence: private bucket. Upload restricted to the assignment's own
-- team; read restricted to admin or that same team.
create policy "repair_evidence_insert_scoped" on storage.objects
  for insert with check (
    bucket_id = 'repair-evidence'
    and exists (
      select 1 from public.repair_assignments ra
      where ra.id::text = (storage.foldername(name))[1]
        and ra.team_id = public.current_team_id()
    )
  );

create policy "repair_evidence_select_scoped" on storage.objects
  for select using (
    bucket_id = 'repair-evidence'
    and (
      public.is_admin()
      or exists (
        select 1 from public.repair_assignments ra
        where ra.id::text = (storage.foldername(name))[1]
          and ra.team_id = public.current_team_id()
      )
    )
  );
