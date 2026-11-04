-- Bolted (`bolted@1`): the nut-and-bolt sorting puzzle, verified by the database.
--
-- Bolts of stacked coloured nuts, four to a bolt, and two empty bolts. Move the
-- top nut — with every nut of its colour right under it, as many as fit — onto
-- an empty bolt or a nut of the same colour, until every bolt holds one colour.
-- A bolt full of one colour locks and never moves again. From board three the
-- nuts below each dealt bolt's top start face down; that is the screen's
-- business only, and the verifier knows every nut.
--
-- The run is Decant's shape: boards against one tapered clock, a point a colour
-- for each sorted board, and undo, restart and one extra bolt a board as
-- actions. The deal is Decant's, over a seed mixed with 0x85EBCA6B so the two
-- games never deal the same boards.
--
-- This migration adds the rules, the deal, the verifier
-- (`complete_bolted_run`) and the (`bolted`, `bolted@1`) row in
-- `public.game_runtimes`, which is all the start gate needs. Nothing a user can
-- see changes: `20261205120100_bolted_playable.sql` flips the catalogue and lands
-- last. Mirrored by src/lib/games/bolted.ts. See docs/games/README.md.

-- ─────────────────────────────────────────────────────────────────────────────
-- The rules, as constants the database owns
-- ─────────────────────────────────────────────────────────────────────────────

create or replace function public.bolted_rules_version()
returns text language sql immutable set search_path = '' as $$ select 'bolted@1'::text $$;

create or replace function public.bolted_max_actions()
returns integer language sql immutable set search_path = '' as $$ select 8192 $$;

create or replace function public.bolted_slack_ms()
returns integer language sql immutable set search_path = '' as $$ select 20000 $$;

-- A level's colours: three, one more every second board, up to eight.
create or replace function public.bolted_colours(p_level integer)
returns integer
language plpgsql
immutable
set search_path = ''
as $$
begin
  if p_level is null or p_level < 1 then
    raise exception 'a Bolted level is one or more' using errcode = '22023';
  end if;
  return least(8, 3 + (p_level - 1) / 2);
end;
$$;

-- The clock a run has earned: 75 s, plus 5 s per colour of every solved board,
-- tapered by clock_taper_pct, less 15 s for every extra bolt.
create or replace function public.bolted_budget_ms(p_cleared integer, p_extra_bolts integer)
returns bigint
language plpgsql
immutable
set search_path = ''
as $$
declare
  v_ms    bigint := 75000 - 15000::bigint * greatest(coalesce(p_extra_bolts, 0), 0);
  v_level integer;
begin
  for v_level in 1..greatest(coalesce(p_cleared, 0), 0) loop
    v_ms := v_ms
          + 5000::bigint * public.bolted_colours(v_level) * public.clock_taper_pct(v_level) / 100;
  end loop;
  return v_ms;
end;
$$;

comment on function public.bolted_rules_version() is
  'The Bolted rules version new runs pin: bolted@1.';
comment on function public.bolted_max_actions() is
  'The most actions a Bolted submission may carry. A request bound, not a last board.';
comment on function public.bolted_slack_ms() is
  'How long after its clock ran out a Bolted run is still accepted.';
comment on function public.bolted_colours(integer) is
  'The colours on a Bolted board: three, one more every second board, up to eight.';
comment on function public.bolted_budget_ms(integer, integer) is
  'The clock a bolted@1 run has earned: 75 s plus 5 s per colour of every solved board, tapered by clock_taper_pct, less 15 s per extra bolt.';

-- ─────────────────────────────────────────────────────────────────────────────
-- The deal: Decant's, over Bolted's own seed
-- ─────────────────────────────────────────────────────────────────────────────
--
-- The seed reduced mod 2³² and mixed with 0x85EBCA6B (2654435769 if that is 0),
-- an outer LCG advanced once per level, and an inner LCG from that state
-- shuffling every nut — four 1s, four 2s, … — by a Fisher–Yates pass from the
-- last nut down. Bolt b takes nuts 4b to 4b + 3, bottom first; the two empty
-- bolts are not in the array. Internals, not API surface.
create or replace function public.bolted_board(p_seed bigint, p_level integer)
returns integer[]
language plpgsql
immutable
set search_path = ''
as $$
declare
  v_state   bigint;
  v_current integer;
  v_colours integer;
  v_nuts    integer[] := array[]::integer[];
  v_i       integer;
  v_j       integer;
  v_swap    integer;
