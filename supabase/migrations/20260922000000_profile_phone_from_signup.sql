-- With email confirmation on, a new account has no session until the emailed
-- link is opened, so the app can no longer save the phone number afterwards
-- with an authenticated PATCH /auth/me (that is how it worked when signup
-- returned a session immediately). The number now travels in the signup
-- metadata beside full_name, and the profile row is seeded with it here.
--
-- Capped at 32 characters, the same limit the registration form and
-- update_own_profile() enforce, because this metadata is client-supplied.

create or replace function public.handle_new_user() returns trigger
  language plpgsql security definer set search_path = public as $$
  begin
    insert into public.profiles (id, email, full_name, phone, role)
    values (
      new.id,
      new.email,
      coalesce(new.raw_user_meta_data->>'full_name', ''),
      nullif(left(trim(new.raw_user_meta_data->>'phone'), 32), ''),
      'CITIZEN'
    );
    return new;
  end;
  $$;
