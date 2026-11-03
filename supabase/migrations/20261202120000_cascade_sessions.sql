-- Cascade (`cascade@1`): the swap-and-match puzzle, verified by the database.
--
-- An 8×8 board of six kinds of tile. Swap two neighbours to line up three or
-- more of a kind; they clear, the tiles above fall, new tiles drop in from the
-- top and any new lines clear in turn, each wave worth more than the last. Four
-- in a line leave a line tile, five in a line or an L or T a burst tile, and a
-- cleared special clears its row, column or 3×3 square too. A run is levels
-- against one clock: each level asks for more tiles cleared and winds the clock
-- back, tapered like every timed game's.
--
-- This migration adds the rules, the generator and the deal, the verifier
-- (`complete_cascade_run`) and teaches the start gate the (`cascade`,
-- `cascade@1`) pair. It is only half the feature, so nothing a user can see
-- changes: `20261202120100_cascade_playable.sql` flips the catalogue and lands
-- last, once the service that routes `cascade@` runs to the new verifier and the
-- client that plays it are deployed. See docs/games/README.md.
--
-- Mirrored by src/lib/games/cascade.ts; the boards and scored lines in
-- src/lib/games/cascade.test.ts are the ones the verifier must reproduce.

-- ─────────────────────────────────────────────────────────────────────────────
-- The rules, as constants the database owns
-- ─────────────────────────────────────────────────────────────────────────────

create or replace function public.cascade_rules_version()
returns text language sql immutable set search_path = '' as $$ select 'cascade@1'::text $$;

create or replace function public.cascade_max_actions()
returns integer language sql immutable set search_path = '' as $$ select 4096 $$;

create or replace function public.cascade_slack_ms()
returns integer language sql immutable set search_path = '' as $$ select 20000 $$;

-- The tiles a level asks for: 30, then ten more every level.
create or replace function public.cascade_goal(p_level integer)
returns integer
language plpgsql
immutable
set search_path = ''
as $$
begin
  if p_level is null or p_level < 1 then
    raise exception 'a Cascade level is one or more' using errcode = '22023';
  end if;
  return 20 + 10 * p_level;
end;
$$;

-- The clock a run has earned: sixty seconds, plus twenty for every level cleared,
-- tapered by clock_taper_pct.
create or replace function public.cascade_budget_ms(p_cleared integer)
returns bigint
language plpgsql
immutable
set search_path = ''
as $$
declare
  v_ms    bigint := 60000;
  v_level integer;
begin
  for v_level in 1..greatest(coalesce(p_cleared, 0), 0) loop
    v_ms := v_ms + 20000::bigint * public.clock_taper_pct(v_level) / 100;
  end loop;
  return v_ms;
end;
$$;

comment on function public.cascade_rules_version() is
  'The Cascade rules version new runs pin: cascade@1.';
comment on function public.cascade_max_actions() is
  'The most swaps one Cascade submission may carry: a request ceiling, not a last level.';
comment on function public.cascade_slack_ms() is
  'How late after its clock ran out a Cascade run is still accepted.';
comment on function public.cascade_goal(integer) is
  'The tiles a Cascade level asks to be cleared: 20 + 10 × level.';
comment on function public.cascade_budget_ms(integer) is
  'The clock a cascade@1 run has earned: 60 s plus 20 s for every level cleared, tapered by clock_taper_pct.';

-- ─────────────────────────────────────────────────────────────────────────────
-- The board, as both sides see it
-- ─────────────────────────────────────────────────────────────────────────────
--
-- 64 cells, row by row from the top: cell r × 8 + c lives at index cell + 1. A
-- tile is colour + 8 × special — colour 1 to 6; special 0 plain, 1 row line,
-- 2 column line, 3 burst — and 0 is a gap, which only exists inside a cascade.
--
-- One generator draws every tile of the run, in order:
--   state₀ = ((seed mod 2³²) + 2³²) mod 2³²   (2654435769 if that is 0)
--   draw   = state ← (state × 22695477 + 1) mod 2³²; colour = 1 + (state >> 16) mod 6
--
-- Internals, not API surface: the verifier calls them as the functions' owner.

