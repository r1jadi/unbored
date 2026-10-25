-- Zip sessions: the verifier for the ninth runtime.
--
-- Zip is LinkedIn's Zip puzzle as an endless run against a clock: every board is
-- an N×N grid with numbered checkpoints and sometimes walls, and the player draws
-- one path from 1 through the numbers in order that visits every cell once. Each
-- board has exactly one solution. What this migration changes, and why:
--
--   1. The rules, as constants the database owns: `zip@1`, an 8192-cell
--      submission bound, the board size of each level (5×5, then 6×6 from level
--      three and 7×7 from level nine), and the clock — sixty seconds to start,
--      five more per row of every solved board, and twenty seconds of slack.
--
--   2. The solution generator, `zip_path(seed, level)`. A board is drawn in two
--      steps from one random stream: the solution path first, then the
--      checkpoints and walls that make it the only solution. The verifier needs
--      only the first: because the solution is unique, a drawn path that covers
--      the board is solved exactly when it *is* the solution. The checkpoint
--      search lives in the client (`src/lib/games/zip.ts`).
--
--   3. `public.complete_zip_run`, the verifier. It replays the drawn path cell by
--      cell — start on the solution's first cell, step to a neighbour, or step back
--      onto the path to cut it — and scores ten points a row whenever the path
--      becomes the solution. Any prefix of a legal line is valid: a run ends on the
--      clock or when the player stops, and the score never goes down. The clock is
--      the server's: a Zip session is issued when the player presses Start, and a
--      run that arrives later than its solved boards earned is refused as
--      `out_of_time`.
--
--   4. `public.start_game_session` learns the (`zip`, `zip@1`) pair.
--
-- Nothing here puts Zip in the catalogue: `20261105120100_zip_playable.sql` does,
-- after the deployment carrying the runtime is live. See docs/games/README.md.

-- ─────────────────────────────────────────────────────────────────────────────
-- The rules, as constants the database owns
-- ─────────────────────────────────────────────────────────────────────────────

create or replace function public.zip_rules_version()
returns text language sql immutable set search_path = '' as $$ select 'zip@1'::text $$;

create or replace function public.zip_max_actions()
returns integer language sql immutable set search_path = '' as $$ select 8192 $$;

-- How late after its clock ran out a run is still accepted: the time between the
-- session being issued and the board appearing, plus the submission's round trip.
create or replace function public.zip_slack_ms()
returns integer language sql immutable set search_path = '' as $$ select 20000 $$;

-- The board a level is played on: 5×5 for levels 1–2, 6×6 for 3–8, 7×7 after.
create or replace function public.zip_side(p_level integer)
returns integer
language plpgsql
immutable
set search_path = ''
as $$
begin
  if p_level is null or p_level < 1 then
    raise exception 'a Zip level is one or more' using errcode = '22023';
  end if;
  return case when p_level <= 2 then 5 when p_level <= 8 then 6 else 7 end;
end;
$$;

-- The clock a run has earned with `p_cleared` boards solved: sixty seconds, plus
-- five seconds per row of every solved board.
create or replace function public.zip_budget_ms(p_cleared integer)
returns bigint
language plpgsql
immutable
set search_path = ''
as $$
declare
  v_total bigint := 60000;
  v_level integer;
begin
  for v_level in 1..coalesce(p_cleared, 0) loop
    v_total := v_total + 5000 * public.zip_side(v_level);
  end loop;
  return v_total;
end;
$$;

comment on function public.zip_rules_version() is
  'The Zip rules version the database can verify. A rules change needs a new version and a new verifier.';
comment on function public.zip_max_actions() is
  'The most cells a Zip submission may carry. A request bound, not a final board.';
comment on function public.zip_slack_ms() is
  'How long after its clock ran out a Zip run is still accepted.';
comment on function public.zip_side(integer) is
  'The side of a Zip board: 5, 6 from level three, 7 from level nine.';
comment on function public.zip_budget_ms(integer) is
  'The clock a Zip run has earned: 60 s plus 5 s per row of every solved board.';

-- ─────────────────────────────────────────────────────────────────────────────
-- The solution, as the one generator both sides draw from
-- ─────────────────────────────────────────────────────────────────────────────
--
-- One Move's outer LCG advanced once per level, and a second LCG started at that
-- state, exactly as Queens draws its boards. The path starts as a serpentine and
-- is shuffled by eight backbite moves per cell: pick an end of the path and one of
-- its four neighbours; if that neighbour is on the board and not already the end's
-- neighbour on the path, join them and reverse the stretch between.
--
-- Internals, not API surface: the verifier calls it as the function's owner.

