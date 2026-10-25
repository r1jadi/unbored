-- Queens sessions: the verifier for the eighth runtime.
--
-- Queens is LinkedIn's Queens puzzle as an endless run: every board is an N×N grid
-- split into N coloured regions, the goal is one Queen in each row, column and
-- region with no two Queens touching, and each board has exactly one solution.
-- What this migration changes, and why each piece is here:
--
--   1. The rules, as constants the database owns: `queens@1`, three mistakes per
--      run, an 8192-tap submission bound, and the board size of each level — 5×5,
--      then 6×6, 7×7 and 8×8, and 9×9 from level eleven on.
--
--   2. The solution generator, `queens_solution(seed, level)`. A board is drawn in
--      two steps from one random stream: the solution first, then the regions
--      grown around it until it is the board's only solution. The verifier only
--      needs the first step — a Queen is right exactly when it sits on the
--      solution — so the database draws a shuffle and never grows a region. The
--      region search lives in the client (`src/lib/games/queens.ts`), and no
--      region a client could show changes which Queens are mistakes.
--
--   3. `public.complete_queens_run`, the verifier. It replays the submitted taps
--      cell by cell: empty → X → Queen → empty, a Queen off the solution is a
--      mistake that locks its cell, the third mistake ends the run, and a board's
--      last Queen solves it for ten points a row. The player may end a run at any
--      point and keep its score — a run never loses points — so any prefix of a
--      legal line is a valid submission. The outcome vocabulary and the ledger
--      are the other verifiers'.
--
--   4. `public.start_game_session` learns the (`queens`, `queens@1`) pair. A
--      Queens session lives twelve hours, like every endless run, and reports its
--      submission bound as `tile_count`.
--
-- Nothing here puts Queens in the catalogue: `20261104120100_queens_playable.sql`
-- does that, applied after the deployment carrying the runtime is live — the same
-- ordering the other games used. The rules are documented in
-- docs/games/README.md.

-- ─────────────────────────────────────────────────────────────────────────────
-- The rules, as constants the database owns
-- ─────────────────────────────────────────────────────────────────────────────

create or replace function public.queens_rules_version()
returns text language sql immutable set search_path = '' as $$ select 'queens@1'::text $$;

-- The third Queen placed off the solution ends the run.
create or replace function public.queens_mistakes()
returns integer language sql immutable set search_path = '' as $$ select 3 $$;

-- The most taps one submission may carry. A request ceiling, not a final board:
-- notes are taps too, so it is twice the other endless games' bound.
create or replace function public.queens_max_actions()
returns integer language sql immutable set search_path = '' as $$ select 8192 $$;

-- The board a level is played on: 5×5 for level one, 6×6 for 2–3, 7×7 for 4–6,
-- 8×8 for 7–10, and 9×9 from level eleven on.
create or replace function public.queens_side(p_level integer)
returns integer
language plpgsql
immutable
set search_path = ''
as $$
begin
  if p_level is null or p_level < 1 then
    raise exception 'a Queens level is one or more' using errcode = '22023';
  end if;
  return case
           when p_level <= 1 then 5
           when p_level <= 3 then 6
           when p_level <= 6 then 7
           when p_level <= 10 then 8
           else 9
         end;
end;
$$;

comment on function public.queens_rules_version() is
  'The Queens rules version the database can verify. A rules change needs a new version and a new verifier.';
comment on function public.queens_mistakes() is
  'The Queens placed off the solution that end a run.';
comment on function public.queens_max_actions() is
  'The most taps a Queens submission may carry. A request bound for the endless game, not a final board.';
comment on function public.queens_side(integer) is
  'The side of a Queens board: 5, 6, 7, 8, then 9 from level eleven on.';

-- ─────────────────────────────────────────────────────────────────────────────
-- The solution, as the one generator both sides draw from
-- ─────────────────────────────────────────────────────────────────────────────
--
-- A pure function of the seed and the level. The outer generator is One Move's
-- 32-bit LCG with the same seed handling, advanced once per level; the board is
-- drawn from a second LCG started at that state, so neighbouring boards do not
-- share their draws. The solution is a Fisher–Yates shuffle of the columns,
-- redrawn until no two Queens in neighbouring rows touch.
--
-- Internals, not API surface: the verifier calls it as the function's owner, and a
-- client already computes the same solution in TypeScript from its own seed.

