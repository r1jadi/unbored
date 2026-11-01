-- Decant: the sixteenth runtime.
--
-- The colour-sorting puzzle as an endless run against a clock: tubes of stacked
-- liquid, four units to a tube, poured between tubes until each holds a single
-- colour. What this migration changes, and why:
--
--   1. The rules, as constants the database owns: `decant@1`, an 8192-action
--      submission bound, and the clock — sixty seconds to start, five more per
--      colour of every solved board, fifteen less for every extra tube, and
--      twenty seconds of slack.
--
--   2. The board generator, `decant_board(seed, level)`: every unit of the
--      level's colours (three, one more every second board, up to nine),
--      shuffled and poured into full tubes, with two empty tubes after them.
--
--   3. `public.complete_decant_run`, the verifier. It replays every action — a
--      pour (`from × 16 + to`), an extra tube (253), an undo (254) and a restart
--      (255) — and scores ten points per colour whenever a board comes out
--      sorted, then deals the next. Any prefix of a legal line is valid. Like 8
--      Puzzle, the session is issued when the player presses Start, and a run
--      that arrives later than its clock allowed is refused as `out_of_time`.
--
--   4. `public.start_game_session` learns the (`decant`, `decant@1`) pair.
--
-- Nothing here puts Decant in the catalogue:
-- `20261121120100_decant_playable.sql` does, after the deployment carrying the
-- runtime is live. See docs/games/README.md and src/lib/games/decant.ts.

-- ─────────────────────────────────────────────────────────────────────────────
-- The rules, as constants the database owns
-- ─────────────────────────────────────────────────────────────────────────────

create or replace function public.decant_rules_version()
returns text language sql immutable set search_path = '' as $$ select 'decant@1'::text $$;

create or replace function public.decant_max_actions()
returns integer language sql immutable set search_path = '' as $$ select 8192 $$;

create or replace function public.decant_slack_ms()
returns integer language sql immutable set search_path = '' as $$ select 20000 $$;

-- A level's colours: three, one more every second board, up to nine.
create or replace function public.decant_colours(p_level integer)
returns integer
language plpgsql
immutable
set search_path = ''
as $$
begin
  if p_level is null or p_level < 1 then
    raise exception 'a Decant level is one or more' using errcode = '22023';
  end if;
  return least(9, 3 + (p_level - 1) / 2);
end;
$$;

-- The clock a run has earned: sixty seconds, five more per colour of every
-- solved board, fifteen less for every extra tube.
create or replace function public.decant_budget_ms(p_cleared integer, p_extra_tubes integer)
returns bigint
language plpgsql
immutable
set search_path = ''
as $$
declare
  v_ms    bigint := 60000 - 15000::bigint * greatest(coalesce(p_extra_tubes, 0), 0);
  v_level integer;
begin
  for v_level in 1..greatest(coalesce(p_cleared, 0), 0) loop
    v_ms := v_ms + 5000 * public.decant_colours(v_level);
  end loop;
  return v_ms;
end;
$$;

comment on function public.decant_rules_version() is
  'The Decant rules version the database can verify. A rules change needs a new version and a new verifier.';
comment on function public.decant_max_actions() is
  'The most actions a Decant submission may carry. A request bound, not a last board.';
comment on function public.decant_slack_ms() is
  'How long after its clock ran out a Decant run is still accepted.';
comment on function public.decant_colours(integer) is
  'The colours on a Decant board: three, one more every second board, up to nine.';
comment on function public.decant_budget_ms(integer, integer) is
  'The clock a Decant run has earned: 60 s, plus 5 s per colour of every solved board, less 15 s per extra tube.';

-- ─────────────────────────────────────────────────────────────────────────────
-- The boards, as the one generator both sides draw from
-- ─────────────────────────────────────────────────────────────────────────────
--
-- One Move's outer LCG advanced once per level, and a second LCG started at that
-- state, as 8 Puzzle draws its boards. Every unit, colour by colour — four 1s,
-- four 2s, … — is shuffled by a Fisher–Yates pass from the last unit down, each
-- swap partner the next draw modulo the units left. Tube t takes units 4t to
-- 4t + 3, bottom first; the two empty tubes are not in the array.
--
-- Internals, not API surface: the verifier calls it as the function's owner.
create or replace function public.decant_board(p_seed bigint, p_level integer)
returns integer[]
language plpgsql
immutable
set search_path = ''
as $$
declare
  v_state   bigint;
  v_current integer;
  v_colours integer;
  v_units   integer[] := array[]::integer[];
  v_i       integer;
  v_j       integer;
  v_swap    integer;