-- Whether the tile in a cell sits in a line of three or more of its colour.
create or replace function public.cascade_in_line(p_board integer[], p_cell integer)
returns boolean
language plpgsql
immutable
set search_path = ''
as $$
declare
  v_colour integer := p_board[p_cell + 1] % 8;
  v_row    integer := p_cell / 8;
  v_col    integer := p_cell % 8;
  v_run    integer;
  v_i      integer;
begin
  if v_colour = 0 then
    return false;
  end if;
  v_run := 1;
  v_i := v_col - 1;
  while v_i >= 0 and p_board[v_row * 8 + v_i + 1] % 8 = v_colour loop
    v_run := v_run + 1; v_i := v_i - 1;
  end loop;
  v_i := v_col + 1;
  while v_i < 8 and p_board[v_row * 8 + v_i + 1] % 8 = v_colour loop
    v_run := v_run + 1; v_i := v_i + 1;
  end loop;
  if v_run >= 3 then
    return true;
  end if;
  v_run := 1;
  v_i := v_row - 1;
  while v_i >= 0 and p_board[v_i * 8 + v_col + 1] % 8 = v_colour loop
    v_run := v_run + 1; v_i := v_i - 1;
  end loop;
  v_i := v_row + 1;
  while v_i < 8 and p_board[v_i * 8 + v_col + 1] % 8 = v_colour loop
    v_run := v_run + 1; v_i := v_i + 1;
  end loop;
  return v_run >= 3;
end;
$$;

-- Whether a swap — cell × 2 + direction, 0 right and 1 down — is legal: on the
-- board, and lining up three or more through one of the two cells.
create or replace function public.cascade_swap_legal(p_board integer[], p_action integer)
returns boolean
language plpgsql
immutable
set search_path = ''
as $$
declare
  v_a     integer;
  v_b     integer;
  v_board integer[] := p_board;
  v_swap  integer;
begin
  if p_action is null or p_action < 0 or p_action > 127 then
    return false;
  end if;
  v_a := p_action / 2;
  if p_action % 2 = 0 then
    if v_a % 8 = 7 then return false; end if;
    v_b := v_a + 1;
  else
    if v_a / 8 = 7 then return false; end if;
    v_b := v_a + 8;
  end if;
  v_swap := v_board[v_a + 1];
  v_board[v_a + 1] := v_board[v_b + 1];
  v_board[v_b + 1] := v_swap;
  return public.cascade_in_line(v_board, v_a) or public.cascade_in_line(v_board, v_b);
end;
$$;

create or replace function public.cascade_has_swap(p_board integer[])
returns boolean
language plpgsql
immutable
set search_path = ''
as $$
declare
  v_action integer;
begin
  for v_action in 0..127 loop
    if public.cascade_swap_legal(p_board, v_action) then
      return true;
    end if;
  end loop;
  return false;
end;
$$;

-- Deals a board from the generator: cell by cell, each tile drawn again until it
-- does not complete a line of three with the two to its left or the two above.
-- A board with no legal swap is dealt again, up to 1000 times; the last stands.
create or replace function public.cascade_deal(
  inout p_state bigint,
  out   p_board integer[]
)
language plpgsql
immutable
set search_path = ''
as $$
declare
  v_attempt integer;
  v_cell    integer;
  v_colour  integer;
begin
  for v_attempt in 1..1000 loop
    p_board := array_fill(0, array[64]);
    for v_cell in 0..63 loop
      loop
        p_state := (p_state * 22695477 + 1) % 4294967296;
        v_colour := 1 + ((p_state >> 16) % 6)::integer;
        exit when not (
          (v_cell % 8 >= 2 and p_board[v_cell] = v_colour and p_board[v_cell - 1] = v_colour)
          or (v_cell / 8 >= 2 and p_board[v_cell - 7] = v_colour and p_board[v_cell - 15] = v_colour)
        );
      end loop;
      p_board[v_cell + 1] := v_colour;
    end loop;
    exit when public.cascade_has_swap(p_board);
  end loop;