begin
  if p_seed is null then
    raise exception 'a seed is required' using errcode = '22023';
  end if;
  if p_level is null or p_level < 1 or p_level > 8192 then
    raise exception 'bolted level is outside the reachable run' using errcode = '22023';
  end if;
  v_colours := public.bolted_colours(p_level);
  v_state := ((p_seed % 4294967296 + 4294967296) % 4294967296) # 2246822507;
  if v_state = 0 then
    v_state := 2654435769;
  end if;
  for v_current in 1..p_level loop
    v_state := (v_state * 1664525 + 1013904223) % 4294967296;
  end loop;

  for v_i in 1..v_colours loop
    v_nuts := v_nuts || array[v_i, v_i, v_i, v_i];
  end loop;
  for v_i in reverse (v_colours * 4 - 1)..1 loop
    v_state := (v_state * 22695477 + 1) % 4294967296;
    v_j := ((v_state >> 16) % (v_i + 1))::integer;
    v_swap := v_nuts[v_i + 1];
    v_nuts[v_i + 1] := v_nuts[v_j + 1];
    v_nuts[v_j + 1] := v_swap;
  end loop;
  return v_nuts;
end;
$$;

comment on function public.bolted_board(bigint, integer) is
  'The nuts a Bolted level is dealt, bolt by bolt and bottom first; two empty bolts follow. Mirrored by src/lib/games/bolted.ts.';

revoke all on function public.bolted_board(bigint, integer) from public;

-- ─────────────────────────────────────────────────────────────────────────────
-- Complete a run: Decant's replay, with the locked bolt
-- ─────────────────────────────────────────────────────────────────────────────

