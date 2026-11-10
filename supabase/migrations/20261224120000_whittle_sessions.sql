-- Whittle (`whittle@1`): the 5×5 grid of numbers and targets, verified by the database.
--
-- Every cell holds a number, every row and every column has a target, and the
-- player crosses numbers out until what is left in each row and each column adds
-- up to its target. Boards are drawn from the seed — numbers first, then which of
-- them the answer crosses out, so every board can be solved — and a run has no
-- clock to lose to: like `sumdoku@1`, every board has a par time and a run ahead
-- of its par earns a speed bonus (`public.speed_bonus`), measured by the server
-- from the session's start.
--
-- This migration adds the rules, the board draw, the verifier
-- (`complete_whittle_run`), the (`whittle`, `whittle@1`) row in
-- `public.game_runtimes`, and the rules version in `public.run_resumable`. Nothing a
-- user can see changes: `20261224120100_whittle_playable.sql` flips the catalogue
-- and lands last, once the service that routes `whittle@` runs to the new verifier
-- and the client that plays it are deployed. Mirrored by src/lib/games/whittle.ts;
-- the boards in tests/security/verifier_vectors.sql pin the two together. See
-- docs/games/README.md.

-- ─────────────────────────────────────────────────────────────────────────────
-- The rules, as constants the database owns
-- ─────────────────────────────────────────────────────────────────────────────

create or replace function public.whittle_rules_version()
returns text language sql immutable set search_path = '' as $$ select 'whittle@1'::text $$;

create or replace function public.whittle_max_actions()
returns integer language sql immutable set search_path = '' as $$ select 8192 $$;

comment on function public.whittle_rules_version() is
  'The Whittle rules version new runs pin: whittle@1.';
comment on function public.whittle_max_actions() is
  'The most moves one Whittle submission may carry: a request ceiling, not a final board.';

-- The tier a level's board is drawn in: 0 easy, 1 medium, 2 hard.
create or replace function public.whittle_tier(p_level integer)
returns integer
language plpgsql
immutable
set search_path = ''
as $$
begin
  if p_level is null or p_level < 1 then
    raise exception 'a Whittle level is one or more' using errcode = '22023';
  end if;
  return case when p_level <= 3 then 0 when p_level <= 7 then 1 else 2 end;
end;
$$;

-- The par of the first `p_cleared` boards: 60, 75 and 90 s by tier.
create or replace function public.whittle_par_ms(p_cleared integer)
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
    v_total := v_total + case public.whittle_tier(v_level)
      when 0 then 60000 when 1 then 75000 else 90000
    end;
  end loop;
  return v_total;
end;
$$;

comment on function public.whittle_tier(integer) is
  'The tier a Whittle level is drawn in: boards 1–3 easy (0, numbers to 9), 4–7 medium (1, to 14), then hard (2, to 19).';
comment on function public.whittle_par_ms(integer) is
  'The par time of the first n Whittle boards: 60, 75 and 90 seconds a board by tier.';

revoke all on function public.whittle_par_ms(integer) from public;

-- ─────────────────────────────────────────────────────────────────────────────
-- A board: numbers, and the targets one answer leaves
-- ─────────────────────────────────────────────────────────────────────────────
--
-- One Move's outer LCG advanced once per level, and a second LCG started at that
-- state, as every endless puzzle draws. Then:
--
--   1. each cell in reading order draws its number, draw() mod max + 1 (max is 9,
--      14 or 19 by tier), then whether the answer crosses it out, draw() mod 5 < 2;
--   2. for i = 0..4, if row i or column i has nothing left standing, the cell
--      where they meet (i, i) stands — so no target is zero;
--   3. if nothing at all is crossed out, the second cell is — so a board never
--      starts solved.
--
-- Returns 35 values: the 25 numbers, the 5 row targets (top to bottom), then the
-- 5 column targets (left to right). The answer itself is not returned: a board is
-- solved by its sums, whichever numbers were crossed out to make them.

