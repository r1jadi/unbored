-- Winnable Stack 10 (`stack-10@3`).
--
-- `stack-10@2` drew every base tile from 1 to 9 evenly and ended the run on the
-- first column past ten. Two in three tiles were 4 or more, so once columns sat
-- at 7, 8 or 9 the small tile they needed almost never came. Measured over
-- hundreds of seeds, even play that could see every future tile survived a median
-- of ten tiles, and no realistic player reached tile sixty, where the pressure
-- ramp starts: the ramp was decoration. `stack-10@3` keeps the board, the
-- scoring, the ramp and the generator, and changes the parts that made it
-- unwinnable:
--
--   - **A weighted draw.** The base tile is `stack10_draw_table()[state mod 23]`:
--     1, 2 and 3 four times each, 4 three times, 5, 6 and 7 twice, 8 and 9 once.
--     Twenty-three is odd, like the old nine, so the slot depends on the whole
--     state rather than the LCG's short-period low bits, and it shares no factor
--     with the promotion roll's 100. The ramp promotes a tile exactly as before.
--   - **Busts.** A column past ten empties and scores nothing; the third bust
--     ends the run (`stack10_busts()`).
--   - **The tile after next is shown** by the client. Every tile is already a
--     function of the seed and its index, so this changes nothing verified here.
--
-- Over 500 seeds, a random player now survives a median of 28 tiles, a greedy one
-- 53, and one who plans with the preview 96; 1%, 41% and 75% of them reach tile
-- sixty, against 0% for everyone under `stack-10@2`. The ramp still ends every run.
--
-- `stack-10@2` and `stack-10@1` keep verifying exactly as before: a run started,
-- saved or continued under them replays under its own rules. New runs pin
-- `stack-10@3`.
--
-- Mirrored by src/lib/games/stack10.ts; the `stack-10@3` vectors in
-- src/lib/games/stack10.test.ts are the ones this verifier must reproduce.

create or replace function public.stack10_rules_version()
returns text language sql immutable set search_path = '' as $$ select 'stack-10@3'::text $$;

comment on function public.stack10_rules_version() is
  'The Stack 10 rules version new sessions pin: stack-10@3, the weighted draw with busts. stack-10@2 and stack-10@1 runs are still verified.';

-- The stack-10@3 base draw, slot by slot. Indexed by (state mod 23) + 1.
create or replace function public.stack10_draw_table()
returns integer[] language sql immutable set search_path = '' as $$
  select array[1, 1, 1, 1, 2, 2, 2, 2, 3, 3, 3, 3, 4, 4, 4, 5, 5, 6, 6, 7, 7, 8, 9]
$$;

-- The busts a stack-10@3 run may take; the last one ends it.
create or replace function public.stack10_busts()
returns integer language sql immutable set search_path = '' as $$ select 3 $$;

comment on function public.stack10_draw_table() is
  'The stack-10@3 base tiles, one per slot: the draw is slot (state mod 23) + 1. Light faces are common so a column can usually be finished exactly.';
comment on function public.stack10_busts() is
  'The busts a stack-10@3 run may take: a column past ten empties, and the third bust ends the run.';

revoke all on function public.stack10_draw_table() from public;
revoke all on function public.stack10_busts() from public;

-- The tile a run's p_placed-th move draws under a rules version, so the tests
-- can assert the new draw directly. The two-argument `stack10_tile` stays the
-- stack-10@2 draw it always was.
create or replace function public.stack10_tile(p_seed bigint, p_placed integer, p_rules_version text)
returns integer
language plpgsql
immutable
set search_path = ''
as $$
declare
  v_state bigint;
  v_tile  int;
  v_roll  int;
  v_index int;
