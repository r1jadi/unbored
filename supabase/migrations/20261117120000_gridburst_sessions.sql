-- Gridburst: the fourteenth runtime.
--
-- Drop the pieces you are dealt onto an 8×8 grid; a full row or column bursts.
-- Three pieces are dealt at a time, and the run ends when none of the pieces left
-- in the tray fits anywhere. What this migration changes, and why:
--
--   1. The rules, as constants the database owns: `gridburst@1`, a 4096-placement
--      submission bound, the piece table and the big-piece ramp.
--
--   2. `public.complete_gridburst_run`, the verifier. It deals the trays from the
--      session's seed, replays every placement, bursts full lines and derives the
--      score: one point a cell placed, `10 × lines² × combo` a burst, and 300 for
--      a burst that empties the board. A run the player ends is scored as it
--      stands, as every endless game's is: the score only grows.
--
--   3. `public.start_game_session` learns (`gridburst`, `gridburst@1`) and gives
--      it the twelve-hour session of the other endless games, and
--      `public.run_resumable` lets a signed-in player save and continue it.
--
-- Nothing here puts Gridburst in the catalogue:
-- `20261117120100_gridburst_playable.sql` does, after the deployment carrying the
-- runtime is live. See docs/games/README.md and src/lib/games/gridburst.ts.

-- ─────────────────────────────────────────────────────────────────────────────
-- The rules, as constants the database owns
-- ─────────────────────────────────────────────────────────────────────────────

create or replace function public.gridburst_rules_version()
returns text language sql immutable set search_path = '' as $$ select 'gridburst@1'::text $$;

create or replace function public.gridburst_max_moves()
returns integer language sql immutable set search_path = '' as $$ select 4096 $$;

-- The share of deals drawn from the big pool: 8% for the first piece, one point
-- more every twelve pieces, capped at 40%.
create or replace function public.gridburst_big_percent(p_piece integer)
returns integer
language plpgsql
immutable
set search_path = ''
as $$
begin
  if p_piece is null or p_piece < 0 then
    raise exception 'a Gridburst piece index starts at zero' using errcode = '22023';
  end if;
  return least(40, 8 + (p_piece / 12));
end;
$$;

-- A shape's cells as flattened (row, column) offsets from its top-left corner.
-- Shapes 0–27 are the everyday pool and 28–36 the big one; the order is part of
-- the rules and mirrors GRIDBURST_SHAPES in src/lib/games/gridburst.ts.
create or replace function public.gridburst_shape(p_shape integer)
returns integer[]
language sql
immutable
set search_path = ''
as $$
  select case p_shape
    when 0 then array[0, 0]
    when 1 then array[0, 0, 0, 1]
    when 2 then array[0, 0, 1, 0]
    when 3 then array[0, 0, 0, 1, 0, 2]
    when 4 then array[0, 0, 1, 0, 2, 0]
    when 5 then array[0, 0, 0, 1, 0, 2, 0, 3]
    when 6 then array[0, 0, 1, 0, 2, 0, 3, 0]
    when 7 then array[0, 0, 0, 1, 1, 0, 1, 1]
    when 8 then array[0, 0, 0, 1, 1, 0]
    when 9 then array[0, 0, 0, 1, 1, 1]
    when 10 then array[0, 0, 1, 0, 1, 1]
    when 11 then array[0, 1, 1, 0, 1, 1]
    when 12 then array[0, 0, 0, 1, 0, 2, 1, 1]
    when 13 then array[0, 1, 1, 0, 1, 1, 1, 2]
    when 14 then array[0, 0, 1, 0, 1, 1, 2, 0]
    when 15 then array[0, 1, 1, 0, 1, 1, 2, 1]
    when 16 then array[0, 1, 0, 2, 1, 0, 1, 1]
    when 17 then array[0, 0, 1, 0, 1, 1, 2, 1]
    when 18 then array[0, 0, 0, 1, 1, 1, 1, 2]
    when 19 then array[0, 1, 1, 0, 1, 1, 2, 0]
    when 20 then array[0, 0, 1, 0, 2, 0, 2, 1]
    when 21 then array[0, 0, 0, 1, 0, 2, 1, 0]
    when 22 then array[0, 0, 0, 1, 1, 1, 2, 1]
    when 23 then array[0, 2, 1, 0, 1, 1, 1, 2]
    when 24 then array[0, 1, 1, 1, 2, 0, 2, 1]
    when 25 then array[0, 0, 1, 0, 1, 1, 1, 2]
    when 26 then array[0, 0, 0, 1, 1, 0, 2, 0]
    when 27 then array[0, 0, 0, 1, 0, 2, 1, 2]
    when 28 then array[0, 0, 0, 1, 0, 2, 0, 3, 0, 4]
    when 29 then array[0, 0, 1, 0, 2, 0, 3, 0, 4, 0]
    when 30 then array[0, 0, 0, 1, 0, 2, 1, 0, 1, 1, 1, 2]
    when 31 then array[0, 0, 0, 1, 1, 0, 1, 1, 2, 0, 2, 1]
    when 32 then array[0, 0, 0, 1, 0, 2, 1, 0, 1, 1, 1, 2, 2, 0, 2, 1, 2, 2]
    when 33 then array[0, 0, 0, 1, 0, 2, 1, 0, 2, 0]
    when 34 then array[0, 0, 0, 1, 0, 2, 1, 2, 2, 2]
    when 35 then array[0, 0, 1, 0, 2, 0, 2, 1, 2, 2]
    when 36 then array[0, 2, 1, 2, 2, 0, 2, 1, 2, 2]
  end
