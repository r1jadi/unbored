-- Reporting, account security, achievements and the admin platform features.
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

-- ── Fixtures ────────────────────────────────────────────────────────────────

create or replace function pg_temp.act_as(p_user uuid, p_aal text default 'aal1', p_session uuid default null)
returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claims', jsonb_build_object(
    'sub', p_user, 'role', 'authenticated', 'aal', p_aal, 'session_id', p_session
  )::text, true);
end;
$$;

-- Runs one statement and answers the SQLSTATE it failed with, or null if it succeeded.
create or replace function pg_temp.fails_with(p_sql text)
returns text language plpgsql as $$
begin
  execute p_sql;
  return null;
exception when others then
  return sqlstate;
end;
$$;

grant execute on function pg_temp.fails_with(text) to authenticated, anon;

insert into auth.users (id, email) values
  ('10000000-0000-4000-8000-000000000001', 'reporter@example.com'),
  ('10000000-0000-4000-8000-000000000002', 'target@example.com'),
  ('10000000-0000-4000-8000-000000000003', 'moderator@example.com');

insert into public.profiles (id, username, display_name)
select u.id, split_part(u.email, '@', 1), split_part(u.email, '@', 1)
  from auth.users u
 where u.email in ('reporter@example.com', 'target@example.com', 'moderator@example.com')
on conflict (id) do nothing;

insert into public.user_roles (user_id, role)
values ('10000000-0000-4000-8000-000000000003', 'moderator')
on conflict (user_id) do update set role = excluded.role;

-- ── Reporting ───────────────────────────────────────────────────────────────

do $$
declare
  v_first  uuid;
  v_second uuid;
  v_state  text;
begin
  perform pg_temp.act_as('10000000-0000-4000-8000-000000000001');
  set local role authenticated;

  v_first := public.submit_report('profile', '10000000-0000-4000-8000-000000000002', 'Spam or scams');
  v_second := public.submit_report('profile', '10000000-0000-4000-8000-000000000002', 'Hate speech');
  if v_first is distinct from v_second then
    raise exception 'a repeat of an open report must be the same report';
  end if;

  v_state := pg_temp.fails_with($q$select public.submit_report('profile', '10000000-0000-4000-8000-000000000001', 'Spam or scams')$q$);
  if v_state is distinct from '22023' then
    raise exception 'reporting yourself = %, want 22023', v_state;
  end if;

  v_state := pg_temp.fails_with($q$select public.submit_report('comment', '10000000-0000-4000-8000-0000000000ff', 'Spam or scams')$q$);
  if v_state is distinct from 'P0002' then
    raise exception 'reporting a missing comment = %, want P0002', v_state;
  end if;

  v_state := pg_temp.fails_with($q$select public.submit_report('game', '10000000-0000-4000-8000-000000000002', 'x')$q$);
  if v_state is distinct from '22023' then
    raise exception 'a report with no real reason = %, want 22023', v_state;
  end if;

  reset role;
  raise notice 'ok   reports are validated and a repeat is one report';
end $$;

-- The evidence comes from the conversation, and only from the reported player.
do $$
declare
  v_conversation uuid;
  v_id           uuid;
  v_details      text;
begin
  insert into public.conversations (user_low, user_high, created_by)
  values ('10000000-0000-4000-8000-000000000001', '10000000-0000-4000-8000-000000000002',
          '10000000-0000-4000-8000-000000000001')
  returning id into v_conversation;
  insert into public.messages (conversation_id, sender_id, body, client_id) values
    (v_conversation, '10000000-0000-4000-8000-000000000002', 'an abusive message', gen_random_uuid()),
    (v_conversation, '10000000-0000-4000-8000-000000000001', 'the reporter''s own words', gen_random_uuid());

  update public.reports set status = 'dismissed', resolved_at = now()
   where reporter_id = '10000000-0000-4000-8000-000000000001';

  perform pg_temp.act_as('10000000-0000-4000-8000-000000000001');
  v_id := public.submit_report('profile', '10000000-0000-4000-8000-000000000002', 'Harassment or bullying', null, true);
  select details into v_details from public.reports where id = v_id;
  if v_details not like '%an abusive message%' or v_details like '%reporter''s own words%' then
    raise exception 'chat evidence = %', v_details;
  end if;
  raise notice 'ok   a report from a chat carries only the reported player''s messages';