create or replace function public.queens_solution(
  p_seed  bigint,
  p_level integer
)
returns integer[]
language plpgsql
immutable
set search_path = ''
as $$
declare
  v_side    integer;
  v_state   bigint;
  v_current integer;
  v_columns integer[];
  v_index   integer;
  v_swap    integer;
  v_held    integer;
  v_apart   boolean;
begin
  if p_seed is null then
    raise exception 'a seed is required' using errcode = '22023';
  end if;
  -- A guard on a pure helper, not a last level: a board takes at least ten taps,
  -- so the submission bound cannot reach it.
  if p_level is null or p_level < 1 or p_level > 8192 then
    raise exception 'queens level is outside the reachable run' using errcode = '22023';
  end if;

  v_side := public.queens_side(p_level);

  v_state := (p_seed % 4294967296 + 4294967296) % 4294967296;
  if v_state = 0 then
    v_state := 2654435769; -- 0x9E3779B9: a zero state would make the sequence degenerate
  end if;
  for v_current in 1..p_level loop
    v_state := (v_state * 1664525 + 1013904223) % 4294967296;
  end loop;

  loop
    v_columns := array(select generate_series(0, v_side - 1));
    -- Fisher–Yates from the last column down, each draw the high sixteen bits of
    -- the next inner state. Arrays are 1-based here and 0-based in the client.
    for v_index in reverse v_side - 1..1 loop
      v_state := (v_state * 22695477 + 1) % 4294967296;
      v_swap := ((v_state >> 16) % (v_index + 1))::integer;
      v_held := v_columns[v_index + 1];
      v_columns[v_index + 1] := v_columns[v_swap + 1];
      v_columns[v_swap + 1] := v_held;
    end loop;

    v_apart := true;
    for v_index in 1..v_side - 1 loop
      if abs(v_columns[v_index] - v_columns[v_index + 1]) < 2 then
        v_apart := false;
      end if;
    end loop;
    if v_apart then
      return v_columns;
    end if;
  end loop;
end;
$$;

comment on function public.queens_solution(bigint, integer) is
  'The solution of a Queens level: the column of the Queen in each row, 0-based. Mirrored by src/lib/games/queens.ts, which grows the regions around it.';

revoke all on function public.queens_solution(bigint, integer) from public;

-- ─────────────────────────────────────────────────────────────────────────────
-- Complete a run: replay, verify, then record
-- ─────────────────────────────────────────────────────────────────────────────

