-- Crowns (`queens@2`), Sudoku (`sudoku@4`) and Mini Sudoku (`mini-sudoku@2`): no way
-- to lose to a clock or to mistakes, and a bonus for being quick.
--
-- Every board has a par time. A run ahead of the par of its solved boards earns its
-- points again, scaled by how much of the par was left: up to double, and nothing at
-- par or slower. The time is the server's own, measured from the session's start,
-- so a client cannot claim it, and the score recorded is the replay's plus the bonus.
-- A claim is still compared, but only with the replay's points: the client cannot
-- know the exact millisecond the server will read.
--
-- Crowns changes the most. A crown off the solution is no longer a mistake: nothing
-- is locked and nothing ends the run. Action 81 takes back the last tap on the board
-- and 82 empties it, both free. A board is solved when its crowns are the solution's.
--
-- The earlier rules stay replayable: `complete_queens_run`, `complete_sudoku_run` and
-- `complete_mini_sudoku_run` are untouched, so a run already under way can still be
-- submitted under the rules it pinned. New rules get new verifiers, routed by version
-- in services/game-sessions/internal/rulesets.
--
-- Apply this before deploying the service and the client. Nothing a user can see
-- changes until then. `20261217120100_speed_runs_copy.sql` rewrites the catalogue
-- text, and lands after them. Mirrored by src/lib/games/speed.ts, queens.ts, sudoku.ts
-- and mini-sudoku.ts. See docs/games/README.md.

-- ─────────────────────────────────────────────────────────────────────────────
-- The bonus
-- ─────────────────────────────────────────────────────────────────────────────

create or replace function public.speed_bonus(p_base bigint, p_par_ms bigint, p_elapsed_ms bigint)
returns bigint
language sql
immutable
set search_path = ''
as $$
  select case
    when p_par_ms <= 0 or p_base <= 0 then 0::bigint
    else p_base * least(p_par_ms, greatest(0, p_par_ms - greatest(0, p_elapsed_ms))) / p_par_ms
  end
$$;

comment on function public.speed_bonus(bigint, bigint, bigint) is
  'A run''s points again, scaled by the share of its par time it had left: up to double, nothing at par or slower. Mirrored by src/lib/games/speed.ts.';

revoke all on function public.speed_bonus(bigint, bigint, bigint) from public;

-- ─────────────────────────────────────────────────────────────────────────────
-- What every speed verifier does before and after its replay
-- ─────────────────────────────────────────────────────────────────────────────

-- The checks a submission meets before its replay. `refusal` is set when it stops
-- here, as the answer to send back.
create or replace function public.speed_run_gate(
  p_session_id    uuid,
  p_actions       integer[],
  p_score         bigint,
  p_duration_ms   integer,
  p_rules_version text,
  p_max_actions   integer,
  out refusal public.play_result,
  out session public.game_sessions,
  out game    public.games,
  out digest  text,
  out elapsed bigint
)
language plpgsql
set search_path = ''
as $$
declare
  v_user uuid := auth.uid();
  v_best bigint;
  v_rank bigint;