create or replace function public.complete_bolted_run(
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
  -- The board: up to twelve bolts of four slots, slot t × 4 + i + 1 (bottom i = 0),
  -- and each bolt's fill. A snapshot for undo is the bolts then the fills.
  v_bolts    integer[];
  v_len      integer[];
  v_count    integer;
  v_history  integer[] := array[]::integer[];
  v_units    integer[];
  v_level    integer := 1;
  v_colours  integer;
  v_extra    boolean := false;
  v_extras   integer := 0;
  v_moves    integer := 0;
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

  if v_session.rules_version is distinct from public.bolted_rules_version() then
    v_result.outcome := 'wrong_rules';
    v_result.session_id := v_session.id;
    v_result.game_slug := v_game.slug;
    return v_result;
  end if;

  if coalesce(array_length(p_actions, 1), 0) > public.bolted_max_actions() then
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
  v_colours := public.bolted_colours(v_level);
  v_units := public.bolted_board(v_session.seed, v_level);
  v_count := v_colours + 2;
  v_bolts := array_fill(0, array[48]);
  v_len := array_fill(0, array[12]);
  for v_i in 1..v_colours * 4 loop
    v_bolts[v_i] := v_units[v_i];
  end loop;
  for v_t in 1..v_colours loop
    v_len[v_t] := 4;
  end loop;

  foreach v_action in array coalesce(p_actions, array[]::integer[]) loop
    if v_action = 253 then
      -- The extra bolt: once per board. Nothing before it can be undone.
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
      v_moves := 0;

    elsif v_action = 254 then
      -- Undo: the last snapshot, if this board has one.
      if v_moves = 0 then
        v_result.outcome := 'invalid_actions';
        v_result.session_id := v_session.id;
        v_result.game_slug := v_game.slug;
        return v_result;
      end if;
      v_i := array_length(v_history, 1) - 60;
      v_bolts := v_history[v_i + 1 : v_i + 48];
      v_len := v_history[v_i + 49 : v_i + 60];
      v_history := v_history[1 : v_i];
      v_moves := v_moves - 1;

    elsif v_action = 255 then
      -- Restart: the board as dealt, keeping a bought bolt.
      if v_moves = 0 then
        v_result.outcome := 'invalid_actions';
        v_result.session_id := v_session.id;
        v_result.game_slug := v_game.slug;
        return v_result;
      end if;
      v_units := public.bolted_board(v_session.seed, v_level);
      v_bolts := array_fill(0, array[48]);
      v_len := array_fill(0, array[12]);
      for v_i in 1..v_colours * 4 loop
        v_bolts[v_i] := v_units[v_i];
      end loop;
      for v_t in 1..v_colours loop
        v_len[v_t] := 4;
      end loop;
      v_history := array[]::integer[];
      v_moves := 0;

    else
      -- A move: from × 16 + to. Onto an empty bolt or the same colour, moving the
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
             and v_bolts[v_to * 4 + v_len[v_to + 1]] <> v_bolts[v_from * 4 + v_len[v_from + 1]]) then
        v_result.outcome := 'invalid_actions';
        v_result.session_id := v_session.id;
        v_result.game_slug := v_game.slug;
        return v_result;
      end if;

      -- A locked bolt — four nuts of one colour — never moves again.
      if v_len[v_from + 1] = 4
         and v_bolts[v_from * 4 + 1] = v_bolts[v_from * 4 + 2]
         and v_bolts[v_from * 4 + 1] = v_bolts[v_from * 4 + 3]
         and v_bolts[v_from * 4 + 1] = v_bolts[v_from * 4 + 4] then
        v_result.outcome := 'invalid_actions';
        v_result.session_id := v_session.id;
        v_result.game_slug := v_game.slug;
        return v_result;
      end if;

      v_history := v_history || v_bolts || v_len;
      v_colour := v_bolts[v_from * 4 + v_len[v_from + 1]];
      v_run := 0;
      while v_run < v_len[v_from + 1]
            and v_bolts[v_from * 4 + v_len[v_from + 1] - v_run] = v_colour loop
        v_run := v_run + 1;
      end loop;
      v_amount := least(v_run, 4 - v_len[v_to + 1]);
      for v_i in 1..v_amount loop
        v_bolts[v_from * 4 + v_len[v_from + 1]] := 0;
        v_len[v_from + 1] := v_len[v_from + 1] - 1;
        v_len[v_to + 1] := v_len[v_to + 1] + 1;
        v_bolts[v_to * 4 + v_len[v_to + 1]] := v_colour;
      end loop;
      v_moves := v_moves + 1;
      v_placed := v_placed + 1;

      -- Sorted: every bolt empty, or full of one colour.
      v_solved := true;
      for v_t in 0..v_count - 1 loop
        if v_len[v_t + 1] <> 0
           and (v_len[v_t + 1] <> 4
                or v_bolts[v_t * 4 + 1] <> v_bolts[v_t * 4 + 2]
                or v_bolts[v_t * 4 + 1] <> v_bolts[v_t * 4 + 3]
                or v_bolts[v_t * 4 + 1] <> v_bolts[v_t * 4 + 4]) then
          v_solved := false;
          exit;
        end if;
      end loop;

      if v_solved then
        v_score := v_score + v_colours;
        v_total := v_total + 1;
        v_level := v_level + 1;
        v_colours := public.bolted_colours(v_level);
        v_units := public.bolted_board(v_session.seed, v_level);
        v_count := v_colours + 2;
        v_bolts := array_fill(0, array[48]);
        v_len := array_fill(0, array[12]);
        for v_i in 1..v_colours * 4 loop
          v_bolts[v_i] := v_units[v_i];
        end loop;
        for v_t in 1..v_colours loop
          v_len[v_t] := 4;
        end loop;
        v_history := array[]::integer[];
        v_moves := 0;
        v_extra := false;
      end if;
    end if;
  end loop;

  -- A run that stops mid-board is the clock running out or the player ending
  -- it, and it is scored as it stands: the score only ever grows. It must still
  -- reach the server within the clock its solved boards earned.
  if v_elapsed > public.bolted_budget_ms(v_total, v_extras) + public.bolted_slack_ms() then
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

comment on function public.complete_bolted_run(uuid, integer[], bigint, integer) is
  'Replays a submitted Bolted run from its session seed — moves, undos, restarts and extra bolts — derives the score, and records it. A locked bolt never moves; a sorted board scores a point per colour and deals the next. Any prefix of a legal line is valid. A run that arrives later than its clock allowed is out_of_time. The claim is compared, never trusted.';

revoke all on function public.complete_bolted_run(uuid, integer[], bigint, integer) from public;
grant execute on function public.complete_bolted_run(uuid, integer[], bigint, integer) to anon, authenticated;

-- ─────────────────────────────────────────────────────────────────────────────
-- The start gate learns Bolted: one row in the registry
-- ─────────────────────────────────────────────────────────────────────────────

insert into public.game_runtimes (runtime, rules_version, max_actions, session_hours)
values ('bolted', public.bolted_rules_version(), public.bolted_max_actions(), 12)
on conflict (runtime, rules_version) do update
  set max_actions   = excluded.max_actions,
      session_hours = excluded.session_hours;
