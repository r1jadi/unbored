-- Flipside (`flipside@1`): the one-tap gravity flipper, verified by the database.
--
-- A runner speeds along a tunnel. A tap flips gravity, and it falls to the other
-- side: floor to ceiling and back. Holes in the floor and the ceiling, and spikes
-- on them, end the run; skimming spikes without touching them is a near miss,
-- worth a combo bonus. Like Flutter (`updraft@1`), time is part of the rules: the
-- world advances in fixed ticks, sixty a second, the physics is whole numbers
-- only, and an action is `2 × tick` for a tap and `2 × tick + 1` for the player
-- ending the run before that tick.
--
-- This migration adds the rules, the replay (`flipside_replay`), the verifier
-- (`complete_flipside_run`) and the (`flipside`, `flipside@1`) row in
-- `public.game_runtimes`. A run cannot be saved and continued — a runner in
-- mid-flip cannot pause — so `run_resumable` is not touched. Nothing a user can
-- see changes: `20261230120100_flipside_playable.sql` flips the catalogue and
-- lands last. Mirrored by src/lib/games/flipside.ts; the lines in
-- tests/security/verifier_vectors.sql pin the two together. See
-- docs/games/README.md.

-- ─────────────────────────────────────────────────────────────────────────────
-- The rules, as constants the database owns
-- ─────────────────────────────────────────────────────────────────────────────

create or replace function public.flipside_rules_version()
returns text language sql immutable set search_path = '' as $$ select 'flipside@1'::text $$;

-- Thirty minutes of ticks at sixty a second.
create or replace function public.flipside_max_ticks()
returns integer language sql immutable set search_path = '' as $$ select 108000 $$;

create or replace function public.flipside_max_actions()
returns integer language sql immutable set search_path = '' as $$ select 8192 $$;

comment on function public.flipside_rules_version() is
  'The Flipside rules version new sessions pin. A rules change needs a new version and a new verifier branch.';
comment on function public.flipside_max_ticks() is
  'The most ticks a Flipside run may last: thirty minutes at sixty a second. A bound, not a level.';
comment on function public.flipside_max_actions() is
  'The most actions a Flipside submission may carry: taps, and the stop of a run the player ended.';

-- ─────────────────────────────────────────────────────────────────────────────
-- The replay: a seed and a line of actions, tick by tick
-- ─────────────────────────────────────────────────────────────────────────────
--
-- Mirrors replay() and step() in src/lib/games/flipside.ts. `valid` is false for
-- impossible play: an action out of order, twice on one tick, or after the run
-- ended. `ending` is 'crash', 'stop' or 'limit'.

create or replace function public.flipside_replay(
  p_seed    bigint,
  p_actions integer[],
  out valid  boolean,
  out score  bigint,
  out ticks  integer,
  out passed integer,
  out placed integer,
  out ending text
)
language plpgsql
immutable
set search_path = ''
as $$
declare
  v_state     bigint;
  v_draw      integer;
  -- The next hazard: its left edge, width, surface (0 floor, 1 ceiling) and
  -- kind (0 hole, 1 spikes). Only the next one can touch the runner: the clear
  -- rock between two hazards is wider than the runner.
  v_hx        integer;
  v_hw        integer;
  v_surface   integer;
  v_kind      integer;
  v_left      integer;
  v_right     integer;
  v_over_hole boolean;
  v_floor_ok  boolean;
  v_ceil_ok   boolean;
  v_clear     integer;
  v_crashed   boolean;
  v_count     integer := coalesce(array_length(p_actions, 1), 0);
  v_index     integer := 1;
  v_action    integer;
  v_y         integer := 85000;
  v_prev_y    integer;
  v_vy        integer := 0;
  v_g         integer := 1;
  v_distance  integer := 0;
  v_buffer    integer := 0;
  v_grazing   boolean := false;
  v_combo     integer := 0;
