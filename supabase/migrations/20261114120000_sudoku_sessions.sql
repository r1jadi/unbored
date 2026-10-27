-- Sudoku sessions: the verifier for the twelfth runtime.
--
-- Sudoku as an endless run against a clock: fill a 9×9 grid so that every row,
-- every column and every 3×3 box holds the digits 1 to 9 once each. Some cells
-- start filled. What this migration changes, and why:
--
--   1. The rules, as constants the database owns: `sudoku@1`, an 8192-move
--      submission bound, the starting cells per board (forty on board one, one
--      fewer each board, down to thirty), and the clock — six minutes to start,
--      three minutes more for every solved board, twenty seconds of slack.
--
--   2. The board generator, `sudoku_draw(seed, level)`: a planted solution — the
--      pattern grid with its digits relabelled and its rows, columns, bands and
--      stacks shuffled, which keeps it valid without a search — and the cells
--      that start filled, the first few of a shuffle of all eighty-one.
--
--   3. `public.complete_sudoku_run`, the verifier. A move is `cell × 10 + digit`:
--      it puts a digit (1–9) in a cell that did not start filled, or clears it
--      with 0. A board scores ninety points once it is full and every row, column
--      and box holds 1 to 9 (`sudoku_solved`) — any such grid, not only the
--      planted one, because a board's givens may allow more than one. Any prefix
--      of a legal line is valid. Like Sun & Moon, the session is issued when the
--      player presses Start, and a run that arrives later than its solved boards
--      earned is refused as `out_of_time`.
--
--   4. `public.start_game_session` learns the (`sudoku`, `sudoku@1`) pair.
--
-- Nothing here puts Sudoku in the catalogue: `20261114120100_sudoku_playable.sql`
-- does, after the deployment carrying the runtime is live. See docs/games/README.md.

-- ─────────────────────────────────────────────────────────────────────────────
-- The rules, as constants the database owns
-- ─────────────────────────────────────────────────────────────────────────────

create or replace function public.sudoku_rules_version()
returns text language sql immutable set search_path = '' as $$ select 'sudoku@1'::text $$;

create or replace function public.sudoku_max_actions()
returns integer language sql immutable set search_path = '' as $$ select 8192 $$;

create or replace function public.sudoku_slack_ms()
returns integer language sql immutable set search_path = '' as $$ select 20000 $$;

-- The clock a run has earned with `p_cleared` boards solved: six minutes, plus
-- three minutes for every solved board.
create or replace function public.sudoku_budget_ms(p_cleared integer)
returns bigint language sql immutable set search_path = '' as $$
  select 360000::bigint + 180000::bigint * greatest(coalesce(p_cleared, 0), 0)
$$;

-- How many cells a level's board starts with: forty on board one, down to thirty.
create or replace function public.sudoku_givens(p_level integer)
returns integer
language plpgsql
immutable
set search_path = ''
as $$
begin
  if p_level is null or p_level < 1 then
    raise exception 'a Sudoku level is one or more' using errcode = '22023';
  end if;
  return greatest(30, 41 - p_level);
end;
$$;

comment on function public.sudoku_rules_version() is
  'The Sudoku rules version the database can verify. A rules change needs a new version and a new verifier.';
comment on function public.sudoku_max_actions() is
  'The most moves a Sudoku submission may carry. A request bound, not a final board.';
comment on function public.sudoku_slack_ms() is
  'How long after its clock ran out a Sudoku run is still accepted.';
comment on function public.sudoku_budget_ms(integer) is
  'The clock a Sudoku run has earned: 360 s plus 180 s per solved board.';
comment on function public.sudoku_givens(integer) is
  'The cells a Sudoku level''s board starts with: forty, one fewer a board, down to thirty.';

