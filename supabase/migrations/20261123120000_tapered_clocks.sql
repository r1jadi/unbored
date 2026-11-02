-- The tapered clock: zip@2, eight-puzzle@2, tango@2, sudoku@3 and decant@2.
--
-- The five timed level games play boards against one clock that every solved
-- board winds back. Until now each board added the same time however far the
-- run had gone. From these versions a run starts with a little more time, the
-- first boards add more than before and later boards less, so a run opens gently
-- and tightens as it goes:
--
--   start            Zip, 8 Puzzle, Decant 60 s → 75 s; Tango 120 s → 140 s;
--                    Sudoku 360 s → 400 s
--   board n's bonus  the game's old bonus × `clock_taper_pct(n)`: 120% for
--                    board 1, 110% for board 2, 100% for board 3, then ten
--                    points less a board, down to 50% from board 8 on
--
-- Mirrored by src/lib/games/clock.ts and each game's `budgetMs`. Every bonus is
-- a whole number of seconds times a whole percentage, so the arithmetic below
-- is exact and the client agrees to the millisecond.
--
-- Nothing else about these games changes: the boards, scoring and bounds are
-- the same. The verifiers still replay the old versions on the old clocks, and
-- the start gate still issues them, so a session opened before this migration —
-- or by a client deployed before it — still verifies.
--
-- Apply before the client that sends the new versions. See docs/games/README.md.

-- ─────────────────────────────────────────────────────────────────────────────
-- The taper, and the versions new runs pin
-- ─────────────────────────────────────────────────────────────────────────────

create or replace function public.clock_taper_pct(p_level integer)
returns integer language sql immutable set search_path = '' as $$
  select greatest(50, 130 - 10 * p_level)
$$;

comment on function public.clock_taper_pct(integer) is
  'The share of a timed game''s base bonus that solving board p_level earns, in percent: 120, 110, 100, then ten less a board down to 50. Mirrored by src/lib/games/clock.ts.';

create or replace function public.zip_rules_version()
returns text language sql immutable set search_path = '' as $$ select 'zip@2'::text $$;
create or replace function public.eight_puzzle_rules_version()
returns text language sql immutable set search_path = '' as $$ select 'eight-puzzle@2'::text $$;
create or replace function public.tango_rules_version()
returns text language sql immutable set search_path = '' as $$ select 'tango@2'::text $$;
create or replace function public.sudoku_rules_version()
returns text language sql immutable set search_path = '' as $$ select 'sudoku@3'::text $$;
create or replace function public.decant_rules_version()
returns text language sql immutable set search_path = '' as $$ select 'decant@2'::text $$;

comment on function public.zip_rules_version() is
  'The Zip rules version new runs pin: zip@2, the tapered clock. complete_zip_run still replays zip@1.';
comment on function public.eight_puzzle_rules_version() is
  'The 8 Puzzle rules version new runs pin: eight-puzzle@2, the tapered clock. complete_eight_puzzle_run still replays eight-puzzle@1.';
comment on function public.tango_rules_version() is
  'The Tango rules version new runs pin: tango@2, the tapered clock. complete_tango_run still replays tango@1.';
comment on function public.sudoku_rules_version() is
  'The Sudoku rules version new runs pin: sudoku@3, bank boards on the tapered clock. complete_sudoku_run still replays sudoku@2 and sudoku@1.';
comment on function public.decant_rules_version() is
  'The Decant rules version new runs pin: decant@2, the tapered clock. complete_decant_run still replays decant@1.';

-- ─────────────────────────────────────────────────────────────────────────────
-- The tapered clocks
-- ─────────────────────────────────────────────────────────────────────────────

-- Zip: 75 s, plus five seconds a row of every solved board, tapered.
create or replace function public.zip_tapered_budget_ms(p_cleared integer)
returns bigint
language plpgsql
immutable
set search_path = ''
as $$
declare
  v_total bigint := 75000;
  v_level integer;
begin
  for v_level in 1..greatest(coalesce(p_cleared, 0), 0) loop
    v_total := v_total
             + 5000::bigint * public.zip_side(v_level) * public.clock_taper_pct(v_level) / 100;
  end loop;
  return v_total;
end;
$$;

