-- Ending a run saves it, in every endless game.
--
-- Queens, Zip, 8 Puzzle, Don't Touch the Black and 7 Second already accept a run
-- the player ends: their verifiers score whatever line was submitted, because a
-- run there never loses points. The five older endless games refused it: Stack 10,
-- Chain, Memory Flash, One Move and Color Merge required a submission to end on
-- the move that lost (or the submission bound), so a player who quit kept nothing.
--
-- That refusal protected nothing. It was there so a player could not "discard the
-- move that lost" — but in all five games the score only ever grows, and the
-- losing move scores nothing, so cutting a line short can never raise a score; it
-- can only stop a run earlier than it would have stopped. This migration lets the
-- endless versions (`stack-10@2`, `chain@2`, `memory-flash@2`, `one-move@2`,
-- `color-merge@2`) score a run that stops while it is still live, exactly as the
-- newer games do. Every other check is unchanged: a move after the run ended, a
-- move the rules cannot produce, a wrong score claim and a duration longer than
-- the session are still refused, and a session still records once.
--
-- The retired finite versions (`@1`) keep their partial-run rule untouched: those
-- sessions are long expired, and their rules are history, not a constant that
-- moves.
--
-- Each function below is the latest definition, unchanged except for the
-- partial-run block. The client sends these runs from its new End run control and
-- from the play screen's quit dialog, which now ends and saves a run instead of
-- discarding it.

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
  -- Which of the two rulesets this session pinned, and the tiles it may carry:
  -- 60 for the legacy deck, 4096 for the endless board.
  v_endless  boolean := false;
  v_max      int;
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
  elsif v_session.rules_version = public.stack10_rules_version() then
    v_endless := true;
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
    v_tile := (v_state % 9)::int + 1;

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
      v_over := true;
    end if;

    -- The submission bound ends an endless run: there is no next tile to place.
    if not v_over and v_endless and v_placed >= v_max then
      v_over := true;
    end if;
  end loop;

  -- Under @1 a list of all sixty tiles is complete, and a shorter one that never
  -- overflowed is partial. Under @2 a submission that stops while the board can
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
  'Replays a submitted Stack 10 run from its session seed, derives the score, and records it. stack-10@1 ends at a sixty-tile deck; stack-10@2 has no deck, and its tiles arrive heavier from tile sixty-one, and a run the player ends is scored as it stands. The claim is compared, never trusted.';

revoke all on function public.complete_stack10_run(uuid, integer[], bigint, integer) from public;
grant execute on function public.complete_stack10_run(uuid, integer[], bigint, integer) to anon, authenticated;