end $$;

-- ── Two-step verification ───────────────────────────────────────────────────

do $$
declare
  v_state text;
begin
  -- No factor: a password-level token is all there is, and it must keep working.
  perform pg_temp.act_as('10000000-0000-4000-8000-000000000001');
  perform public.enforce_mfa();

  insert into auth.mfa_factors (user_id, status)
  values ('10000000-0000-4000-8000-000000000001', 'verified');

  v_state := pg_temp.fails_with('select public.enforce_mfa()');
  if v_state is distinct from 'PT403' then
    raise exception 'a password-level token with a verified factor = %, want PT403', v_state;
  end if;

  perform pg_temp.act_as('10000000-0000-4000-8000-000000000001', 'aal2');
  perform public.enforce_mfa();

  -- An unfinished setup must not lock anyone out.
  delete from auth.mfa_factors where user_id = '10000000-0000-4000-8000-000000000001';
  insert into auth.mfa_factors (user_id, status)
  values ('10000000-0000-4000-8000-000000000001', 'unverified');
  perform pg_temp.act_as('10000000-0000-4000-8000-000000000001');
  perform public.enforce_mfa();

  -- Guests and the service role have no factor to check.
  perform set_config('request.jwt.claims', '{"role":"anon"}', true);
  perform public.enforce_mfa();
  perform set_config('request.jwt.claims', '{"role":"service_role"}', true);
  perform public.enforce_mfa();
  raise notice 'ok   enforce_mfa refuses only a password-level token with a verified factor';
end $$;

-- ── Devices ─────────────────────────────────────────────────────────────────

do $$
declare
  v_here  uuid := gen_random_uuid();
  v_there uuid := gen_random_uuid();
  v_other uuid := gen_random_uuid();
  v_count integer;
begin
  insert into auth.sessions (id, user_id) values
    (v_here, '10000000-0000-4000-8000-000000000001'),
    (v_there, '10000000-0000-4000-8000-000000000001'),
    (v_other, '10000000-0000-4000-8000-000000000002');

  perform pg_temp.act_as('10000000-0000-4000-8000-000000000001', 'aal1', v_here);
  set local role authenticated;

  select count(*) into v_count from public.list_my_sessions();
  if v_count <> 2 then raise exception 'list_my_sessions saw % rows, want 2', v_count; end if;
  if not (select s.is_current from public.list_my_sessions() s where s.id = v_here) then
    raise exception 'the current session is not marked';
  end if;

  if public.revoke_my_session(v_other) then
    raise exception 'a player ended someone else''s session';
  end if;

  v_count := public.revoke_my_other_sessions();
  if v_count <> 1 then raise exception 'ended % other sessions, want 1', v_count; end if;
  reset role;

  if not exists (select 1 from auth.sessions where id = v_here) then
    raise exception 'signing out other devices ended this one';
  end if;
  if not exists (select 1 from auth.sessions where id = v_other) then
    raise exception 'signing out other devices reached another player';
  end if;
  raise notice 'ok   a player sees and ends only their own sessions';
end $$;

-- ── Achievements ────────────────────────────────────────────────────────────

do $$
declare
  v_result jsonb;