begin
  if p_seed is null then
    raise exception 'a seed is required' using errcode = '22023';
  end if;
  if p_level is null or p_level < 1 or p_level > 8192 then
    raise exception 'decant level is outside the reachable run' using errcode = '22023';
  end if;
  v_colours := public.decant_colours(p_level);
  v_state := (p_seed % 4294967296 + 4294967296) % 4294967296;
  if v_state = 0 then
    v_state := 2654435769; -- 0x9E3779B9: a zero state would make the sequence degenerate
  end if;
  for v_current in 1..p_level loop
    v_state := (v_state * 1664525 + 1013904223) % 4294967296;
  end loop;

  for v_i in 1..v_colours loop
    v_units := v_units || array[v_i, v_i, v_i, v_i];
  end loop;
  for v_i in reverse (v_colours * 4 - 1)..1 loop
    v_state := (v_state * 22695477 + 1) % 4294967296;
    v_j := ((v_state >> 16) % (v_i + 1))::integer;
    v_swap := v_units[v_i + 1];
    v_units[v_i + 1] := v_units[v_j + 1];
    v_units[v_j + 1] := v_swap;
  end loop;
  return v_units;
end;
$$;

comment on function public.decant_board(bigint, integer) is
  'The units a Decant level is dealt, tube by tube and bottom first; two empty tubes follow. Mirrored by src/lib/games/decant.ts.';

revoke all on function public.decant_board(bigint, integer) from public;

-- ─────────────────────────────────────────────────────────────────────────────
-- Complete a run: replay, verify, then record
-- ─────────────────────────────────────────────────────────────────────────────

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

  if v_session.rules_version is distinct from public.decant_rules_version() then
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
  if v_elapsed > public.decant_budget_ms(v_total, v_extras) + public.decant_slack_ms() then
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

comment on function public.complete_decant_run(uuid, integer[], bigint, integer) is
  'Replays a submitted Decant run from its session seed — pours, undos, restarts and extra tubes — derives the score, and records it. A sorted board scores ten points per colour and deals the next. Any prefix of a legal line is valid. A run that arrives later than its clock allowed is out_of_time. The claim is compared, never trusted.';

revoke all on function public.complete_decant_run(uuid, integer[], bigint, integer) from public;
grant execute on function public.complete_decant_run(uuid, integer[], bigint, integer) to anon, authenticated;

-- ─────────────────────────────────────────────────────────────────────────────
-- Start a run: the gate learns Decant
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
  -- holds. 7 Second, Queens, Zip, 8 Puzzle, Tango, Gridburst, Updraft, Decant
  -- and the crossword have one. Anything else is a version no verifier owns.
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
     or (v_game.runtime = 'updraft' and p_rules_version = public.updraft_rules_version())
     or (v_game.runtime = 'decant' and p_rules_version = public.decant_rules_version()) then
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
                                          'sudoku@2', 'gridburst@1', 'decant@1')
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
  'Issues a play session with a server-chosen seed. The caller identity is the verified token, never an argument. Stack 10 accepts stack-10@1 (legacy) and stack-10@2 (endless); Chain accepts chain@1 and chain@2; Memory Flash accepts memory-flash@1 (legacy) and memory-flash@2 (endless); One Move accepts one-move@1 (legacy) and one-move@2 (endless); Color Merge accepts color-merge@1 and color-merge@2; Don''t Touch the Black accepts dont-touch@1 and dont-touch@2; Queens accepts queens@1; Zip accepts zip@1, 8 Puzzle accepts eight-puzzle@1, Tango accepts tango@1, Sudoku accepts sudoku@2 (and sudoku@1, the random-grid rules), Gridburst accepts gridburst@1, Updraft accepts updraft@1 and Decant accepts decant@1; 7 Second and the daily crossword (crossword@1) also answer already_played once the signed-in player has finished today''s.';

revoke all on function public.start_game_session(text, text, text) from public;
grant execute on function public.start_game_session(text, text, text) to anon, authenticated;
