-- Ported from backend/app/services/assessment.py's AssessmentService.assess().
--
-- Supabase's REST layer can't span multiple postgrest-js calls in one
-- transaction the way the Python SQLAlchemy session could, so
-- supabase/functions/api/services/assessment.ts only COMPUTES the outcome
-- (AI -> severity, location -> nearby places, traffic, history, optional
-- weather, then priority). This function does the actual multi-table write
-- atomically: ai_analyses/ai_detections, nearby_places (replace), a
-- traffic_snapshots row, an optional weather_snapshots row, a
-- priority_assessments row, the complaint's own damage_type/severity_score/
-- priority_score/priority_level/status, and complaint_status_history --
-- mirroring assessment.py's _advance_status exactly (PENDING ->
-- AI_ANALYZED -> PRIORITIZED, never pulling an already-assigned/in-progress
-- job back into the early lifecycle).
--
-- security definer because the write fans out across nine tables that
-- ordinary RLS policies don't (and shouldn't) grant a citizen direct access
-- to. Authorization is checked explicitly at the top instead: the caller
-- must be the complaint's own reporter or an admin.

create function public._fmt_g(v double precision) returns text
  language sql immutable as $$
    select case
      when v = trunc(v) then trunc(v)::bigint::text
      else rtrim(rtrim(round(v::numeric, 6)::text, '0'), '.')
    end
  $$;

create function public.persist_assessment(
  p_complaint_id uuid,
  p_image_id uuid,
  p_damage_type text,
  p_severity_score double precision,
  p_had_analysis boolean,
  p_ai jsonb,             -- null, or {confidence, damaged_area_ratio, detection_count, is_confident,
                           --           model_name, model_version, provider, processing_ms,
                           --           severity_explanation, error_message, detections: [...]}
  p_nearby_places jsonb,  -- array of {place_type, name, distance_meters, latitude, longitude, source}
  p_traffic jsonb,        -- {level, score, estimated_vehicles_per_hour, observed_at, provider}
  p_weather jsonb,        -- null, or {condition, rainfall_mm_24h, temperature_c, risk_multiplier, observed_at, provider}
  p_priority jsonb        -- {total_score, level, explanation, weights, signals, weather_multiplier,
                           --  engine_version, severity_factor, traffic_factor, location_factor,
                           --  history_factor, severity_points, traffic_points, location_points, history_points}
) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_complaint public.complaints;
  v_status text;
  v_previous text;
  v_analysis_id uuid;
  v_assessment_id uuid;
  v_place jsonb;
  v_detection jsonb;