end;
$$;

-- The first board a seed deals, and the generator after it.
create or replace function public.cascade_first_board(
  p_seed    bigint,
  out p_board integer[],
  out p_state bigint
)
language plpgsql
immutable
set search_path = ''
as $$
declare
  v_state bigint;
begin
  if p_seed is null then
    raise exception 'a seed is required' using errcode = '22023';
  end if;
  v_state := (p_seed % 4294967296 + 4294967296) % 4294967296;
  if v_state = 0 then
    v_state := 2654435769; -- 0x9E3779B9: a zero state would make the sequence degenerate
  end if;
  select d.p_state, d.p_board into p_state, p_board from public.cascade_deal(v_state) d;
end;
$$;

-- Resolves the board after a swap, wave by wave, drawing refills from the
-- generator. Returns the settled board, the generator, and the tiles cleared and
-- points scored. See `resolve` in src/lib/games/cascade.ts for the rules in prose.
create or replace function public.cascade_resolve(
  inout p_board  integer[],
  inout p_state  bigint,
  p_from         integer,
  p_to           integer,
  out   p_tiles  integer,
  out   p_points bigint
)
language plpgsql
immutable
set search_path = ''
as $$
declare
  v_wave     integer;
  -- The lines of a wave, in order: across lines (rows top to bottom), then down
  -- lines (columns left to right). A line is its first cell, length and direction.
  v_start    integer[];
  v_length   integer[];
  v_across   boolean[];
  v_used     boolean[];
  v_lines    integer;
  -- Each cell's across line and down line (0 for none), and the wave's sets.
  v_hline    integer[];
  v_vline    integer[];
  v_matched  boolean[];
  v_clear    boolean[];
  v_fired    boolean[];
  v_created  integer[];
  v_row      integer;
  v_col      integer;
  v_first    integer;
  v_here     integer;
  v_s        integer;
  v_i        integer;
  v_l        integer;
  v_cell     integer;
  v_anchor   integer;
  v_special  integer;
  v_changed  boolean;
  v_r        integer;
  v_c        integer;
  v_count    integer;
  v_write    integer;
  v_tile     integer;
