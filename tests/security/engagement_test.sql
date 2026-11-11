-- Today's rank on a daily board, the saved runs the feed offers, and who the weekly
-- recap goes to with what numbers.
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

create or replace function pg_temp.player(p_name text)
returns uuid language plpgsql as $$
declare
  v_id uuid := gen_random_uuid();
begin
  insert into auth.users (id, email, email_confirmed_at) values (v_id, p_name || '@example.com', now());
  insert into public.profiles (id, username, display_name) values (v_id, p_name, initcap(p_name))
  on conflict (id) do nothing;
  return v_id;
end;
$$;

-- A finished run: its session (with a seed) and its verified score.
create or replace function pg_temp.scored(
  p_user uuid, p_game uuid, p_seed bigint, p_score bigint, p_at timestamptz default now()
)
returns uuid language plpgsql as $$
declare
  v_session uuid;
begin
  insert into public.game_sessions (game_id, user_id, seed) values (p_game, p_user, p_seed)
  returning id into v_session;
  insert into public.scores (session_id, game_id, user_id, score, created_at)
  values (v_session, p_game, p_user, p_score, p_at);
  return v_session;
end;
$$;

create or replace function pg_temp.act_as(p_user uuid)
returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claims',
    jsonb_build_object('sub', p_user, 'role', 'authenticated')::text, true);
end;
$$;

-- ── Today's rank ────────────────────────────────────────────────────────────

do $$
declare
  v_game uuid := (select id from public.games order by created_at limit 1);
  v_me   uuid := pg_temp.player('rank_me');
  v_mine uuid;
  v_alone uuid;
  v record;
begin
  v_mine := pg_temp.scored(v_me, v_game, 777001, 50);
  perform pg_temp.scored(pg_temp.player('rank_low1'), v_game, 777001, 10);
  perform pg_temp.scored(pg_temp.player('rank_low2'), v_game, 777001, 20);
  perform pg_temp.scored(pg_temp.player('rank_tie'), v_game, 777001, 50);
  perform pg_temp.scored(pg_temp.player('rank_high'), v_game, 777001, 90);
  -- Another day's board doesn't count.
  perform pg_temp.scored(pg_temp.player('rank_other'), v_game, 777002, 1);

  perform pg_temp.act_as(v_me);
  set local role authenticated;
  select * into v from public.my_daily_rank(v_mine);
  reset role;
  if v.players <> 4 or v.beaten <> 2 then
    raise exception 'rank = % players, % beaten; expected 4 and 2 (a tie is not beaten)', v.players, v.beaten;
  end if;
  raise notice 'ok   a daily run is ranked against the same board only, ties not beaten';

  -- Someone else's run tells this player nothing.
  perform pg_temp.act_as(pg_temp.player('rank_snoop'));
  set local role authenticated;
  select * into v from public.my_daily_rank(v_mine);
  reset role;
  if v.players is not null then
    raise exception 'a player read another player''s rank';
  end if;

  -- Too few others to say anything.
  v_alone := pg_temp.scored(v_me, v_game, 777003, 5);
  perform pg_temp.scored(pg_temp.player('rank_only'), v_game, 777003, 1);
  perform pg_temp.act_as(v_me);
  set local role authenticated;
  select * into v from public.my_daily_rank(v_alone);
  reset role;
  if v.players is not null then
    raise exception 'a board with one other player was ranked';
  end if;
  raise notice 'ok   only the player''s own run, and only with two others on the board';
end $$;

-- ── Saved runs for the feed ─────────────────────────────────────────────────

do $$
declare
  v_me    uuid := pg_temp.player('saved_me');
  v_games uuid[] := array(select id from public.games where status = 'published' order by created_at limit 2);
  v_slugs text[];
begin
  if array_length(v_games, 1) < 2 then
    raise notice 'skip fewer than two published games';
    return;
  end if;
  insert into public.game_sessions (game_id, user_id, rules_version, progress_actions, progress_saved_at, expires_at)
  select v_games[1], v_me, rv, '{1,2,3}', now() - interval '2 hours', now() + interval '1 day'
    from (select min(r) as rv from unnest(array['sudoku@4','queens@2','zip@2']) r
           where public.run_resumable(r)) x;
  insert into public.game_sessions (game_id, user_id, rules_version, progress_actions, progress_saved_at, expires_at)
  select v_games[2], v_me, rv, '{1}', now() - interval '5 minutes', now() + interval '1 day'
    from (select min(r) as rv from unnest(array['sudoku@4','queens@2','zip@2']) r
           where public.run_resumable(r)) x;
  -- Expired: not offered.
  insert into public.game_sessions (game_id, user_id, rules_version, progress_actions, started_at, progress_saved_at, expires_at)
  select v_games[2], v_me, 'sudoku@4', '{1}', now() - interval '4 days', now() - interval '3 days', now() - interval '1 day';

  perform pg_temp.act_as(v_me);
  set local role authenticated;
  select array_agg(r.game_slug order by r.saved_at desc) into v_slugs from public.my_saved_runs() r;
  reset role;
  if v_slugs is distinct from array[
    (select slug::text from public.games where id = v_games[2]),
    (select slug::text from public.games where id = v_games[1])
  ] then
    raise exception 'saved runs = %', v_slugs;
  end if;
  raise notice 'ok   one saved run per game, newest first, expired ones left out';