-- 8 Puzzle: 75 s, plus fifteen seconds a solved board, tapered.
create or replace function public.eight_puzzle_tapered_budget_ms(p_cleared integer)
returns bigint
language plpgsql
immutable
set search_path = ''
as $$
declare
  v_total bigint := 75000;
  v_level integer;
begin
  for v_level in 1..greatest(coalesce(p_cleared, 0), 0) loop
    v_total := v_total + 15000::bigint * public.clock_taper_pct(v_level) / 100;
  end loop;
  return v_total;
end;
$$;

-- Tango: 140 s, plus forty-five seconds a solved board, tapered.
create or replace function public.tango_tapered_budget_ms(p_cleared integer)
returns bigint
language plpgsql
immutable
set search_path = ''
as $$
declare
  v_total bigint := 140000;
  v_level integer;
begin
  for v_level in 1..greatest(coalesce(p_cleared, 0), 0) loop
    v_total := v_total + 45000::bigint * public.clock_taper_pct(v_level) / 100;
  end loop;
  return v_total;
end;
$$;

-- Sudoku: 400 s, plus, for every solved board, the allowance of the board after
-- it, tapered by the board just solved.
create or replace function public.sudoku_tapered_budget_ms(p_cleared integer)
returns bigint
language plpgsql
immutable
set search_path = ''
as $$
declare
  v_total bigint := 400000;
  v_level integer;
begin
  for v_level in 1..greatest(coalesce(p_cleared, 0), 0) loop
    v_total := v_total
             + public.sudoku_allowance_ms(public.sudoku_tier(v_level + 1))
               * public.clock_taper_pct(v_level) / 100;
  end loop;
  return v_total;
end;
$$;

-- Decant: 75 s, plus five seconds per colour of every solved board, tapered,
-- fifteen less for every extra tube.
create or replace function public.decant_tapered_budget_ms(p_cleared integer, p_extra_tubes integer)
returns bigint
language plpgsql
immutable
set search_path = ''
as $$
declare
  v_ms    bigint := 75000 - 15000::bigint * greatest(coalesce(p_extra_tubes, 0), 0);
  v_level integer;
begin
  for v_level in 1..greatest(coalesce(p_cleared, 0), 0) loop
    v_ms := v_ms
          + 5000::bigint * public.decant_colours(v_level) * public.clock_taper_pct(v_level) / 100;
  end loop;
  return v_ms;
end;
$$;

comment on function public.zip_tapered_budget_ms(integer) is
  'The clock a zip@2 run has earned: 75 s plus 5 s per row of every solved board, tapered by clock_taper_pct.';
comment on function public.eight_puzzle_tapered_budget_ms(integer) is
  'The clock an eight-puzzle@2 run has earned: 75 s plus 15 s per solved board, tapered by clock_taper_pct.';
comment on function public.tango_tapered_budget_ms(integer) is
  'The clock a tango@2 run has earned: 140 s plus 45 s per solved board, tapered by clock_taper_pct.';
comment on function public.sudoku_tapered_budget_ms(integer) is
  'The clock a sudoku@3 run has earned: 400 s plus the next board''s allowance for every solved board, tapered by clock_taper_pct.';
comment on function public.decant_tapered_budget_ms(integer, integer) is
  'The clock a decant@2 run has earned: 75 s plus 5 s per colour of every solved board, tapered by clock_taper_pct, less 15 s per extra tube.';

-- ─────────────────────────────────────────────────────────────────────────────
-- The verifiers replay each old version on its old clock and each new one on the
-- tapered clock, and the start gate issues both. Only the version checks and the
-- clocks change; the rest of each function is as the migration that last defined
-- it left it.
-- ─────────────────────────────────────────────────────────────────────────────