create or replace function public.whittle_board(
  p_seed  bigint,
  p_level integer
)
returns integer[]
language plpgsql
immutable
set search_path = ''
as $$
declare
  v_state   bigint;
  v_current integer;
  v_max     integer;
  v_cell    integer;
  v_i       integer;
  v_j       integer;
  v_numbers integer[] := array[]::integer[];
  v_crossed boolean[] := array[]::boolean[];
  v_row_all boolean;
  v_col_all boolean;
  v_rows    integer[] := array[0, 0, 0, 0, 0];
  v_columns integer[] := array[0, 0, 0, 0, 0];
begin
  if p_seed is null then
    raise exception 'a seed is required' using errcode = '22023';
  end if;
  if p_level is null or p_level < 1 or p_level > 8192 then
    raise exception 'whittle level is outside the reachable run' using errcode = '22023';
  end if;

  v_state := (p_seed % 4294967296 + 4294967296) % 4294967296;
  if v_state = 0 then
    v_state := 2654435769; -- 0x9E3779B9: a zero state would make the sequence degenerate
  end if;
  for v_current in 1..p_level loop
    v_state := (v_state * 1664525 + 1013904223) % 4294967296;
  end loop;

  v_max := case public.whittle_tier(p_level) when 0 then 9 when 1 then 14 else 19 end;

  -- 1. The numbers, and the answer's crosses.
  for v_cell in 1..25 loop
    v_state := (v_state * 22695477 + 1) % 4294967296;
    v_numbers := v_numbers || (((v_state >> 16) % v_max)::integer + 1);
    v_state := (v_state * 22695477 + 1) % 4294967296;
    v_crossed := v_crossed || ((v_state >> 16) % 5 < 2);
  end loop;

  -- 2. No row or column loses everything.
  for v_i in 0..4 loop
    v_row_all := true;
    v_col_all := true;
    for v_j in 0..4 loop
      v_row_all := v_row_all and v_crossed[v_i * 5 + v_j + 1];
      v_col_all := v_col_all and v_crossed[v_j * 5 + v_i + 1];
    end loop;
    if v_row_all or v_col_all then
      v_crossed[v_i * 6 + 1] := false;
    end if;
  end loop;

  -- 3. Something is crossed out.
  if not (true = any (v_crossed)) then
    v_crossed[2] := true;
  end if;

  for v_cell in 0..24 loop
    if not v_crossed[v_cell + 1] then
      v_rows[v_cell / 5 + 1] := v_rows[v_cell / 5 + 1] + v_numbers[v_cell + 1];
      v_columns[v_cell % 5 + 1] := v_columns[v_cell % 5 + 1] + v_numbers[v_cell + 1];
    end if;
  end loop;

  return v_numbers || v_rows || v_columns;
end;
$$;

comment on function public.whittle_board(bigint, integer) is
  'A whittle@1 board: its 25 numbers, then its 5 row targets and 5 column targets, drawn from the seed. Mirrored by src/lib/games/whittle.ts.';

revoke all on function public.whittle_board(bigint, integer) from public;

