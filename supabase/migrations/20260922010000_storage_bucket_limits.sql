-- Enforce the upload rules in Storage itself, not only in the app.
--
-- The Edge Function already checks size and decodes every image before it
-- stores anything, and the browser checks first. This is the last layer: if a
-- client ever talks to Storage directly (the insert policies allow the owning
-- user to), it still cannot put a 500 MB file or a non-image into either bucket.
--
-- 10 MB matches MAX_UPLOAD_BYTES in the Edge Function's config and MAX_UPLOAD_MB
-- in the frontend; the function re-encodes everything to JPEG, so the stored
-- object is always well inside it.

update storage.buckets
set
  file_size_limit = 10485760,
  allowed_mime_types = array['image/jpeg', 'image/png', 'image/webp']
where id in ('complaint-photos', 'repair-evidence');