create or replace function public.complete_chain_run(
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
  v_symbols  integer[] := '{}';
  v_round    int := 1;
  v_taken    int := 0;
  v_placed   int := 0;
  v_correct  int := 0;
  v_cleared  int := 0;
  v_over     boolean := false;
  -- Which of the two rulesets this session pinned, and the submission bound it
  -- carries: 55 for the legacy ten-round game, 4096 for the endless one.
  v_endless  boolean := false;
  v_max      int;
  v_pad      int;
  v_digest   text;
  v_elapsed  bigint;
  v_best     bigint;
  v_rank     bigint;
begin
  if p_session_id is null then
    raise exception 'a session id is required' using errcode = '22023';
  end if;
  if p_actions is null or array_position(p_actions, null) is not null then
    raise exception 'actions must be a dense array of pad indexes' using errcode = '22023';
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

  -- The session pins the rules it was issued under. Two versions are
  -- implemented: the legacy ten-round game, and the endless one. The version
  -- chooses the rules; a session under anything else is refused rather than
  -- guessed at.
  if v_session.rules_version = 'chain@1' then
    v_max := public.chain_taps();
  elsif v_session.rules_version = public.chain_rules_version() then
    v_endless := true;
    v_max := public.chain_max_actions();
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
  -- The symbol sequence is a function of the seed alone: the same 32-bit LCG
  -- Stack 10's deck uses, defined once here and mirrored by the client's engine
  -- (src/lib/games/chain.ts, seeds and vectors in docs/games/README.md). Round r
  -- shows the run's first r symbols and the player taps r pads, so a tap is
  -- checked against the symbol at its position *within its round*, not against
  -- the draw at its absolute position. Symbols are drawn lazily, one round at a
  -- time: the legacy game needed ten draws up front, and the endless game has no
  -- number of rounds to draw for in advance. A wrong tap ends the run with a loss
  -- and is still part of the submission; taps after it, a pad that does not
  -- exist, or a non-endless run that stops before its last tap make the
  -- submission impossible rather than merely bad.
  v_state := (v_session.seed % 4294967296 + 4294967296) % 4294967296;
  if v_state = 0 then
    v_state := 2654435769; -- 0x9E3779B9: a zero state would make the sequence degenerate
  end if;

  foreach v_pad in array coalesce(p_actions, array[]::integer[]) loop
    if v_over or v_placed >= v_max then
      v_result.outcome := 'invalid_actions';
      v_result.session_id := v_session.id;
      v_result.game_slug := v_game.slug;
      return v_result;
    end if;

    if v_pad < 0 or v_pad >= public.chain_pads() then
      v_result.outcome := 'invalid_actions';
      v_result.session_id := v_session.id;
      v_result.game_slug := v_game.slug;
      return v_result;
    end if;

    -- Draw until the current round has every symbol it will show. Round r needs
    -- r symbols and symbols are drawn in order, so this is exactly the
    -- sequence's prefix: the verifier never draws a symbol it does not compare,
    -- and the first ten draws are the same ten the legacy game made.
    while coalesce(array_length(v_symbols, 1), 0) < v_round loop
      v_state := (v_state * 1664525 + 1013904223) % 4294967296;
      v_symbols := v_symbols || (((v_state >> 16) % 4)::int);
    end loop;

    v_placed := v_placed + 1;
    -- Postgres arrays are 1-based; the round's taken count is 0-based.
    if v_pad = v_symbols[v_taken + 1] then
      v_correct := v_correct + 1;
      v_taken := v_taken + 1;
      if v_taken >= v_round then
        -- The round is fully reproduced: it clears, and the next round shows
        -- one symbol more.
        v_cleared := v_cleared + 1;
        v_round := v_round + 1;
        v_taken := 0;
      end if;
    else
      v_over := true;
    end if;
  end loop;

  -- Under chain@1 a run is the full fifty-five taps or the losing tap, and a
  -- shorter no-loss submission is partial. Under chain@2 a submission that never
  -- lost is the player ending the run, and is scored as it stands: the score
  -- only grows, so stopping early can never earn a point.
  if not v_over and not v_endless and v_placed < v_max then
    v_result.outcome := 'invalid_actions';
    v_result.session_id := v_session.id;
    v_result.game_slug := v_game.slug;
    return v_result;
  end if;

  -- The client's number is a claim. The database's replay is the score.
  if p_score is distinct from v_correct then
    v_result.outcome := 'score_mismatch';
    v_result.session_id := v_session.id;
    v_result.game_slug := v_game.slug;
    v_result.score := v_correct;
    return v_result;
  end if;

  update public.game_sessions s
     set completed_at    = now(),
         verified_score  = v_correct,
         verified_digest = v_digest
   where s.id = v_session.id
  returning * into v_session;

  -- Only a signed-in run becomes a ranked score. A guest run is verified and
  -- closed, and its score exists on the session alone: `scores.user_id` is NOT
  -- NULL precisely so an anonymous run cannot become somebody's personal best.
  if v_session.user_id is not null then
    insert into public.scores (session_id, game_id, user_id, score, duration_ms)
    values (v_session.id, v_session.game_id, v_session.user_id, v_correct, p_duration_ms);
  end if;

  v_result.outcome         := 'recorded';
  v_result.session_id      := v_session.id;
  v_result.game_slug       := v_game.slug;
  v_result.score           := v_correct;
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

comment on function public.complete_chain_run(uuid, integer[], bigint, integer) is
  'Replays a submitted Chain run from its session seed, derives the score, and records it. chain@1 runs end at ten rounds; chain@2 runs end when a tap breaks the chain or when the player ends them. The claim is compared, never trusted.';

revoke all on function public.complete_chain_run(uuid, integer[], bigint, integer) from public;
grant execute on function public.complete_chain_run(uuid, integer[], bigint, integer) to anon, authenticated;

create or replace function public.complete_memory_flash_run(
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
  v_pattern  integer[] := '{}';
  v_entered  integer[] := '{}';
  v_round    int := 1;
  v_placed   int := 0;
  v_cleared  int := 0;
  v_score    bigint := 0;
  v_over     boolean := false;
  v_cell     int;
  v_cells    int;
  v_digest   text;
  v_elapsed  bigint;
  v_best     bigint;
  v_rank     bigint;
  -- Which of the two rulesets this session pinned, and the taps it may carry:
  -- 55 for the legacy ten-pattern game, 4096 for the endless board.
  v_endless  boolean := false;
  v_max      int;
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
  -- the legacy ten-pattern game, and the endless board. The version chooses the
  -- rules; a session under anything else is refused rather than guessed at.
  if v_session.rules_version = 'memory-flash@1' then
    v_max := public.memory_flash_taps();
  elsif v_session.rules_version = public.memory_flash_rules_version() then
    v_endless := true;
    v_max := public.memory_flash_max_taps();
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
  -- Round r lights r cells, drawn from the seed by the generator above and
  -- mirrored by the client's engine (src/lib/games/memory-flash.ts, seeds and
  -- vectors in docs/games/README.md). A pattern is a set: a correct tap is one of
  -- its cells that has not been entered yet, in any order. A tap outside the
  -- pattern, or a repeat, ends the run and is still part of the submission;
  -- actions after that, or a cell that does not exist on the round's board, make
  -- the submission impossible rather than merely bad.
  --
  -- Under @1 the board is 4×4 and the tenth cleared pattern is the whole game.
  -- Under @2 the board grows with the pattern and there is no last round: the run
  -- ends on a mistake, or when the submission bound leaves no room for another
  -- tap.
  if v_endless then
    v_cells := public.memory_flash_cells_at(1);
    v_pattern := public.memory_flash_endless_pattern(v_session.seed, 1);
  else
    v_cells := public.memory_flash_cells();
    v_pattern := public.memory_flash_pattern(v_session.seed, 1);
  end if;

  foreach v_cell in array coalesce(p_actions, array[]::integer[]) loop
    if v_over or v_placed >= v_max then
      v_result.outcome := 'invalid_actions';
      v_result.session_id := v_session.id;
      v_result.game_slug := v_game.slug;
      return v_result;
    end if;

    if v_cell < 0 or v_cell >= v_cells then
      v_result.outcome := 'invalid_actions';
      v_result.session_id := v_session.id;
      v_result.game_slug := v_game.slug;
      return v_result;
    end if;

    v_placed := v_placed + 1;

    if v_cell = any(v_pattern) and not (v_cell = any(v_entered)) then
      v_entered := v_entered || v_cell;
      if coalesce(array_length(v_entered, 1), 0) >= v_round then
        -- The pattern is rebuilt: it clears, and the next one is one cell larger
        -- on a board that has grown if the pattern needs it.
        v_cleared := v_cleared + 1;
        v_entered := '{}';
        if v_endless then
          v_round := v_round + 1;
          v_cells := public.memory_flash_cells_at(v_round);
          v_pattern := public.memory_flash_endless_pattern(v_session.seed, v_round);
        elsif v_round < public.memory_flash_rounds() then
          v_round := v_round + 1;
          v_pattern := public.memory_flash_pattern(v_session.seed, v_round);
        end if;
      end if;
    else
      v_over := true;
    end if;

    -- The submission bound ends an endless run: there is no next tap to carry.
    if not v_over and v_endless and v_placed >= v_max then
      v_over := true;
    end if;
  end loop;

  -- Under memory-flash@1 a submission that stops early is a partial run. Under
  -- memory-flash@2 it is the player ending the run, and is scored as it stands:
  -- the score only grows, so stopping early can never earn a point.
  if not v_over and not v_endless and v_placed < v_max then
    v_result.outcome := 'invalid_actions';
    v_result.session_id := v_session.id;
    v_result.game_slug := v_game.slug;
    return v_result;
  end if;

  v_score := v_cleared * 10;

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

comment on function public.complete_memory_flash_run(uuid, integer[], bigint, integer) is
  'Replays a submitted Memory Flash run from its session seed, derives the score, and records it. memory-flash@1 ends after ten patterns on a 4×4 board; memory-flash@2 has no final round, grows the board with the pattern, and ends on a mistake, the submission bound, or the player ending it. The claim is compared, never trusted.';

revoke all on function public.complete_memory_flash_run(uuid, integer[], bigint, integer) from public;
grant execute on function public.complete_memory_flash_run(uuid, integer[], bigint, integer) to anon, authenticated;

create or replace function public.complete_one_move_run(
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
  v_placed   int := 0;
  v_cleared  int := 0;
  v_score    bigint := 0;
  v_over     boolean := false;
  v_cell     int;
  v_digest   text;
  v_elapsed  bigint;
  v_best     bigint;
  v_rank     bigint;
  -- Which of the two rulesets this session pinned, and the taps it may carry:
  -- 12 for the legacy twelve-board game, 4096 for the endless board. The level's
  -- board comes from the matching function, too.
  v_endless  boolean := false;
  v_max      int;
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
  -- the legacy twelve-board game, and the endless board. The version chooses the
  -- rules; a session under anything else is refused rather than guessed at.
  if v_session.rules_version = 'one-move@1' then
    v_max := public.one_move_taps();
  elsif v_session.rules_version = public.one_move_rules_version() then
    v_endless := true;
    v_max := public.one_move_max_taps();
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
  -- Every level shows a checkerboard with exactly one cross already flipped, and
  -- the winning cell is that cross's centre (drawn from the seed by the generator
  -- above and mirrored by the client's engine — src/lib/games/one-move.ts, seeds
  -- and vectors in docs/games/README.md). A tap either restores the board and
  -- scores ten points, or ends the run; the losing tap is still part of the
  -- submission. Actions after the run ended, a cell that is not on the level's
  -- board, or a run that stops early make the submission impossible rather than
  -- merely bad.
  --
  -- Under @1 the twelfth restored board is the whole game. Under @2 the board
  -- grows with the level and there is no last board: the run ends on a mistake,
  -- or when the submission bound leaves no room for another tap.
  foreach v_cell in array coalesce(p_actions, array[]::integer[]) loop
    if v_over or v_placed >= v_max
       or (not v_endless and v_cleared >= public.one_move_levels()) then
      v_result.outcome := 'invalid_actions';
      v_result.session_id := v_session.id;
      v_result.game_slug := v_game.slug;
      return v_result;
    end if;

    if v_cell < 0 or v_cell >= (case
                                  when v_endless then public.one_move_cells_at(v_level)
                                  else public.one_move_cells(v_level)
                                end) then
      v_result.outcome := 'invalid_actions';
      v_result.session_id := v_session.id;
      v_result.game_slug := v_game.slug;
      return v_result;
    end if;

    v_placed := v_placed + 1;

    if v_cell = (case
                   when v_endless then public.one_move_endless_center(v_session.seed, v_level)
                   else public.one_move_center(v_session.seed, v_level)
                 end) then
      v_cleared := v_cleared + 1;
      v_score := v_score + 10;
      if v_endless or v_level < public.one_move_levels() then
        v_level := v_level + 1;
      end if;
    else
      v_over := true;
    end if;

    -- The submission bound ends an endless run: there is no next tap to carry.
    if not v_over and v_endless and v_placed >= v_max then
      v_over := true;
    end if;
  end loop;

  -- Under one-move@1 a submission that stops before the twelfth board is a
  -- partial run. Under one-move@2 it is the player ending the run, and is scored
  -- as it stands: the score only grows, so stopping early can never earn a point.
  if not v_over and not v_endless and v_cleared < public.one_move_levels() then
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

comment on function public.complete_one_move_run(uuid, integer[], bigint, integer) is
  'Replays a submitted One Move run from its session seed, derives the score, and records it. one-move@1 ends after twelve boards on boards up to 5×5; one-move@2 has no final board, grows the board every four levels, and ends on a miss, the submission bound, or the player ending it. The claim is compared, never trusted.';

revoke all on function public.complete_one_move_run(uuid, integer[], bigint, integer) from public;
grant execute on function public.complete_one_move_run(uuid, integer[], bigint, integer) to anon, authenticated;

create or replace function public.complete_color_merge_run(
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
  v_next     integer[];
  v_gain     bigint;
  v_slides   int := 0;
  v_score    bigint := 0;
  v_over     boolean := false;
  -- Which of the two rulesets this session pinned, and the slides it may carry:
  -- 48 for the legacy deck, 4096 for the endless board.
  v_endless  boolean := false;
  v_max      int;
  v_direction int;
  v_digest   text;
  v_elapsed  bigint;
  v_best     bigint;
  v_rank     bigint;
begin
  if p_session_id is null then
    raise exception 'a session id is required' using errcode = '22023';
  end if;
  if p_actions is null or array_position(p_actions, null) is not null then
    raise exception 'actions must be a dense array of directions' using errcode = '22023';
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
  -- the legacy forty-eight-slide deck, and the endless board. The version chooses
  -- the rules; a session under anything else is refused rather than guessed at.
  if v_session.rules_version = 'color-merge@1' then
    v_max := public.color_merge_slides();
  elsif v_session.rules_version = public.color_merge_rules_version() then
    v_endless := true;
    v_max := public.color_merge_max_slides();
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
  -- The board opens at two tiles from the seed, and each submitted direction is
  -- one slide: every line compacts toward that edge, equal neighbours merge into
  -- the next shade, a tile is dealt, and the score grows by the value the board
  -- gained. A slide that changes nothing is impossible play — the client never
  -- records one — and so is a slide after the run ended, a direction that is not
  -- 0 to 3, or a submission that stops before the board locks.
  --
  -- Under @1 the forty-eighth slide ends the run. Under @2 only the board's own
  -- lock (or the submission bound) does.
  if v_endless then
    v_board := public.color_merge_board_endless(v_session.seed);
  else
    v_board := public.color_merge_board(v_session.seed);
  end if;

  foreach v_direction in array coalesce(p_actions, array[]::integer[]) loop
    if v_over or v_slides >= v_max then
      v_result.outcome := 'invalid_actions';
      v_result.session_id := v_session.id;
      v_result.game_slug := v_game.slug;
      return v_result;
    end if;

    if v_direction < 0 or v_direction > 3 then
      v_result.outcome := 'invalid_actions';
      v_result.session_id := v_session.id;
      v_result.game_slug := v_game.slug;
      return v_result;
    end if;

    v_next := public.color_merge_slide(v_board, v_direction);
    if v_next = v_board then
      v_result.outcome := 'invalid_actions';
      v_result.session_id := v_session.id;
      v_result.game_slug := v_game.slug;
      return v_result;
    end if;

    v_gain := public.color_merge_gain(v_board, v_direction);
    v_score := v_score + v_gain;
    v_board := v_next;
    v_slides := v_slides + 1;

    -- The bound and the legacy deck both end the run without dealing a tile:
    -- there is no next move to make with it.
    if v_slides >= v_max then
      v_over := true;
    else
      if v_endless then
        v_board := public.color_merge_spawn_endless(v_session.seed, v_slides + 2, v_board);
      else
        v_board := public.color_merge_spawn(v_session.seed, v_slides + 2, v_board);
      end if;
      if not public.color_merge_can_move(v_board) then
        v_over := true;
      end if;
    end if;
  end loop;

  -- Under color-merge@1 a submission that stops before the board locks or the
  -- deck runs out is a partial run. Under color-merge@2 it is the player ending
  -- the run, and is scored as it stands: the score only grows, so stopping early
  -- can never earn a point.
  if not v_over and not v_endless then
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
  v_result.tiles_placed    := v_slides;
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

comment on function public.complete_color_merge_run(uuid, integer[], bigint, integer) is
  'Replays a submitted Color Merge run from its session seed, derives the score, and records it. color-merge@1 ends at a forty-eight-slide deck; color-merge@2 has no deck and ends when the board locks, the submission bound is reached, or the player ends it. The claim is compared, never trusted.';

revoke all on function public.complete_color_merge_run(uuid, integer[], bigint, integer) from public;
grant execute on function public.complete_color_merge_run(uuid, integer[], bigint, integer) to anon, authenticated;