begin
  p_tiles := 0;
  p_points := 0;
  for v_wave in 1..64 loop
    v_start := array[]::integer[];
    v_length := array[]::integer[];
    v_across := array[]::boolean[];
    v_hline := array_fill(0, array[64]);
    v_vline := array_fill(0, array[64]);
    v_matched := array_fill(false, array[64]);

    for v_row in 0..7 loop
      v_s := 0;
      for v_col in 1..8 loop
        v_first := p_board[v_row * 8 + v_s + 1] % 8;
        v_here := case when v_col < 8 then p_board[v_row * 8 + v_col + 1] % 8 else -1 end;
        continue when v_here = v_first and v_first <> 0;
        if v_col - v_s >= 3 and v_first <> 0 then
          v_start := v_start || (v_row * 8 + v_s);
          v_length := v_length || (v_col - v_s);
          v_across := v_across || true;
          for v_i in v_s..v_col - 1 loop
            v_hline[v_row * 8 + v_i + 1] := array_length(v_start, 1);
            v_matched[v_row * 8 + v_i + 1] := true;
          end loop;
        end if;
        v_s := v_col;
      end loop;
    end loop;
    for v_col in 0..7 loop
      v_s := 0;
      for v_row in 1..8 loop
        v_first := p_board[v_s * 8 + v_col + 1] % 8;
        v_here := case when v_row < 8 then p_board[v_row * 8 + v_col + 1] % 8 else -1 end;
        continue when v_here = v_first and v_first <> 0;
        if v_row - v_s >= 3 and v_first <> 0 then
          v_start := v_start || (v_s * 8 + v_col);
          v_length := v_length || (v_row - v_s);
          v_across := v_across || false;
          for v_i in v_s..v_row - 1 loop
            v_vline[v_i * 8 + v_col + 1] := array_length(v_start, 1);
            v_matched[v_i * 8 + v_col + 1] := true;
          end loop;
        end if;
        v_s := v_row;
      end loop;
    end loop;

    v_lines := coalesce(array_length(v_start, 1), 0);
    exit when v_lines = 0;

    -- The special tiles this wave makes: crossings first, in cell order, then
    -- every other line of four or more, in line order.
    v_used := array_fill(false, array[v_lines]);
    v_created := array_fill(0, array[64]);
    for v_cell in 0..63 loop
      if v_hline[v_cell + 1] > 0 and v_vline[v_cell + 1] > 0
         and not v_used[v_hline[v_cell + 1]] and not v_used[v_vline[v_cell + 1]] then
        v_used[v_hline[v_cell + 1]] := true;
        v_used[v_vline[v_cell + 1]] := true;
        v_created[v_cell + 1] := p_board[v_cell + 1] % 8 + 24;
      end if;
    end loop;
    for v_l in 1..v_lines loop
      continue when v_used[v_l] or v_length[v_l] < 4;
      v_anchor := v_start[v_l];
      if v_wave = 1 then
        if (v_across[v_l] and v_hline[p_from + 1] = v_l)
           or (not v_across[v_l] and v_vline[p_from + 1] = v_l) then
          v_anchor := p_from;
        elsif (v_across[v_l] and v_hline[p_to + 1] = v_l)
              or (not v_across[v_l] and v_vline[p_to + 1] = v_l) then
          v_anchor := p_to;
        end if;
      end if;
      continue when v_created[v_anchor + 1] <> 0;
      v_special := case when v_length[v_l] >= 5 then 3 when v_across[v_l] then 1 else 2 end;
      v_created[v_anchor + 1] := p_board[v_anchor + 1] % 8 + 8 * v_special;
    end loop;

    -- What clears: every matched cell, and the blast of every special among them,
    -- and of every special a blast catches.
    v_clear := v_matched;
    v_fired := array_fill(false, array[64]);
    loop
      v_changed := false;
      for v_cell in 0..63 loop
        continue when not v_clear[v_cell + 1] or v_fired[v_cell + 1]
                      or p_board[v_cell + 1] / 8 = 0;
        v_fired[v_cell + 1] := true;
        v_changed := true;
        v_special := p_board[v_cell + 1] / 8;
        v_row := v_cell / 8;
        v_col := v_cell % 8;
        if v_special = 1 then
          for v_c in 0..7 loop v_clear[v_row * 8 + v_c + 1] := true; end loop;
        elsif v_special = 2 then
          for v_r in 0..7 loop v_clear[v_r * 8 + v_col + 1] := true; end loop;
        else
          for v_r in greatest(0, v_row - 1)..least(7, v_row + 1) loop
            for v_c in greatest(0, v_col - 1)..least(7, v_col + 1) loop
              v_clear[v_r * 8 + v_c + 1] := true;
            end loop;
          end loop;
        end if;
      end loop;
      exit when not v_changed;
    end loop;

    v_count := 0;
    for v_cell in 0..63 loop
      if v_clear[v_cell + 1] then
        v_count := v_count + 1;
        p_board[v_cell + 1] := 0;
      end if;
      if v_created[v_cell + 1] <> 0 then
        p_board[v_cell + 1] := v_created[v_cell + 1];
      end if;
    end loop;
    p_tiles := p_tiles + v_count;
    p_points := p_points + v_count * v_wave;

    -- Gravity, then the refill: each column falls, then fills from its lowest gap up.
    for v_col in 0..7 loop
      v_write := 7;
      for v_row in reverse 7..0 loop
        v_tile := p_board[v_row * 8 + v_col + 1];
        continue when v_tile = 0;
        p_board[v_row * 8 + v_col + 1] := 0;
        p_board[v_write * 8 + v_col + 1] := v_tile;
        v_write := v_write - 1;
      end loop;
      for v_row in reverse v_write..0 loop
        p_state := (p_state * 22695477 + 1) % 4294967296;
        p_board[v_row * 8 + v_col + 1] := 1 + ((p_state >> 16) % 6)::integer;
      end loop;
    end loop;
  end loop;