-- ─────────────────────────────────────────────────────────────────────────────
-- Complete a run: replay, verify, then record
-- ─────────────────────────────────────────────────────────────────────────────
--
-- A move is `cell × 10 + mark`: it sets a cell's mark to 0 (none), 1 (crossed out)
-- or 2 (circled, the player's note that the number stays). A cell off the board, a
-- mark above 2, or a move that leaves the cell as it was is impossible play. Only
-- a cross changes a sum: a circled number counts exactly as an unmarked one. A
-- board is solved once every row and every column adds up to its target, and
-- scores fifty points before the next starts. A submission that stops with the run
-- live is the player ending it, and is valid: the score never goes down. The claim
-- is the points before the bonus; `speed_run_finish` adds the bonus by the server's
-- time.

create or replace function public.complete_whittle_run(
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
  v_board   integer[];
  v_numbers integer[];
  v_targets integer[];
  v_sums    integer[];
  v_marks   integer[];
  v_level   integer := 0;
  v_score   bigint := 0;
  v_cleared integer := 0;
  v_placed  integer := 0;
  v_action  integer;
  v_cell    integer;
  v_mark    integer;
  v_delta   integer;
  v_fresh   boolean := true;
begin
  select * into v_gate from public.speed_run_gate(
    p_session_id, p_actions, p_score, p_duration_ms,
    public.whittle_rules_version(), public.whittle_max_actions());
  if (v_gate.refusal).outcome is not null then
    return v_gate.refusal;
  end if;

  v_result.session_id := (v_gate.session).id;
  v_result.game_slug := (v_gate.game).slug;

  foreach v_action in array p_actions loop
    -- The next board: its numbers, its targets (rows then columns), and the sums
    -- of a board with nothing crossed out.
    if v_fresh then
      v_level := v_level + 1;
      v_board := public.whittle_board((v_gate.session).seed, v_level);
      v_numbers := v_board[1:25];
      v_targets := v_board[26:35];
      v_marks := array_fill(0, array[25]);
      v_sums := array_fill(0, array[10]);
      for v_cell in 0..24 loop
        v_sums[v_cell / 5 + 1] := v_sums[v_cell / 5 + 1] + v_numbers[v_cell + 1];
        v_sums[v_cell % 5 + 6] := v_sums[v_cell % 5 + 6] + v_numbers[v_cell + 1];
      end loop;
      v_fresh := false;
    end if;

    if v_action is null or v_action < 0 then
      v_result.outcome := 'invalid_actions';
      return v_result;
    end if;
    v_cell := v_action / 10;
    v_mark := v_action % 10;
    if v_cell > 24 or v_mark > 2 or v_marks[v_cell + 1] = v_mark then
      v_result.outcome := 'invalid_actions';
      return v_result;
    end if;

    -- A number leaves its row's and column's sums when crossed out, and returns
    -- when the cross is taken off.
    v_delta := case
      when v_mark = 1 then -v_numbers[v_cell + 1]
      when v_marks[v_cell + 1] = 1 then v_numbers[v_cell + 1]
      else 0
    end;
    v_sums[v_cell / 5 + 1] := v_sums[v_cell / 5 + 1] + v_delta;
    v_sums[v_cell % 5 + 6] := v_sums[v_cell % 5 + 6] + v_delta;
    v_marks[v_cell + 1] := v_mark;
    v_placed := v_placed + 1;

    if v_sums = v_targets then
      v_cleared := v_cleared + 1;
      v_score := v_score + 50;
      v_fresh := true;
    end if;
  end loop;

  if p_score is distinct from v_score then
    v_result.outcome := 'score_mismatch';
    v_result.score := v_score;
    return v_result;
  end if;

  return public.speed_run_finish(
    v_gate.session, v_gate.game, v_gate.digest, v_score,
    public.whittle_par_ms(v_cleared), v_gate.elapsed,
    v_cleared, v_placed, p_duration_ms);
end;
$$;

comment on function public.complete_whittle_run(uuid, integer[], bigint, integer) is
  'Replays a Whittle run from the session''s seed, adds the speed bonus by the server''s own time, and records it. The caller identity is the verified token; the claim is the points before the bonus, compared and never trusted.';

revoke all on function public.complete_whittle_run(uuid, integer[], bigint, integer) from public;
grant execute on function public.complete_whittle_run(uuid, integer[], bigint, integer) to anon, authenticated;

-- ─────────────────────────────────────────────────────────────────────────────
-- The start gate and saved runs learn Whittle
-- ─────────────────────────────────────────────────────────────────────────────

insert into public.game_runtimes (runtime, rules_version, max_actions, session_hours)
values ('whittle', public.whittle_rules_version(), public.whittle_max_actions(), 12)
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
    'bolted@1', 'huedini@1', 'scatter@1', 'cascade@1', 'checkmate@1', 'fusebox@1',
    'minefield@1', 'sumdoku@1', 'whittle@1'
  ), false)
$$;
