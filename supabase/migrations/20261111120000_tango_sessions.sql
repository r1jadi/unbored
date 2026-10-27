-- Tango sessions: the verifier for the eleventh runtime.
--
-- LinkedIn's Tango as an endless run against a clock: fill a 6×6 grid with suns
-- and moons so that every row and column holds three of each, no three alike sit
-- next to each other across or down, and the `=` / `×` signs between neighbours
-- hold. Some cells start filled, and every board has exactly one solution. What
-- this migration changes, and why:
--
--   1. The rules, as constants the database owns: `tango@1`, an 8192-tap
--      submission bound, the starting cells per board (nine on board one, one
--      fewer each board, down to three), and the clock — two minutes to start,
--      forty-five seconds more for every solved board, twenty seconds of slack.
--
--   2. The board generator, `tango_draw(seed, level)`: the solution, drawn row by
--      row from the fourteen rows a solution may use, and the cells that start
--      filled, the first few of a shuffle. The signs that make the solution the
--      only one are the client's alone (`src/lib/games/tango.ts`), as Zip's
--      checkpoints are: they guide the player's deduction, and the verifier needs
--      only the solution and the start to know when a board is solved.
--
--   3. `public.complete_tango_run`, the verifier. It replays every tap — a cell
--      that did not start filled cycles sun, moon, empty — and scores sixty points
--      whenever the board equals its solution, then deals the next board. Any
--      prefix of a legal line is valid. Like Zip and 8 Puzzle, the session is
--      issued when the player presses Start, and a run that arrives later than its
--      solved boards earned is refused as `out_of_time`.
--
--   4. `public.start_game_session` learns the (`tango`, `tango@1`) pair.
--
-- Nothing here puts Tango in the catalogue: `20261111120100_tango_playable.sql`
-- does, after the deployment carrying the runtime is live. See docs/games/README.md.

-- ─────────────────────────────────────────────────────────────────────────────
-- The rules, as constants the database owns
-- ─────────────────────────────────────────────────────────────────────────────

create or replace function public.tango_rules_version()
returns text language sql immutable set search_path = '' as $$ select 'tango@1'::text $$;

create or replace function public.tango_max_actions()
returns integer language sql immutable set search_path = '' as $$ select 8192 $$;

create or replace function public.tango_slack_ms()
returns integer language sql immutable set search_path = '' as $$ select 20000 $$;

-- The clock a run has earned with `p_cleared` boards solved: two minutes, plus
-- forty-five seconds for every solved board.
create or replace function public.tango_budget_ms(p_cleared integer)
returns bigint language sql immutable set search_path = '' as $$
  select 120000::bigint + 45000::bigint * greatest(coalesce(p_cleared, 0), 0)
$$;

-- How many cells a level's board starts with: nine on board one, down to three.
create or replace function public.tango_givens(p_level integer)
returns integer
language plpgsql
immutable
set search_path = ''
as $$
begin
  if p_level is null or p_level < 1 then
    raise exception 'a Tango level is one or more' using errcode = '22023';
  end if;
  return greatest(3, 10 - p_level);
end;
$$;

comment on function public.tango_rules_version() is
  'The Tango rules version the database can verify. A rules change needs a new version and a new verifier.';
comment on function public.tango_max_actions() is
  'The most taps a Tango submission may carry. A request bound, not a final board.';
comment on function public.tango_slack_ms() is
  'How long after its clock ran out a Tango run is still accepted.';
comment on function public.tango_budget_ms(integer) is
  'The clock a Tango run has earned: 120 s plus 45 s per solved board.';
comment on function public.tango_givens(integer) is
  'The cells a Tango level''s board starts with: nine, one fewer a board, down to three.';

-- ─────────────────────────────────────────────────────────────────────────────
-- The boards, as the one generator both sides draw from
-- ─────────────────────────────────────────────────────────────────────────────
--
-- One Move's outer LCG advanced once per level, and a second LCG started at that
-- state, as Queens, Zip and 8 Puzzle draw theirs. In board order, 1 is a sun, 2 a
-- moon and 0 an empty cell.
--
-- The solution is drawn row by row. A row is picked from the fourteen rows a
-- solution may use — three suns and three moons, never three alike — in the
-- fixed order below, keeping only those that leave every column with at most
-- three of each and never three alike down it; the next draw picks among them. A
-- draw that runs out of rows starts again from the first row. Then a shuffle of
-- all thirty-six cells (Fisher–Yates from the last cell down) chooses which cells
-- start filled: the first `tango_givens(level)` of it.
--
-- The result is seventy-two values: the solution, then the starting cells.
-- Internals, not API surface: the verifier calls it as the function's owner.