end;
$$;

comment on function public.cascade_deal(bigint) is
  'Deals a Cascade board from the generator state: no line of three, at least one swap. Mirrored by src/lib/games/cascade.ts.';
comment on function public.cascade_first_board(bigint) is
  'The first Cascade board a seed deals, and the generator after it. Mirrored by src/lib/games/cascade.ts.';
comment on function public.cascade_resolve(integer[], bigint, integer, integer) is
  'Resolves a Cascade board after a swap, wave by wave: lines clear, specials form and fire, tiles fall and refill. Mirrored by src/lib/games/cascade.ts.';

revoke all on function public.cascade_in_line(integer[], integer) from public;
revoke all on function public.cascade_swap_legal(integer[], integer) from public;
revoke all on function public.cascade_has_swap(integer[]) from public;
revoke all on function public.cascade_deal(bigint) from public;
revoke all on function public.cascade_first_board(bigint) from public;
revoke all on function public.cascade_resolve(integer[], bigint, integer, integer) from public;

-- ─────────────────────────────────────────────────────────────────────────────
-- Complete a run: replay, verify, then record
-- ─────────────────────────────────────────────────────────────────────────────

create or replace function public.complete_cascade_run(
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
  v_board    integer[];
  v_state    bigint;
  v_action   integer;
  v_a        integer;
  v_b        integer;
  v_swap     integer;
  v_tiles    integer;
  v_points   bigint;
  v_level    integer := 1;
  v_progress integer := 0;
  v_total    integer := 0;
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

  if v_session.rules_version is distinct from public.cascade_rules_version() then
    v_result.outcome := 'wrong_rules';
    v_result.session_id := v_session.id;
    v_result.game_slug := v_game.slug;
    return v_result;
  end if;

  if coalesce(array_length(p_actions, 1), 0) > public.cascade_max_actions() then
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
  select f.p_board, f.p_state into v_board, v_state
    from public.cascade_first_board(v_session.seed) f;

  foreach v_action in array coalesce(p_actions, array[]::integer[]) loop
    -- A swap must be on the board and line up three or more.
    if not public.cascade_swap_legal(v_board, v_action) then
      v_result.outcome := 'invalid_actions';
      v_result.session_id := v_session.id;
      v_result.game_slug := v_game.slug;
      return v_result;
    end if;
    v_a := v_action / 2;
    v_b := case when v_action % 2 = 0 then v_a + 1 else v_a + 8 end;
    v_swap := v_board[v_a + 1];
    v_board[v_a + 1] := v_board[v_b + 1];
    v_board[v_b + 1] := v_swap;

    select r.p_board, r.p_state, r.p_tiles, r.p_points
      into v_board, v_state, v_tiles, v_points
      from public.cascade_resolve(v_board, v_state, v_a, v_b) r;

    -- A board left with no swap is dealt afresh.
    if not public.cascade_has_swap(v_board) then
      select d.p_state, d.p_board into v_state, v_board from public.cascade_deal(v_state) d;
    end if;

    v_score := v_score + v_points;
    v_cleared := v_cleared + v_tiles;
    v_progress := v_progress + v_tiles;
    while v_progress >= public.cascade_goal(v_level) loop
      v_progress := v_progress - public.cascade_goal(v_level);
      v_level := v_level + 1;
      v_total := v_total + 1;
    end loop;
  end loop;

  -- A run that stops mid-level is the clock running out or the player ending it,
  -- and it is scored as it stands: the score only ever grows. It must still reach
  -- the server within the clock its levels earned.
  if v_elapsed > public.cascade_budget_ms(v_total) + public.cascade_slack_ms() then
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
  v_result.tiles_placed    := v_cleared;
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

comment on function public.complete_cascade_run(uuid, integer[], bigint, integer) is
  'Replays a submitted Cascade run from its session seed — every swap and the cascade it sets off — derives the score, and records it. Any prefix of a legal line is valid. A run that arrives later than its clock allowed is out_of_time. The claim is compared, never trusted.';

revoke all on function public.complete_cascade_run(uuid, integer[], bigint, integer) from public;
grant execute on function public.complete_cascade_run(uuid, integer[], bigint, integer) to anon, authenticated;


-- ─────────────────────────────────────────────────────────────────────────────
-- The start gate: the same function as the migration that last defined it
-- (`20261201120000_fjalekryqi_sessions.sql`), plus the (`cascade`, `cascade@1`)
-- pair, its action ceiling and its twelve-hour session.
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
     or (v_game.runtime = 'crossword'
         and p_rules_version in (public.crossword_rules_version(),
                                 public.fjalekryqi_rules_version()))
     or (v_game.runtime = 'gridburst' and p_rules_version = public.gridburst_rules_version())
     or (v_game.runtime = 'updraft' and p_rules_version = public.updraft_rules_version())
     or (v_game.runtime = 'decant'
         and p_rules_version in ('decant@1', public.decant_rules_version()))
     or (v_game.runtime = 'mini-sudoku' and p_rules_version = public.mini_sudoku_rules_version())
     or (v_game.runtime = 'scatter' and p_rules_version = public.scatter_rules_version())
     or (v_game.runtime = 'huedini' and p_rules_version = public.huedini_rules_version())
     or (v_game.runtime = 'cascade' and p_rules_version = public.cascade_rules_version()) then
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
                                          'mini-sudoku@1', 'scatter@1',
                                          'huedini@1', 'cascade@1')
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
                             when 'huedini' then public.huedini_max_actions()
                             when 'cascade' then public.cascade_max_actions()
                             else public.stack10_tiles()
                           end;
  v_empty.started_at    := v_session.started_at;
  v_empty.expires_at    := v_session.expires_at;
  v_empty.ranked        := v_session.user_id is not null;
  return v_empty;