begin
  if p_session_id is null then
    raise exception 'a session id is required' using errcode = '22023';
  end if;
  if p_actions is null or array_position(p_actions, null) is not null then
    raise exception 'actions must be a dense array of moves' using errcode = '22023';
  end if;
  if p_duration_ms is null or p_duration_ms < 1 then
    raise exception 'duration must be a positive number of milliseconds' using errcode = '22023';
  end if;

  select * into session from public.game_sessions s where s.id = p_session_id for update;

  if not found
     or (session.user_id is not null and session.user_id is distinct from v_user)
     or (session.user_id is null and v_user is not null) then
    refusal.outcome := 'not_found';
    refusal.session_id := p_session_id;
    return;
  end if;

  select * into game from public.games g where g.id = session.game_id;

  digest := md5(concat_ws('|',
    session.rules_version,
    session.seed::text,
    array_to_string(p_actions, ','),
    p_score::text
  ));

  refusal.session_id := session.id;
  refusal.game_slug := game.slug;

  if session.completed_at is not null then
    if session.verified_digest = digest then
      refusal.outcome     := 'duplicate';
      refusal.score       := session.verified_score;
      refusal.duration_ms := p_duration_ms;
      refusal.ranked      := session.user_id is not null;
      refusal.recorded_at := session.completed_at;
      if session.user_id is not null then
        select max(s.score) into v_best from public.scores s
         where s.game_id = session.game_id and s.user_id = session.user_id;
        select count(*) + 1 into v_rank from (
          select s.user_id, max(s.score) as best
            from public.scores s
           where s.game_id = session.game_id and s.user_id is not null
           group by s.user_id
        ) t where t.best > coalesce(v_best, 0) and t.user_id <> session.user_id;
        refusal.personal_best := v_best;
        refusal.board_rank    := v_rank;
      end if;
      return;
    end if;
    refusal.outcome := 'closed';
    refusal.score := session.verified_score;
    return;
  end if;

  if session.abandoned_at is not null then
    refusal.outcome := 'abandoned';
    return;
  end if;

  if now() >= session.expires_at then
    refusal.outcome := 'expired';
    return;
  end if;

  if session.rules_version is distinct from p_rules_version then
    refusal.outcome := 'wrong_rules';
    return;
  end if;

  if coalesce(array_length(p_actions, 1), 0) > p_max_actions then
    refusal.outcome := 'invalid_actions';
    return;
  end if;

  elapsed := (extract(epoch from (now() - session.started_at)) * 1000)::bigint;
  if p_duration_ms > elapsed + 2000 then
    refusal.outcome := 'invalid_duration';
    return;
  end if;

  refusal := null;
end;
$$;

revoke all on function public.speed_run_gate(uuid, integer[], bigint, integer, text, integer) from public;

-- The end of a verified run: the bonus added, the session closed, the score recorded.
create or replace function public.speed_run_finish(
  p_session     public.game_sessions,
  p_game        public.games,
  p_digest      text,
  p_base        bigint,
  p_par_ms      bigint,
  p_elapsed_ms  bigint,
  p_cleared     integer,
  p_placed      integer,
  p_duration_ms integer
)
returns public.play_result
language plpgsql
set search_path = ''
as $$
declare
  v_result  public.play_result;
  v_session public.game_sessions;
  v_score   bigint := p_base + public.speed_bonus(p_base, p_par_ms, p_elapsed_ms);
  v_best    bigint;
  v_rank    bigint;
begin
  update public.game_sessions s
     set completed_at    = now(),
         verified_score  = v_score,
         verified_digest = p_digest
   where s.id = p_session.id
  returning * into v_session;

  if v_session.user_id is not null then
    insert into public.scores (session_id, game_id, user_id, score, duration_ms)
    values (v_session.id, v_session.game_id, v_session.user_id, v_score, p_duration_ms);
  end if;

  v_result.outcome         := 'recorded';
  v_result.session_id      := v_session.id;
  v_result.game_slug       := p_game.slug;
  v_result.score           := v_score;
  v_result.cleared_columns := p_cleared;
  v_result.tiles_placed    := p_placed;
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

revoke all on function public.speed_run_finish(public.game_sessions, public.games, text, bigint, bigint, bigint, integer, integer, integer) from public;

-- ─────────────────────────────────────────────────────────────────────────────
-- Crowns: queens@2
-- ─────────────────────────────────────────────────────────────────────────────

-- The par of the first `p_cleared` boards: 60, 90, 150, 240 and 360 s by side.
create or replace function public.queens_par_ms(p_cleared integer)
returns bigint
language plpgsql
immutable
set search_path = ''
as $$
declare
  v_total bigint := 0;
  v_level integer;
begin
  for v_level in 1..greatest(coalesce(p_cleared, 0), 0) loop
    v_total := v_total + case public.queens_side(v_level)
      when 5 then 60000 when 6 then 90000 when 7 then 150000 when 8 then 240000 else 360000
    end;
  end loop;
  return v_total;
end;
$$;

revoke all on function public.queens_par_ms(integer) from public;

