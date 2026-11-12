-- Avatar screening: a picture reaches the public bucket and a profile only
-- through the screening service, and staff can take a reported one down.
--
-- Runs after the migrations on a throwaway database (scripts/test-rls.sh), and rolls
-- everything back. Each check raises on failure, so the file stops at the first one.

\set ON_ERROR_STOP on

begin;

do $$
begin
  if exists (select 1 from pg_roles where rolname = 'supabase_admin') then
    raise exception 'refusing to run against a hosted Supabase project';
  end if;
end $$;

insert into auth.users (id, email) values
  ('aaaaaaaa-0000-4000-8000-0000000000b1', 'avatar-player@example.com'),
  ('aaaaaaaa-0000-4000-8000-0000000000b2', 'avatar-moderator@example.com');
update public.user_roles set role = 'moderator' where user_id = 'aaaaaaaa-0000-4000-8000-0000000000b2';

-- ── The buckets ─────────────────────────────────────────────────────────────

do $$
begin
  if not exists (select 1 from storage.buckets where id = 'avatar-uploads' and not public) then
    raise exception 'ASSERTION FAILED: the holding bucket is missing or public';
  end if;
  if exists (
    select 1 from pg_policies
     where schemaname = 'storage' and tablename = 'objects'
       and policyname in ('avatars_owner_insert', 'avatars_owner_update')
  ) then
    raise exception 'ASSERTION FAILED: players can still write into the public avatars bucket';
  end if;
  if not exists (
    select 1 from pg_policies
     where schemaname = 'storage' and tablename = 'objects' and policyname = 'avatar_uploads_owner_insert'
  ) then
    raise exception 'ASSERTION FAILED: players cannot upload to the holding bucket';
  end if;
  raise notice 'ok   pictures wait in a private bucket; only the service writes public ones';
end $$;

-- ── A player's token cannot point the profile at a file ─────────────────────

select set_config('request.jwt.claims',
  '{"sub":"aaaaaaaa-0000-4000-8000-0000000000b1","role":"authenticated"}', true);
set local role authenticated;

do $$
begin
  begin
    update public.profiles set avatar_path = 'aaaaaaaa-0000-4000-8000-0000000000b1/sneaky.png'
     where id = 'aaaaaaaa-0000-4000-8000-0000000000b1';
    raise exception 'ASSERTION FAILED: a player set an unscreened picture';
  exception when insufficient_privilege then null;
  end;
  raise notice 'ok   a player cannot set a picture path themselves';
end $$;

reset role;

-- The service (service_role) can; then the player can still clear it.
set local role service_role;
update public.profiles set avatar_path = 'aaaaaaaa-0000-4000-8000-0000000000b1/screened.png'
 where id = 'aaaaaaaa-0000-4000-8000-0000000000b1';
reset role;

set local role authenticated;
update public.profiles set avatar_path = null where id = 'aaaaaaaa-0000-4000-8000-0000000000b1';
reset role;

do $$
begin
  if (select avatar_path from public.profiles where id = 'aaaaaaaa-0000-4000-8000-0000000000b1') is not null then
    raise exception 'ASSERTION FAILED: a player could not remove their own picture';
  end if;
  raise notice 'ok   the service sets a screened picture, and a player can still remove theirs';
end $$;

-- ── Staff take a reported picture down ──────────────────────────────────────

set local role service_role;
update public.profiles set avatar_path = 'aaaaaaaa-0000-4000-8000-0000000000b1/reported.png'
 where id = 'aaaaaaaa-0000-4000-8000-0000000000b1';
reset role;

-- A player cannot.
set local role authenticated;
do $$
begin
  begin
    perform public.admin_remove_avatar('aaaaaaaa-0000-4000-8000-0000000000b1', 'nope');
    raise exception 'ASSERTION FAILED: a player removed a picture';
  exception when insufficient_privilege then null;
  end;
end $$;
reset role;

-- A moderator can, with a reason, and it is logged.
select set_config('request.jwt.claims',
  '{"sub":"aaaaaaaa-0000-4000-8000-0000000000b2","role":"authenticated"}', true);
set local role authenticated;
do $$
declare
  v_result jsonb;
begin
  begin
    perform public.admin_remove_avatar('aaaaaaaa-0000-4000-8000-0000000000b1', '   ');
    raise exception 'ASSERTION FAILED: a picture was removed without a reason';
  exception when invalid_parameter_value then null;
  end;
  v_result := public.admin_remove_avatar('aaaaaaaa-0000-4000-8000-0000000000b1', 'Explicit picture');
  if v_result ->> 'avatarPath' <> 'aaaaaaaa-0000-4000-8000-0000000000b1/reported.png' then
    raise exception 'ASSERTION FAILED: the removal did not return the removed file (%)', v_result;
  end if;
end $$;
reset role;

do $$
begin
  if (select avatar_path from public.profiles where id = 'aaaaaaaa-0000-4000-8000-0000000000b1') is not null then
    raise exception 'ASSERTION FAILED: the reported picture is still on the profile';
  end if;
  if not exists (
    select 1 from public.moderation_actions
     where target_id = 'aaaaaaaa-0000-4000-8000-0000000000b1' and action = 'remove_avatar'
       and moderator_id = 'aaaaaaaa-0000-4000-8000-0000000000b2' and reason = 'Explicit picture'
  ) then
    raise exception 'ASSERTION FAILED: the removal was not logged against the moderator';
  end if;
  raise notice 'ok   a moderator removes a reported picture, with a reason, and it is logged';
end $$;

rollback;

\echo 'Avatar screening suite passed.'