create or replace function public.tango_draw(
  p_seed  bigint,
  p_level integer
)
returns integer[]
language plpgsql
immutable
set search_path = ''
as $$
declare
  -- The fourteen rows, six cells each, in the client's order (TANGO_ROWS).
  v_rows     integer[] := array[
    2,2,1,2,1,1,
    2,2,1,1,2,1,
    2,1,2,2,1,1,
    2,1,2,1,2,1,
    2,1,2,1,1,2,
    2,1,1,2,2,1,
    2,1,1,2,1,2,
    1,2,2,1,2,1,
    1,2,2,1,1,2,
    1,2,1,2,2,1,
    1,2,1,2,1,2,
    1,2,1,1,2,2,
    1,1,2,2,1,2,
    1,1,2,1,2,2
  ];
  v_state    bigint;
  v_current  integer;
  v_grid     integer[];
  v_options  integer[];
  v_stuck    boolean;
  v_row      integer;
  v_candidate integer;
  v_column   integer;
  v_value    integer;
  v_above    integer;
  v_suns     integer;
  v_fits     boolean;
  v_pick     integer;
  v_order    integer[];
  v_index    integer;
  v_swap     integer;
  v_held     integer;
  v_start    integer[];
begin
  if p_seed is null then
    raise exception 'a seed is required' using errcode = '22023';
  end if;
  if p_level is null or p_level < 1 or p_level > 8192 then
    raise exception 'tango level is outside the reachable run' using errcode = '22023';
  end if;

  v_state := (p_seed % 4294967296 + 4294967296) % 4294967296;
  if v_state = 0 then
    v_state := 2654435769; -- 0x9E3779B9: a zero state would make the sequence degenerate
  end if;
  for v_current in 1..p_level loop
    v_state := (v_state * 1664525 + 1013904223) % 4294967296;
  end loop;

  -- The solution. Arrays are 1-based here: v_grid[r * 6 + c + 1] is row r, column c.
  loop
    v_grid := array_fill(0, array[36]);
    v_stuck := false;
    for v_row in 0..5 loop
      v_options := array[]::integer[];
      for v_candidate in 0..13 loop
        v_fits := true;
        for v_column in 0..5 loop
          v_value := v_rows[v_candidate * 6 + v_column + 1];
          v_suns := case when v_value = 1 then 1 else 0 end;
          for v_above in 0..v_row - 1 loop
            if v_grid[v_above * 6 + v_column + 1] = 1 then
              v_suns := v_suns + 1;
            end if;
          end loop;
          if v_suns > 3 or v_row + 1 - v_suns > 3 then
            v_fits := false;
          elsif v_row >= 2
                and v_grid[(v_row - 1) * 6 + v_column + 1] = v_value
                and v_grid[(v_row - 2) * 6 + v_column + 1] = v_value then
            v_fits := false;
          end if;
          exit when not v_fits;
        end loop;
        if v_fits then
          v_options := v_options || v_candidate;
        end if;
      end loop;

      if coalesce(array_length(v_options, 1), 0) = 0 then
        v_stuck := true;
        exit;
      end if;

      v_state := (v_state * 22695477 + 1) % 4294967296;
      v_pick := v_options[((v_state >> 16) % array_length(v_options, 1))::integer + 1];
      for v_column in 0..5 loop
        v_grid[v_row * 6 + v_column + 1] := v_rows[v_pick * 6 + v_column + 1];
      end loop;
    end loop;
    exit when not v_stuck;
  end loop;

  -- The starting cells: the first few of a shuffle of every cell.
  v_order := array(select generate_series(0, 35));
  for v_index in reverse 35..1 loop
    v_state := (v_state * 22695477 + 1) % 4294967296;
    v_swap := ((v_state >> 16) % (v_index + 1))::integer;
    v_held := v_order[v_index + 1];
    v_order[v_index + 1] := v_order[v_swap + 1];
    v_order[v_swap + 1] := v_held;
  end loop;
  v_start := array_fill(0, array[36]);
  for v_index in 1..public.tango_givens(p_level) loop
    v_start[v_order[v_index] + 1] := v_grid[v_order[v_index] + 1];
  end loop;

  return v_grid || v_start;
end;
$$;

comment on function public.tango_draw(bigint, integer) is
  'A Tango level''s board: its solution then its starting cells, 36 values each (1 sun, 2 moon, 0 empty). Mirrored by src/lib/games/tango.ts, which adds the signs.';

revoke all on function public.tango_draw(bigint, integer) from public;

-- ─────────────────────────────────────────────────────────────────────────────
-- Complete a run: replay, verify, then record
-- ─────────────────────────────────────────────────────────────────────────────

