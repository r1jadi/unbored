-- Ballpark (`ballpark@1`): guess the day's price, verified by the database.
--
-- One product a day and six guesses at its price, in cents. Within 5% wins, and
-- fewer guesses score more: (7 − k) × 10 on guess k.
--
--   1. The rules version and the prices, in cents, in the order the client lists
--      its products (`src/lib/games/ballpark-bank.ts`), written by
--      `bun scripts/generate-daily-banks.ts --write`.
--   2. `ballpark_score(day, actions)`: the replay, null for a run that is not legal.
--   3. `complete_ballpark_run`, the verifier, as Guesswork's.
--   4. The registry row. The day seed is `20270104120400_daily_four_start.sql`.
--
-- Nothing a user can see changes until `20270104120500_daily_four_playable.sql`.
-- Mirrored by src/lib/games/ballpark.ts. See docs/games/README.md.

create or replace function public.ballpark_rules_version()
returns text language sql immutable set search_path = '' as $$ select 'ballpark@1'::text $$;

create or replace function public.ballpark_max_actions()
returns integer language sql immutable set search_path = '' as $$ select 6 $$;

comment on function public.ballpark_rules_version() is 'The Ballpark rules version: ballpark@1.';
comment on function public.ballpark_max_actions() is
  'The most moves one Ballpark submission may carry: six guesses.';

create or replace function public.ballpark_prices()
returns integer[] language sql immutable set search_path = '' as $$
  select array[
    -- ballpark-prices:begin
    65, 29999, 349, 3499, 399, 8999, 150, 9900, 299, 24900, 899, 54900,
    329, 3999, 499, 49999, 549, 2499, 349, 4999, 179, 12999, 799, 18900,
    399, 4499, 1299, 37999, 139, 13000, 699, 24900, 549, 4499, 599, 44999,
    499, 399, 49999, 999, 3499, 499, 89999, 449, 9999, 599, 12999, 599,
    4999, 499, 34900, 399, 14999, 1199, 49999, 599, 3499, 1199, 19999, 599,
    7999, 449, 29999, 599, 3999, 199, 199999, 999, 2999, 1399, 19999, 179,
    14999, 349, 69999, 199, 3999, 599, 99999, 899, 2499, 699, 79999, 599,
    1999, 1199, 59999, 349, 5999, 599, 2999, 449, 119999, 349, 2999, 399,
    9999, 199, 10999
    -- ballpark-prices:end
  ]::integer[]
$$;

comment on function public.ballpark_prices() is
  'ballpark@1''s daily prices in cents: day d is entry d mod n. Mirrored by src/lib/games/ballpark-bank.ts.';

-- The score a day's guesses make, or null when they are not a legal run: a guess
-- outside 1 … 99 999 999 cents, or one after the run was over (a hit, or the
-- sixth). Stopping early is giving up, and is legal.
create or replace function public.ballpark_score(p_day bigint, p_actions integer[])
returns bigint
language plpgsql
immutable
set search_path = ''
as $$
declare
  v_prices integer[] := public.ballpark_prices();
  v_n      integer := cardinality(public.ballpark_prices());
  v_price  bigint;
  v_used   integer := 0;
  v_solved boolean := false;
  v_action integer;
begin
  v_price := v_prices[(((p_day % v_n) + v_n) % v_n)::integer + 1];
  foreach v_action in array coalesce(p_actions, '{}'::integer[]) loop
    if v_solved or v_used >= 6 or v_action < 1 or v_action > 99999999 then
      return null;
    end if;
    v_used := v_used + 1;
    v_solved := abs(v_action::bigint - v_price) * 100 <= 5 * v_price;
  end loop;
  if v_solved then
    return (7 - v_used) * 10;
  end if;
  return 0;
end;
$$;

comment on function public.ballpark_score(bigint, integer[]) is
  'A Ballpark day''s guesses replayed: (7 − k) × 10 for a hit within 5% on guess k, else 0; null when the guesses are not a legal run.';

revoke all on function public.ballpark_score(bigint, integer[]) from public;

create or replace function public.complete_ballpark_run(
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
    public.ballpark_rules_version(), public.ballpark_max_actions());
  if (v_gate.refusal).outcome is not null then
    return v_gate.refusal;
  end if;

  v_result.session_id := (v_gate.session).id;
  v_result.game_slug := (v_gate.game).slug;

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

  v_score := public.ballpark_score((v_gate.session).seed, p_actions);
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
    0, v_gate.elapsed, case when v_score > 0 then 1 else 0 end,
    coalesce(cardinality(p_actions), 0), p_duration_ms);
end;
$$;

comment on function public.complete_ballpark_run(uuid, integer[], bigint, integer) is
  'Ballpark: replays a day''s guesses on the day''s price and records the score.';

revoke all on function public.complete_ballpark_run(uuid, integer[], bigint, integer) from public;
grant execute on function public.complete_ballpark_run(uuid, integer[], bigint, integer) to anon, authenticated;

insert into public.game_runtimes (runtime, rules_version, max_actions, session_hours) values
  ('ballpark', public.ballpark_rules_version(), public.ballpark_max_actions(), 2)
on conflict (runtime, rules_version) do update
  set max_actions   = excluded.max_actions,
      session_hours = excluded.session_hours;