begin
  valid := true;
  score := 0;
  ticks := 0;
  passed := 0;
  placed := 0;
  ending := 'limit';

  -- The generator every game uses, one draw per hazard, read from bit 16 up.
  v_state := (p_seed % 4294967296 + 4294967296) % 4294967296;
  if v_state = 0 then
    v_state := 2654435769; -- 0x9E3779B9: a zero state would make the sequence degenerate
  end if;

  -- Hazard 0. A draw's parts: bit 0 the surface; bits 1–3 spikes when under 3
  -- (never for the first three hazards); bits 4–7 extra width, (mod 9) × 500;
  -- bits 8–15 extra room before it, (mod 13) × 1000.
  v_state := (v_state * 1664525 + 1013904223) % 4294967296;
  v_draw := (v_state >> 16)::integer;
  v_hx := 90000;
  v_hw := 12000 + (((v_draw >> 4) & 15) % 9) * 500;
  v_surface := v_draw & 1;
  v_kind := 0;

  loop
    if v_index <= v_count then
      v_action := p_actions[v_index];
      if v_action < 2 * ticks then
        valid := false;
        return;
      end if;
      if v_action = 2 * ticks + 1 then
        -- The player ended the run here. Nothing may follow the stop.
        v_index := v_index + 1;
        ending := 'stop';
        exit;
      end if;
      if v_action = 2 * ticks then
        -- A tap waits up to six ticks to land; one made while another waits is
        -- the same tap.
        if v_buffer = 0 then
          v_buffer := 6;
          placed := placed + 1;
        end if;
        v_index := v_index + 1;
      end if;
    end if;

    -- 1. A waiting tap flips gravity if the runner stands on its surface.
    if v_buffer > 0 then
      if v_y = (case when v_g = 1 then 85000 else 15000 end) then
        v_g := -v_g;
        v_vy := v_g * 300;
        v_buffer := 0;
      else
        v_buffer := v_buffer - 1;
      end if;
    end if;

    -- 2–3. Gravity, the move, the scroll: 420 a tick, five more per hazard
    -- passed, up to 620.
    v_vy := greatest(-2600, least(2600, v_vy + v_g * 110));
    v_prev_y := v_y;
    v_y := v_y + v_vy;
    v_distance := v_distance + least(620, 420 + 5 * passed);
    ticks := ticks + 1;

    v_left := v_hx - v_distance;
    v_right := v_left + v_hw;
    v_over_hole := v_kind = 0 and v_left <= 19000 and v_right >= 25000;
    v_floor_ok := not (v_over_hole and v_surface = 0);
    v_ceil_ok := not (v_over_hole and v_surface = 1);
    v_crashed := false;

    -- 4. Crossing a surface lands on it, unless a hole lies wholly under the
    -- runner; fallen in, it hits the hole's far wall or drops out of the tunnel.
    if v_y > 85000 then
      if v_prev_y <= 85000 and v_floor_ok then
        v_y := 85000;
        v_vy := 0;
      elsif v_floor_ok or v_y >= 91000 then
        v_crashed := true;
      end if;
    elsif v_y < 15000 then
      if v_prev_y >= 15000 and v_ceil_ok then
        v_y := 15000;
        v_vy := 0;
      elsif v_ceil_ok or v_y <= 9000 then
        v_crashed := true;
      end if;
    end if;

    -- 5. Spikes 4000 tall: touching them crashes, passing within 3000 grazes.
    if not v_crashed and v_kind = 1 and v_left < 25000 and v_right > 19000 then
      v_clear := case when v_surface = 0 then 84000 - (v_y + 3000)
                      else v_y - 3000 - 16000 end;
      if v_clear < 0 then
        v_crashed := true;
      elsif v_clear <= 3000 then
        v_grazing := true;
      end if;
    end if;

    -- 6. A crash ends the run before any score this tick.
    if v_crashed then
      ending := 'crash';
      exit;
    end if;

    -- 7. A hazard wholly behind the runner is passed: one point, and grazed
    -- spikes add the combo. Then the next hazard is drawn.
    if v_right < 19000 then
      passed := passed + 1;
      score := score + 1;
      if v_kind = 1 then
        if v_grazing then
          v_combo := v_combo + 1;
          score := score + v_combo;
        else
          v_combo := 0;
        end if;
      end if;
      v_grazing := false;

      v_state := (v_state * 1664525 + 1013904223) % 4294967296;
      v_draw := (v_state >> 16)::integer;
      v_hx := v_hx + 38000 + ((v_draw >> 8) % 13) * 1000;
      v_hw := least(20000, 12000 + 200 * passed) + (((v_draw >> 4) & 15) % 9) * 500;
      v_surface := v_draw & 1;
      v_kind := case when passed >= 3 and ((v_draw >> 1) & 7) < 3 then 1 else 0 end;
    end if;

    exit when ticks >= public.flipside_max_ticks();
  end loop;

  -- The run is over, so any action left is one it never reached.
  if v_index <= v_count then
    valid := false;
  end if;
