-- Foursort (`foursort@1`): sixteen words, four hidden groups, verified by the database.
--
-- Pick four words that belong together; right locks the group in, wrong costs one
-- of four mistakes. Every puzzle has the same shape — word id `4 × group + place` —
-- so a group is always the same four ids and the verifier needs no bank: the words
-- live only in the client (`src/lib/games/foursort-bank.ts`).
--
--   1. The rules version and the bound on a submission.
--   2. `foursort_score(day, actions)`: the replay, null for a run that is not legal.
--   3. `complete_foursort_run`, the verifier: the generic gate, one completion a day
--      (`already_played`), the replay, and `speed_run_finish` with no par.
--   4. The registry row. The day seed is `20270105120200_foursort_pixelock_start.sql`.
--
-- Nothing a user can see changes: `20270105120300_foursort_pixelock_playable.sql`
-- flips the catalogue and lands last. Mirrored by src/lib/games/foursort.ts. See
-- docs/games/README.md.

create or replace function public.foursort_rules_version()
returns text language sql immutable set search_path = '' as $$ select 'foursort@1'::text $$;

-- Three groups found and four mistakes before the last guess: seven at most.
create or replace function public.foursort_max_actions()
returns integer language sql immutable set search_path = '' as $$ select 7 $$;

comment on function public.foursort_rules_version() is 'The Foursort rules version: foursort@1.';
comment on function public.foursort_max_actions() is
  'The most guesses one Foursort submission may carry: seven.';

-- The score a day's guesses make, or null when they are not a legal run. A guess
-- is the 16-bit mask of the four ids picked; one that is not exactly four bits,
-- touches a group already found, repeats an earlier guess or comes after the run is
-- over (all four found, or the fourth mistake) is not legal. Stopping early is.
-- The day does not change the rules — every puzzle has the same shape — but stays
-- in the signature, as for every daily game.
create or replace function public.foursort_score(p_day bigint, p_actions integer[])
returns bigint
language plpgsql
immutable
set search_path = ''
as $$
declare
  v_seen     integer[] := '{}';
  v_taken    integer := 0;   -- the ids of every group found
  v_found    integer := 0;
  v_mistakes integer := 0;
  v_over     boolean := false;
  v_action   integer;
  v_bits     integer;
  v_group    integer;
  v_g        integer;
begin
  perform p_day;
  foreach v_action in array coalesce(p_actions, '{}'::integer[]) loop
    if v_over or v_action is null or v_action <= 0 or v_action >= 65536
       or v_action = any(v_seen) or (v_action & v_taken) <> 0 then
      return null;
    end if;
    v_bits := length(replace((v_action::bit(16))::text, '0', ''));
    if v_bits <> 4 then
      return null;
    end if;
    v_seen := v_seen || v_action;

    v_group := -1;
    for v_g in 0..3 loop
      if v_action = (15 << (4 * v_g)) then
        v_group := v_g;
      end if;
    end loop;

    if v_group >= 0 then
      v_found := v_found + 1;
      v_taken := v_taken | v_action;
    else
      v_mistakes := v_mistakes + 1;
    end if;
    if v_found = 4 or v_mistakes >= 4 then
      v_over := true;
    end if;
  end loop;

  if v_found = 4 then
    return v_found * 15 + 10 * (4 - v_mistakes);
  end if;
  return v_found * 15;
end;
$$;

comment on function public.foursort_score(bigint, integer[]) is
  'A Foursort day''s guesses replayed: 15 a group found, and 10 for every mistake left when all four are found; null when the guesses are not a legal run.';

revoke all on function public.foursort_score(bigint, integer[]) from public;

create or replace function public.complete_foursort_run(
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
    public.foursort_rules_version(), public.foursort_max_actions());
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

  v_score := public.foursort_score((v_gate.session).seed, p_actions);
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

comment on function public.complete_foursort_run(uuid, integer[], bigint, integer) is
  'Foursort: replays a day''s guesses and records the score.';

revoke all on function public.complete_foursort_run(uuid, integer[], bigint, integer) from public;
grant execute on function public.complete_foursort_run(uuid, integer[], bigint, integer) to anon, authenticated;

insert into public.game_runtimes (runtime, rules_version, max_actions, session_hours) values
  ('foursort', public.foursort_rules_version(), public.foursort_max_actions(), 2)
on conflict (runtime, rules_version) do update
  set max_actions   = excluded.max_actions,
      session_hours = excluded.session_hours;
