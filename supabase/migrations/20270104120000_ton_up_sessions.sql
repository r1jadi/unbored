-- Ton Up (`ton-up@1`): three darts at exactly one hundred, verified by the database.
--
-- One category a day — chemical elements, US presidents, calling codes — whose
-- every answer is worth a number. A dart names an answer and adds its number; up to
-- three darts, each answer once; stand whenever you like. Past 100 is a bust and
-- scores nothing; exactly 100 is a ton, worth more in fewer darts.
--
--   1. The rules version and the bank: each category's values, in the order the
--      client lists its answers (`src/lib/games/ton-up-bank.ts`), written by
--      `bun scripts/generate-daily-banks.ts --write`.
--   2. `ton_up_score(day, actions)`: the replay, null for a run that is not legal.
--   3. `complete_ton_up_run`, the verifier: the generic gate, one completion a day
--      (`already_played`), the replay, and `speed_run_finish` with no par.
--   4. The registry row. The day seed is `20270104120400_daily_four_start.sql`.
--
-- Nothing a user can see changes: `20270104120500_daily_four_playable.sql` flips
-- the catalogue and lands last. Mirrored by src/lib/games/ton-up.ts. See
-- docs/games/README.md.

create or replace function public.ton_up_rules_version()
returns text language sql immutable set search_path = '' as $$ select 'ton-up@1'::text $$;

-- Three darts, one move each.
create or replace function public.ton_up_max_actions()
returns integer language sql immutable set search_path = '' as $$ select 3 $$;

comment on function public.ton_up_rules_version() is 'The Ton Up rules version: ton-up@1.';
comment on function public.ton_up_max_actions() is
  'The most moves one Ton Up submission may carry: three darts.';

create or replace function public.ton_up_category_count()
returns integer language sql immutable set search_path = '' as $$
  select
    -- ton-up-count:begin
    5
    -- ton-up-count:end
$$;

-- A category's values: answer i (from 0) is worth element i + 1.
create or replace function public.ton_up_values(p_category integer)
returns integer[] language sql immutable set search_path = '' as $$
  select case p_category
    -- ton-up-values:begin
    when 0 then array[1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20, 21, 22, 23, 24, 25, 26, 27, 28, 29, 30, 31, 32, 33, 34, 35, 36, 37, 38, 39, 40, 41, 42, 43, 44, 45, 46, 47, 48, 49, 50, 51, 52, 53, 54, 55, 56, 57, 58, 59, 60, 61, 62, 63, 64, 65, 66, 67, 68, 69, 70, 71, 72, 73, 74, 75, 76, 77, 78, 79, 80, 81, 82, 83, 84, 85, 86, 87, 88, 89, 90, 91, 92, 93, 94, 95, 96, 97, 98, 99, 100, 101, 102, 103, 104, 105, 106, 107, 108, 109, 110, 111, 112, 113, 114, 115, 116, 117, 118]
    when 1 then array[1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20, 21, 22, 23, 24, 25, 26, 27, 28, 29, 30, 31, 32, 33, 34, 35, 36, 37, 38, 39, 40, 41, 42, 43, 44, 45, 46, 47]
    when 2 then array[1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20, 21, 22, 23, 24, 25, 26, 27, 28, 29, 30, 31, 32, 33, 34, 35, 36, 37, 38, 39, 40, 41, 42, 43, 44, 45, 46, 47, 48, 49, 50]
    when 3 then array[1, 1, 7, 7, 20, 27, 30, 31, 32, 33, 34, 36, 39, 40, 41, 43, 44, 45, 46, 47, 48, 49, 51, 52, 53, 54, 55, 56, 57, 58, 60, 61, 62, 63, 64, 65, 66, 81, 82, 84, 86, 90, 91, 92, 93, 94, 95, 98, 212, 233, 234, 251, 254, 351, 352, 353, 354, 355, 358, 359, 380, 381, 385, 420, 880, 966, 971, 972, 974, 977]
    when 4 then array[1, 6, 25, 26, 27, 33, 45, 60, 67, 73, 76, 81, 91, 97, 112, 113, 121, 125, 156, 170, 182, 185, 195, 304, 309, 315, 358, 359, 360, 365]
    -- ton-up-values:end
  end