end;
$$;

comment on function public.flipside_replay(bigint, integer[]) is
  'Replays a Flipside line from a seed, tick by tick: whether it is valid, its score, ticks, hazards passed, taps and how it ended. An internal of complete_flipside_run; mirrors replay() in src/lib/games/flipside.ts.';

revoke all on function public.flipside_replay(bigint, integer[]) from public;

-- ─────────────────────────────────────────────────────────────────────────────
-- Complete a run: replay, verify, then record
-- ─────────────────────────────────────────────────────────────────────────────

create or replace function public.complete_flipside_run(
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
  v_gate    record;
  v_replay  record;
  v_result  public.play_result;
  v_session public.game_sessions;
  v_best    bigint;
  v_rank    bigint;
begin
  -- The session checks every verifier shares: owner, open, rules, size, time.
  select * into v_gate from public.speed_run_gate(
    p_session_id, p_actions, p_score, p_duration_ms,
    public.flipside_rules_version(), public.flipside_max_actions());
  if (v_gate.refusal).outcome is not null then
    return v_gate.refusal;
  end if;

  v_result.session_id := (v_gate.session).id;
  v_result.game_slug := (v_gate.game).slug;

  select * into v_replay from public.flipside_replay((v_gate.session).seed, p_actions);

  if not v_replay.valid then
    v_result.outcome := 'invalid_actions';
    return v_result;
  end if;

  -- A run cannot have lasted longer than its session has been open: the
  -- screen's clock never runs faster than real time.
  if v_replay.ticks::bigint * 1000 / 60 > v_gate.elapsed + 2000 then
    v_result.outcome := 'invalid_duration';
    return v_result;
  end if;

  if p_score is distinct from v_replay.score then
    v_result.outcome := 'score_mismatch';
    v_result.score := v_replay.score;
    return v_result;
  end if;

  update public.game_sessions s
     set completed_at    = now(),
         verified_score  = v_replay.score,
         verified_digest = v_gate.digest
   where s.id = (v_gate.session).id
  returning * into v_session;

  if v_session.user_id is not null then
    insert into public.scores (session_id, game_id, user_id, score, duration_ms)
    values (v_session.id, v_session.game_id, v_session.user_id, v_replay.score, p_duration_ms);
  end if;

  v_result.outcome         := 'recorded';
  v_result.score           := v_replay.score;
  v_result.cleared_columns := v_replay.passed;
  v_result.tiles_placed    := v_replay.placed;
  v_result.duration_ms     := p_duration_ms;
  v_result.ranked          := v_session.user_id is not null;
  v_result.recorded_at     := v_session.completed_at;

  if v_session.user_id is not null then
    select max(s.score) into v_best from public.scores s
     where s.game_id = v_session.game_id and s.user_id = v_session.user_id;
    select count(*) + 1 into v_rank from (
      select s.user_id, max(s.score) as best
        from public.scores s
       where s.game_id = v_session.game_id and s.user_id is not null
       group by s.user_id
    ) t where t.best > coalesce(v_best, 0) and t.user_id <> v_session.user_id;
    v_result.personal_best := v_best;
    v_result.board_rank    := v_rank;
  end if;

  return v_result;
end;
$$;

comment on function public.complete_flipside_run(uuid, integer[], bigint, integer) is
  'Replays a submitted Flipside run from its session seed (flipside_replay), derives the score and records it. A run ends at a crash, at the player''s stop, or at the thirty-minute bound. The claim is compared, never trusted.';

revoke all on function public.complete_flipside_run(uuid, integer[], bigint, integer) from public;
grant execute on function public.complete_flipside_run(uuid, integer[], bigint, integer) to anon, authenticated;

-- ─────────────────────────────────────────────────────────────────────────────
-- The start gate learns Flipside
-- ─────────────────────────────────────────────────────────────────────────────

-- Two hours, like Flutter: a run cannot pause, so it never needs twelve.
insert into public.game_runtimes (runtime, rules_version, max_actions, session_hours)
values ('flipside', public.flipside_rules_version(), public.flipside_max_actions(), 2)
on conflict (runtime, rules_version) do update
  set max_actions   = excluded.max_actions,
      session_hours = excluded.session_hours;
