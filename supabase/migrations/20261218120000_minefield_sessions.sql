-- Minefield (`minefield@1`): hidden mines and numbered clues, verified by the database.
--
-- Open every safe cell of a grid with hidden mines. An opened cell shows how many of
-- its eight neighbours are mines, and a cell with none opens its neighbours too. A
-- flag marks a cell and protects it. Tapping an opened number whose flags add up
-- opens its other neighbours. A mine costs a life, and the run ends at no lives. A
-- board's mines are drawn when its first cell is opened, never on that cell or its
-- neighbours. A safe cell scores one unit, a cleared board two a row, a board cleared
-- without a mine one more a row, and every third cleared board brings back a life.
--
-- This migration adds the rules, the deal, the replay, the verifier
-- (`complete_minefield_run`), the (`minefield`, `minefield@1`) row in
-- `public.game_runtimes`, and the rules version in `public.run_resumable`. Nothing a
-- user can see changes: `20261218120100_minefield_playable.sql` flips the catalogue
-- and lands last. Mirrored by src/lib/games/minefield.ts; the lines in
-- tests/security/verifier_vectors.sql pin the two together. See docs/games/README.md.

-- ─────────────────────────────────────────────────────────────────────────────
-- The rules, as constants the database owns
-- ─────────────────────────────────────────────────────────────────────────────

create or replace function public.minefield_rules_version()
returns text language sql immutable set search_path = '' as $$ select 'minefield@1'::text $$;

create or replace function public.minefield_max_actions()
returns integer language sql immutable set search_path = '' as $$ select 4096 $$;

comment on function public.minefield_rules_version() is
  'The Minefield rules version new runs pin: minefield@1.';
comment on function public.minefield_max_actions() is
  'The most actions a Minefield submission may carry. A request bound, not a last board.';

-- A board's side: 8 for boards 1–2, 9 for 3–5, then 10.
create or replace function public.minefield_side(p_level integer)
returns integer
language sql
immutable
set search_path = ''
as $$
  select case when p_level <= 2 then 8 when p_level <= 5 then 9 else 10 end
$$;

-- A board's mines: 13% of its cells, rising a point every second board to 22%.
create or replace function public.minefield_mine_count(p_level integer)
returns integer
language sql
immutable
set search_path = ''
as $$
  select public.minefield_side(p_level) * public.minefield_side(p_level)
         * least(22, 12 + (p_level + 1) / 2) / 100
$$;

-- A cell's neighbours, ascending. Cells count from 0.
create or replace function public.minefield_neighbours(p_cell integer, p_side integer)
returns integer[]
language plpgsql
immutable
set search_path = ''
as $$
declare
  v_row   integer := p_cell / p_side;
  v_col   integer := p_cell % p_side;
  v_found integer[] := array[]::integer[];
  v_r     integer;
  v_c     integer;
begin
  for v_r in greatest(0, v_row - 1)..least(p_side - 1, v_row + 1) loop
    for v_c in greatest(0, v_col - 1)..least(p_side - 1, v_col + 1) loop
      if v_r <> v_row or v_c <> v_col then
        v_found := v_found || (v_r * p_side + v_c);
      end if;
    end loop;
  end loop;
  return v_found;
end;
$$;

comment on function public.minefield_side(integer) is
  'A Minefield board''s side. Mirrored by sideFor in src/lib/games/minefield.ts.';
comment on function public.minefield_mine_count(integer) is
  'How many mines a Minefield board holds. Mirrored by minesFor in src/lib/games/minefield.ts.';
comment on function public.minefield_neighbours(integer, integer) is
  'A Minefield cell''s neighbours, ascending. Mirrored by neighbours in src/lib/games/minefield.ts.';

-- ─────────────────────────────────────────────────────────────────────────────
-- The deal
-- ─────────────────────────────────────────────────────────────────────────────
--
-- The seed reduced mod 2³² and mixed with 0x27D4EB2F (2654435769 if that is 0), an
-- outer LCG advanced once per level, and an inner LCG from that state whose draws are
-- the state's top sixteen bits. The candidates are every cell but the first opened
-- and its neighbours, ascending. For i from 0, slot i swaps with slot
-- i + draw mod (candidates − i), and the first slots are the mines. Internals, not
-- API surface.
create or replace function public.minefield_mines(p_seed bigint, p_level integer, p_first integer)
returns integer[]
language plpgsql
immutable
set search_path = ''
as $$
declare
  v_side    integer;
  v_kept    integer[];
  v_cand    integer[] := array[]::integer[];
  v_state   bigint;
  v_count   integer;
  v_total   integer;
  v_i       integer;
  v_j       integer;
  v_held    integer;
