-- Updraft: the fifteenth runtime.
--
-- A glider falls; a tap lifts it. Columns scroll in with a gap in each: thread
-- the gap and score, touch a column or the ground and the run is over. What
-- this migration changes, and why:
--
--   1. The rules, as constants the database owns: `updraft@1`, the thirty-minute
--      tick bound and the 8192-action submission bound.
--
--   2. `public.complete_updraft_run`, the verifier. Updraft is the first game
--      whose rules include time, so the verifier replays the flight tick by
--      tick: sixty ticks a second, whole-number physics only, the columns laid
--      out from the session's seed. An action is `2 × tick` for a flap and
--      `2 × tick + 1` for the player ending the run before that tick; without a
--      stop the glider falls on until it crashes, exactly as it did on screen.
--      A flight longer than the session has been open is refused, so a run
--      cannot be flown faster than real time.
--
--   3. `public.start_game_session` learns (`updraft`, `updraft@1`) and gives it
--      the two-hour session of the other real-time games. A run cannot be saved
--      and continued: a glider in mid-air cannot pause.
--
-- Nothing here puts Updraft in the catalogue:
-- `20261120120100_updraft_playable.sql` does, after the deployment carrying the
-- runtime is live. See docs/games/README.md and src/lib/games/updraft.ts.

-- ─────────────────────────────────────────────────────────────────────────────
-- The rules, as constants the database owns
-- ─────────────────────────────────────────────────────────────────────────────

create or replace function public.updraft_rules_version()
returns text language sql immutable set search_path = '' as $$ select 'updraft@1'::text $$;

-- Thirty minutes of ticks at sixty a second.
create or replace function public.updraft_max_ticks()
returns integer language sql immutable set search_path = '' as $$ select 108000 $$;

create or replace function public.updraft_max_actions()
returns integer language sql immutable set search_path = '' as $$ select 8192 $$;

comment on function public.updraft_rules_version() is
  'The Updraft rules version new sessions pin. A rules change needs a new version and a new verifier branch.';
comment on function public.updraft_max_ticks() is
  'The most ticks an Updraft run may last: thirty minutes at sixty a second. A bound, not a level.';
comment on function public.updraft_max_actions() is
  'The most actions an Updraft submission may carry: flaps, and the stop of a run the player ended.';

-- Whether the glider, centred at (22000, p_y) with radius 3200, touches the
-- column whose left edge is at p_left (13000 wide) and whose gap runs from p_top
-- to p_top + p_gap. Mirrors hits() in src/lib/games/updraft.ts.
create or replace function public.updraft_hits(
  p_left integer,
  p_top  integer,
  p_gap  integer,
  p_y    integer
)
returns boolean
language plpgsql
immutable
set search_path = ''
as $$
declare
  v_dx bigint := greatest(p_left - 22000, 0, 22000 - (p_left + 13000));
  v_dy bigint;
begin
  if v_dx >= 3200 then
    return false;
  end if;
  if p_y < p_top or p_y > p_top + p_gap then
    return true;
  end if;
  v_dy := least(p_y - p_top, p_top + p_gap - p_y);
  return v_dx * v_dx + v_dy * v_dy < 3200 * 3200;
end;
$$;

comment on function public.updraft_hits(integer, integer, integer, integer) is
  'Whether the Updraft glider touches a column. An internal of the verifier; mirrors hits() in src/lib/games/updraft.ts.';

revoke all on function public.updraft_hits(integer, integer, integer, integer) from public;

-- ─────────────────────────────────────────────────────────────────────────────
-- Complete a run: replay, verify, then record
-- ─────────────────────────────────────────────────────────────────────────────

