-- Ported from backend/app/api/v1/auth.py's PATCH /auth/me. profiles has no
-- client-facing update policy for ordinary users (only
-- "profiles_update_admin" - see the RLS migration's comment: "Self-service
-- edits to name/phone go through a security-definer RPC ... so role and
-- team_id can't be self-granted"). This is that RPC: it can only ever touch
-- the calling user's own row, and only full_name/phone. The caller (see
-- routes/auth.ts) resolves "field not sent -> keep current value" before
-- calling, same as Python's `if payload.x is not None` field-by-field
-- patch semantics - this function always sets exactly what it's given.

create function public.update_own_profile(p_full_name text, p_phone text)
returns public.profiles
language plpgsql
security definer
set search_path = public
as $$
declare
  v_row public.profiles;
begin
  if auth.uid() is null then
    raise exception 'authentication required' using errcode = '28000';
  end if;

  update public.profiles set
    full_name = p_full_name,
    phone = p_phone,
    updated_at = now()
  where id = auth.uid()
  returning * into v_row;

  if not found then
    raise exception 'profile not found' using errcode = 'P0002';
  end if;

  return v_row;
end;
$$;

grant execute on function public.update_own_profile(text, text) to authenticated;