-- ─────────────────────────────────────────────────────────────────────────────
-- The boards, as the one generator both sides draw from
-- ─────────────────────────────────────────────────────────────────────────────
--
-- One Move's outer LCG advanced once per level, and a second LCG started at that
-- state, as Queens, Zip, 8 Puzzle and Tango draw theirs. Every shuffle below is
-- Fisher–Yates from the last index down, j = draw() mod (i + 1), and the draws
-- come in this order:
--
--   1. the digits 1..9 (their relabelling);
--   2. the rows: the three bands, then the three rows within each band, band by
--      band in the band order just drawn;
--   3. the columns, the same way through the stacks;
--   4. all eighty-one cells: the first `sudoku_givens(level)` start filled.
--
-- The solution's cell (r, c) is digits[pattern(rows[r], columns[c])], where
-- pattern(r, c) = (3 × (r mod 3) + r / 3 + c) mod 9 is a valid grid; shuffling
-- bands, lines within a band and digits keeps it one.
--
-- The result is 162 values: the solution, then the starting cells (0 empty).
-- Internals, not API surface: the verifier calls it as the function's owner.

create or replace function public.sudoku_draw(
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
  v_digits  integer[] := array[1, 2, 3, 4, 5, 6, 7, 8, 9];
  v_bands   integer[];
  v_within  integer[];
  v_lines   integer[];
  v_rows    integer[];
  v_columns integer[];
  v_pass    integer;
  v_band    integer;
  v_index   integer;
  v_swap    integer;
  v_held    integer;
  v_row     integer;
  v_column  integer;
  v_r       integer;
  v_c       integer;
  v_grid    integer[] := array[]::integer[];
  v_order   integer[];
  v_start   integer[];
begin
  if p_seed is null then
    raise exception 'a seed is required' using errcode = '22023';
  end if;
  if p_level is null or p_level < 1 or p_level > 8192 then
    raise exception 'sudoku level is outside the reachable run' using errcode = '22023';
  end if;

  v_state := (p_seed % 4294967296 + 4294967296) % 4294967296;
  if v_state = 0 then
    v_state := 2654435769; -- 0x9E3779B9: a zero state would make the sequence degenerate
  end if;
  for v_current in 1..p_level loop
    v_state := (v_state * 1664525 + 1013904223) % 4294967296;
  end loop;

  -- 1. The digits.
  for v_index in reverse 8..1 loop
    v_state := (v_state * 22695477 + 1) % 4294967296;
    v_swap := ((v_state >> 16) % (v_index + 1))::integer;
    v_held := v_digits[v_index + 1];
    v_digits[v_index + 1] := v_digits[v_swap + 1];
    v_digits[v_swap + 1] := v_held;
  end loop;

  -- 2 and 3. The rows, then the columns.
  for v_pass in 1..2 loop
    v_bands := array[0, 1, 2];
    for v_index in reverse 2..1 loop
      v_state := (v_state * 22695477 + 1) % 4294967296;
      v_swap := ((v_state >> 16) % (v_index + 1))::integer;
      v_held := v_bands[v_index + 1];
      v_bands[v_index + 1] := v_bands[v_swap + 1];
      v_bands[v_swap + 1] := v_held;
    end loop;
    v_lines := array[]::integer[];
    for v_band in 1..3 loop
      v_within := array[0, 1, 2];
      for v_index in reverse 2..1 loop
        v_state := (v_state * 22695477 + 1) % 4294967296;
        v_swap := ((v_state >> 16) % (v_index + 1))::integer;
        v_held := v_within[v_index + 1];
        v_within[v_index + 1] := v_within[v_swap + 1];
        v_within[v_swap + 1] := v_held;
      end loop;
      for v_index in 1..3 loop
        v_lines := v_lines || (v_bands[v_band] * 3 + v_within[v_index]);
      end loop;
    end loop;
    if v_pass = 1 then
      v_rows := v_lines;
    else
      v_columns := v_lines;
    end if;
  end loop;

  for v_row in 0..8 loop
    for v_column in 0..8 loop
      v_r := v_rows[v_row + 1];
      v_c := v_columns[v_column + 1];
      v_grid := v_grid || v_digits[(3 * (v_r % 3) + v_r / 3 + v_c) % 9 + 1];
    end loop;
  end loop;

  -- 4. The starting cells: the first few of a shuffle of every cell.
  v_order := array(select generate_series(0, 80));
  for v_index in reverse 80..1 loop
    v_state := (v_state * 22695477 + 1) % 4294967296;
    v_swap := ((v_state >> 16) % (v_index + 1))::integer;
    v_held := v_order[v_index + 1];
    v_order[v_index + 1] := v_order[v_swap + 1];
    v_order[v_swap + 1] := v_held;
  end loop;
  v_start := array_fill(0, array[81]);
  for v_index in 1..public.sudoku_givens(p_level) loop
    v_start[v_order[v_index] + 1] := v_grid[v_order[v_index] + 1];
  end loop;

  return v_grid || v_start;
end;
$$;

comment on function public.sudoku_draw(bigint, integer) is
  'A Sudoku level''s board: its planted solution then its starting cells, 81 values each (0 empty). Mirrored by src/lib/games/sudoku.ts.';

revoke all on function public.sudoku_draw(bigint, integer) from public;

-- Whether 81 cells (1-based, reading order) are a solved grid: every cell filled,
-- and every row, column and box holds each of 1 to 9. A unit's digits as bits
-- 1..9 must make 1022.
create or replace function public.sudoku_solved(p_cells integer[])
returns boolean
language plpgsql
immutable
set search_path = ''
as $$
declare
  v_unit   integer;
  v_index  integer;
  v_value  integer;
  v_row    integer;
  v_column integer;
  v_box    integer;
begin
  if p_cells is null or coalesce(array_length(p_cells, 1), 0) <> 81 then
    return false;
  end if;
  for v_unit in 0..8 loop
    v_row := 0;
    v_column := 0;
    v_box := 0;
    for v_index in 0..8 loop
      v_value := p_cells[v_unit * 9 + v_index + 1];
      if v_value is null or v_value < 1 or v_value > 9 then
        return false;
      end if;
      v_row := v_row | (1 << v_value);
      v_column := v_column | (1 << p_cells[v_index * 9 + v_unit + 1]);
      v_box := v_box | (1 << p_cells[((v_unit / 3) * 3 + v_index / 3) * 9
                                     + (v_unit % 3) * 3 + v_index % 3 + 1]);
    end loop;
    if v_row <> 1022 or v_column <> 1022 or v_box <> 1022 then
      return false;
    end if;
  end loop;
  return true;
end;
$$;

comment on function public.sudoku_solved(integer[]) is
  'Whether 81 Sudoku cells are full and every row, column and box holds 1 to 9 once each.';

revoke all on function public.sudoku_solved(integer[]) from public;

-- ─────────────────────────────────────────────────────────────────────────────
-- Complete a run: replay, verify, then record
-- ─────────────────────────────────────────────────────────────────────────────

create or replace function public.complete_sudoku_run(
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
  v_result   public.play_result;
  v_session  public.game_sessions;
  v_game     public.games;
  v_user     uuid := auth.uid();
  v_level    int := 1;
  -- The current board (1-based, 0 empty) and the cells it started with.
  v_board    int[];
  v_cells    int[];
  v_start    int[];
  v_empty    int;
  v_placed   int := 0;
  v_cleared  int := 0;
  v_score    bigint := 0;
  v_over     boolean := false;
  v_action   int;
  v_cell     int;
  v_digit    int;
  v_digest   text;
  v_elapsed  bigint;
  v_best     bigint;
  v_rank     bigint;
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

  select * into v_session from public.game_sessions s where s.id = p_session_id for update;

  if not found
     or (v_session.user_id is not null and v_session.user_id is distinct from v_user)
     or (v_session.user_id is null and v_user is not null) then
    v_result.outcome := 'not_found';
    v_result.session_id := p_session_id;
    return v_result;
  end if;

  select * into v_game from public.games g where g.id = v_session.game_id;

  v_digest := md5(concat_ws('|',
    v_session.rules_version,
    v_session.seed::text,
    array_to_string(p_actions, ','),
    p_score::text
  ));

  if v_session.completed_at is not null then
    if v_session.verified_digest = v_digest then
      v_result.outcome       := 'duplicate';
      v_result.session_id    := v_session.id;
      v_result.game_slug     := v_game.slug;
      v_result.score         := v_session.verified_score;
      v_result.duration_ms   := p_duration_ms;
      v_result.ranked        := v_session.user_id is not null;
      v_result.recorded_at   := v_session.completed_at;
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
    end if;

    v_result.outcome := 'closed';
    v_result.session_id := v_session.id;
    v_result.game_slug := v_game.slug;
    v_result.score := v_session.verified_score;
    return v_result;
  end if;

  if v_session.abandoned_at is not null then
    v_result.outcome := 'abandoned';
    v_result.session_id := v_session.id;
    v_result.game_slug := v_game.slug;
    return v_result;
  end if;

  if now() >= v_session.expires_at then
    v_result.outcome := 'expired';
    v_result.session_id := v_session.id;
    v_result.game_slug := v_game.slug;
    return v_result;
  end if;

  if v_session.rules_version is distinct from public.sudoku_rules_version() then
    v_result.outcome := 'wrong_rules';
    v_result.session_id := v_session.id;
    v_result.game_slug := v_game.slug;
    return v_result;
  end if;

  if coalesce(array_length(p_actions, 1), 0) > public.sudoku_max_actions() then
    v_result.outcome := 'invalid_actions';
    v_result.session_id := v_session.id;
    v_result.game_slug := v_game.slug;
    return v_result;
  end if;

  v_elapsed := (extract(epoch from (now() - v_session.started_at)) * 1000)::bigint;
  if p_duration_ms > v_elapsed + 2000 then
    v_result.outcome := 'invalid_duration';
    v_result.session_id := v_session.id;
    v_result.game_slug := v_game.slug;
    return v_result;
  end if;

  -- ── The replay ───────────────────────────────────────────────────────────
  -- A move is `cell × 10 + digit`: it names a cell that did not start filled and
  -- sets it to the digit, 0 clearing it. A cell that started filled, a cell off
  -- the board, or a move that leaves the cell as it was is impossible play. Once
  -- no cell is empty and every unit holds 1 to 9 (`sudoku_solved`), the board
  -- scores ninety points and the next starts (`sudoku_draw`, mirrored by
  -- src/lib/games/sudoku.ts). A submission that stops with the run live is the
  -- clock or the player ending it, and is valid: the score never goes down.
  v_board := public.sudoku_draw(v_session.seed, v_level);
  v_start := v_board[82:162];
  v_cells := v_start;
  v_empty := 81 - public.sudoku_givens(v_level);

  foreach v_action in array coalesce(p_actions, array[]::integer[]) loop
    v_cell := v_action / 10;
    v_digit := v_action % 10;
    if v_over or v_action < 0 or v_action > 809
       or v_start[v_cell + 1] <> 0 or v_cells[v_cell + 1] = v_digit then
      v_result.outcome := 'invalid_actions';
      v_result.session_id := v_session.id;
      v_result.game_slug := v_game.slug;
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
      v_board := public.sudoku_draw(v_session.seed, v_level);
      v_start := v_board[82:162];
      v_cells := v_start;
      v_empty := 81 - public.sudoku_givens(v_level);
    end if;

    if v_placed >= public.sudoku_max_actions() then
      v_over := true;
    end if;
  end loop;

  if p_score is distinct from v_score then
    v_result.outcome := 'score_mismatch';
    v_result.session_id := v_session.id;
    v_result.game_slug := v_game.slug;
    v_result.score := v_score;
    return v_result;
  end if;

  -- The clock, by the server's own time. The session was issued when the player
  -- pressed Start, so the time since then is the run's: it may not exceed what
  -- the solved boards earned, plus the slack. The session stays open, so a
  -- submission that is refused here can never be swapped for a shorter one later
  -- that the clock would accept: it would arrive later still.
  if v_elapsed > public.sudoku_budget_ms(v_cleared) + public.sudoku_slack_ms() then
    v_result.outcome := 'out_of_time';
    v_result.session_id := v_session.id;
    v_result.game_slug := v_game.slug;
    return v_result;
  end if;

  update public.game_sessions s
     set completed_at    = now(),
         verified_score  = v_score,
         verified_digest = v_digest
   where s.id = v_session.id
  returning * into v_session;

  if v_session.user_id is not null then
    insert into public.scores (session_id, game_id, user_id, score, duration_ms)
    values (v_session.id, v_session.game_id, v_session.user_id, v_score, p_duration_ms);
  end if;

  v_result.outcome         := 'recorded';
  v_result.session_id      := v_session.id;
  v_result.game_slug       := v_game.slug;
  v_result.score           := v_score;
  v_result.cleared_columns := v_cleared;
  v_result.tiles_placed    := v_placed;
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

comment on function public.complete_sudoku_run(uuid, integer[], bigint, integer) is
  'Replays a submitted Sudoku run from its session seed, derives the score, and records it. A move (cell × 10 + digit) sets a cell that did not start filled; a full board that obeys the rules scores ninety points and deals the next. Any prefix of a legal line is valid. A run that arrives later than its solved boards earned is out_of_time. The claim is compared, never trusted.';

revoke all on function public.complete_sudoku_run(uuid, integer[], bigint, integer) from public;
grant execute on function public.complete_sudoku_run(uuid, integer[], bigint, integer) to anon, authenticated;

-- ─────────────────────────────────────────────────────────────────────────────
-- Start a run: the gate learns the twelfth runtime
-- ─────────────────────────────────────────────────────────────────────────────

create or replace function public.start_game_session(
  p_game_slug     text,
  p_rules_version text,
  p_client        text
)
returns public.session_start
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_empty   public.session_start;
  v_game    public.games;
  v_user    uuid := auth.uid();
  v_client  text := nullif(btrim(coalesce(p_client, '')), '');
  v_session public.game_sessions;
begin
  if p_game_slug is null or p_game_slug !~ '^[a-z0-9-]{2,48}$' then
    raise exception 'invalid game slug' using errcode = '22023';
  end if;
  if p_rules_version is null or p_rules_version !~ '^[a-z0-9-]{2,32}@[0-9]{1,4}$' then
    raise exception 'invalid rules version' using errcode = '22023';
  end if;
  if v_client is not null and char_length(v_client) > 40 then
    raise exception 'client is longer than 40 characters' using errcode = '22023';
  end if;

  select * into v_game
    from public.games g
   where g.slug = p_game_slug
     and g.status = 'published'
     and g.playable
     and g.runtime is not null;

  if not found then
    v_empty.outcome := 'not_playable';
    return v_empty;
  end if;

  -- The gate is a pair: each runtime plays the rules versions its verifier
  -- implements. Stack 10, Chain, Memory Flash, One Move, Color Merge and Don't
  -- Touch the Black have two each — the endless version new runs pin, and the
  -- legacy finite version a session opened before the endless migrations still
  -- holds. 7 Second, Queens, Zip, 8 Puzzle, Tango and Sudoku have one. Anything else is
  -- a version no verifier owns.
  if (v_game.runtime = 'stack-10'
      and p_rules_version in ('stack-10@1', public.stack10_rules_version()))
     or (v_game.runtime = 'chain'
         and p_rules_version in ('chain@1', public.chain_rules_version()))
     or (v_game.runtime = 'memory-flash'
         and p_rules_version in ('memory-flash@1', public.memory_flash_rules_version()))
     or (v_game.runtime = 'one-move'
         and p_rules_version in ('one-move@1', public.one_move_rules_version()))
     or (v_game.runtime = 'color-merge'
         and p_rules_version in ('color-merge@1', public.color_merge_rules_version()))
     or (v_game.runtime = 'dont-touch'
         and p_rules_version in ('dont-touch@1', public.dont_touch_rules_version()))
     or (v_game.runtime = 'seven-second' and p_rules_version = public.seven_second_rules_version())
     or (v_game.runtime = 'queens' and p_rules_version = public.queens_rules_version())
     or (v_game.runtime = 'zip' and p_rules_version = public.zip_rules_version())
     or (v_game.runtime = 'eight-puzzle'
         and p_rules_version = public.eight_puzzle_rules_version())
     or (v_game.runtime = 'tango' and p_rules_version = public.tango_rules_version())
     or (v_game.runtime = 'sudoku' and p_rules_version = public.sudoku_rules_version()) then
    -- Allowed: issued below.
    null;
  else
    v_empty.outcome := 'unsupported_runtime';
    return v_empty;
  end if;

  if v_game.runtime = 'seven-second' and v_user is not null then
    perform pg_advisory_xact_lock(
      hashtextextended(v_game.id::text || ':' || v_user::text, 0)
    );

    if exists (
      select 1
        from public.game_sessions s
       where s.game_id = v_game.id
         and s.user_id = v_user
         and s.completed_at is not null
         and s.seed = public.seven_second_seed()
    ) then
      v_empty.outcome := 'already_played';
      return v_empty;
    end if;
  end if;

  if v_user is not null then
    update public.game_sessions s
       set abandoned_at = now()
     where s.game_id = v_game.id
       and s.user_id = v_user
       and s.completed_at is null
       and s.abandoned_at is null;
  end if;

  if v_game.runtime = 'seven-second' then
    insert into public.game_sessions (game_id, user_id, client, rules_version, seed)
    values (v_game.id, v_user, v_client, p_rules_version, public.seven_second_seed())
    returning * into v_session;
  else
    -- An endless run is a marathon, so its session lives for twelve hours instead
    -- of the table's two. Queens, Zip, 8 Puzzle, Tango and Sudoku are endless too (the
    -- clocks of the last four end a run long before this would). Every finite game keeps two hours.
    insert into public.game_sessions (game_id, user_id, client, rules_version, expires_at)
    values (v_game.id, v_user, v_client, p_rules_version,
            case when p_rules_version in ('chain@2', 'color-merge@2', 'stack-10@2',
                                          'memory-flash@2', 'one-move@2', 'queens@1', 'zip@1',
                                          'eight-puzzle@1', 'tango@1', 'sudoku@1')
                 then now() + interval '12 hours'
                 else now() + interval '2 hours' end)
    returning * into v_session;
  end if;

  v_empty.outcome       := 'started';
  v_empty.id            := v_session.id;
  v_empty.game_slug     := v_game.slug;
  v_empty.rules_version := v_session.rules_version;
  v_empty.seed          := v_session.seed;
  -- The moves a session tells the client about. The endless games report their
  -- submission bound — there is no complete run to count — while a legacy
  -- session still reports its finite length.
  v_empty.tile_count    := case v_game.runtime
                             when 'stack-10' then
                               case when p_rules_version = 'stack-10@1'
                                    then public.stack10_tiles()
                                    else public.stack10_max_tiles()
                               end
                             when 'chain' then
                               case when p_rules_version = 'chain@1'
                                    then public.chain_taps()
                                    else public.chain_max_actions()
                               end
                             when 'memory-flash' then
                               case when p_rules_version = 'memory-flash@1'
                                    then public.memory_flash_taps()
                                    else public.memory_flash_max_taps()
                               end
                             when 'one-move' then
                               case when p_rules_version = 'one-move@1'
                                    then public.one_move_taps()
                                    else public.one_move_max_taps()
                               end
                             when 'color-merge' then
                               case when p_rules_version = 'color-merge@1'
                                    then public.color_merge_slides()
                                    else public.color_merge_max_slides()
                               end
                             when 'dont-touch' then
                               case when p_rules_version = 'dont-touch@1'
                                    then public.dont_touch_cells()
                                    else public.dont_touch_max_cells()
                               end
                             when 'seven-second' then public.seven_second_answers()
                             when 'queens' then public.queens_max_actions()
                             when 'zip' then public.zip_max_actions()
                             when 'eight-puzzle' then public.eight_puzzle_max_actions()
                             when 'tango' then public.tango_max_actions()
                             when 'sudoku' then public.sudoku_max_actions()
                             else public.stack10_tiles()
                           end;
  v_empty.started_at    := v_session.started_at;
  v_empty.expires_at    := v_session.expires_at;
  v_empty.ranked        := v_session.user_id is not null;
  return v_empty;
end;
$$;

comment on function public.start_game_session(text, text, text) is
  'Issues a play session with a server-chosen seed. The caller identity is the verified token, never an argument. Stack 10 accepts stack-10@1 (legacy) and stack-10@2 (endless); Chain accepts chain@1 and chain@2; Memory Flash accepts memory-flash@1 (legacy) and memory-flash@2 (endless); One Move accepts one-move@1 (legacy) and one-move@2 (endless); Color Merge accepts color-merge@1 and color-merge@2; Don''t Touch the Black accepts dont-touch@1 and dont-touch@2; Queens accepts queens@1; Zip accepts zip@1, 8 Puzzle accepts eight-puzzle@1, Tango accepts tango@1 and Sudoku accepts sudoku@1, all issued on Start because their verifiers time the run from the session; 7 Second also answers already_played once the signed-in player has finished today''s deck.';

revoke all on function public.start_game_session(text, text, text) from public;
grant execute on function public.start_game_session(text, text, text) to anon, authenticated;
