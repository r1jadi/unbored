-- Scatter (`scatter@1`): arrow tiles that fly off the board, verified by the database.
--
-- A grid of arrow tiles. A tapped tile escapes the way it points if its lane to
-- the edge is clear, and jams otherwise; three jams end the run. Turnstile tiles
-- turn a quarter clockwise every time a tile escapes. Every escape scores one
-- unit, every cleared board five more, and a board where no tile can leave is
-- lost for a jam. There is no last board and no clock.
--
-- This migration is half the feature:
--
--   1. The rules, as constants the database owns, and the boards
--      (`scatter_board`), mirrored by src/lib/games/scatter.ts.
--   2. `public.complete_scatter_run`, the verifier: it replays the taps from the
--      session's seed and derives the score itself.
--   3. `public.start_game_session` learns the (`scatter`, `scatter@1`) pair.
--
-- Nothing here puts Scatter in the catalogue: `20261128120100_scatter_playable.sql`
-- does, after the deployment carrying the runtime is live. See docs/games/README.md.

-- ─────────────────────────────────────────────────────────────────────────────
-- The rules, as constants the database owns
-- ─────────────────────────────────────────────────────────────────────────────

create or replace function public.scatter_rules_version()
returns text language sql immutable set search_path = '' as $$ select 'scatter@1'::text $$;

create or replace function public.scatter_max_actions()
returns integer language sql immutable set search_path = '' as $$ select 4096 $$;

-- A board's side: 4 for boards 1–2, 5 for 3–5, 6 for 6–9, then 7.
create or replace function public.scatter_side(p_level integer)
returns integer
language plpgsql
immutable
set search_path = ''
as $$
begin
  if p_level is null or p_level < 1 then
    raise exception 'a Scatter level is one or more' using errcode = '22023';
  end if;
  return case when p_level <= 2 then 4 when p_level <= 5 then 5 when p_level <= 9 then 6 else 7 end;
end;
$$;

-- The tiles a board is dealt: half its cells on board one, five points more a
-- board, up to four fifths.
create or replace function public.scatter_tiles(p_level integer)
returns integer language sql immutable set search_path = '' as $$
  select (public.scatter_side(p_level) * public.scatter_side(p_level)
          * least(80, 50 + 5 * (p_level - 1))) / 100
$$;

-- The turnstiles among `p_tiles` dealt tiles: none on boards 1–2, then one more
-- a board, up to a quarter of the tiles.
create or replace function public.scatter_turnstiles(p_level integer, p_tiles integer)
returns integer language sql immutable set search_path = '' as $$
  select least(p_tiles / 4, greatest(0, p_level - 2))
$$;

-- Whether the lane from cell `p_cell` (0-based) to the edge, the way `p_dir`
-- points (0 up, 1 right, 2 down, 3 left), holds no tile. `p_cells` is the board,
-- 1-based, 0 for an empty cell.
create or replace function public.scatter_lane_clear(
  p_cells integer[], p_side integer, p_cell integer, p_dir integer
)
returns boolean
language plpgsql
immutable
set search_path = ''
as $$
declare
  v_dr  integer := case p_dir when 0 then -1 when 2 then 1 else 0 end;
  v_dc  integer := case p_dir when 1 then 1 when 3 then -1 else 0 end;
  v_row integer := p_cell / p_side + v_dr;
  v_col integer := p_cell % p_side + v_dc;
begin
  while v_row >= 0 and v_row < p_side and v_col >= 0 and v_col < p_side loop
    if p_cells[v_row * p_side + v_col + 1] <> 0 then
      return false;
    end if;
    v_row := v_row + v_dr;
    v_col := v_col + v_dc;
  end loop;
  return true;
end;
$$;

comment on function public.scatter_rules_version() is
  'The Scatter rules version the database can verify. A rules change needs a new version and a new verifier.';
