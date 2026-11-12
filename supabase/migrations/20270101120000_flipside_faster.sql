-- Flipside, faster (`flipside@2`).
--
-- Players found the tunnel slow. The new rules keep the game and only retune
-- its speed: the tunnel scrolls 600 a tick from the start (was 420), about 45%
-- faster at full speed (900, was 620, reached by the 50th hazard), gravity is
-- twice as strong (220, falling at most 4200 a tick, a flip's push 600) so a flip
-- takes about 0.43 s instead of 0.65 s, and the first hazard starts at 60 000
-- instead of 90 000, so a run is busy within a second. The hazards, scoring,
-- near misses and the tap buffer are unchanged. A pilot that flips at the last
-- safe tick still clears 300 hazards on every one of 40 seeds tried.
--
-- `flipside@1` stays verifiable: a session opened under it is replayed under it.
-- New sessions pin `flipside@2` (the client asks for it), and the start gate
-- learns the new version. Mirrored by src/lib/games/flipside.ts; the lines in
-- tests/security/verifier_vectors.sql pin both versions to the engine.

create or replace function public.flipside_rules_version()
returns text language sql immutable set search_path = '' as $$ select 'flipside@2'::text $$;

-- The replay gains its rules as an argument. The old two-argument form goes, so
-- a call without one resolves to this function and replays flipside@1, as before.
drop function if exists public.flipside_replay(bigint, integer[]);

create or replace function public.flipside_replay(
  p_seed    bigint,
  p_actions integer[],
  p_rules   text default 'flipside@1',
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
  -- The rules' physics: flipside@2 is the faster tunnel.
  v_gravity   integer;
  v_max_fall  integer;
  v_kick      integer;
  v_first     integer;
  v_speed0    integer;
  v_speed_up  integer;
  v_speed_max integer;
begin
  if p_rules = 'flipside@1' then
    v_gravity := 110; v_max_fall := 2600; v_kick := 300; v_first := 90000;
    v_speed0 := 420; v_speed_up := 5; v_speed_max := 620;
  elsif p_rules = 'flipside@2' then
    v_gravity := 220; v_max_fall := 4200; v_kick := 600; v_first := 60000;
    v_speed0 := 600; v_speed_up := 6; v_speed_max := 900;
  else
    raise exception 'unknown Flipside rules %', p_rules using errcode = '22023';
  end if;

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
  v_hx := v_first;
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
        v_vy := v_g * v_kick;
        v_buffer := 0;
      else
        v_buffer := v_buffer - 1;
      end if;
    end if;

    -- 2–3. Gravity, the move, the scroll (the rules' speed, up per hazard passed).
    v_vy := greatest(-v_max_fall, least(v_max_fall, v_vy + v_g * v_gravity));
    v_prev_y := v_y;
    v_y := v_y + v_vy;
    v_distance := v_distance + least(v_speed_max, v_speed0 + v_speed_up * passed);
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

comment on function public.flipside_replay(bigint, integer[], text) is
  'Replays a Flipside line from a seed under flipside@1 (the default) or flipside@2, tick by tick: whether it is valid, its score, ticks, hazards passed, taps and how it ended. An internal of complete_flipside_run; mirrors replay() in src/lib/games/flipside.ts.';

revoke all on function public.flipside_replay(bigint, integer[], text) from public;

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
  v_rules   text;
  v_replay  record;
  v_result  public.play_result;
  v_session public.game_sessions;
  v_best    bigint;
  v_rank    bigint;
begin
  -- The session checks every verifier shares: owner, open, rules, size, time.
  -- A session keeps the rules it was opened under: flipside@1 is still replayed
  -- for one opened before the faster tunnel. Anything else is held to the
  -- current rules, which the gate then refuses as wrong_rules.
  select s.rules_version into v_rules from public.game_sessions s where s.id = p_session_id;
  if v_rules is distinct from 'flipside@1' then
    v_rules := public.flipside_rules_version();
  end if;

  select * into v_gate from public.speed_run_gate(
    p_session_id, p_actions, p_score, p_duration_ms,
    v_rules, public.flipside_max_actions());
  if (v_gate.refusal).outcome is not null then
    return v_gate.refusal;
  end if;

  v_result.session_id := (v_gate.session).id;
  v_result.game_slug := (v_gate.game).slug;

  select * into v_replay from public.flipside_replay((v_gate.session).seed, p_actions, v_rules);

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
  'Replays a submitted Flipside run from its session seed under the rules the session was opened with (flipside@1 or flipside@2), derives the score and records it. The claim is compared, never trusted.';

revoke all on function public.complete_flipside_run(uuid, integer[], bigint, integer) from public;
grant execute on function public.complete_flipside_run(uuid, integer[], bigint, integer) to anon, authenticated;

-- The start gate learns flipside@2. The flipside@1 row stays, so a client that
-- has not reloaded since still gets a session it can play and have verified.
insert into public.game_runtimes (runtime, rules_version, max_actions, session_hours)
values ('flipside', 'flipside@2', public.flipside_max_actions(), 2)
on conflict (runtime, rules_version) do update
  set max_actions   = excluded.max_actions,
      session_hours = excluded.session_hours;
