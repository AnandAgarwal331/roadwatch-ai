-- Replaces backend/app/core/rate_limit.py's in-memory fixed-window counter,
-- which its own docstring flags as unsafe across multiple instances -
-- exactly Edge Functions' model. This is a fixed 60s window keyed by
-- "<scope>:<ip>" (same key shape as the Python version), reset atomically
-- via INSERT ... ON CONFLICT DO UPDATE, so it is also race-safe across
-- concurrent invocations the way the in-memory version never was. Not the
-- same sliding-log algorithm Python used (which tracked exact per-request
-- timestamps) - a fixed window is the standard trade-off for a shared
-- counter table, and still enforces the same per-minute thresholds.

create function public.check_rate_limit(p_bucket_key text, p_limit_per_minute int)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_window_start timestamptz;
  v_hit_count int;
  v_now timestamptz := now();
begin
  if p_limit_per_minute <= 0 then
    return jsonb_build_object('allowed', true);
  end if;

  insert into public.rate_limit_counters (bucket_key, window_start, hit_count)
  values (p_bucket_key, v_now, 1)
  on conflict (bucket_key) do update set
    window_start = case
      when v_now - rate_limit_counters.window_start >= interval '60 seconds' then v_now
      else rate_limit_counters.window_start
    end,
    hit_count = case
      when v_now - rate_limit_counters.window_start >= interval '60 seconds' then 1
      else rate_limit_counters.hit_count + 1
    end
  returning window_start, hit_count into v_window_start, v_hit_count;

  if v_hit_count > p_limit_per_minute then
    return jsonb_build_object(
      'allowed', false,
      'retry_after_seconds', greatest(1, ceil(60 - extract(epoch from (v_now - v_window_start)))::int)
    );
  end if;

  return jsonb_build_object('allowed', true);
end;
$$;

grant execute on function public.check_rate_limit(text, int) to authenticated, anon;