$$;

comment on function public.gridburst_rules_version() is
  'The Gridburst rules version new sessions pin. A rules change needs a new version and a new verifier branch.';
comment on function public.gridburst_max_moves() is
  'The most placements a Gridburst submission may carry. A request bound, not a final tray.';
comment on function public.gridburst_big_percent(integer) is
  'The chance a Gridburst deal comes from the big pool: 8% at piece zero, one point per twelve pieces, capped at 40%.';
comment on function public.gridburst_shape(integer) is
  'A Gridburst shape as flattened (row, column) offsets. Mirrors GRIDBURST_SHAPES in src/lib/games/gridburst.ts.';

-- ─────────────────────────────────────────────────────────────────────────────
-- The board: whether a piece fits
-- ─────────────────────────────────────────────────────────────────────────────

-- Whether shape `p_shape` fits with its top-left corner on 0-based `p_cell` of a
-- 64-cell board (1-based array, 0 empty).
create or replace function public.gridburst_fits(
  p_board integer[],
  p_shape integer,
  p_cell  integer
)
returns boolean
language plpgsql
immutable
set search_path = ''
as $$
declare
  v_cells integer[] := public.gridburst_shape(p_shape);
  v_row   integer;
  v_col   integer;
  v_r     integer;
  v_c     integer;
  v_i     integer;
begin
  if v_cells is null or p_cell is null or p_cell < 0 or p_cell > 63 then
    return false;
  end if;
  v_row := p_cell / 8;
  v_col := p_cell % 8;
  for v_i in 1..array_length(v_cells, 1) by 2 loop
    v_r := v_row + v_cells[v_i];
    v_c := v_col + v_cells[v_i + 1];
    if v_r > 7 or v_c > 7 or p_board[v_r * 8 + v_c + 1] <> 0 then
      return false;
    end if;
  end loop;
  return true;
end;
$$;

create or replace function public.gridburst_fits_anywhere(p_board integer[], p_shape integer)
returns boolean
language plpgsql
immutable
set search_path = ''
as $$
declare
  v_cell integer;
begin
  for v_cell in 0..63 loop
    if public.gridburst_fits(p_board, p_shape, v_cell) then
      return true;
    end if;
  end loop;
  return false;
end;
$$;

comment on function public.gridburst_fits(integer[], integer, integer) is
  'Whether a Gridburst shape fits with its corner on a cell. Mirrored by fits() in src/lib/games/gridburst.ts.';
comment on function public.gridburst_fits_anywhere(integer[], integer) is
  'Whether a Gridburst shape fits anywhere on the board: the run ends when no tray piece does.';

-- ─────────────────────────────────────────────────────────────────────────────
-- Complete a run: replay, verify, then record
-- ─────────────────────────────────────────────────────────────────────────────

