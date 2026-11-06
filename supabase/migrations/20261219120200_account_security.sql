-- Signed-in devices, and two-step verification that the server enforces.
--
-- Sessions: Supabase Auth keeps one `auth.sessions` row per signed-in device, and the
-- access token names its row in the `session_id` claim. These functions show a player
-- their own rows and end them. Ending a session stops it refreshing at once; an access
-- token already issued still works until it expires, within the hour.
--
-- Two-step verification: Supabase Auth enrols and checks the codes, and marks a token
-- that passed with `aal: aal2`. On its own that decides nothing: a password alone still
-- gets a working `aal1` token. So `enforce_mfa` runs before every Data API request (as
-- PostgREST's `db_pre_request`) and refuses an `aal1` token whose owner has a verified
-- factor. That covers tables and functions alike, including the ones that run as
-- definer and so don't meet RLS, and the Go services, which reach the database through
-- the same API with the player's token. The sign-in screen is only the way to the code
-- prompt; this is what makes the prompt matter.
--
-- Realtime doesn't pass through PostgREST. An `aal1` token could still hear "this chat
-- changed" signals and typing indicators. Those carry no message text, and reading the
-- chat itself is refused here.
--
-- Apply before the client. Applying this changes nothing for anyone until a player
-- enrols a factor.

create or replace function public.list_my_sessions()
returns table (
  id         uuid,
  created_at timestamptz,
  last_seen  timestamptz,
  user_agent text,
  ip         text,
  is_current boolean
)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_user    uuid := auth.uid();
  v_current text := auth.jwt() ->> 'session_id';
begin
  if v_user is null then
    raise exception 'sign in to see your devices' using errcode = '42501';
  end if;
  return query
  select
    s.id,
    s.created_at,
    coalesce(s.refreshed_at::timestamptz, s.updated_at, s.created_at),
    s.user_agent,
    host(s.ip),
    s.id::text = v_current
    from auth.sessions s
   where s.user_id = v_user
     and (s.not_after is null or s.not_after > now())
   order by (s.id::text = v_current) desc,
            coalesce(s.refreshed_at::timestamptz, s.updated_at, s.created_at) desc;
end;
$$;

revoke all on function public.list_my_sessions() from public, anon, authenticated;
grant execute on function public.list_my_sessions() to authenticated;

-- Only ever the caller's own row. Answers whether it ended anything.
create or replace function public.revoke_my_session(p_session_id uuid)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user uuid := auth.uid();
begin
  if v_user is null then
    raise exception 'sign in to manage your devices' using errcode = '42501';
  end if;
  delete from auth.sessions s where s.id = p_session_id and s.user_id = v_user;
  return found;
end;
$$;

revoke all on function public.revoke_my_session(uuid) from public, anon, authenticated;
grant execute on function public.revoke_my_session(uuid) to authenticated;

-- Everywhere except here. A token with no session claim can't say which device "here"
-- is, so it refuses rather than sign the player out of the one they are holding.
create or replace function public.revoke_my_other_sessions()
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user    uuid := auth.uid();
  v_current text := auth.jwt() ->> 'session_id';
  v_count   integer;
begin
  if v_user is null then
    raise exception 'sign in to manage your devices' using errcode = '42501';
  end if;
  if v_current is null or v_current = '' then
    raise exception 'this session cannot be identified' using errcode = '22023';
  end if;
  delete from auth.sessions s where s.user_id = v_user and s.id::text <> v_current;
  get diagnostics v_count = row_count;
  return v_count;
end;
$$;

revoke all on function public.revoke_my_other_sessions() from public, anon, authenticated;
grant execute on function public.revoke_my_other_sessions() to authenticated;

-- ── Enforcing two-step verification ─────────────────────────────────────────────

create or replace function public.enforce_mfa()
returns void
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_claims jsonb := coalesce(nullif(current_setting('request.jwt.claims', true), '')::jsonb, '{}'::jsonb);
begin
  -- Guests and the service role have no factor to check.
  if v_claims ->> 'role' is distinct from 'authenticated' or v_claims ->> 'aal' = 'aal2' then
    return;
  end if;
  if exists (
    select 1 from auth.mfa_factors f
     where f.user_id = (v_claims ->> 'sub')::uuid
       and f.status::text = 'verified'
  ) then
    -- PT403 is PostgREST's way of choosing the HTTP status: this answers 403.
    raise exception 'two-step verification is required'
      using errcode = 'PT403', hint = 'mfa_required';
  end if;
end;
$$;

revoke all on function public.enforce_mfa() from public;
grant execute on function public.enforce_mfa() to anon, authenticated, service_role;

comment on function public.enforce_mfa() is
  'PostgREST db_pre_request: refuses a password-only (aal1) token whose owner has a verified second factor.';

-- Conditional, so this also applies to a database without PostgREST's role. A project
-- that refuses it keeps working without enforcement and says so in the migration log.
-- To confirm it took effect:
--   select rolconfig from pg_roles where rolname = 'authenticator';
do $do$
begin
  if exists (select 1 from pg_roles where rolname = 'authenticator') then
    execute 'alter role authenticator set pgrst.db_pre_request to ''public.enforce_mfa''';
    notify pgrst, 'reload config';
  end if;
exception when others then
  raise warning 'could not install enforce_mfa as db_pre_request: %', sqlerrm;
end
$do$;