end $$;

-- ── The weekly recap ────────────────────────────────────────────────────────

do $$
declare
  -- Sunday 19:00 in Tirana is Sunday 13:00 in New York: due in one, not the other.
  v_now   timestamptz := timestamptz '2026-11-15 19:00 Europe/Tirane';
  v_week  date := date '2026-11-09';
  v_in    timestamptz := timestamptz '2026-11-10 12:00 Europe/Tirane';
  v_game  uuid := (select id from public.games order by created_at limit 1);
  v_ana   uuid := pg_temp.player('recap_ana');
  v_ny    uuid := pg_temp.player('recap_ny');
  v_off   uuid := pg_temp.player('recap_off');
  v_gone  uuid := pg_temp.player('recap_gone');
  v       record;
  v_ids   uuid[];
begin
  insert into public.user_preferences (user_id, notify_weekly_recap, time_zone) values
    (v_ana, true, 'Europe/Tirane'),
    (v_ny, true, 'America/New_York'),
    (v_gone, true, 'Europe/Tirane'),
    (v_off, false, 'Europe/Tirane')
  on conflict (user_id) do update
    set notify_weekly_recap = excluded.notify_weekly_recap, time_zone = excluded.time_zone;

  -- Ana: an older best of 40, then three plays this week topping at 60. A play at
  -- 00:30 Monday her time belongs to this week, though it is still Sunday in UTC.
  perform pg_temp.scored(v_ana, v_game, 1, 40, v_in - interval '20 days');
  perform pg_temp.scored(v_ana, v_game, 2, 30, timestamptz '2026-11-09 00:30 Europe/Tirane');
  perform pg_temp.scored(v_ana, v_game, 3, 60, v_in);
  perform pg_temp.scored(v_ana, v_game, 4, 10, v_in + interval '2 hours');
  -- Next week on her clock: not counted.
  perform pg_temp.scored(v_ana, v_game, 5, 99, timestamptz '2026-11-16 00:30 Europe/Tirane');
  perform pg_temp.scored(v_ny, v_game, 6, 10, v_in);
  perform pg_temp.scored(v_off, v_game, 7, 10, v_in);
  perform pg_temp.scored(v_gone, v_game, 8, 10, v_in - interval '60 days');

  select array_agg(r.user_id) into v_ids from public.weekly_recap_due(100, v_now) r
   where r.user_id in (v_ana, v_ny, v_off, v_gone);
  if v_ids is distinct from array[v_ana] then
    raise exception 'due = %, expected only the opted-in, active player whose Sunday evening it is', v_ids;
  end if;

  select * into v from public.weekly_recap_due(100, v_now) r where r.user_id = v_ana;
  if v.week_start <> v_week or v.games_played <> 3 or v.new_bests <> 1
     or v.email <> 'recap_ana@example.com' then
    raise exception 'ana''s week = %', row_to_json(v);
  end if;
  raise notice 'ok   the recap goes out on each player''s own Sunday evening, with their own week';

  -- New York's turn comes six hours later.
  if not exists (select 1 from public.weekly_recap_due(100, v_now + interval '6 hours') r where r.user_id = v_ny) then
    raise exception 'new york was never due';
  end if;
  raise notice 'ok   a later time zone is due later';

  perform public.record_weekly_recap_delivery(v_week, v_ana, null);
  perform public.record_weekly_recap_delivery(v_week, v_ana, 'again');
  if exists (select 1 from public.weekly_recap_due(100, v_now) r where r.user_id = v_ana) then
    raise exception 'a delivered recap is offered again';
  end if;
  raise notice 'ok   one recap per player per week';

  set local role authenticated;
  begin
    perform public.weekly_recap_due(1);
    raise exception 'a player could read the recap list';
  exception when insufficient_privilege then
    null;
  end;
  reset role;
  raise notice 'ok   the recipient list is server-only';
end $$;

-- ── Saving a time zone ──────────────────────────────────────────────────────

do $$
declare
  v_me uuid := pg_temp.player('tz_me');
begin
  perform pg_temp.act_as(v_me);
  set local role authenticated;
  perform public.set_my_time_zone('Europe/Tirane');
  perform public.set_my_time_zone('Not/AZone');
  reset role;
  if (select time_zone from public.user_preferences where user_id = v_me) is distinct from 'Europe/Tirane' then
    raise exception 'time zone = %', (select time_zone from public.user_preferences where user_id = v_me);
  end if;
  raise notice 'ok   a player saves their own time zone, and an unknown one is ignored';
end $$;

rollback;

\echo 'Engagement suite passed.'