create or replace function public.zip_path(
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
  v_cells   integer;
  v_state   bigint;
  v_current integer;
  v_path    integer[];
  v_pos     integer[];
  v_row     integer;
  v_column  integer;
  v_move    integer;
  v_tail    boolean;
  v_dir     integer;
  v_end     integer;
  v_joined  integer;
  v_low     integer;
  v_high    integer;
  v_held    integer;
begin
  if p_seed is null then
    raise exception 'a seed is required' using errcode = '22023';
  end if;
  if p_level is null or p_level < 1 or p_level > 8192 then
    raise exception 'zip level is outside the reachable run' using errcode = '22023';
  end if;

  v_side := public.zip_side(p_level);
  v_cells := v_side * v_side;

  v_state := (p_seed % 4294967296 + 4294967296) % 4294967296;
  if v_state = 0 then
    v_state := 2654435769; -- 0x9E3779B9: a zero state would make the sequence degenerate
  end if;
  for v_current in 1..p_level loop
    v_state := (v_state * 1664525 + 1013904223) % 4294967296;
  end loop;

  -- The serpentine. Arrays are 1-based here: v_path[i + 1] is the cell at path
  -- index i, and v_pos[c + 1] is the path index of cell c.
  v_path := array_fill(0, array[v_cells]);
  v_pos := array_fill(0, array[v_cells]);
  for v_row in 0..v_side - 1 loop
    for v_column in 0..v_side - 1 loop
      v_current := v_row * v_side + v_column;
      v_path[v_current + 1] := v_row * v_side
                               + case when v_row % 2 = 0 then v_column else v_side - 1 - v_column end;
    end loop;
  end loop;
  for v_current in 0..v_cells - 1 loop
    v_pos[v_path[v_current + 1] + 1] := v_current;
  end loop;

  for v_move in 1..8 * v_cells loop
    v_state := (v_state * 22695477 + 1) % 4294967296;
    v_tail := ((v_state >> 16) % 2) = 1;
    v_state := (v_state * 22695477 + 1) % 4294967296;
    v_dir := ((v_state >> 16) % 4)::integer;

    v_end := case when v_tail then v_path[v_cells] else v_path[1] end;
    v_row := v_end / v_side + case v_dir when 0 then -1 when 1 then 1 else 0 end;
    v_column := v_end % v_side + case v_dir when 2 then -1 when 3 then 1 else 0 end;
    if v_row < 0 or v_row >= v_side or v_column < 0 or v_column >= v_side then
      continue;
    end if;
    v_joined := v_pos[v_row * v_side + v_column + 1];

    if v_tail then
      if v_joined = v_cells - 2 then
        continue;
      end if;
      v_low := v_joined + 1;
      v_high := v_cells - 1;
    else
      if v_joined = 1 then
        continue;
      end if;
      v_low := 0;
      v_high := v_joined - 1;
    end if;

    while v_low < v_high loop
      v_held := v_path[v_low + 1];
      v_path[v_low + 1] := v_path[v_high + 1];
      v_path[v_high + 1] := v_held;
      v_pos[v_path[v_low + 1] + 1] := v_low;
      v_pos[v_path[v_high + 1] + 1] := v_high;
      v_low := v_low + 1;
      v_high := v_high - 1;
    end loop;
  end loop;

  return v_path;
end;
$$;

comment on function public.zip_path(bigint, integer) is
  'The solution of a Zip level: every cell, in the order the path visits it. Mirrored by src/lib/games/zip.ts, which places the checkpoints and walls around it.';

revoke all on function public.zip_path(bigint, integer) from public;

-- ─────────────────────────────────────────────────────────────────────────────
-- Complete a run: replay, verify, then record
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

  if v_session.rules_version is distinct from public.zip_rules_version() then
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
  if v_elapsed > public.zip_budget_ms(v_cleared) + public.zip_slack_ms() then
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

comment on function public.complete_zip_run(uuid, integer[], bigint, integer) is
  'Replays a submitted Zip run from its session seed, derives the score, and records it. The path starts on the solution''s first cell, steps to neighbours or back onto itself, and solves a board when it is the solution; ten points a row. Any prefix of a legal line is valid. A run that arrives later than its solved boards earned is out_of_time. The claim is compared, never trusted.';

revoke all on function public.complete_zip_run(uuid, integer[], bigint, integer) from public;
grant execute on function public.complete_zip_run(uuid, integer[], bigint, integer) to anon, authenticated;

-- ─────────────────────────────────────────────────────────────────────────────
-- Start a run: the gate learns the ninth runtime
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
  -- holds. 7 Second, Queens and Zip have one. Anything else is a version no
  -- verifier owns.
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
     or (v_game.runtime = 'zip' and p_rules_version = public.zip_rules_version()) then
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
    -- of the table's two. Queens and Zip are endless too (Zip's own clock ends a
    -- run long before this would). Every finite game keeps two hours.
    insert into public.game_sessions (game_id, user_id, client, rules_version, expires_at)
    values (v_game.id, v_user, v_client, p_rules_version,
            case when p_rules_version in ('chain@2', 'color-merge@2', 'stack-10@2',
                                          'memory-flash@2', 'one-move@2', 'queens@1', 'zip@1')
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
                             else public.stack10_tiles()
                           end;
  v_empty.started_at    := v_session.started_at;
  v_empty.expires_at    := v_session.expires_at;
  v_empty.ranked        := v_session.user_id is not null;
  return v_empty;
end;
$$;

comment on function public.start_game_session(text, text, text) is
  'Issues a play session with a server-chosen seed. The caller identity is the verified token, never an argument. Stack 10 accepts stack-10@1 (legacy) and stack-10@2 (endless); Chain accepts chain@1 and chain@2; Memory Flash accepts memory-flash@1 (legacy) and memory-flash@2 (endless); One Move accepts one-move@1 (legacy) and one-move@2 (endless); Color Merge accepts color-merge@1 and color-merge@2; Don''t Touch the Black accepts dont-touch@1 and dont-touch@2; Queens accepts queens@1; Zip accepts zip@1 and is issued on Start, because its verifier times the run from the session; 7 Second also answers already_played once the signed-in player has finished today''s deck.';

revoke all on function public.start_game_session(text, text, text) from public;
grant execute on function public.start_game_session(text, text, text) to anon, authenticated;