begin
  if p_rules_version is distinct from public.stack10_rules_version() then
    return public.stack10_tile(p_seed, p_placed);
  end if;
  if p_seed is null then
    raise exception 'a seed is required' using errcode = '22023';
  end if;
  if p_placed is null or p_placed < 0 then
    raise exception 'a Stack 10 tile index is zero or more' using errcode = '22023';
  end if;

  v_state := (p_seed % 4294967296 + 4294967296) % 4294967296;
  if v_state = 0 then
    v_state := 2654435769; -- 0x9E3779B9: a zero state would make the sequence degenerate
  end if;

  for v_index in 0..p_placed loop
    v_state := (v_state * 1664525 + 1013904223) % 4294967296;
  end loop;

  v_tile := (public.stack10_draw_table())[(v_state % 23)::int + 1];
  v_roll := ((v_state >> 16) % 100)::int;
  if v_roll < public.stack10_pressure_percent(p_placed) then
    v_tile := least(9, v_tile + public.stack10_heavy_bonus(p_placed));
  end if;
  return v_tile;
end;
$$;

comment on function public.stack10_tile(bigint, integer, text) is
  'The tile the p_placed-th move of a Stack 10 run draws under a rules version: the weighted table under stack-10@3, the even draw otherwise. Pure, and mirrored by src/lib/games/stack10.ts.';

revoke all on function public.stack10_tile(bigint, integer, text) from public;

-- ─────────────────────────────────────────────────────────────────────────────
-- The verifier: stack-10@1 and @2 as before, stack-10@3 with the table and busts
-- ─────────────────────────────────────────────────────────────────────────────
--
-- The latest definition (20261107120000_end_run_saves_score.sql), with the @3
-- branch added.