begin
  select * into v_complaint from public.complaints where id = p_complaint_id for update;
  if not found then
    raise exception 'complaint % not found', p_complaint_id using errcode = 'P0002';
  end if;

  if not (v_complaint.reporter_id = auth.uid() or public.is_admin()) then
    raise exception 'not authorized to assess this complaint' using errcode = '42501';
  end if;

  if p_image_id is not null and not exists (
    select 1 from public.complaint_images where id = p_image_id and complaint_id = p_complaint_id
  ) then
    raise exception 'image % does not belong to complaint %', p_image_id, p_complaint_id using errcode = '22023';
  end if;

  -- AI analysis + detections (only when a photo was actually analysed).
  if p_ai is not null then
    insert into public.ai_analyses (
      complaint_id, image_id, damage_type, confidence, severity_score, damaged_area_ratio,
      detection_count, is_confident, model_name, model_version, provider, processing_ms,
      severity_explanation, error_message
    ) values (
      p_complaint_id, p_image_id, p_damage_type,
      round((p_ai->>'confidence')::numeric, 4)::double precision,
      p_severity_score,
      round((p_ai->>'damaged_area_ratio')::numeric, 4)::double precision,
      coalesce((p_ai->>'detection_count')::int, 0),
      coalesce((p_ai->>'is_confident')::boolean, false),
      p_ai->>'model_name',
      p_ai->>'model_version',
      p_ai->>'provider',
      nullif(p_ai->>'processing_ms', '')::int,
      p_ai->>'severity_explanation',
      p_ai->>'error_message'
    ) returning id into v_analysis_id;

    for v_detection in select jsonb_array_elements(coalesce(p_ai->'detections', '[]'::jsonb))
    loop
      insert into public.ai_detections (
        analysis_id, damage_type, confidence, bbox_x, bbox_y, bbox_width, bbox_height, area_ratio
      ) values (
        v_analysis_id,
        v_detection->>'damage_type',
        round((v_detection->>'confidence')::numeric, 4)::double precision,
        (v_detection->>'bbox_x')::double precision,
        (v_detection->>'bbox_y')::double precision,
        (v_detection->>'bbox_width')::double precision,
        (v_detection->>'bbox_height')::double precision,
        round((v_detection->>'area_ratio')::numeric, 4)::double precision
      );
    end loop;
  end if;

  -- Nearby-places snapshot: replace, so re-assessment doesn't duplicate rows.
  delete from public.nearby_places where complaint_id = p_complaint_id;
  for v_place in select jsonb_array_elements(coalesce(p_nearby_places, '[]'::jsonb))
  loop
    insert into public.nearby_places (
      complaint_id, place_type, name, distance_meters, latitude, longitude, source
    ) values (
      p_complaint_id,
      v_place->>'place_type',
      v_place->>'name',
      (v_place->>'distance_meters')::double precision,
      (v_place->>'latitude')::double precision,
      (v_place->>'longitude')::double precision,
      v_place->>'source'
    );
  end loop;

  insert into public.traffic_snapshots (
    complaint_id, level, score, estimated_vehicles_per_hour, observed_at, provider
  ) values (
    p_complaint_id,
    p_traffic->>'level',
    (p_traffic->>'score')::double precision,
    nullif(p_traffic->>'estimated_vehicles_per_hour', '')::int,
    (p_traffic->>'observed_at')::timestamptz,
    p_traffic->>'provider'
  );

  if p_weather is not null then
    insert into public.weather_snapshots (
      complaint_id, condition, rainfall_mm_24h, temperature_c, risk_multiplier, observed_at, provider
    ) values (
      p_complaint_id,
      p_weather->>'condition',
      (p_weather->>'rainfall_mm_24h')::double precision,
      nullif(p_weather->>'temperature_c', '')::double precision,
      (p_weather->>'multiplier')::double precision,
      (p_weather->>'observed_at')::timestamptz,
      p_weather->>'provider'
    );
  end if;

  insert into public.priority_assessments (
    complaint_id, severity_factor, traffic_factor, location_factor, history_factor,
    severity_points, traffic_points, location_points, history_points,
    total_score, level, explanation, weights, signals, weather_multiplier, engine_version
  ) values (
    p_complaint_id,
    (p_priority->>'severity_factor')::double precision,
    (p_priority->>'traffic_factor')::double precision,
    (p_priority->>'location_factor')::double precision,
    (p_priority->>'history_factor')::double precision,
    (p_priority->>'severity_points')::double precision,
    (p_priority->>'traffic_points')::double precision,
    (p_priority->>'location_points')::double precision,
    (p_priority->>'history_points')::double precision,
    (p_priority->>'total_score')::double precision,
    p_priority->>'level',
    p_priority->>'explanation',
    p_priority->'weights',
    p_priority->'signals',
    (p_priority->>'weather_multiplier')::double precision,
    p_priority->>'engine_version'
  ) returning id into v_assessment_id;

  -- Status advance, mirroring assessment.py's _advance_status: only nudge
  -- complaints still in their early lifecycle, and only ever forward.
  v_status := v_complaint.status;
  if v_status in ('PENDING', 'AI_ANALYZED', 'PRIORITIZED') then
    v_previous := v_status;
    if p_had_analysis and v_previous = 'PENDING' then
      insert into public.complaint_status_history (complaint_id, from_status, to_status, note)
      values (p_complaint_id, v_previous, 'AI_ANALYZED', 'AI analysis completed');
      v_previous := 'AI_ANALYZED';
    end if;
    if v_previous <> 'PRIORITIZED' then
      insert into public.complaint_status_history (complaint_id, from_status, to_status, note)
      values (
        p_complaint_id, v_previous, 'PRIORITIZED',
        'Priority score ' || public._fmt_g((p_priority->>'total_score')::double precision)
          || ' (' || (p_priority->>'level') || ')'
      );
    end if;
    v_status := 'PRIORITIZED';
  end if;

  update public.complaints set
    damage_type = p_damage_type,
    severity_score = p_severity_score,
    priority_score = (p_priority->>'total_score')::double precision,
    priority_level = p_priority->>'level',
    status = v_status,
    updated_at = now()
  where id = p_complaint_id
  returning * into v_complaint;

  return jsonb_build_object(
    'complaint', to_jsonb(v_complaint),
    'analysis_id', v_analysis_id,
    'assessment_id', v_assessment_id
  );
end;
$$;

grant execute on function public.persist_assessment(
  uuid, uuid, text, double precision, boolean, jsonb, jsonb, jsonb, jsonb, jsonb
) to authenticated;