create or replace function public.complete_queens_run(
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
  v_result    public.play_result;
  v_session   public.game_sessions;
  v_game      public.games;
  v_user      uuid := auth.uid();
  v_level     int := 1;
  v_side      int;
  v_solution  int[];
  -- The current board's cells: 0 empty, 1 X, 2 Queen, 3 ruled out by a mistake.
  v_cells     int[];
  v_queens    int := 0;
  v_mistakes  int := 0;
  v_placed    int := 0;
  v_cleared   int := 0;
  v_score     bigint := 0;
  v_over      boolean := false;
  v_cell      int;
  v_digest    text;
  v_elapsed   bigint;
  v_best      bigint;
  v_rank      bigint;
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

  -- One version is implemented. A session under anything else is refused rather
  -- than guessed at.
  if v_session.rules_version is distinct from public.queens_rules_version() then
    v_result.outcome := 'wrong_rules';
    v_result.session_id := v_session.id;
    v_result.game_slug := v_game.slug;
    return v_result;
  end if;

  if coalesce(array_length(p_actions, 1), 0) > public.queens_max_actions() then
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
  -- A tap cycles a cell: empty → X → Queen → empty. A Queen is kept only on the
  -- level's solution (drawn by `queens_solution`, mirrored by the client engine
  -- — src/lib/games/queens.ts, vectors in docs/games/README.md); anywhere else it
  -- is a mistake, and the cell is ruled out and locked. The third mistake ends
  -- the run. A board's last Queen solves it: ten points a row, and the next board
  -- starts empty.
  --
  -- A tap after the run ended, a cell that is not on the board, or a tap on a
  -- ruled-out cell is impossible rather than merely bad. A submission that stops
  -- while the run is still live is the player ending it, and is valid: the score
  -- only ever grows, so stopping cannot earn a point the replay did not count.
  v_side := public.queens_side(v_level);
  v_solution := public.queens_solution(v_session.seed, v_level);
  v_cells := array_fill(0, array[v_side * v_side]);

  foreach v_cell in array coalesce(p_actions, array[]::integer[]) loop
    if v_over
       or v_cell < 0 or v_cell >= v_side * v_side
       or v_cells[v_cell + 1] = 3 then
      v_result.outcome := 'invalid_actions';
      v_result.session_id := v_session.id;
      v_result.game_slug := v_game.slug;
      return v_result;
    end if;

    v_placed := v_placed + 1;

    if v_cells[v_cell + 1] = 0 then
      v_cells[v_cell + 1] := 1;
    elsif v_cells[v_cell + 1] = 2 then
      v_cells[v_cell + 1] := 0;
      v_queens := v_queens - 1;
    elsif v_solution[v_cell / v_side + 1] = v_cell % v_side then
      v_cells[v_cell + 1] := 2;
      v_queens := v_queens + 1;
    else
      v_cells[v_cell + 1] := 3;
      v_mistakes := v_mistakes + 1;
    end if;

    if v_mistakes >= public.queens_mistakes() then
      v_over := true;
    elsif v_queens = v_side then
      v_cleared := v_cleared + 1;
      v_score := v_score + 10 * v_side;
      v_level := v_level + 1;
      v_side := public.queens_side(v_level);
      v_solution := public.queens_solution(v_session.seed, v_level);
      v_cells := array_fill(0, array[v_side * v_side]);
      v_queens := 0;
    end if;

    -- The submission bound ends a run: there is no next tap to carry.
    if v_placed >= public.queens_max_actions() then
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

comment on function public.complete_queens_run(uuid, integer[], bigint, integer) is
  'Replays a submitted Queens run from its session seed, derives the score, and records it. A tap cycles X, Queen and empty; a Queen off the solution is a mistake and the third ends the run; a solved board scores ten points a row. Any prefix of a legal line is valid, because a run never loses points. The claim is compared, never trusted.';

revoke all on function public.complete_queens_run(uuid, integer[], bigint, integer) from public;
grant execute on function public.complete_queens_run(uuid, integer[], bigint, integer) to anon, authenticated;

-- ─────────────────────────────────────────────────────────────────────────────
-- Start a run: the gate learns the eighth runtime
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
  -- holds. 7 Second and Queens have one. Anything else is a version no verifier
  -- owns.
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
     or (v_game.runtime = 'queens' and p_rules_version = public.queens_rules_version()) then
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
    -- of the table's two. Queens is endless too. Every finite game keeps two hours.
    insert into public.game_sessions (game_id, user_id, client, rules_version, expires_at)
    values (v_game.id, v_user, v_client, p_rules_version,
            case when p_rules_version in ('chain@2', 'color-merge@2', 'stack-10@2',
                                          'memory-flash@2', 'one-move@2', 'queens@1')
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
                             else public.stack10_tiles()
                           end;
  v_empty.started_at    := v_session.started_at;
  v_empty.expires_at    := v_session.expires_at;
  v_empty.ranked        := v_session.user_id is not null;
  return v_empty;
end;
$$;

comment on function public.start_game_session(text, text, text) is
  'Issues a play session with a server-chosen seed. The caller identity is the verified token, never an argument. Stack 10 accepts stack-10@1 (legacy) and stack-10@2 (endless); Chain accepts chain@1 and chain@2; Memory Flash accepts memory-flash@1 (legacy) and memory-flash@2 (endless); One Move accepts one-move@1 (legacy) and one-move@2 (endless); Color Merge accepts color-merge@1 and color-merge@2; Don''t Touch the Black accepts dont-touch@1 and dont-touch@2; Queens accepts queens@1; 7 Second also answers already_played once the signed-in player has finished today''s deck.';

revoke all on function public.start_game_session(text, text, text) from public;
grant execute on function public.start_game_session(text, text, text) to anon, authenticated;