end;
$$;

comment on function public.start_game_session(text, text, text) is
  'Issues a play session with a server-chosen seed. The caller identity is the verified token, never an argument. Stack 10 accepts stack-10@1 (legacy) and stack-10@2 (endless); Chain accepts chain@1 and chain@2; Memory Flash accepts memory-flash@1 (legacy) and memory-flash@2 (endless); One Move accepts one-move@1 (legacy) and one-move@2 (endless); Color Merge accepts color-merge@1 and color-merge@2; Don''t Touch the Black accepts dont-touch@1 and dont-touch@2; Queens accepts queens@1; Zip accepts zip@2 (and zip@1), 8 Puzzle accepts eight-puzzle@2 (and eight-puzzle@1), Tango accepts tango@2 (and tango@1), Sudoku accepts sudoku@3 (and sudoku@2 and sudoku@1), Gridburst accepts gridburst@1, Updraft accepts updraft@1 and Decant accepts decant@2 (and decant@1) — the @1 versions and sudoku@2 are the clocks before the taper; Mini Sudoku accepts mini-sudoku@1; Scatter accepts scatter@1; Huedini accepts huedini@1; Cascade accepts cascade@1; 7 Second and the daily crossword (crossword@1, or fjalekryqi@1 in Albanian) also answer already_played once the signed-in player has finished today''s, in either language.';
