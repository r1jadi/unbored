-- Then & Now (`then-and-now@1`): six events in the order they happened, verified by
-- the database.
--
-- The events arrive shuffled; a try submits an order, and every event in its right
-- place locks in. Four tries. Every puzzle lists its events oldest first
-- (`src/lib/games/then-and-now-bank.ts`), so event id `i` belongs in place `i` and
-- the verifier needs no bank.
--
--   1. The rules version and the bound on a submission.
--   2. `then_and_now_score(day, actions)`: the replay, null for a run that is not legal.
--   3. `complete_then_and_now_run`, the verifier: the generic gate, one completion a
--      day (`already_played`), the replay, and `speed_run_finish` with no par.
--   4. The registry row. The day seed is `20270106120200_then_and_now_honeycomb_start.sql`.
--
-- Nothing a user can see changes: `20270106120300_then_and_now_honeycomb_playable.sql`
-- flips the catalogue and lands last. Mirrored by src/lib/games/then-and-now.ts. See
-- docs/games/README.md.

create or replace function public.then_and_now_rules_version()
returns text language sql immutable set search_path = '' as $$ select 'then-and-now@1'::text $$;

create or replace function public.then_and_now_max_actions()
returns integer language sql immutable set search_path = '' as $$ select 4 $$;

comment on function public.then_and_now_rules_version() is 'The Then & Now rules version: then-and-now@1.';
comment on function public.then_and_now_max_actions() is
  'The most tries one Then & Now submission may carry: four.';

-- The score a day's tries make, or null when they are not a legal run. A try is the
-- order submitted, `sum of id at place p * 6^p`; one that is not an order of all six
-- ids, moves an event already locked in, repeats an earlier try or comes after the
-- run is over (all six placed, or the fourth try) is not legal. Stopping early is.
-- The day does not change the rules but stays in the signature, as for every daily
-- game.
create or replace function public.then_and_now_score(p_day bigint, p_actions integer[])
returns bigint
language plpgsql
immutable
set search_path = ''
as $$
declare
  v_seen   integer[] := '{}';
  v_locked boolean[] := array_fill(false, array[6]);
  v_placed integer := 0;
  v_tries  integer := 0;
  v_over   boolean := false;
  v_action integer;
  v_rest   integer;
  v_id     integer;
  v_used   integer;
  v_p      integer;
begin
  perform p_day;
  foreach v_action in array coalesce(p_actions, '{}'::integer[]) loop
    if v_over or v_action is null or v_action < 0 or v_action >= 46656
       or v_action = any(v_seen) then
      return null;
    end if;
    v_rest := v_action;
    v_used := 0;
    v_placed := 0;
    for v_p in 0..5 loop
      v_id := v_rest % 6;
      v_rest := v_rest / 6;
      if (v_used & (1 << v_id)) <> 0 then
        return null;   -- an id twice: not an order
      end if;
      v_used := v_used | (1 << v_id);
      if v_locked[v_p + 1] and v_id <> v_p then
        return null;   -- a locked event moved
      end if;
    end loop;
    v_rest := v_action;
    for v_p in 0..5 loop
      v_id := v_rest % 6;
      v_rest := v_rest / 6;
      v_locked[v_p + 1] := v_id = v_p;
      if v_id = v_p then
        v_placed := v_placed + 1;
      end if;
    end loop;
    v_seen := v_seen || v_action;
    v_tries := v_tries + 1;
    if v_placed = 6 or v_tries >= 4 then
      v_over := true;
    end if;
  end loop;

  if v_placed = 6 then
    return v_placed * 10 + 20 * (4 - v_tries);
  end if;
  return v_placed * 10;
end;
$$;

comment on function public.then_and_now_score(bigint, integer[]) is
  'A Then & Now day''s tries replayed: 10 an event in place, and 20 for every try left when all six are; null when the tries are not a legal run.';

revoke all on function public.then_and_now_score(bigint, integer[]) from public;

create or replace function public.complete_then_and_now_run(
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
    public.then_and_now_rules_version(), public.then_and_now_max_actions());
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

  v_score := public.then_and_now_score((v_gate.session).seed, p_actions);
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
    0, v_gate.elapsed, case when v_score >= 60 then 1 else 0 end,
    coalesce(cardinality(p_actions), 0), p_duration_ms);
end;
$$;

comment on function public.complete_then_and_now_run(uuid, integer[], bigint, integer) is
  'Then & Now: replays a day''s tries and records the score.';

revoke all on function public.complete_then_and_now_run(uuid, integer[], bigint, integer) from public;
grant execute on function public.complete_then_and_now_run(uuid, integer[], bigint, integer) to anon, authenticated;

insert into public.game_runtimes (runtime, rules_version, max_actions, session_hours) values
  ('then-and-now', public.then_and_now_rules_version(), public.then_and_now_max_actions(), 2)
on conflict (runtime, rules_version) do update
  set max_actions   = excluded.max_actions,
      session_hours = excluded.session_hours;