begin
  if p_seed is null then
    raise exception 'a seed is required' using errcode = '22023';
  end if;
  if p_level is null or p_level < 1 or p_level > 8192 then
    raise exception 'minefield level is outside the reachable run' using errcode = '22023';
  end if;
  v_side := public.minefield_side(p_level);
  if p_first is null or p_first < 0 or p_first >= v_side * v_side then
    raise exception 'minefield first cell is off the board' using errcode = '22023';
  end if;

  v_state := ((p_seed % 4294967296 + 4294967296) % 4294967296) # 668265263;
  if v_state = 0 then
    v_state := 2654435769;
  end if;
  for v_i in 1..p_level loop
    v_state := (v_state * 1664525 + 1013904223) % 4294967296;
  end loop;

  v_kept := public.minefield_neighbours(p_first, v_side) || p_first;
  for v_i in 0..v_side * v_side - 1 loop
    if not (v_i = any (v_kept)) then
      v_cand := v_cand || v_i;
    end if;
  end loop;

  v_count := public.minefield_mine_count(p_level);
  v_total := array_length(v_cand, 1);
  for v_i in 0..v_count - 1 loop
    v_state := (v_state * 22695477 + 1) % 4294967296;
    v_j := v_i + ((v_state >> 16) % (v_total - v_i))::integer;
    v_held := v_cand[v_i + 1];
    v_cand[v_i + 1] := v_cand[v_j + 1];
    v_cand[v_j + 1] := v_held;
  end loop;

  return (select array_agg(m order by m) from unnest(v_cand[1:v_count]) as m);
end;
$$;

comment on function public.minefield_mines(bigint, integer, integer) is
  'The mines of a Minefield board, ascending, given the first cell opened on it. Mirrored by minesOn in src/lib/games/minefield.ts.';

-- ─────────────────────────────────────────────────────────────────────────────
-- The replay
-- ─────────────────────────────────────────────────────────────────────────────
--
-- Every action, from the seed. An action is a cell to open (or an opened number to
-- open around), or cell + 100 to toggle a flag. `valid` is false when one is not a
-- move: after the run ended, off the board, opening a flag or a mine already hit,
-- flagging an opened cell, or a number whose flags do not add up. Any prefix of a
-- legal line is valid, because the player may stop at any time and the score only
-- grows. Cells are written 0 closed, 1 flagged, 2 open, 3 a mine that was hit.
create or replace function public.minefield_replay(
  p_seed    bigint,
  p_actions integer[],
  out valid   boolean,
  out cells   integer[],
  out level   integer,
  out lives   integer,
  out score   bigint,
  out boards  integer,
  out opened  integer,
  out hits    integer
)
language plpgsql
immutable
set search_path = ''
as $$
declare
  v_side     integer := public.minefield_side(1);
  v_numbers  integer[];
  v_mines    integer[];
  v_targets  integer[];
  v_around   integer[];
  v_stack    integer[];
  v_action   integer;
  v_cell     integer;
  v_state    integer;
  v_target   integer;
  v_at       integer;
  v_near     integer;
  v_marked   integer;
  v_gain     integer;
  v_hits     integer := 0;
  v_i        integer;
  v_cleared  boolean;
begin
  valid := true;
  level := 1;
  lives := 3;
  score := 0;
  boards := 0;
  opened := 0;
  hits := 0;
  cells := array_fill(0, array[v_side * v_side]);

  foreach v_action in array coalesce(p_actions, array[]::integer[]) loop
    if lives <= 0 or v_action < 0 then
      valid := false;
      exit;
    end if;
    v_cell := case when v_action >= 100 then v_action - 100 else v_action end;
    if v_cell >= v_side * v_side then
      valid := false;
      exit;
    end if;
    v_state := cells[v_cell + 1];

    -- A flag: on a closed cell, or off a flagged one.
    if v_action >= 100 then
      if v_state > 1 then
        valid := false;
        exit;
      end if;
      cells[v_cell + 1] := 1 - v_state;
      continue;
    end if;

    if v_state = 0 then
      v_targets := array[v_cell];
    elsif v_state = 2 and v_numbers[v_cell + 1] > 0 then
      -- An opened number: its flags and mines must add up, with something left to open.
      v_around := public.minefield_neighbours(v_cell, v_side);
      v_marked := 0;
      v_targets := array[]::integer[];
      foreach v_near in array v_around loop
        if cells[v_near + 1] in (1, 3) then
          v_marked := v_marked + 1;
        elsif cells[v_near + 1] = 0 then
          v_targets := v_targets || v_near;
        end if;
      end loop;
      if v_marked <> v_numbers[v_cell + 1] or coalesce(array_length(v_targets, 1), 0) = 0 then
        valid := false;
        exit;
      end if;
    else
      valid := false;
      exit;
    end if;

    -- A board's first opened cell draws its mines.
    if v_numbers is null then
      v_mines := public.minefield_mines(p_seed, level, v_cell);
      v_numbers := array_fill(0, array[v_side * v_side]);
      foreach v_at in array v_mines loop
        foreach v_near in array public.minefield_neighbours(v_at, v_side) loop
          v_numbers[v_near + 1] := v_numbers[v_near + 1] + 1;
        end loop;
      end loop;
      foreach v_at in array v_mines loop
        v_numbers[v_at + 1] := -1;
      end loop;
    end if;

    v_gain := 0;
    foreach v_target in array v_targets loop
      continue when cells[v_target + 1] <> 0;
      if v_numbers[v_target + 1] = -1 then
        cells[v_target + 1] := 3;
        v_hits := v_hits + 1;
        hits := hits + 1;
        lives := lives - 1;
        exit when lives = 0;
      else
        v_stack := array[v_target];
        while coalesce(array_length(v_stack, 1), 0) > 0 loop
          v_at := v_stack[array_length(v_stack, 1)];
          v_stack := v_stack[1:array_length(v_stack, 1) - 1];
          continue when cells[v_at + 1] <> 0;
          cells[v_at + 1] := 2;
          v_gain := v_gain + 1;
          if v_numbers[v_at + 1] = 0 then
            v_stack := v_stack || public.minefield_neighbours(v_at, v_side);
          end if;
        end loop;
      end if;
    end loop;
    opened := opened + v_gain;

    v_cleared := lives > 0;
    if v_cleared then
      for v_i in 1..v_side * v_side loop
        if cells[v_i] <> 2 and v_numbers[v_i] <> -1 then
          v_cleared := false;
          exit;
        end if;
      end loop;
    end if;

    if v_cleared then
      v_gain := v_gain + 2 * v_side + case when v_hits = 0 then v_side else 0 end;
      boards := boards + 1;
      if boards % 3 = 0 and lives < 3 then
        lives := lives + 1;
      end if;
      level := level + 1;
      v_side := public.minefield_side(level);
      cells := array_fill(0, array[v_side * v_side]);
      v_numbers := null;
      v_hits := 0;
    end if;
    score := score + v_gain;
  end loop;