comment on function public.scatter_max_actions() is
  'The most taps a Scatter submission may carry. A request bound, not a final board.';
comment on function public.scatter_side(integer) is
  'The side of a Scatter board: 4, 5 from board three, 6 from board six, 7 from board ten.';
comment on function public.scatter_tiles(integer) is
  'The tiles a Scatter board is dealt: 50% of its cells, five points more a board, up to 80%.';
comment on function public.scatter_turnstiles(integer, integer) is
  'The turnstiles among a Scatter board''s tiles: one a board from board three, up to a quarter.';
comment on function public.scatter_lane_clear(integer[], integer, integer, integer) is
  'Whether a Scatter tile''s lane to the edge is empty. Mirrored by laneClear in src/lib/games/scatter.ts.';

-- ─────────────────────────────────────────────────────────────────────────────
-- The boards, as the one generator both sides draw from
-- ─────────────────────────────────────────────────────────────────────────────
--
-- One Move's outer LCG advanced once per level, and a second LCG started at that
-- state, as Decant draws its boards; a draw is the state's top sixteen bits. For
-- each tile: a start cell and a start direction are drawn, and from the start
-- cell onwards (wrapping) the first free cell with a clear lane in some
-- direction — tried from the start direction, clockwise — takes the tile facing
-- it; a tile that fits nowhere ends the dealing. Then for each turnstile a start
-- index among the placed tiles is drawn, and the first from there (wrapping) not
-- yet a turnstile becomes one, turned back a quarter for every tile that leaves
-- before it when the board is cleared in the reverse of the order it was dealt.
--
-- A cell is 0 when empty, else 1 + direction, plus 4 for a turnstile.
create or replace function public.scatter_board(p_seed bigint, p_level integer)
returns integer[]
language plpgsql
immutable
set search_path = ''
as $$
declare
  v_state   bigint;
  v_current integer;
  v_side    integer;
  v_count   integer;
  v_target  integer;
  v_cells   integer[];
  v_place   integer[] := array[]::integer[];
  v_dirs    integer[] := array[]::integer[];
  v_turn    boolean[];
  v_k       integer;
  v_start   integer;
  v_sdir    integer;
  v_probe   integer;
  v_cell    integer;
  v_t       integer;
  v_dir     integer;
  v_found   boolean;
  v_n       integer;
  v_turns   integer;
  v_index   integer;
  v_before  integer;
begin
  if p_seed is null then
    raise exception 'a seed is required' using errcode = '22023';
  end if;
  if p_level is null or p_level < 1 or p_level > 8192 then
    raise exception 'scatter level is outside the reachable run' using errcode = '22023';
  end if;
  v_side := public.scatter_side(p_level);
  v_count := v_side * v_side;
  v_target := public.scatter_tiles(p_level);
  v_cells := array_fill(0, array[v_count]);

  v_state := (p_seed % 4294967296 + 4294967296) % 4294967296;
  if v_state = 0 then
    v_state := 2654435769; -- 0x9E3779B9: a zero state would make the sequence degenerate
  end if;
  for v_current in 1..p_level loop
    v_state := (v_state * 1664525 + 1013904223) % 4294967296;
  end loop;

  -- The tiles, in the reverse of the order a solution clears them. While dealing,
  -- a cell holds 1 for "taken" so the lane test sees it.
  for v_k in 1..v_target loop
    v_state := (v_state * 22695477 + 1) % 4294967296;
    v_start := ((v_state >> 16) % v_count)::integer;
    v_state := (v_state * 22695477 + 1) % 4294967296;
    v_sdir := ((v_state >> 16) % 4)::integer;
    v_found := false;
    for v_probe in 0..v_count - 1 loop
      v_cell := (v_start + v_probe) % v_count;
      continue when v_cells[v_cell + 1] <> 0;
      for v_t in 0..3 loop
        v_dir := (v_sdir + v_t) % 4;
        if public.scatter_lane_clear(v_cells, v_side, v_cell, v_dir) then
          v_cells[v_cell + 1] := 1;
          v_place := v_place || v_cell;
          v_dirs := v_dirs || v_dir;
          v_found := true;
          exit;
        end if;
      end loop;
      exit when v_found;
    end loop;
    exit when not v_found;
  end loop;

  v_n := coalesce(array_length(v_place, 1), 0);
  v_turn := array_fill(false, array[greatest(v_n, 1)]);
  v_turns := public.scatter_turnstiles(p_level, v_n);
  for v_k in 1..v_turns loop
    v_state := (v_state * 22695477 + 1) % 4294967296;
    v_start := ((v_state >> 16) % v_n)::integer;
    for v_probe in 0..v_n - 1 loop
      v_index := (v_start + v_probe) % v_n;
      if not v_turn[v_index + 1] then
        v_turn[v_index + 1] := true;
        exit;
      end if;
    end loop;
  end loop;

  for v_index in 0..v_n - 1 loop
    v_dir := v_dirs[v_index + 1];
    if v_turn[v_index + 1] then
      v_before := v_n - 1 - v_index;
      v_dir := ((v_dir - v_before) % 4 + 4) % 4;
      v_cells[v_place[v_index + 1] + 1] := 5 + v_dir;
    else
      v_cells[v_place[v_index + 1] + 1] := 1 + v_dir;
    end if;
  end loop;
  return v_cells;