begin
  perform pg_temp.act_as('10000000-0000-4000-8000-000000000001');
  v_result := public.profile_achievements('10000000-0000-4000-8000-000000000002');
  if (v_result ->> 'visible')::boolean is not true or (v_result ->> 'runs')::int <> 0 then
    raise exception 'a public profile with no runs = %', v_result;
  end if;

  insert into public.user_preferences (user_id, show_profile_scores)
  values ('10000000-0000-4000-8000-000000000002', false)
  on conflict (user_id) do update set show_profile_scores = false;
  v_result := public.profile_achievements('10000000-0000-4000-8000-000000000002');
  if (v_result ->> 'visible')::boolean is not false or v_result ? 'runs' then
    raise exception 'hidden scores leaked through achievements: %', v_result;
  end if;

  perform pg_temp.act_as('10000000-0000-4000-8000-000000000002');
  v_result := public.profile_achievements('10000000-0000-4000-8000-000000000002');
  if (v_result ->> 'visible')::boolean is not true then
    raise exception 'a player can''t see their own achievements: %', v_result;
  end if;
  raise notice 'ok   achievements follow the scores'' visibility';
end $$;

-- ── Featured games, settings and broadcasts ─────────────────────────────────

do $$
declare
  v_state text;
begin
  -- An ordinary player gets none of it.
  perform pg_temp.act_as('10000000-0000-4000-8000-000000000001');
  set local role authenticated;
  foreach v_state in array array[
    'select public.admin_set_featured_games(''{}'')',
    'select public.admin_set_platform_settings(null, true, true)',
    $q$select public.admin_send_broadcast('Hello there', 'A real message')$q$,
    'select * from public.admin_broadcasts()'
  ] loop
    if pg_temp.fails_with(v_state) is distinct from '42501' then
      raise exception 'a player was not refused: %', v_state;
    end if;
  end loop;

  -- The wrappers that act as an administrator are not callable with a user's token.
  if pg_temp.fails_with(
    $q$select public.admin_send_broadcast_svc('10000000-0000-4000-8000-000000000001', 'Hello there', 'A real message')$q$
  ) is distinct from '42501' then
    raise exception 'a player reached a service-role wrapper';
  end if;
  reset role;

  -- A moderator may arrange featured games, but can't broadcast or change settings.
  perform pg_temp.act_as('10000000-0000-4000-8000-000000000003');
  set local role authenticated;
  perform public.admin_set_featured_games('{}');
  if pg_temp.fails_with($q$select public.admin_send_broadcast('Hello there', 'A real message')$q$) is distinct from '42501' then
    raise exception 'a moderator sent a broadcast';
  end if;
  if pg_temp.fails_with('select public.admin_set_platform_settings(null, false, true)') is distinct from '42501' then
    raise exception 'a moderator changed platform settings';
  end if;
  reset role;
  raise notice 'ok   platform writes are limited to the right staff tier';
end $$;

-- Through the bridge an allowlisted administrator can do all of it, and it is recorded.
do $$
declare
  v_game     uuid;
  v_result   jsonb;
  v_expected integer;