create or replace function public.complete_stack10_run(
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
  v_state    bigint;
  v_tile     int;
  v_roll     int;
  v_column   int;
  v_index    int;
  v_placed   int := 0;
  v_score    bigint := 0;
  v_cleared  int := 0;
  v_over     boolean := false;
  v_sums     integer[] := array[0, 0, 0, 0];
  v_stacks   integer[] := array[0, 0, 0, 0];
  v_digest   text;
  v_elapsed  bigint;
  v_best     bigint;
  v_rank     bigint;
  -- Which of the three rulesets this session pinned, and the tiles it may carry:
  -- 60 for the legacy deck, 4096 for either endless board.
  v_endless  boolean := false;
  v_max      int;
  -- stack-10@3: the weighted draw, and the busts a run may take before it ends.
  v_winnable boolean := false;
  v_busts    int := 0;
  v_limit    int := 1;
begin
  if p_session_id is null then
    raise exception 'a session id is required' using errcode = '22023';
  end if;
  if p_actions is null or array_position(p_actions, null) is not null then
    raise exception 'actions must be a dense array of column indexes' using errcode = '22023';
  end if;
  if p_duration_ms is null or p_duration_ms < 1 then
    raise exception 'duration must be a positive number of milliseconds' using errcode = '22023';
  end if;

  -- Locked: two completions racing for one session must meet here, not both pass
  -- the "already closed" check and then both insert.
  select * into v_session from public.game_sessions s where s.id = p_session_id for update;

  -- A missing session and somebody else's session answer identically: telling
  -- them apart would let a caller enumerate other people's run ids.
  if not found
     or (v_session.user_id is not null and v_session.user_id is distinct from v_user)
     or (v_session.user_id is null and v_user is not null) then
    v_result.outcome := 'not_found';
    v_result.session_id := p_session_id;
    return v_result;
  end if;

  select * into v_game from public.games g where g.id = v_session.game_id;

  -- The fingerprint of *this* submission. A retry of the same run produces the
  -- same string; anything else does not.
  v_digest := md5(concat_ws('|',
    v_session.rules_version,
    v_session.seed::text,
    array_to_string(p_actions, ','),
    p_score::text
  ));

  if v_session.completed_at is not null then
    -- A retry must be recognised as a retry, not punished and not recorded
    -- twice: an interrupted network should be safe to repeat.
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

    -- Same session, different run: refuse rather than replace. The first result
    -- is the one that was verified.
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

  -- The session pins the rules it was issued under. Two versions are implemented:
  -- the legacy sixty-tile deck, and the endless board. The version chooses the
  -- rules; a session under anything else is refused rather than guessed at.
  if v_session.rules_version = 'stack-10@1' then
    v_max := public.stack10_tiles();
  elsif v_session.rules_version = 'stack-10@2' then
    v_endless := true;
    v_max := public.stack10_max_tiles();
  elsif v_session.rules_version = public.stack10_rules_version() then
    v_endless := true;
    v_winnable := true;
    v_limit := public.stack10_busts();
    v_max := public.stack10_max_tiles();
  else
    v_result.outcome := 'wrong_rules';
    v_result.session_id := v_session.id;
    v_result.game_slug := v_game.slug;
    return v_result;
  end if;

  if array_length(p_actions, 1) > v_max then
    v_result.outcome := 'invalid_actions';
    v_result.session_id := v_session.id;
    v_result.game_slug := v_game.slug;
    return v_result;
  end if;

  -- A claimed duration longer than the session has existed is impossible: the
  -- run cannot have taken longer than the time since it started. Two seconds of
  -- slack covers the round trip and a client clock that is slightly ahead.
  v_elapsed := (extract(epoch from (now() - v_session.started_at)) * 1000)::bigint;
  if p_duration_ms > v_elapsed + 2000 then
    v_result.outcome := 'invalid_duration';
    v_result.session_id := v_session.id;
    v_result.game_slug := v_game.slug;
    return v_result;
  end if;

  -- ── The replay ───────────────────────────────────────────────────────────
  -- The base tile sequence is a function of the seed alone: a 32-bit LCG, defined
  -- once here and mirrored by the client's engine (seeds and vectors in
  -- docs/games/README.md). Tiles are 1..9. A drop raises its column's sum; a sum
  -- of exactly ten clears the column and scores; a sum above ten ends the run.
  -- Actions after the run ended, or a column that does not exist, make the
  -- submission impossible rather than merely bad.
  --
  -- Under @1 that is the whole game: the sixty-tile deck ends the run.
  -- Under @2 the first sixty tiles are the same deck, and from tile sixty-one a
  -- draw can arrive promoted — heavier, by a chance and a weight that both climb.
  -- Under @3 the base tile is read from the weighted table instead of 1..9
  -- evenly, the ramp is the same, and a sum above ten busts the column — it
  -- empties and scores nothing — until the third bust, which ends the run.
  v_state := (v_session.seed % 4294967296 + 4294967296) % 4294967296;
  if v_state = 0 then
    v_state := 2654435769; -- 0x9E3779B9: a zero state would make the sequence degenerate
  end if;

  foreach v_column in array coalesce(p_actions, array[]::integer[]) loop
    if v_over or v_placed >= v_max then
      v_result.outcome := 'invalid_actions';
      v_result.session_id := v_session.id;
      v_result.game_slug := v_game.slug;
      return v_result;
    end if;

    if v_column < 0 or v_column >= public.stack10_columns() then
      v_result.outcome := 'invalid_actions';
      v_result.session_id := v_session.id;
      v_result.game_slug := v_game.slug;
      return v_result;
    end if;

    v_state := (v_state * 1664525 + 1013904223) % 4294967296;
    if v_winnable then
      v_tile := (public.stack10_draw_table())[(v_state % 23)::int + 1];
    else
      v_tile := (v_state % 9)::int + 1;
    end if;

    if v_endless then
      v_roll := ((v_state >> 16) % 100)::int;
      if v_roll < public.stack10_pressure_percent(v_placed) then
        v_tile := least(9, v_tile + public.stack10_heavy_bonus(v_placed));
      end if;
    end if;

    v_index := v_column + 1; -- Postgres arrays are 1-based; the API's indexes are 0-based
    v_stacks[v_index] := v_stacks[v_index] + 1;
    v_sums[v_index] := v_sums[v_index] + v_tile;
    v_placed := v_placed + 1;

    if v_sums[v_index] = 10 then
      -- Stacking more tiles into a column before it clears is the riskier play —
      -- fewer free columns, less room for the next tile — so it is what scores.
      v_score := v_score + 10 + 5 * (v_stacks[v_index] - 1);
      v_cleared := v_cleared + 1;
      v_sums[v_index] := 0;
      v_stacks[v_index] := 0;
    elsif v_sums[v_index] > 10 then
      v_busts := v_busts + 1;
      if v_busts >= v_limit then
        v_over := true;
      else
        -- A bust the run survives (@3): the column empties and scores nothing.
        v_sums[v_index] := 0;
        v_stacks[v_index] := 0;
      end if;
    end if;

    -- The submission bound ends an endless run: there is no next tile to place.
    if not v_over and v_endless and v_placed >= v_max then
      v_over := true;
    end if;
  end loop;

  -- Under @1 a list of all sixty tiles is complete, and a shorter one that never
  -- overflowed is partial. Under @2 and @3 a submission that stops while the board can
  -- still take a tile is the player ending the run, and is scored as it stands:
  -- the score only grows, so stopping early can never earn a point.
  if not v_over and not v_endless and v_placed < public.stack10_tiles() then
    v_result.outcome := 'invalid_actions';
    v_result.session_id := v_session.id;
    v_result.game_slug := v_game.slug;
    return v_result;
  end if;

  -- The client's number is a claim. The database's replay is the score.
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

  -- Only a signed-in run becomes a ranked score. A guest run is verified and
  -- closed, and its score exists on the session alone: `scores.user_id` is NOT
  -- NULL precisely so an anonymous run cannot become somebody's personal best.
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