create or replace function public.complete_zip_run(
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
  v_side     int;
  v_cells    int;
  v_solution int[];
  -- The drawn path (1-based, the first v_length entries are live) and each
  -- cell's index on it, or -1.
  v_path     int[];
  v_at       int[];
  v_length   int := 0;
  v_head     int;
  v_index    int;
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

  if v_session.rules_version is null
     or v_session.rules_version not in ('zip@1', public.zip_rules_version()) then
    v_result.outcome := 'wrong_rules';
    v_result.session_id := v_session.id;
    v_result.game_slug := v_game.slug;
    return v_result;
  end if;

  if coalesce(array_length(p_actions, 1), 0) > public.zip_max_actions() then
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
  -- A cell either starts the path (it must be the solution's first cell), steps
  -- back onto the path (cutting it after that cell; the head itself is not a
  -- move), or extends the path to a neighbour of its head (not once the head is
  -- the solution's last cell). When the path covers the board and is the
  -- solution (`zip_path`, mirrored by src/lib/games/zip.ts), the board is solved
  -- for ten points a row and the next one starts with no path. Anything else is
  -- impossible play. A submission that stops with the run live is the clock or
  -- the player ending it, and is valid: the score never goes down.
  v_side := public.zip_side(v_level);
  v_cells := v_side * v_side;
  v_solution := public.zip_path(v_session.seed, v_level);
  v_path := array_fill(0, array[v_cells]);
  v_at := array_fill(-1, array[v_cells]);

  foreach v_cell in array coalesce(p_actions, array[]::integer[]) loop
    if v_over or v_cell < 0 or v_cell >= v_cells then
      v_result.outcome := 'invalid_actions';
      v_result.session_id := v_session.id;
      v_result.game_slug := v_game.slug;
      return v_result;
    end if;

    if v_length = 0 then
      if v_cell <> v_solution[1] then
        v_result.outcome := 'invalid_actions';
        v_result.session_id := v_session.id;
        v_result.game_slug := v_game.slug;
        return v_result;
      end if;
      v_path[1] := v_cell;
      v_at[v_cell + 1] := 0;
      v_length := 1;
    elsif v_at[v_cell + 1] >= 0 then
      v_index := v_at[v_cell + 1];
      if v_index = v_length - 1 then
        v_result.outcome := 'invalid_actions';
        v_result.session_id := v_session.id;
        v_result.game_slug := v_game.slug;
        return v_result;
      end if;
      for v_head in v_index + 1..v_length - 1 loop
        v_at[v_path[v_head + 1] + 1] := -1;
      end loop;
      v_length := v_index + 1;
    else
      v_head := v_path[v_length];
      if v_head = v_solution[v_cells]
         or not ((v_head / v_side = v_cell / v_side and abs(v_head - v_cell) = 1)
                 or abs(v_head - v_cell) = v_side) then
        v_result.outcome := 'invalid_actions';
        v_result.session_id := v_session.id;
        v_result.game_slug := v_game.slug;
        return v_result;
      end if;
      v_path[v_length + 1] := v_cell;
      v_at[v_cell + 1] := v_length;
      v_length := v_length + 1;
    end if;

    v_placed := v_placed + 1;

    if v_length = v_cells and v_path = v_solution then
      v_cleared := v_cleared + 1;
      v_score := v_score + 10 * v_side;
      v_level := v_level + 1;
      v_side := public.zip_side(v_level);
      v_cells := v_side * v_side;
      v_solution := public.zip_path(v_session.seed, v_level);
      v_path := array_fill(0, array[v_cells]);
      v_at := array_fill(-1, array[v_cells]);
      v_length := 0;
    end if;

    if v_placed >= public.zip_max_actions() then
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
  if v_elapsed > (case when v_session.rules_version = 'zip@1' then public.zip_budget_ms(v_cleared)
                    else public.zip_tapered_budget_ms(v_cleared) end) + public.zip_slack_ms() then
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

create or replace function public.complete_eight_puzzle_run(
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
  -- The current board (1-based, 0 for the gap) and the gap's cell, 0-based.
  v_tiles    int[];
  v_gap      int;
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

  if v_session.rules_version is null
     or v_session.rules_version not in ('eight-puzzle@1', public.eight_puzzle_rules_version()) then
    v_result.outcome := 'wrong_rules';
    v_result.session_id := v_session.id;
    v_result.game_slug := v_game.slug;
    return v_result;
  end if;

  if coalesce(array_length(p_actions, 1), 0) > public.eight_puzzle_max_actions() then
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
  -- A slide names the cell of a tile next to the gap, and that tile moves into
  -- it. When the board comes out solved, it scores ten points and the next board
  -- (`eight_puzzle_board`, mirrored by src/lib/games/eight-puzzle.ts) is dealt.
  -- The gap itself, a cell off the board, or a tile not next to the gap is
  -- impossible play. A submission that stops with the run live is the clock or
  -- the player ending it, and is valid: the score never goes down.
  v_tiles := public.eight_puzzle_board(v_session.seed, v_level);
  v_gap := array_position(v_tiles, 0) - 1;

  foreach v_cell in array coalesce(p_actions, array[]::integer[]) loop
    if v_over or v_cell < 0 or v_cell > 8 or v_cell = v_gap
       or not ((v_cell / 3 = v_gap / 3 and abs(v_cell - v_gap) = 1)
               or abs(v_cell - v_gap) = 3) then
      v_result.outcome := 'invalid_actions';
      v_result.session_id := v_session.id;
      v_result.game_slug := v_game.slug;
      return v_result;
    end if;

    v_tiles[v_gap + 1] := v_tiles[v_cell + 1];
    v_tiles[v_cell + 1] := 0;
    v_gap := v_cell;
    v_placed := v_placed + 1;

    if v_tiles = array[1,2,3,4,5,6,7,8,0] then
      v_cleared := v_cleared + 1;
      v_score := v_score + 10;
      v_level := v_level + 1;
      v_tiles := public.eight_puzzle_board(v_session.seed, v_level);
      v_gap := array_position(v_tiles, 0) - 1;
    end if;

    if v_placed >= public.eight_puzzle_max_actions() then
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
  if v_elapsed > (case when v_session.rules_version = 'eight-puzzle@1' then public.eight_puzzle_budget_ms(v_cleared)
                    else public.eight_puzzle_tapered_budget_ms(v_cleared) end) + public.eight_puzzle_slack_ms() then
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

  if v_session.rules_version is null
     or v_session.rules_version not in ('tango@1', public.tango_rules_version()) then
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
  if v_elapsed > (case when v_session.rules_version = 'tango@1' then public.tango_budget_ms(v_cleared)
                    else public.tango_tapered_budget_ms(v_cleared) end) + public.tango_slack_ms() then
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

create or replace function public.complete_decant_run(
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
  -- The board: up to twelve tubes of four slots, slot t × 4 + i + 1 (bottom i = 0),
  -- and each tube's fill. A snapshot for undo is the tubes then the fills.
  v_tubes    integer[];
  v_len      integer[];
  v_count    integer;
  v_history  integer[] := array[]::integer[];
  v_units    integer[];
  v_level    integer := 1;
  v_colours  integer;
  v_extra    boolean := false;
  v_extras   integer := 0;
  v_pours    integer := 0;
  v_action   integer;
  v_from     integer;
  v_to       integer;
  v_colour   integer;
  v_run      integer;
  v_amount   integer;
  v_i        integer;
  v_t        integer;
  v_solved   boolean;
  v_total    integer := 0;
  v_placed   integer := 0;
  v_score    bigint := 0;
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

  if v_session.rules_version is null
     or v_session.rules_version not in ('decant@1', public.decant_rules_version()) then
    v_result.outcome := 'wrong_rules';
    v_result.session_id := v_session.id;
    v_result.game_slug := v_game.slug;
    return v_result;
  end if;

  if coalesce(array_length(p_actions, 1), 0) > public.decant_max_actions() then
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
  -- Board one, dealt.
  v_colours := public.decant_colours(v_level);
  v_units := public.decant_board(v_session.seed, v_level);
  v_count := v_colours + 2;
  v_tubes := array_fill(0, array[48]);
  v_len := array_fill(0, array[12]);
  for v_i in 1..v_colours * 4 loop
    v_tubes[v_i] := v_units[v_i];
  end loop;
  for v_t in 1..v_colours loop
    v_len[v_t] := 4;
  end loop;

  foreach v_action in array coalesce(p_actions, array[]::integer[]) loop
    if v_action = 253 then
      -- The extra tube: once per board. Nothing before it can be undone.
      if v_extra then
        v_result.outcome := 'invalid_actions';
        v_result.session_id := v_session.id;
        v_result.game_slug := v_game.slug;
        return v_result;
      end if;
      v_extra := true;
      v_extras := v_extras + 1;
      v_count := v_count + 1;
      v_history := array[]::integer[];
      v_pours := 0;

    elsif v_action = 254 then
      -- Undo: the last snapshot, if this board has one.
      if v_pours = 0 then
        v_result.outcome := 'invalid_actions';
        v_result.session_id := v_session.id;
        v_result.game_slug := v_game.slug;
        return v_result;
      end if;
      v_i := array_length(v_history, 1) - 60;
      v_tubes := v_history[v_i + 1 : v_i + 48];
      v_len := v_history[v_i + 49 : v_i + 60];
      v_history := v_history[1 : v_i];
      v_pours := v_pours - 1;

    elsif v_action = 255 then
      -- Restart: the board as dealt, keeping a bought tube.
      if v_pours = 0 then
        v_result.outcome := 'invalid_actions';
        v_result.session_id := v_session.id;
        v_result.game_slug := v_game.slug;
        return v_result;
      end if;
      v_units := public.decant_board(v_session.seed, v_level);
      v_tubes := array_fill(0, array[48]);
      v_len := array_fill(0, array[12]);
      for v_i in 1..v_colours * 4 loop
        v_tubes[v_i] := v_units[v_i];
      end loop;
      for v_t in 1..v_colours loop
        v_len[v_t] := 4;
      end loop;
      v_history := array[]::integer[];
      v_pours := 0;

    else
      -- A pour: from × 16 + to. Onto an empty tube or the same colour, moving the
      -- top run of that colour, or as much as fits.
      if v_action < 0 or v_action > 255 then
        v_result.outcome := 'invalid_actions';
        v_result.session_id := v_session.id;
        v_result.game_slug := v_game.slug;
        return v_result;
      end if;
      v_from := v_action / 16;
      v_to := v_action % 16;
      if v_from = v_to or v_from >= v_count or v_to >= v_count
         or v_len[v_from + 1] = 0 or v_len[v_to + 1] >= 4
         or (v_len[v_to + 1] > 0
             and v_tubes[v_to * 4 + v_len[v_to + 1]] <> v_tubes[v_from * 4 + v_len[v_from + 1]]) then
        v_result.outcome := 'invalid_actions';
        v_result.session_id := v_session.id;
        v_result.game_slug := v_game.slug;
        return v_result;
      end if;

      v_history := v_history || v_tubes || v_len;
      v_colour := v_tubes[v_from * 4 + v_len[v_from + 1]];
      v_run := 0;
      while v_run < v_len[v_from + 1]
            and v_tubes[v_from * 4 + v_len[v_from + 1] - v_run] = v_colour loop
        v_run := v_run + 1;
      end loop;
      v_amount := least(v_run, 4 - v_len[v_to + 1]);
      for v_i in 1..v_amount loop
        v_tubes[v_from * 4 + v_len[v_from + 1]] := 0;
        v_len[v_from + 1] := v_len[v_from + 1] - 1;
        v_len[v_to + 1] := v_len[v_to + 1] + 1;
        v_tubes[v_to * 4 + v_len[v_to + 1]] := v_colour;
      end loop;
      v_pours := v_pours + 1;
      v_placed := v_placed + 1;

      -- Sorted: every tube empty, or full of one colour.
      v_solved := true;
      for v_t in 0..v_count - 1 loop
        if v_len[v_t + 1] <> 0
           and (v_len[v_t + 1] <> 4
                or v_tubes[v_t * 4 + 1] <> v_tubes[v_t * 4 + 2]
                or v_tubes[v_t * 4 + 1] <> v_tubes[v_t * 4 + 3]
                or v_tubes[v_t * 4 + 1] <> v_tubes[v_t * 4 + 4]) then
          v_solved := false;
          exit;
        end if;
      end loop;

      if v_solved then
        v_score := v_score + v_colours;
        v_total := v_total + 1;
        v_level := v_level + 1;
        v_colours := public.decant_colours(v_level);
        v_units := public.decant_board(v_session.seed, v_level);
        v_count := v_colours + 2;
        v_tubes := array_fill(0, array[48]);
        v_len := array_fill(0, array[12]);
        for v_i in 1..v_colours * 4 loop
          v_tubes[v_i] := v_units[v_i];
        end loop;
        for v_t in 1..v_colours loop
          v_len[v_t] := 4;
        end loop;
        v_history := array[]::integer[];
        v_pours := 0;
        v_extra := false;
      end if;
    end if;
  end loop;

  -- A run that stops mid-board is the clock running out or the player ending
  -- it, and it is scored as it stands: the score only ever grows. It must still
  -- reach the server within the clock its solved boards earned.
  if v_elapsed > (case when v_session.rules_version = 'decant@1' then public.decant_budget_ms(v_total, v_extras)
                    else public.decant_tapered_budget_ms(v_total, v_extras) end) + public.decant_slack_ms() then
    v_result.outcome := 'out_of_time';
    v_result.session_id := v_session.id;
    v_result.game_slug := v_game.slug;
    return v_result;
  end if;

  if p_score is distinct from v_score then
    v_result.outcome := 'score_mismatch';
    v_result.session_id := v_session.id;
    v_result.game_slug := v_game.slug;
    v_result.score := v_score;
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
  v_result.cleared_columns := v_total;
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
  -- sudoku@2 deals bank boards on a tiered clock; sudoku@1 its own grids.
  v_tiered   boolean;
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

  if v_session.rules_version is null
     or v_session.rules_version not in ('sudoku@1', 'sudoku@2', public.sudoku_rules_version()) then
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
  v_tiered := v_session.rules_version in ('sudoku@2', 'sudoku@3');
  if v_tiered then
    v_start := public.sudoku_start(v_session.seed, v_level);
    v_empty := 81 - coalesce(array_length(array_remove(v_start, 0), 1), 0);
  else
    v_board := public.sudoku_draw(v_session.seed, v_level);
    v_start := v_board[82:162];
    v_empty := 81 - public.sudoku_givens(v_level);
  end if;
  v_cells := v_start;

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
      if v_tiered then
        v_start := public.sudoku_start(v_session.seed, v_level);
        v_empty := 81 - coalesce(array_length(array_remove(v_start, 0), 1), 0);
      else
        v_board := public.sudoku_draw(v_session.seed, v_level);
        v_start := v_board[82:162];
        v_empty := 81 - public.sudoku_givens(v_level);
      end if;
      v_cells := v_start;
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
  if v_elapsed > (case when v_session.rules_version = 'sudoku@3' then public.sudoku_tapered_budget_ms(v_cleared)
                       when v_tiered then public.sudoku_tiered_budget_ms(v_cleared)
                       else public.sudoku_budget_ms(v_cleared) end) + public.sudoku_slack_ms() then
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
  -- holds. Zip, 8 Puzzle, Tango, Sudoku and Decant keep the versions from before
  -- the tapered clock too, for the same reason. 7 Second, Queens, Gridburst,
  -- Updraft and the crossword have one. Anything else is a version no verifier owns.
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
     or (v_game.runtime = 'zip' and p_rules_version in ('zip@1', public.zip_rules_version()))
     or (v_game.runtime = 'eight-puzzle'
         and p_rules_version in ('eight-puzzle@1', public.eight_puzzle_rules_version()))
     or (v_game.runtime = 'tango' and p_rules_version in ('tango@1', public.tango_rules_version()))
     or (v_game.runtime = 'sudoku'
         and p_rules_version in ('sudoku@1', 'sudoku@2', public.sudoku_rules_version()))
     or (v_game.runtime = 'crossword' and p_rules_version = public.crossword_rules_version())
     or (v_game.runtime = 'gridburst' and p_rules_version = public.gridburst_rules_version())
     or (v_game.runtime = 'updraft' and p_rules_version = public.updraft_rules_version())
     or (v_game.runtime = 'decant'
         and p_rules_version in ('decant@1', public.decant_rules_version())) then
    -- Allowed: issued below.
    null;
  else
    v_empty.outcome := 'unsupported_runtime';
    return v_empty;
  end if;

  if v_game.runtime in ('seven-second', 'crossword') and v_user is not null then
    perform pg_advisory_xact_lock(
      hashtextextended(v_game.id::text || ':' || v_user::text, 0)
    );

    if exists (
      select 1
        from public.game_sessions s
       where s.game_id = v_game.id
         and s.user_id = v_user
         and s.completed_at is not null
         and s.seed = case v_game.runtime when 'crossword' then public.crossword_day()
                                           else public.seven_second_seed() end
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
  elsif v_game.runtime = 'crossword' then
    insert into public.game_sessions (game_id, user_id, client, rules_version, seed)
    values (v_game.id, v_user, v_client, p_rules_version, public.crossword_day())
    returning * into v_session;
  else
    -- An endless run is a marathon, so its session lives for twelve hours instead
    -- of the table's two. Every finite game keeps two hours.
    insert into public.game_sessions (game_id, user_id, client, rules_version, expires_at)
    values (v_game.id, v_user, v_client, p_rules_version,
            case when p_rules_version in ('chain@2', 'color-merge@2', 'stack-10@2',
                                          'memory-flash@2', 'one-move@2', 'queens@1', 'zip@1',
                                          'eight-puzzle@1', 'tango@1', 'sudoku@1',
                                          'sudoku@2', 'gridburst@1', 'decant@1', 'zip@2',
                                          'eight-puzzle@2', 'tango@2', 'sudoku@3', 'decant@2')
                 then now() + interval '12 hours'
                 else now() + interval '2 hours' end)
    returning * into v_session;
  end if;

  v_empty.outcome       := 'started';
  v_empty.id            := v_session.id;
  v_empty.game_slug     := v_game.slug;
  v_empty.rules_version := v_session.rules_version;
  v_empty.seed          := v_session.seed;
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
                             when 'crossword' then public.crossword_max_actions()
                             when 'gridburst' then public.gridburst_max_moves()
                             when 'updraft' then public.updraft_max_actions()
                             when 'decant' then public.decant_max_actions()
                             else public.stack10_tiles()
                           end;
  v_empty.started_at    := v_session.started_at;
  v_empty.expires_at    := v_session.expires_at;
  v_empty.ranked        := v_session.user_id is not null;
  return v_empty;
end;
$$;

comment on function public.start_game_session(text, text, text) is
  'Issues a play session with a server-chosen seed. The caller identity is the verified token, never an argument. Stack 10 accepts stack-10@1 (legacy) and stack-10@2 (endless); Chain accepts chain@1 and chain@2; Memory Flash accepts memory-flash@1 (legacy) and memory-flash@2 (endless); One Move accepts one-move@1 (legacy) and one-move@2 (endless); Color Merge accepts color-merge@1 and color-merge@2; Don''t Touch the Black accepts dont-touch@1 and dont-touch@2; Queens accepts queens@1; Zip accepts zip@2 (and zip@1), 8 Puzzle accepts eight-puzzle@2 (and eight-puzzle@1), Tango accepts tango@2 (and tango@1), Sudoku accepts sudoku@3 (and sudoku@2 and sudoku@1), Gridburst accepts gridburst@1, Updraft accepts updraft@1 and Decant accepts decant@2 (and decant@1) — the @1 versions and sudoku@2 are the clocks before the taper; 7 Second and the daily crossword (crossword@1) also answer already_played once the signed-in player has finished today''s.';

-- ─────────────────────────────────────────────────────────────────────────────
-- The catalogue copy states the new clocks. Matched by runtime, as the rename
-- migration does; a sentence that is not there is left as it is.
-- ─────────────────────────────────────────────────────────────────────────────

update public.games
   set instructions = replace(instructions,
         'The clock starts at 60 seconds and every solved board adds five seconds a row.',
         'The clock starts at 75 seconds and every solved board adds about five seconds a row: a little more early on, less as the run goes.')
 where runtime = 'zip';

update public.games
   set instructions = replace(instructions,
         'The clock starts at 60 seconds and every solved board adds 15 seconds and ten points.',
         'The clock starts at 75 seconds and every solved board adds ten points and time: 18 seconds for the first, less with each board after, down to 7.5.')
 where runtime = 'eight-puzzle';

update public.games
   set instructions = replace(instructions,
         'The clock starts at two minutes and every solved board adds 45 seconds and sixty points.',
         'The clock starts at 2:20 and every solved board adds sixty points and time: 54 seconds for the first, less with each board after, down to 22.5.')
 where runtime = 'tango';

update public.games
   set instructions = replace(instructions,
         'the clock starts at six minutes, and every solved board scores ninety points and adds the next board''s time.',
         'the clock starts at 6:40, and every solved board scores ninety points and adds time for the next board: generous early on, tighter as the run goes.')
 where runtime = 'sudoku';

update public.games
   set instructions = replace(instructions,
         '10 points and 5 more seconds per colour.',
         '10 points and about 5 more seconds per colour: a little more early on, less as the run goes.')
 where runtime = 'decant';