-- Every action, from the seed: a cell cycles empty → X → crown → empty, 81 takes back
-- the last tap on this board and 82 empties it. `valid` is false for an action that
-- could not have been made. `cells` is the board left, 0 empty, 1 X, 2 crown.
create or replace function public.queens_speed_replay(
  p_seed    bigint,
  p_actions integer[],
  out valid   boolean,
  out cells   integer[],
  out level   integer,
  out score   bigint,
  out cleared integer,
  out placed  integer
)
language plpgsql
immutable
set search_path = ''
as $$
declare
  v_side     integer;
  v_solution integer[];
  v_history  integer[] := array[]::integer[];
  v_action   integer;
  v_cell     integer;
  v_crowns   integer;
  v_row      integer;
  v_solved   boolean;
begin
  valid := true;
  level := 1;
  score := 0;
  cleared := 0;
  placed := 0;
  v_side := public.queens_side(level);
  v_solution := public.queens_solution(p_seed, level);
  cells := array_fill(0, array[v_side * v_side]);

  foreach v_action in array coalesce(p_actions, array[]::integer[]) loop
    if v_action = 81 then
      if coalesce(array_length(v_history, 1), 0) = 0 then
        valid := false;
        return;
      end if;
      v_cell := v_history[array_length(v_history, 1)];
      v_history := v_history[1 : array_length(v_history, 1) - 1];
      cells[v_cell + 1] := (cells[v_cell + 1] + 2) % 3;
    elsif v_action = 82 then
      if coalesce(array_length(v_history, 1), 0) = 0 then
        valid := false;
        return;
      end if;
      v_history := array[]::integer[];
      cells := array_fill(0, array[v_side * v_side]);
    else
      if v_action < 0 or v_action >= v_side * v_side then
        valid := false;
        return;
      end if;
      -- The cycle: 0 → 1 → 2 → 0. Only gaining or losing a crown can solve a board.
      cells[v_action + 1] := (cells[v_action + 1] + 1) % 3;
      v_history := v_history || v_action;

      if cells[v_action + 1] <> 1 then
        v_crowns := 0;
        foreach v_cell in array cells loop
          if v_cell = 2 then
            v_crowns := v_crowns + 1;
          end if;
        end loop;
        v_solved := v_crowns = v_side;
        if v_solved then
          for v_row in 1..v_side loop
            if cells[(v_row - 1) * v_side + v_solution[v_row] + 1] <> 2 then
              v_solved := false;
              exit;
            end if;
          end loop;
        end if;
        if v_solved then
          score := score + 10 * v_side;
          cleared := cleared + 1;
          level := level + 1;
          v_side := public.queens_side(level);
          v_solution := public.queens_solution(p_seed, level);
          cells := array_fill(0, array[v_side * v_side]);
          v_history := array[]::integer[];
        end if;
      end if;
    end if;
    placed := placed + 1;
  end loop;
end;
$$;

comment on function public.queens_speed_replay(bigint, integer[]) is
  'Replays queens@2 actions from a seed. Mirrored by replay in src/lib/games/queens.ts.';

revoke all on function public.queens_speed_replay(bigint, integer[]) from public;