end;
$$;

comment on function public.minefield_replay(bigint, integer[]) is
  'Replays Minefield actions from a seed: the board, lives, score, boards cleared, cells opened and mines hit they reach, and whether every action was legal. Mirrored by replay in src/lib/games/minefield.ts.';

-- These are not API surface: the seed is the player's, but a client has no need of them.
revoke all on function public.minefield_side(integer) from public, anon, authenticated;
revoke all on function public.minefield_mine_count(integer) from public, anon, authenticated;
revoke all on function public.minefield_neighbours(integer, integer) from public, anon, authenticated;
revoke all on function public.minefield_mines(bigint, integer, integer) from public, anon, authenticated;
revoke all on function public.minefield_replay(bigint, integer[]) from public, anon, authenticated;

-- ─────────────────────────────────────────────────────────────────────────────
-- Complete a run
-- ─────────────────────────────────────────────────────────────────────────────

create or replace function public.complete_minefield_run(
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
  v_replay   record;
  v_digest   text;
  v_elapsed  bigint;
  v_best     bigint;
  v_rank     bigint;
begin
  if p_session_id is null then
    raise exception 'a session id is required' using errcode = '22023';
  end if;
  if p_actions is null or array_position(p_actions, null) is not null then
    raise exception 'actions must be a dense array of actions' using errcode = '22023';
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

  if v_session.rules_version is distinct from public.minefield_rules_version() then
    v_result.outcome := 'wrong_rules';
    v_result.session_id := v_session.id;
    v_result.game_slug := v_game.slug;
    return v_result;
  end if;

  if coalesce(array_length(p_actions, 1), 0) > public.minefield_max_actions() then
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

  select * into v_replay from public.minefield_replay(v_session.seed, p_actions);

  if not v_replay.valid then
    v_result.outcome := 'invalid_actions';
    v_result.session_id := v_session.id;
    v_result.game_slug := v_game.slug;
    return v_result;
  end if;

  if p_score is distinct from v_replay.score then
    v_result.outcome := 'score_mismatch';
    v_result.session_id := v_session.id;
    v_result.game_slug := v_game.slug;
    v_result.score := v_replay.score;
    return v_result;
  end if;

  update public.game_sessions s
     set completed_at    = now(),
         verified_score  = v_replay.score,
         verified_digest = v_digest
   where s.id = v_session.id
  returning * into v_session;

  if v_session.user_id is not null then
    insert into public.scores (session_id, game_id, user_id, score, duration_ms)
    values (v_session.id, v_session.game_id, v_session.user_id, v_replay.score, p_duration_ms);
  end if;

  v_result.outcome         := 'recorded';
  v_result.session_id      := v_session.id;
  v_result.game_slug       := v_game.slug;
  v_result.score           := v_replay.score;
  v_result.cleared_columns := v_replay.boards;
  v_result.tiles_placed    := v_replay.opened;
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

comment on function public.complete_minefield_run(uuid, integer[], bigint, integer) is
  'Replays a submitted Minefield run from its session seed, derives the score and records it. An action that is not a move is invalid_actions. Any prefix of a legal line is valid. The claim is compared, never trusted.';

revoke all on function public.complete_minefield_run(uuid, integer[], bigint, integer) from public;
grant execute on function public.complete_minefield_run(uuid, integer[], bigint, integer) to anon, authenticated;

-- ─────────────────────────────────────────────────────────────────────────────
-- The start gate and saved runs learn Minefield
-- ─────────────────────────────────────────────────────────────────────────────

insert into public.game_runtimes (runtime, rules_version, max_actions, session_hours)
values ('minefield', public.minefield_rules_version(), public.minefield_max_actions(), 12)
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
    'minefield@1'
  ), false)
$$;