$$;

comment on function public.ton_up_values(integer) is
  'ton-up@1''s answer values by category. Mirrored by src/lib/games/ton-up-bank.ts.';

-- The score a day's darts make, or null when they are not a legal run: an answer
-- out of range, thrown twice, or after the run was over (a bust, a ton, or the
-- third dart). Stopping early is standing, and is legal.
create or replace function public.ton_up_score(p_day bigint, p_actions integer[])
returns bigint
language plpgsql
immutable
set search_path = ''
as $$
declare
  v_count  integer := public.ton_up_category_count();
  v_values integer[];
  v_used   integer[] := '{}';
  v_total  integer := 0;
  v_over   boolean := false;
  v_action integer;
begin
  v_values := public.ton_up_values((((p_day % v_count) + v_count) % v_count)::integer);
  foreach v_action in array coalesce(p_actions, '{}'::integer[]) loop
    if v_over or v_action < 0 or v_action >= cardinality(v_values) or v_action = any(v_used) then
      return null;
    end if;
    v_used := v_used || v_action;
    v_total := v_total + v_values[v_action + 1];
    if v_total >= 100 or cardinality(v_used) >= 3 then
      v_over := true;
    end if;
  end loop;
  if v_total > 100 then
    return 0;
  elsif v_total = 100 then
    return 100 + 25 * (4 - cardinality(v_used));
  end if;
  return v_total;
end;
$$;

comment on function public.ton_up_score(bigint, integer[]) is
  'A Ton Up day''s darts replayed: 0 for a bust, 100 + 25 × (4 − darts) for a ton, else the total; null when the darts are not a legal run.';

revoke all on function public.ton_up_values(integer) from public;
revoke all on function public.ton_up_score(bigint, integer[]) from public;

create or replace function public.complete_ton_up_run(
  p_session_id  uuid,
  p_actions     integer[],
  p_score       bigint,
  p_duration_ms integer
)
returns public.play_result
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_gate   record;
  v_result public.play_result;
  v_score  bigint;
begin
  select * into v_gate from public.speed_run_gate(
    p_session_id, p_actions, p_score, p_duration_ms,
    public.ton_up_rules_version(), public.ton_up_max_actions());
  if (v_gate.refusal).outcome is not null then
    return v_gate.refusal;
  end if;

  v_result.session_id := (v_gate.session).id;
  v_result.game_slug := (v_gate.game).slug;

  -- One ranked play a day: the day is the seed.
  if (v_gate.session).user_id is not null and exists (
    select 1
      from public.game_sessions s
     where s.game_id = (v_gate.session).game_id
       and s.user_id = (v_gate.session).user_id
       and s.seed = (v_gate.session).seed
       and s.id <> (v_gate.session).id
       and s.completed_at is not null
  ) then
    v_result.outcome := 'already_played';
    return v_result;
  end if;

  v_score := public.ton_up_score((v_gate.session).seed, p_actions);
  if v_score is null then
    v_result.outcome := 'invalid_actions';
    return v_result;
  end if;

  if p_score is distinct from v_score then
    v_result.outcome := 'score_mismatch';
    v_result.score := v_score;
    return v_result;
  end if;

  return public.speed_run_finish(
    v_gate.session, v_gate.game, v_gate.digest, v_score,
    0, v_gate.elapsed, case when v_score >= 100 then 1 else 0 end,
    coalesce(cardinality(p_actions), 0), p_duration_ms);
end;
$$;

comment on function public.complete_ton_up_run(uuid, integer[], bigint, integer) is
  'Ton Up: replays a day''s darts on the day''s category and records the score.';

revoke all on function public.complete_ton_up_run(uuid, integer[], bigint, integer) from public;
grant execute on function public.complete_ton_up_run(uuid, integer[], bigint, integer) to anon, authenticated;

insert into public.game_runtimes (runtime, rules_version, max_actions, session_hours) values
  ('ton-up', public.ton_up_rules_version(), public.ton_up_max_actions(), 2)
on conflict (runtime, rules_version) do update
  set max_actions   = excluded.max_actions,
      session_hours = excluded.session_hours;