comment on function public.complete_stack10_run(uuid, integer[], bigint, integer) is
  'Replays a submitted Stack 10 run from its session seed, derives the score, and records it. stack-10@1 ends at a sixty-tile deck; stack-10@2 has no deck, and its tiles arrive heavier from tile sixty-one; stack-10@3 draws from a table weighted toward light tiles and lets a run survive two busts. A run the player ends is scored as it stands. The claim is compared, never trusted.';

revoke all on function public.complete_stack10_run(uuid, integer[], bigint, integer) from public;
grant execute on function public.complete_stack10_run(uuid, integer[], bigint, integer) to anon, authenticated;

-- ─────────────────────────────────────────────────────────────────────────────
-- Starting, saving and continuing stack-10@3 runs
-- ─────────────────────────────────────────────────────────────────────────────

insert into public.game_runtimes (runtime, rules_version, max_actions, session_hours)
values ('stack-10', 'stack-10@3', public.stack10_max_tiles(), 12)
on conflict (runtime, rules_version) do nothing;

-- The same list as 20270108120000_cascade_bombs.sql, plus stack-10@3.
create or replace function public.run_resumable(p_rules_version text)
returns boolean
language sql
immutable
set search_path = ''
as $$
  select coalesce(p_rules_version in (
    'stack-10@2', 'stack-10@3', 'chain@2', 'memory-flash@2', 'one-move@2', 'color-merge@2',
    'queens@1', 'queens@2',
    'gridburst@1',
    'zip@2', 'eight-puzzle@2', 'tango@2',
    'sudoku@3', 'sudoku@4', 'mini-sudoku@1', 'mini-sudoku@2', 'decant@2',
    'bolted@1', 'huedini@1', 'scatter@1', 'cascade@1', 'cascade@2', 'checkmate@1', 'fusebox@1',
    'minefield@1', 'sumdoku@1', 'whittle@1'
  ), false)
$$;

-- The game page describes the run that now exists.
update public.games
   set instructions = 'Place the numbered tile in one of four columns; the tile after it is shown too. A column that adds up to exactly ten clears and scores. A column that goes past ten busts: it empties, and the third bust ends the run. Small tiles are common and big ones rare, but there is no final tile: past tile sixty, tiles arrive with a growing chance of a heavier face, so clears get rarer and the board gets tighter.'
 where slug = 'stack-10'
   and status = 'published';