begin
  select id into v_game from public.games where status = 'published' limit 1;
  if v_game is null then
    raise exception 'the seed has no published game';
  end if;

  perform public.admin_set_featured_games_svc('10000000-0000-4000-8000-000000000003', array[v_game]);
  if (select count(*) from public.featured_game_slugs()) <> 1 then
    raise exception 'the featured game is not listed for players';
  end if;
  if not exists (
    select 1 from public.moderation_actions
     where target_id = v_game and action = 'feature_game'
       and moderator_id = '10000000-0000-4000-8000-000000000003'
  ) then
    raise exception 'featuring a game left no audit row';
  end if;

  v_result := public.admin_send_broadcast_svc(
    '10000000-0000-4000-8000-000000000003', 'Hello there', 'A real message', '/games/sudoku'
  );
  select count(*) into v_expected from public.profiles p
    left join public.user_preferences up on up.user_id = p.id
   where not p.is_suspended and coalesce(up.notify_announcements, true);
  if (v_result ->> 'recipients')::int <> v_expected or v_expected = 0 then
    raise exception 'broadcast reached %, want %', v_result ->> 'recipients', v_expected;
  end if;

  if pg_temp.fails_with($q$select public.admin_send_broadcast_svc('10000000-0000-4000-8000-000000000003', 'Hello there', 'A real message')$q$)
     is distinct from '23505' then
    raise exception 'the same broadcast went out twice';
  end if;
  if pg_temp.fails_with($q$select public.admin_send_broadcast_svc('10000000-0000-4000-8000-000000000003', 'Elsewhere', 'Click this link', '//evil.example')$q$)
     is distinct from '23514' then
    raise exception 'a broadcast linked outside the app';
  end if;

  -- Opting out is respected.
  insert into public.user_preferences (user_id, notify_announcements)
  values ('10000000-0000-4000-8000-000000000001', false)
  on conflict (user_id) do update set notify_announcements = false;
  v_result := public.admin_send_broadcast_svc('10000000-0000-4000-8000-000000000003', 'Second news', 'Another message');
  if exists (
    select 1 from public.notifications
     where user_id = '10000000-0000-4000-8000-000000000001'
       and payload ->> 'broadcast' = v_result ->> 'id'
  ) then
    raise exception 'a player who opted out got an announcement';
  end if;
  raise notice 'ok   the administrator bridge works, is audited, and respects opt-outs';
end $$;

-- The switches hold on the tables themselves.
do $$
declare
  v_conversation uuid;
  v_game         uuid;
begin
  select id into v_game from public.games where status = 'published' limit 1;
  select id into v_conversation from public.conversations limit 1;

  perform public.admin_set_platform_settings_svc(
    '10000000-0000-4000-8000-000000000003', 'Back soon', false, false
  );
  if (public.public_platform_settings() ->> 'banner_text') is distinct from 'Back soon' then
    raise exception 'the banner did not save';
  end if;
  if (select count(*) from public.platform_settings_log) <> 1 then
    raise exception 'a settings change left no audit row';
  end if;

  if pg_temp.fails_with(format(
    $q$insert into public.comments (game_id, author_id, body) values (%L, '10000000-0000-4000-8000-000000000001', 'hello')$q$,
    v_game
  )) is distinct from 'P0001' then
    raise exception 'a comment got through while comments were paused';
  end if;
  if pg_temp.fails_with(format(
    $q$insert into public.messages (conversation_id, sender_id, body, client_id) values (%L, '10000000-0000-4000-8000-000000000001', 'hello', gen_random_uuid())$q$,
    v_conversation
  )) is distinct from 'P0001' then
    raise exception 'a message got through while messages were paused';
  end if;

  perform public.admin_set_platform_settings_svc('10000000-0000-4000-8000-000000000003', null, true, true);
  insert into public.comments (game_id, author_id, body)
  values (v_game, '10000000-0000-4000-8000-000000000001', 'hello again');
  raise notice 'ok   paused comments and messages are refused by the database';
end $$;

-- The push sender gets announcements, and no other system row.
do $$
declare
  v_kinds text[];
begin
  update public.notifications set push_sent_at = now() where push_sent_at is null;
  insert into public.push_subscriptions (user_id, endpoint, p256dh, auth)
  values (
    '10000000-0000-4000-8000-000000000002',
    'https://fcm.googleapis.com/fcm/send/test',
    repeat('a', 87),
    repeat('b', 22)
  );
  insert into public.notifications (user_id, kind, payload) values
    ('10000000-0000-4000-8000-000000000002', 'system', '{"reason":"announcement","title":"T","text":"B"}'),
    ('10000000-0000-4000-8000-000000000002', 'system', '{"reason":"other"}');
  select array_agg(b.payload ->> 'reason') into v_kinds from public.claim_push_batch(10) b;
  if v_kinds is distinct from array['announcement'] then
    raise exception 'push batch = %', v_kinds;
  end if;
  raise notice 'ok   only announcements leave as system pushes';
end $$;

rollback;

\echo 'Platform features suite passed.'