end;
$$;

comment on function public.scatter_board(bigint, integer) is
  'The board a Scatter level is dealt, row by row: 0 empty, else 1 + direction (0 up, 1 right, 2 down, 3 left), plus 4 for a turnstile. Mirrored by src/lib/games/scatter.ts.';

revoke all on function public.scatter_board(bigint, integer) from public;
revoke all on function public.scatter_lane_clear(integer[], integer, integer, integer) from public;

-- ─────────────────────────────────────────────────────────────────────────────
-- Complete a run: replay, verify, then record
-- ─────────────────────────────────────────────────────────────────────────────

create or replace function public.complete_scatter_run(
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
  v_level    integer := 1;
  v_side     integer;
  v_cells    integer[];
  v_action   integer;
  v_tile     integer;
  v_i        integer;
  v_any      boolean;
  v_over     boolean := false;
  v_jams     integer := 0;
  v_exits    integer := 0;
  v_cleared  integer := 0;
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

  if v_session.rules_version is distinct from public.scatter_rules_version() then
    v_result.outcome := 'wrong_rules';
    v_result.session_id := v_session.id;
    v_result.game_slug := v_game.slug;
    return v_result;
  end if;

  if coalesce(array_length(p_actions, 1), 0) > public.scatter_max_actions() then
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
  v_side := public.scatter_side(v_level);
  v_cells := public.scatter_board(v_session.seed, v_level);

  foreach v_action in array coalesce(p_actions, array[]::integer[]) loop
    -- A tap after the run ended, off the board, or on an empty cell is not a move.
    if v_over or v_action < 0 or v_action >= v_side * v_side or v_cells[v_action + 1] = 0 then
      v_result.outcome := 'invalid_actions';
      v_result.session_id := v_session.id;
      v_result.game_slug := v_game.slug;
      return v_result;
    end if;

    v_tile := v_cells[v_action + 1];
    if public.scatter_lane_clear(v_cells, v_side, v_action, (v_tile - 1) % 4) then
      -- It escapes, and every turnstile turns a quarter clockwise.
      v_cells[v_action + 1] := 0;
      v_exits := v_exits + 1;
      v_score := v_score + 1;
      v_any := false;
      for v_i in 1..v_side * v_side loop
        if v_cells[v_i] > 4 then
          v_cells[v_i] := 5 + (v_cells[v_i] - 4) % 4;
        end if;
        if v_cells[v_i] <> 0 then
          v_any := true;
        end if;
      end loop;
      if not v_any then
        v_score := v_score + 5;
        v_cleared := v_cleared + 1;
        v_level := v_level + 1;
        v_side := public.scatter_side(v_level);
        v_cells := public.scatter_board(v_session.seed, v_level);
      end if;
    else
      v_jams := v_jams + 1;
    end if;

    -- A board where no tile can leave is lost for a jam.
    if v_jams < 3 then
      v_any := false;
      for v_i in 0..v_side * v_side - 1 loop
        if v_cells[v_i + 1] <> 0
           and public.scatter_lane_clear(v_cells, v_side, v_i, (v_cells[v_i + 1] - 1) % 4) then
          v_any := true;
          exit;
        end if;
      end loop;
      if not v_any then
        v_jams := v_jams + 1;
        v_level := v_level + 1;
        v_side := public.scatter_side(v_level);
        v_cells := public.scatter_board(v_session.seed, v_level);
      end if;
    end if;

    if v_jams >= 3 then
      v_over := true;
    end if;
  end loop;

  -- A run that stops with jams to spare is the player ending it, and it is
  -- scored as it stands: the score only ever grows.
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
  v_result.cleared_columns := v_cleared;
  v_result.tiles_placed    := v_exits;
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

comment on function public.complete_scatter_run(uuid, integer[], bigint, integer) is
  'Replays a submitted Scatter run from its session seed — escapes, jams, turnstile turns and lost boards — derives the score and records it. An escape scores one, a cleared board five more; the third jam ends the run. Any prefix of a legal line is valid. The claim is compared, never trusted.';

revoke all on function public.complete_scatter_run(uuid, integer[], bigint, integer) from public;
grant execute on function public.complete_scatter_run(uuid, integer[], bigint, integer) to anon, authenticated;

-- ─────────────────────────────────────────────────────────────────────────────
-- Start a run: the gate learns Scatter
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
         and p_rules_version in ('decant@1', public.decant_rules_version()))
     or (v_game.runtime = 'mini-sudoku' and p_rules_version = public.mini_sudoku_rules_version())
     or (v_game.runtime = 'scatter' and p_rules_version = public.scatter_rules_version()) then
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
                                          'eight-puzzle@2', 'tango@2', 'sudoku@3', 'decant@2',
                                          'mini-sudoku@1', 'scatter@1')
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
                             when 'mini-sudoku' then public.mini_sudoku_max_actions()
                             when 'scatter' then public.scatter_max_actions()
                             else public.stack10_tiles()
                           end;
  v_empty.started_at    := v_session.started_at;
  v_empty.expires_at    := v_session.expires_at;
  v_empty.ranked        := v_session.user_id is not null;
  return v_empty;
end;
$$;

comment on function public.start_game_session(text, text, text) is
  'Issues a play session with a server-chosen seed. The caller identity is the verified token, never an argument. Stack 10 accepts stack-10@1 (legacy) and stack-10@2 (endless); Chain accepts chain@1 and chain@2; Memory Flash accepts memory-flash@1 (legacy) and memory-flash@2 (endless); One Move accepts one-move@1 (legacy) and one-move@2 (endless); Color Merge accepts color-merge@1 and color-merge@2; Don''t Touch the Black accepts dont-touch@1 and dont-touch@2; Queens accepts queens@1; Zip accepts zip@2 (and zip@1), 8 Puzzle accepts eight-puzzle@2 (and eight-puzzle@1), Tango accepts tango@2 (and tango@1), Sudoku accepts sudoku@3 (and sudoku@2 and sudoku@1), Gridburst accepts gridburst@1, Updraft accepts updraft@1 and Decant accepts decant@2 (and decant@1) — the @1 versions and sudoku@2 are the clocks before the taper; Mini Sudoku accepts mini-sudoku@1; Scatter accepts scatter@1; 7 Second and the daily crossword (crossword@1) also answer already_played once the signed-in player has finished today''s.';