create or replace function public.complete_gridburst_run(
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
  v_board    integer[] := array_fill(0, array[64]);
  v_tray     integer[];
  v_state    bigint;
  v_dealt    integer := 0;
  v_roll     integer;
  v_size     integer;
  v_pick     integer;
  v_action   integer;
  v_slot     integer;
  v_cell     integer;
  v_shape    integer;
  v_cells    integer[];
  v_i        integer;
  v_j        integer;
  v_full_rows boolean[];
  v_full_cols boolean[];
  v_lines    integer;
  v_total    integer := 0;
  v_combo    integer := 0;
  v_misses   integer := 0;
  v_placed   integer := 0;
  v_score    bigint := 0;
  v_over     boolean := false;
  v_digest   text;
  v_elapsed  bigint;
  v_best     bigint;
  v_rank     bigint;
begin
  if p_session_id is null then
    raise exception 'a session id is required' using errcode = '22023';
  end if;
  if p_actions is null or array_position(p_actions, null) is not null then
    raise exception 'actions must be a dense array of placements' using errcode = '22023';
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

  if v_session.rules_version is distinct from public.gridburst_rules_version() then
    v_result.outcome := 'wrong_rules';
    v_result.session_id := v_session.id;
    v_result.game_slug := v_game.slug;
    return v_result;
  end if;

  if coalesce(array_length(p_actions, 1), 0) > public.gridburst_max_moves() then
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
  -- The generator is the one every game uses. Each deal is two draws, read from
  -- bit 16 up: the first picks the pool (big when it falls under the ramp), the
  -- second the shape within it. A tray is three deals, and the next tray is dealt
  -- when the third piece is placed.
  v_state := (v_session.seed % 4294967296 + 4294967296) % 4294967296;
  if v_state = 0 then
    v_state := 2654435769; -- 0x9E3779B9: a zero state would make the sequence degenerate
  end if;

  v_tray := array[]::integer[];
  for v_i in 1..3 loop
    v_state := (v_state * 1664525 + 1013904223) % 4294967296;
    v_roll := ((v_state >> 16) % 100)::integer;
    v_state := (v_state * 1664525 + 1013904223) % 4294967296;
    v_size := case when v_roll < public.gridburst_big_percent(v_dealt) then 9 else 28 end;
    v_pick := ((v_state >> 16) % v_size)::integer;
    v_tray := v_tray || (case when v_size = 9 then 28 + v_pick else v_pick end);
    v_dealt := v_dealt + 1;
  end loop;

  -- A placement is `slot × 64 + cell`: the tray slot and the cell the piece's
  -- top-left corner lands on. A slot already played, a piece that does not fit
  -- and any placement after the run ended are impossible play.
  foreach v_action in array coalesce(p_actions, array[]::integer[]) loop
    if v_over or v_action < 0 or v_action > 191 then
      v_result.outcome := 'invalid_actions';
      v_result.session_id := v_session.id;
      v_result.game_slug := v_game.slug;
      return v_result;
    end if;

    v_slot := v_action / 64;
    v_cell := v_action % 64;
    v_shape := v_tray[v_slot + 1];
    if v_shape < 0 or not public.gridburst_fits(v_board, v_shape, v_cell) then
      v_result.outcome := 'invalid_actions';
      v_result.session_id := v_session.id;
      v_result.game_slug := v_game.slug;
      return v_result;
    end if;

    v_cells := public.gridburst_shape(v_shape);
    for v_i in 1..array_length(v_cells, 1) by 2 loop
      v_board[(v_cell / 8 + v_cells[v_i]) * 8 + v_cell % 8 + v_cells[v_i + 1] + 1] := v_shape + 1;
    end loop;
    v_score := v_score + array_length(v_cells, 1) / 2;
    v_tray[v_slot + 1] := -1;
    v_placed := v_placed + 1;

    -- Full lines are read before any is cleared, so a cell on a full row and a
    -- full column bursts once and counts toward both.
    v_full_rows := array_fill(true, array[8]);
    v_full_cols := array_fill(true, array[8]);
    for v_i in 0..7 loop
      for v_j in 0..7 loop
        if v_board[v_i * 8 + v_j + 1] = 0 then
          v_full_rows[v_i + 1] := false;
          v_full_cols[v_j + 1] := false;
        end if;
      end loop;
    end loop;

    v_lines := 0;
    for v_i in 1..8 loop
      if v_full_rows[v_i] then v_lines := v_lines + 1; end if;
      if v_full_cols[v_i] then v_lines := v_lines + 1; end if;
    end loop;

    if v_lines > 0 then
      for v_i in 0..7 loop
        for v_j in 0..7 loop
          if v_full_rows[v_i + 1] or v_full_cols[v_j + 1] then
            v_board[v_i * 8 + v_j + 1] := 0;
          end if;
        end loop;
      end loop;
      v_combo := v_combo + 1;
      v_misses := 0;
      v_score := v_score + 10 * v_lines * v_lines * v_combo;
      if not exists (select 1 from unnest(v_board) as b(value) where b.value <> 0) then
        v_score := v_score + 300;
      end if;
      v_total := v_total + v_lines;
    else
      v_misses := v_misses + 1;
      if v_misses >= 3 then
        v_combo := 0;
      end if;
    end if;

    if v_tray[1] < 0 and v_tray[2] < 0 and v_tray[3] < 0 then
      v_tray := array[]::integer[];
      for v_i in 1..3 loop
        v_state := (v_state * 1664525 + 1013904223) % 4294967296;
        v_roll := ((v_state >> 16) % 100)::integer;
        v_state := (v_state * 1664525 + 1013904223) % 4294967296;
        v_size := case when v_roll < public.gridburst_big_percent(v_dealt) then 9 else 28 end;
        v_pick := ((v_state >> 16) % v_size)::integer;
        v_tray := v_tray || (case when v_size = 9 then 28 + v_pick else v_pick end);
        v_dealt := v_dealt + 1;
      end loop;
    end if;

    -- The run ends when no piece left in the tray fits, or at the bound.
    v_over := v_placed >= public.gridburst_max_moves()
      or not (
        (v_tray[1] >= 0 and public.gridburst_fits_anywhere(v_board, v_tray[1]))
        or (v_tray[2] >= 0 and public.gridburst_fits_anywhere(v_board, v_tray[2]))
        or (v_tray[3] >= 0 and public.gridburst_fits_anywhere(v_board, v_tray[3]))
      );
  end loop;

  -- A run that stops while the board can still take a piece is the player ending
  -- it, and it is scored as it stands: the score only ever grows.

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

comment on function public.complete_gridburst_run(uuid, integer[], bigint, integer) is
  'Replays a submitted Gridburst run from its session seed — deals, placements, bursts and combos — derives the score and records it. A run ends when no tray piece fits, at the submission bound, or when the player ends it. The claim is compared, never trusted.';

revoke all on function public.complete_gridburst_run(uuid, integer[], bigint, integer) from public;
grant execute on function public.complete_gridburst_run(uuid, integer[], bigint, integer) to anon, authenticated;

-- ─────────────────────────────────────────────────────────────────────────────
-- Saved progress: Gridburst is untimed, so a run can be saved and continued
-- ─────────────────────────────────────────────────────────────────────────────

create or replace function public.run_resumable(p_rules_version text)
returns boolean
language sql
immutable
set search_path = ''
as $$
  select coalesce(p_rules_version in (
    'stack-10@2', 'chain@2', 'memory-flash@2', 'one-move@2', 'color-merge@2', 'queens@1',
    'gridburst@1'
  ), false)
$$;

comment on function public.run_resumable(text) is
  'Whether a run under these rules can be saved and continued later: the untimed endless games. Timed and real-time games cannot pause.';

-- ─────────────────────────────────────────────────────────────────────────────
-- Start a run: the gate learns Gridburst
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
  -- holds. 7 Second, Queens, Zip, 8 Puzzle, Tango, Gridburst and the crossword
  -- have one. Anything else is a version no verifier owns.
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
     or (v_game.runtime = 'sudoku'
         and p_rules_version in ('sudoku@1', public.sudoku_rules_version()))
     or (v_game.runtime = 'crossword' and p_rules_version = public.crossword_rules_version())
     or (v_game.runtime = 'gridburst' and p_rules_version = public.gridburst_rules_version()) then
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
                                          'sudoku@2', 'gridburst@1')
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
                             else public.stack10_tiles()
                           end;
  v_empty.started_at    := v_session.started_at;
  v_empty.expires_at    := v_session.expires_at;
  v_empty.ranked        := v_session.user_id is not null;
  return v_empty;
end;
$$;

comment on function public.start_game_session(text, text, text) is
  'Issues a play session with a server-chosen seed. The caller identity is the verified token, never an argument. Stack 10 accepts stack-10@1 (legacy) and stack-10@2 (endless); Chain accepts chain@1 and chain@2; Memory Flash accepts memory-flash@1 (legacy) and memory-flash@2 (endless); One Move accepts one-move@1 (legacy) and one-move@2 (endless); Color Merge accepts color-merge@1 and color-merge@2; Don''t Touch the Black accepts dont-touch@1 and dont-touch@2; Queens accepts queens@1; Zip accepts zip@1, 8 Puzzle accepts eight-puzzle@1, Tango accepts tango@1, Sudoku accepts sudoku@2 (and sudoku@1, the random-grid rules) and Gridburst accepts gridburst@1; 7 Second and the daily crossword (crossword@1) also answer already_played once the signed-in player has finished today''s.';

revoke all on function public.start_game_session(text, text, text) from public;
grant execute on function public.start_game_session(text, text, text) to anon, authenticated;