create or replace function public.complete_queens_speed_run(
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
  v_replay record;
  v_result public.play_result;
begin
  select * into v_gate from public.speed_run_gate(
    p_session_id, p_actions, p_score, p_duration_ms, 'queens@2', 8192);
  if (v_gate.refusal).outcome is not null then
    return v_gate.refusal;
  end if;

  select * into v_replay from public.queens_speed_replay((v_gate.session).seed, p_actions);

  v_result.session_id := (v_gate.session).id;
  v_result.game_slug := (v_gate.game).slug;
  if not v_replay.valid then
    v_result.outcome := 'invalid_actions';
    return v_result;
  end if;
  if p_score is distinct from v_replay.score then
    v_result.outcome := 'score_mismatch';
    v_result.score := v_replay.score;
    return v_result;
  end if;

  return public.speed_run_finish(
    v_gate.session, v_gate.game, v_gate.digest, v_replay.score,
    public.queens_par_ms(v_replay.cleared), v_gate.elapsed,
    v_replay.cleared, v_replay.placed, p_duration_ms);
end;
$$;

comment on function public.complete_queens_speed_run(uuid, integer[], bigint, integer) is
  'Replays a queens@2 run from its session seed, adds the speed bonus by the server''s own time, and records it. The claim is the points before the bonus, and is compared, never trusted.';

revoke all on function public.complete_queens_speed_run(uuid, integer[], bigint, integer) from public;
grant execute on function public.complete_queens_speed_run(uuid, integer[], bigint, integer) to anon, authenticated;

-- ─────────────────────────────────────────────────────────────────────────────
-- Sudoku: sudoku@4
-- ─────────────────────────────────────────────────────────────────────────────

-- The par of the first `p_cleared` boards: each board's allowance, by its tier.
create or replace function public.sudoku_par_ms(p_cleared integer)
returns bigint
language plpgsql
immutable
set search_path = ''
as $$
declare
  v_total bigint := 0;
  v_level integer;
begin
  for v_level in 1..greatest(coalesce(p_cleared, 0), 0) loop
    v_total := v_total + public.sudoku_allowance_ms(public.sudoku_tier(v_level));
  end loop;
  return v_total;
end;
$$;

revoke all on function public.sudoku_par_ms(integer) from public;

create or replace function public.complete_sudoku_speed_run(
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
  v_result  public.play_result;
  v_start   integer[];
  v_cells   integer[];
  v_empty   integer;
  v_level   integer := 1;
  v_score   bigint := 0;
  v_cleared integer := 0;
  v_placed  integer := 0;
  v_action  integer;
  v_cell    integer;
  v_digit   integer;
begin
  select * into v_gate from public.speed_run_gate(
    p_session_id, p_actions, p_score, p_duration_ms, 'sudoku@4', 8192);
  if (v_gate.refusal).outcome is not null then
    return v_gate.refusal;
  end if;

  v_result.session_id := (v_gate.session).id;
  v_result.game_slug := (v_gate.game).slug;

  v_start := public.sudoku_start((v_gate.session).seed, v_level);
  v_empty := 81 - coalesce(array_length(array_remove(v_start, 0), 1), 0);
  v_cells := v_start;

  foreach v_action in array p_actions loop
    v_cell := v_action / 10;
    v_digit := v_action % 10;
    if v_action < 0 or v_action > 809
       or v_start[v_cell + 1] <> 0 or v_cells[v_cell + 1] = v_digit then
      v_result.outcome := 'invalid_actions';
      return v_result;
    end if;

    if v_cells[v_cell + 1] = 0 then
      v_empty := v_empty - 1;
    elsif v_digit = 0 then
      v_empty := v_empty + 1;
    end if;
    v_cells[v_cell + 1] := v_digit;
    v_placed := v_placed + 1;

    if v_empty = 0 and public.sudoku_solved(v_cells) then
      v_cleared := v_cleared + 1;
      v_score := v_score + 90;
      v_level := v_level + 1;
      v_start := public.sudoku_start((v_gate.session).seed, v_level);
      v_empty := 81 - coalesce(array_length(array_remove(v_start, 0), 1), 0);
      v_cells := v_start;
    end if;
  end loop;

  if p_score is distinct from v_score then
    v_result.outcome := 'score_mismatch';
    v_result.score := v_score;
    return v_result;
  end if;

  return public.speed_run_finish(
    v_gate.session, v_gate.game, v_gate.digest, v_score,
    public.sudoku_par_ms(v_cleared), v_gate.elapsed,
    v_cleared, v_placed, p_duration_ms);
end;
$$;

comment on function public.complete_sudoku_speed_run(uuid, integer[], bigint, integer) is
  'Replays a sudoku@4 run on sudoku@3''s boards, with no clock to lose to, adds the speed bonus by the server''s own time, and records it. The claim is the points before the bonus.';

revoke all on function public.complete_sudoku_speed_run(uuid, integer[], bigint, integer) from public;
grant execute on function public.complete_sudoku_speed_run(uuid, integer[], bigint, integer) to anon, authenticated;

-- ─────────────────────────────────────────────────────────────────────────────
-- Mini Sudoku: mini-sudoku@2
-- ─────────────────────────────────────────────────────────────────────────────

create or replace function public.mini_sudoku_par_ms(p_cleared integer)
returns bigint
language plpgsql
immutable
set search_path = ''
as $$
declare
  v_total bigint := 0;
  v_level integer;
begin
  for v_level in 1..greatest(coalesce(p_cleared, 0), 0) loop
    v_total := v_total + public.mini_sudoku_allowance_ms(public.mini_sudoku_tier(v_level));
  end loop;
  return v_total;
end;
$$;

revoke all on function public.mini_sudoku_par_ms(integer) from public;

create or replace function public.complete_mini_sudoku_speed_run(
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
  v_result  public.play_result;
  v_start   integer[];
  v_cells   integer[];
  v_empty   integer;
  v_level   integer := 1;
  v_score   bigint := 0;
  v_cleared integer := 0;
  v_placed  integer := 0;
  v_action  integer;
  v_cell    integer;
  v_digit   integer;
begin
  select * into v_gate from public.speed_run_gate(
    p_session_id, p_actions, p_score, p_duration_ms, 'mini-sudoku@2', 8192);
  if (v_gate.refusal).outcome is not null then
    return v_gate.refusal;
  end if;

  v_result.session_id := (v_gate.session).id;
  v_result.game_slug := (v_gate.game).slug;

  v_start := public.mini_sudoku_start((v_gate.session).seed, v_level);
  v_empty := 36 - coalesce(array_length(array_remove(v_start, 0), 1), 0);
  v_cells := v_start;

  foreach v_action in array p_actions loop
    v_cell := v_action / 10;
    v_digit := v_action % 10;
    if v_action < 0 or v_cell > 35 or v_digit > 6
       or v_start[v_cell + 1] <> 0 or v_cells[v_cell + 1] = v_digit then
      v_result.outcome := 'invalid_actions';
      return v_result;
    end if;

    if v_cells[v_cell + 1] = 0 then
      v_empty := v_empty - 1;
    elsif v_digit = 0 then
      v_empty := v_empty + 1;
    end if;
    v_cells[v_cell + 1] := v_digit;
    v_placed := v_placed + 1;

    if v_empty = 0 and public.mini_sudoku_solved(v_cells) then
      v_cleared := v_cleared + 1;
      v_score := v_score + 60;
      v_level := v_level + 1;
      v_start := public.mini_sudoku_start((v_gate.session).seed, v_level);
      v_empty := 36 - coalesce(array_length(array_remove(v_start, 0), 1), 0);
      v_cells := v_start;
    end if;
  end loop;

  if p_score is distinct from v_score then
    v_result.outcome := 'score_mismatch';
    v_result.score := v_score;
    return v_result;
  end if;

  return public.speed_run_finish(
    v_gate.session, v_gate.game, v_gate.digest, v_score,
    public.mini_sudoku_par_ms(v_cleared), v_gate.elapsed,
    v_cleared, v_placed, p_duration_ms);
end;
$$;

comment on function public.complete_mini_sudoku_speed_run(uuid, integer[], bigint, integer) is
  'Replays a mini-sudoku@2 run on mini-sudoku@1''s boards, with no clock to lose to, adds the speed bonus by the server''s own time, and records it. The claim is the points before the bonus.';

revoke all on function public.complete_mini_sudoku_speed_run(uuid, integer[], bigint, integer) from public;
grant execute on function public.complete_mini_sudoku_speed_run(uuid, integer[], bigint, integer) to anon, authenticated;

-- ─────────────────────────────────────────────────────────────────────────────
-- The start gate and saved runs learn the new versions
-- ─────────────────────────────────────────────────────────────────────────────

insert into public.game_runtimes (runtime, rules_version, max_actions, session_hours) values
  ('queens', 'queens@2', 8192, 12),
  ('sudoku', 'sudoku@4', 8192, 12),
  ('mini-sudoku', 'mini-sudoku@2', 8192, 12)
on conflict (runtime, rules_version) do update
  set max_actions   = excluded.max_actions,
      session_hours = excluded.session_hours;

create or replace function public.run_resumable(p_rules_version text)
returns boolean
language sql
immutable
set search_path = ''
as $$
  select coalesce(p_rules_version in (
    'stack-10@2', 'chain@2', 'memory-flash@2', 'one-move@2', 'color-merge@2',
    'queens@1', 'queens@2',
    'gridburst@1',
    'zip@2', 'eight-puzzle@2', 'tango@2',
    'sudoku@3', 'sudoku@4', 'mini-sudoku@1', 'mini-sudoku@2', 'decant@2',
    'bolted@1', 'huedini@1', 'scatter@1', 'cascade@1', 'checkmate@1', 'fusebox@1'
  ), false)
$$;
