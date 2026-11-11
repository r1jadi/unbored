-- The daily streak across games, its freezes, and the evening reminder.
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

create or replace function pg_temp.player(p_name text)
returns uuid language plpgsql as $$
declare
  v_id uuid := gen_random_uuid();
begin
  insert into auth.users (id, email) values (v_id, p_name || '@example.com');
  insert into public.profiles (id, username, display_name)
  values (v_id, p_name, p_name)
  on conflict (id) do nothing;
  return v_id;
end;
$$;

-- A verified score on each of these days, counted back from today in a zone.
create or replace function pg_temp.played(p_user uuid, p_zone text, p_days_ago int[])
returns void language plpgsql as $$
declare
  v_game    uuid := (select id from public.games order by created_at limit 1);
  v_today   date := (now() at time zone p_zone)::date;
  v_ago     int;
  v_session uuid;
begin
  foreach v_ago in array p_days_ago loop
    insert into public.game_sessions (game_id, user_id) values (v_game, p_user)
    returning id into v_session;
    insert into public.scores (session_id, game_id, user_id, score, created_at)
    values (v_session, v_game, p_user, 10, ((v_today - v_ago) + time '12:00') at time zone p_zone);
  end loop;
end;
$$;

create or replace function pg_temp.expect_streak(
  p_label text, p_user uuid, p_days int[], p_streak int, p_freezes int
)
returns void language plpgsql as $$
declare
  v record;
begin
  perform pg_temp.played(p_user, 'UTC', p_days);
  select * into v from public.daily_streak_for(p_user, 'UTC');
  if v.streak <> p_streak or v.freezes <> p_freezes then
    raise exception '%: streak % freezes %, expected % and %',
      p_label, v.streak, v.freezes, p_streak, p_freezes;
  end if;
  raise notice 'ok   %', p_label;
end;
$$;

-- ── The streak ──────────────────────────────────────────────────────────────

select pg_temp.expect_streak('three days running, today included',
  pg_temp.player('s_today'), array[0, 1, 2], 3, 0);
select pg_temp.expect_streak('a streak waits for today''s game',
  pg_temp.player('s_keep'), array[1, 2, 3], 3, 0);
select pg_temp.expect_streak('one missed day is a free rest day',
  pg_temp.player('s_rest'), array[2, 3], 2, 0);
select pg_temp.expect_streak('two missed days with no freeze end it',
  pg_temp.player('s_gone'), array[3, 4], 0, 0);
select pg_temp.expect_streak('seven days earn a freeze',
  pg_temp.player('s_earn'), array[1, 2, 3, 4, 5, 6, 7], 7, 1);
select pg_temp.expect_streak('a freeze covers the day past the rest day',
  pg_temp.player('s_spend'), array[12, 11, 10, 9, 8, 7, 6, 3, 2, 1], 10, 0);
select pg_temp.expect_streak('without a freeze the same gap starts over',
  pg_temp.player('s_reset'), array[6, 5, 4, 1], 1, 0);
select pg_temp.expect_streak('at most two freezes are banked',
  pg_temp.player('s_bank'), array(select generate_series(1, 28)), 28, 2);

-- The caller's own streak, and nothing for anyone else.
do $$
declare
  v_user uuid := (select id from public.profiles where username = 's_today');
  v record;
begin
  perform set_config('request.jwt.claims',
    jsonb_build_object('sub', v_user, 'role', 'authenticated')::text, true);
  set local role authenticated;
  select * into v from public.my_daily_streak('UTC');
  reset role;
  if v.streak <> 3 then
    raise exception 'my_daily_streak = %', v.streak;
  end if;
  raise notice 'ok   a player reads their own streak';
end $$;

do $$
begin
  set local role authenticated;
  perform public.daily_streak_for(gen_random_uuid(), 'UTC');
  raise exception 'a player could read anyone''s streak';
exception when insufficient_privilege then
  reset role;
  raise notice 'ok   another player''s streak is not readable';
end $$;

-- ── The evening reminder ────────────────────────────────────────────────────

do $$
declare
  -- Somewhere it is 19:00 right now.
  v_zone   text := (
    select z.name from pg_catalog.pg_timezone_names z
     where extract(hour from now() at time zone z.name) = 19
       and z.name like '%/%'
     order by z.name limit 1
  );
  v_due    uuid := pg_temp.player('r_due');
  v_played uuid := pg_temp.player('r_played');
  v_off    uuid := pg_temp.player('r_off');
  v_short  uuid := pg_temp.player('r_short');
  v_user   uuid;
  v_queued integer;
  v_row    record;
  v_reasons text[];
begin
  if v_zone is null then
    raise notice 'skip no time zone reads 19:00 right now';
    return;
  end if;

  perform pg_temp.played(v_due, v_zone, array[1, 2, 3]);
  perform pg_temp.played(v_played, v_zone, array[0, 1, 2]);
  perform pg_temp.played(v_off, v_zone, array[1, 2, 3]);
  perform pg_temp.played(v_short, v_zone, array[1]);
  insert into public.user_preferences (user_id, notify_streak_reminders) values (v_off, false)
  on conflict (user_id) do update set notify_streak_reminders = false;

  foreach v_user in array array[v_due, v_played, v_off, v_short] loop
    insert into public.push_subscriptions (user_id, endpoint, p256dh, auth, time_zone)
    values (v_user, 'https://fcm.googleapis.com/fcm/send/' || v_user, repeat('a', 87), repeat('b', 22), v_zone);
  end loop;
  update public.notifications set push_sent_at = now() where push_sent_at is null;

  v_queued := public.queue_streak_reminders();
  if v_queued <> 1 then
    raise exception 'queued % reminders, expected only the player who has not played', v_queued;
  end if;

  select * into v_row from public.notifications n where n.user_id = v_due;
  if v_row.kind <> 'system'
     or v_row.payload ->> 'reason' <> 'streak_reminder'
     or (v_row.payload ->> 'streak')::int <> 3
     or v_row.read_at is null or v_row.dismissed_at is null then
    raise exception 'reminder row = %', row_to_json(v_row);
  end if;
  raise notice 'ok   a reminder goes only to a kept streak not yet played today, with the setting on';

  select array_agg(b.payload ->> 'reason') into v_reasons from public.claim_push_batch(10) b;
  if v_reasons is distinct from array['streak_reminder'] then
    raise exception 'push batch = %', v_reasons;
  end if;
  raise notice 'ok   the push sender takes the reminder';

  if public.queue_streak_reminders() <> 0 then
    raise exception 'a second run reminded again';
  end if;
  raise notice 'ok   one reminder a day, however often the job runs';
end $$;

rollback;

\echo 'Streaks suite passed.'