create or replace function public.complete_updraft_run(
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
  v_state     bigint;
  v_draw      integer;
  v_lo        integer;
  v_hi        integer;
  -- The column behind the glider (index v_passed - 1) and the one ahead of it.
  v_prev_x    integer;
  v_prev_top  integer;
  v_prev_gap  integer;
  v_next_x    integer;
  v_next_top  integer;
  v_next_gap  integer;
  v_count     integer := coalesce(array_length(p_actions, 1), 0);
  v_index     integer := 1;
  v_action    integer;
  v_flap      boolean;
  v_tick      integer := 0;
  v_y         integer := 44000;
  v_vy        integer := 0;
  v_distance  integer := 0;
  v_passed    integer := 0;
  v_total     integer := 0;
  v_placed    integer := 0;
  v_score     bigint := 0;
  v_digest    text;
  v_elapsed   bigint;
  v_best      bigint;
  v_rank      bigint;
begin
  if p_session_id is null then
    raise exception 'a session id is required' using errcode = '22023';
  end if;
  if p_actions is null or array_position(p_actions, null) is not null then
    raise exception 'actions must be a dense array of flaps' using errcode = '22023';
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

  if v_session.rules_version is distinct from public.updraft_rules_version() then
    v_result.outcome := 'wrong_rules';
    v_result.session_id := v_session.id;
    v_result.game_slug := v_game.slug;
    return v_result;
  end if;

  if v_count > public.updraft_max_actions() then
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
  -- The generator is the one every game uses, one draw per column, read from
  -- bit 16 up. Column k's gap is 30000 high less 200 a column, never under
  -- 23000; its top edge falls anywhere from 10000 down to 10000 above the
  -- ground for the first column, and within 24000 of the column before for
  -- every later one.
  v_state := (v_session.seed % 4294967296 + 4294967296) % 4294967296;
  if v_state = 0 then
    v_state := 2654435769; -- 0x9E3779B9: a zero state would make the sequence degenerate
  end if;

  v_state := (v_state * 1664525 + 1013904223) % 4294967296;
  v_draw := (v_state >> 16)::integer;
  v_next_gap := 30000;
  v_lo := 10000;
  v_hi := 88000 - 10000 - v_next_gap;
  v_next_top := v_lo + v_draw % (v_hi - v_lo + 1);
  v_next_x := 90000;

  -- One tick: a flap on this tick sets the speed to -1400, otherwise gravity
  -- adds 75 up to a fall of 2200; the glider moves and rests against the top of
  -- the field; the field scrolls 400 a tick plus 4 per column passed, up to 560;
  -- touching the ground or a column ends the run before any score this tick;
  -- and a column whose middle is behind the glider is passed.
  loop
    v_flap := false;
    if v_index <= v_count then
      v_action := p_actions[v_index];
      if v_action < 2 * v_tick then
        -- Out of order, twice on one tick, or after the stop: impossible play.
        v_result.outcome := 'invalid_actions';
        v_result.session_id := v_session.id;
        v_result.game_slug := v_game.slug;
        return v_result;
      end if;
      if v_action = 2 * v_tick + 1 then
        -- The player ended the run here. Nothing may follow the stop.
        v_index := v_index + 1;
        exit;
      end if;
      if v_action = 2 * v_tick then
        v_flap := true;
        v_placed := v_placed + 1;
        v_index := v_index + 1;
      end if;
    end if;

    if v_flap then
      v_vy := -1400;
    else
      v_vy := least(v_vy + 75, 2200);
    end if;
    v_y := v_y + v_vy;
    if v_y < 3200 then
      v_y := 3200;
      v_vy := 0;
    end if;
    v_distance := v_distance + least(560, 400 + 4 * v_passed);
    v_tick := v_tick + 1;

    exit when v_y + 3200 >= 88000
      or (v_passed > 0
          and public.updraft_hits(v_prev_x - v_distance, v_prev_top, v_prev_gap, v_y))
      or public.updraft_hits(v_next_x - v_distance, v_next_top, v_next_gap, v_y);

    if v_next_x + 6500 - v_distance <= 22000 then
      v_passed := v_passed + 1;
      v_prev_x := v_next_x;
      v_prev_top := v_next_top;
      v_prev_gap := v_next_gap;

      v_state := (v_state * 1664525 + 1013904223) % 4294967296;
      v_draw := (v_state >> 16)::integer;
      v_next_gap := greatest(23000, 30000 - 200 * v_passed);
      v_lo := greatest(10000, v_prev_top - 24000);
      v_hi := least(88000 - 10000 - v_next_gap, v_prev_top + 24000);
      v_next_top := v_lo + v_draw % (v_hi - v_lo + 1);
      v_next_x := 90000 + v_passed * 42000;
    end if;

    exit when v_tick >= public.updraft_max_ticks();
  end loop;

  -- The run is over — crashed, stopped or at the bound — so any action left is
  -- one the flight never reached.
  if v_index <= v_count then
    v_result.outcome := 'invalid_actions';
    v_result.session_id := v_session.id;
    v_result.game_slug := v_game.slug;
    return v_result;
  end if;

  -- A flight cannot have lasted longer than its session has been open: the
  -- screen's clock never runs faster than real time.
  if v_tick::bigint * 1000 / 60 > v_elapsed + 2000 then
    v_result.outcome := 'invalid_duration';
    v_result.session_id := v_session.id;
    v_result.game_slug := v_game.slug;
    return v_result;
  end if;

  v_score := v_passed;
  v_total := v_passed;

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

comment on function public.complete_updraft_run(uuid, integer[], bigint, integer) is
  'Replays a submitted Updraft flight from its session seed, tick by tick — flaps, gravity, columns and the crash — derives the score and records it. A run ends at a crash, at the player''s stop, or at the thirty-minute bound. The claim is compared, never trusted.';

revoke all on function public.complete_updraft_run(uuid, integer[], bigint, integer) from public;
grant execute on function public.complete_updraft_run(uuid, integer[], bigint, integer) to anon, authenticated;

-- ─────────────────────────────────────────────────────────────────────────────
-- Start a run: the gate learns Updraft
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
  -- holds. 7 Second, Queens, Zip, 8 Puzzle, Tango, Gridburst, Updraft and the
  -- crossword have one. Anything else is a version no verifier owns.
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
     or (v_game.runtime = 'gridburst' and p_rules_version = public.gridburst_rules_version())
     or (v_game.runtime = 'updraft' and p_rules_version = public.updraft_rules_version()) then
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
                             when 'updraft' then public.updraft_max_actions()
                             else public.stack10_tiles()
                           end;
  v_empty.started_at    := v_session.started_at;
  v_empty.expires_at    := v_session.expires_at;
  v_empty.ranked        := v_session.user_id is not null;
  return v_empty;
end;
$$;

comment on function public.start_game_session(text, text, text) is
  'Issues a play session with a server-chosen seed. The caller identity is the verified token, never an argument. Stack 10 accepts stack-10@1 (legacy) and stack-10@2 (endless); Chain accepts chain@1 and chain@2; Memory Flash accepts memory-flash@1 (legacy) and memory-flash@2 (endless); One Move accepts one-move@1 (legacy) and one-move@2 (endless); Color Merge accepts color-merge@1 and color-merge@2; Don''t Touch the Black accepts dont-touch@1 and dont-touch@2; Queens accepts queens@1; Zip accepts zip@1, 8 Puzzle accepts eight-puzzle@1, Tango accepts tango@1, Sudoku accepts sudoku@2 (and sudoku@1, the random-grid rules), Gridburst accepts gridburst@1 and Updraft accepts updraft@1; 7 Second and the daily crossword (crossword@1) also answer already_played once the signed-in player has finished today''s.';

revoke all on function public.start_game_session(text, text, text) from public;
grant execute on function public.start_game_session(text, text, text) to anon, authenticated;