create or replace function public.complete_tango_run(
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
  -- The current board (1-based, 1 sun, 2 moon, 0 empty), its solution and the
  -- cells it started with.
  v_board    int[];
  v_cells    int[];
  v_solution int[];
  v_start    int[];
  v_placed   int := 0;
  v_cleared  int := 0;
  v_score    bigint := 0;
  v_over     boolean := false;
  v_cell     int;
  v_digest   text;
  v_elapsed  bigint;
  v_best     bigint;
  v_rank     bigint;
begin
  if p_session_id is null then
    raise exception 'a session id is required' using errcode = '22023';
  end if;
  if p_actions is null or array_position(p_actions, null) is not null then
    raise exception 'actions must be a dense array of cell indexes' using errcode = '22023';
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

  if v_session.rules_version is distinct from public.tango_rules_version() then
    v_result.outcome := 'wrong_rules';
    v_result.session_id := v_session.id;
    v_result.game_slug := v_game.slug;
    return v_result;
  end if;

  if coalesce(array_length(p_actions, 1), 0) > public.tango_max_actions() then
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
  -- A tap names a cell that did not start filled, and cycles it: empty, sun,
  -- moon, empty. When the board equals its solution (`tango_draw`, mirrored by
  -- src/lib/games/tango.ts), it scores sixty points and the next board starts.
  -- A cell that started filled, or a cell off the board, is impossible play. A
  -- submission that stops with the run live is the clock or the player ending
  -- it, and is valid: the score never goes down.
  v_board := public.tango_draw(v_session.seed, v_level);
  v_solution := v_board[1:36];
  v_start := v_board[37:72];
  v_cells := v_start;

  foreach v_cell in array coalesce(p_actions, array[]::integer[]) loop
    if v_over or v_cell < 0 or v_cell > 35 or v_start[v_cell + 1] <> 0 then
      v_result.outcome := 'invalid_actions';
      v_result.session_id := v_session.id;
      v_result.game_slug := v_game.slug;
      return v_result;
    end if;

    v_cells[v_cell + 1] := (v_cells[v_cell + 1] + 1) % 3;
    v_placed := v_placed + 1;

    if v_cells = v_solution then
      v_cleared := v_cleared + 1;
      v_score := v_score + 60;
      v_level := v_level + 1;
      v_board := public.tango_draw(v_session.seed, v_level);
      v_solution := v_board[1:36];
      v_start := v_board[37:72];
      v_cells := v_start;
    end if;

    if v_placed >= public.tango_max_actions() then
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
  if v_elapsed > public.tango_budget_ms(v_cleared) + public.tango_slack_ms() then
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

comment on function public.complete_tango_run(uuid, integer[], bigint, integer) is
  'Replays a submitted Tango run from its session seed, derives the score, and records it. A tap cycles a cell that did not start filled; a board equal to its solution scores sixty points and deals the next. Any prefix of a legal line is valid. A run that arrives later than its solved boards earned is out_of_time. The claim is compared, never trusted.';

revoke all on function public.complete_tango_run(uuid, integer[], bigint, integer) from public;
grant execute on function public.complete_tango_run(uuid, integer[], bigint, integer) to anon, authenticated;

-- ─────────────────────────────────────────────────────────────────────────────
-- Start a run: the gate learns the eleventh runtime
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
  -- holds. 7 Second, Queens, Zip, 8 Puzzle and Tango have one. Anything else is
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
     or (v_game.runtime = 'tango' and p_rules_version = public.tango_rules_version()) then
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
    -- of the table's two. Queens, Zip, 8 Puzzle and Tango are endless too (the
    -- clocks of the last three end a run long before this would). Every finite game keeps two hours.
    insert into public.game_sessions (game_id, user_id, client, rules_version, expires_at)
    values (v_game.id, v_user, v_client, p_rules_version,
            case when p_rules_version in ('chain@2', 'color-merge@2', 'stack-10@2',
                                          'memory-flash@2', 'one-move@2', 'queens@1', 'zip@1',
                                          'eight-puzzle@1', 'tango@1')
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
                             else public.stack10_tiles()
                           end;
  v_empty.started_at    := v_session.started_at;
  v_empty.expires_at    := v_session.expires_at;
  v_empty.ranked        := v_session.user_id is not null;
  return v_empty;
end;
$$;

comment on function public.start_game_session(text, text, text) is
  'Issues a play session with a server-chosen seed. The caller identity is the verified token, never an argument. Stack 10 accepts stack-10@1 (legacy) and stack-10@2 (endless); Chain accepts chain@1 and chain@2; Memory Flash accepts memory-flash@1 (legacy) and memory-flash@2 (endless); One Move accepts one-move@1 (legacy) and one-move@2 (endless); Color Merge accepts color-merge@1 and color-merge@2; Don''t Touch the Black accepts dont-touch@1 and dont-touch@2; Queens accepts queens@1; Zip accepts zip@1, 8 Puzzle accepts eight-puzzle@1 and Tango accepts tango@1, all issued on Start because their verifiers time the run from the session; 7 Second also answers already_played once the signed-in player has finished today''s deck.';

revoke all on function public.start_game_session(text, text, text) from public;
grant execute on function public.start_game_session(text, text, text) to anon, authenticated;
