-- The display name chosen during sign-up is kept, and an email sign-up that
-- collected everything is registered when the account is created.
--
-- APPLY ORDER: after `20261025120000_signup_usernames.sql`. Manual application
-- only (Supabase SQL Editor). Safe before or after the deployment that sends
-- `display_name`: without it the metadata is simply ignored.
--
-- Before this, the sign-up form's display name was held in the browser's
-- session storage until the confirmation link was opened. The link usually
-- opens in a new tab (or another device), where that storage is empty, so the
-- name was lost and the account was sent back through the sign-up form to
-- choose it — and accept the terms — a second time.
--
-- The auth service now forwards the display name in the Supabase sign-up
-- request's `data` payload next to `username`. `handle_new_user` reads it:
--
--   * a display name of 1–60 characters (after trimming) is stored verbatim;
--     anything else falls back to the previous email-derived default.
--   * when both a username and a display name were chosen, the form had
--     already collected the name and the accepted terms before the request was
--     made, so `onboarded_at` is set in the same transaction. Opening the
--     confirmation link then signs straight in. OAuth sign-ups carry neither
--     key and keep finishing at `/signup`, as before.
--
-- `raw_user_meta_data` is caller-supplied, but this grants nothing new: an
-- authenticated user can already write their own `display_name` and
-- `onboarded_at` under the existing column grants.
--
-- Rollback (manual): re-apply `20261025120000_signup_usernames.sql`.

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  requested_username text;
  requested_display_name text;
  candidate text;
  suffix integer := 0;
begin
  requested_username := lower(btrim(coalesce(new.raw_user_meta_data ->> 'username', '')));

  if requested_username = '' then
    requested_username := null;
  elsif requested_username !~ '^[a-z0-9_]{3,24}$' then
    requested_username := null;
  end if;

  requested_display_name := btrim(coalesce(new.raw_user_meta_data ->> 'display_name', ''));
  if char_length(requested_display_name) not between 1 and 60 then
    requested_display_name := null;
  end if;

  if requested_username is not null then
    -- A collision on `profiles_username_key` is deliberately not caught: it
    -- aborts the auth insert, so a taken name is a refused registration.
    candidate := requested_username;
  else
    candidate := 'user_' || substr(replace(new.id::text, '-', ''), 1, 12);

    while exists (select 1 from public.profiles p where p.username = candidate) loop
      suffix := suffix + 1;
      if suffix > 99 then
        candidate := 'user_' || substr(replace(new.id::text, '-', ''), 1, 16);
        exit;
      end if;
      candidate := 'user_' || substr(replace(new.id::text, '-', ''), 1, 10)
        || lpad(suffix::text, 2, '0');
    end loop;
  end if;

  insert into public.profiles (id, username, display_name, onboarded_at)
  values (
    new.id,
    candidate,
    coalesce(
      requested_display_name,
      left(
        coalesce(nullif(split_part(coalesce(new.email, ''), '@', 1), ''), candidate),
        60
      )
    ),
    case
      when requested_username is not null and requested_display_name is not null then now()
    end
  )
  on conflict (id) do nothing;

  insert into public.user_roles (user_id, role)
  values (new.id, 'user')
  on conflict (user_id) do nothing;

  return new;
end;
$$;

comment on function public.handle_new_user() is
  'Creates the profile and role rows for a new auth user. A username and display name supplied in raw_user_meta_data are honored; when both are present the sign-up form was completed, so onboarded_at is set. A taken username fails the insert via profiles_username_key.';

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- Verification:
--   select pg_get_functiondef('public.handle_new_user()'::regprocedure);
--   -- must read raw_user_meta_data ->> 'display_name' and set onboarded_at
