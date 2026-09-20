-- Ported from backend/app/services/complaints.py's ComplaintService.create()
-- (the part before the assessment pipeline runs) and
-- backend/app/services/numbering.py's next_complaint_number().
--
-- locations and complaint_status_history have no client-facing insert
-- policy at all (see the RLS migration's comments on both tables) - a
-- citizen's own complaints/complaint_images inserts are still reachable
-- directly under RLS as a defense-in-depth fallback, but the real creation
-- path is this function, called once with everything the "new report" form
-- collects. security definer so it can write both of those tables in the
-- same transaction as the complaint row itself.

create function public.create_complaint(
  p_latitude double precision,
  p_longitude double precision,
  p_description text,
  p_reported_damage_type text,
  p_road_name text,
  p_address text,
  p_city text,
  p_accuracy_meters double precision,
  p_road_importance double precision
) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_reporter uuid := auth.uid();
  v_year text := to_char(now(), 'YYYY');
  v_prefix text := 'RW-' || v_year || '-';
  v_number text;
  v_sequence int;
  v_complaint_id uuid;
  v_attempt int;
begin
  if v_reporter is null then
    raise exception 'authentication required' using errcode = '28000';
  end if;

  for v_attempt in 1..5 loop
    select coalesce(max(substring(complaint_number from length(v_prefix) + 1)::int), 0) + 1
      into v_sequence
      from public.complaints
      where complaint_number like v_prefix || '%';
    v_number := v_prefix || lpad(v_sequence::text, 6, '0');

    begin
      insert into public.complaints (
        complaint_number, reporter_id, description, reported_damage_type, damage_type,
        road_name, latitude, longitude, status
      ) values (
        v_number, v_reporter, p_description, p_reported_damage_type,
        coalesce(p_reported_damage_type, 'UNKNOWN'),
        p_road_name, p_latitude, p_longitude, 'PENDING'
      ) returning id into v_complaint_id;
      exit;
    exception when unique_violation then
      if v_attempt = 5 then
        raise exception 'Could not allocate a complaint number. Please try again.' using errcode = '40001';
      end if;
    end;
  end loop;

  insert into public.locations (
    complaint_id, latitude, longitude, accuracy_meters, address, road_name, city,
    road_importance, geocode_source
  ) values (
    v_complaint_id, p_latitude, p_longitude, p_accuracy_meters, p_address, p_road_name, p_city,
    p_road_importance, 'client'
  );

  insert into public.complaint_status_history (complaint_id, from_status, to_status, changed_by_id, note)
  values (v_complaint_id, null, 'PENDING', v_reporter, 'Report submitted');

  return jsonb_build_object('id', v_complaint_id, 'complaint_number', v_number);
end;
$$;

grant execute on function public.create_complaint(
  double precision, double precision, text, text, text, text, text, double precision, double precision
) to authenticated;
