-- Cascade with bombs (`cascade@2`).
--
-- From level 2 a bomb drops onto the top row every few swaps: an ordinary tile of
-- its kind carrying a countdown. Once a swap's cascade has settled every countdown
-- goes down by one, and one that reaches zero ends the run, scored as it stands.
-- A bomb cleared in a line or caught in a blast is defused, for 5 points (50 on
-- screen) on top of its tile. Bombs fall with their tiles, survive a fresh deal
-- where they stand, and are placed by the run's own generator, so the replay puts
-- each one exactly where the client did.
--
--   bomb_every(level) = greatest(3, 8 − level)   swaps between drops
--   bomb_timer(level) = greatest(5, 11 − level)  the countdown a bomb drops with
--   at most 3 bombs at once; the column is the next draw (state >> 16) mod 8,
--   moved right past a bomb already there.
--
-- `cascade@1` keeps its own resolve and replays exactly as before: a run started
-- under it, or saved under it, still verifies. New runs pin `cascade@2`.
--
-- Mirrored by src/lib/games/cascade.ts; the bomb lines in
-- src/lib/games/cascade.test.ts are the ones this verifier must reproduce.

create or replace function public.cascade_rules_version()
returns text language sql immutable set search_path = '' as $$ select 'cascade@2'::text $$;

comment on function public.cascade_rules_version() is
  'The Cascade rules version new runs pin: cascade@2, with bombs. complete_cascade_run still replays cascade@1.';

create or replace function public.cascade_bomb_every(p_level integer)
returns integer language sql immutable set search_path = '' as $$ select greatest(3, 8 - p_level) $$;

create or replace function public.cascade_bomb_timer(p_level integer)
returns integer language sql immutable set search_path = '' as $$ select greatest(5, 11 - p_level) $$;

comment on function public.cascade_bomb_every(integer) is
  'Swaps between one Cascade bomb and the next on a level (cascade@2): 6 on level 2, down to 3.';
comment on function public.cascade_bomb_timer(integer) is
  'The countdown a Cascade bomb drops with on a level (cascade@2): 9 on level 2, down to 5.';

-- The resolve of `cascade_resolve`, with each cell's bomb countdown carried along:
-- a cleared bomb is defused (and scores 5), a bomb falls with its tile, and a refill
-- has none. Everything else is the same rule, in the same order.
create or replace function public.cascade_resolve_bombs(
  inout p_board   integer[],
  inout p_timers  integer[],
  inout p_state   bigint,
  p_from          integer,
  p_to            integer,
  out   p_tiles   integer,
  out   p_points  bigint,
  out   p_defused integer
)
language plpgsql
immutable
set search_path = ''
as $$
declare
  v_wave     integer;
  v_start    integer[];
  v_length   integer[];
  v_across   boolean[];
  v_used     boolean[];
  v_lines    integer;
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
  v_defused  integer;
  v_write    integer;
  v_tile     integer;
  v_timer    integer;
begin
  p_tiles := 0;
  p_points := 0;
  p_defused := 0;
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
    v_defused := 0;
    for v_cell in 0..63 loop
      if v_clear[v_cell + 1] then
        v_count := v_count + 1;
        p_board[v_cell + 1] := 0;
        -- A bomb caught in the clear is defused.
        if p_timers[v_cell + 1] > 0 then
          v_defused := v_defused + 1;
        end if;
        p_timers[v_cell + 1] := 0;
      end if;
      if v_created[v_cell + 1] <> 0 then
        p_board[v_cell + 1] := v_created[v_cell + 1];
      end if;
    end loop;
    p_tiles := p_tiles + v_count;
    p_defused := p_defused + v_defused;
    p_points := p_points + v_count * v_wave + v_defused * 5;

    -- Gravity, then the refill. A bomb falls with its tile; a refill has none.
    for v_col in 0..7 loop
      v_write := 7;
      for v_row in reverse 7..0 loop
        v_tile := p_board[v_row * 8 + v_col + 1];
        continue when v_tile = 0;
        v_timer := p_timers[v_row * 8 + v_col + 1];
        p_board[v_row * 8 + v_col + 1] := 0;
        p_timers[v_row * 8 + v_col + 1] := 0;
        p_board[v_write * 8 + v_col + 1] := v_tile;
        p_timers[v_write * 8 + v_col + 1] := v_timer;
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

comment on function public.cascade_resolve_bombs(integer[], integer[], bigint, integer, integer) is
  'cascade_resolve with each cell''s bomb countdown carried along (cascade@2): cleared bombs are defused for 5 points, bombs fall with their tiles. Mirrored by src/lib/games/cascade.ts.';

revoke all on function public.cascade_bomb_every(integer) from public;
revoke all on function public.cascade_bomb_timer(integer) from public;
revoke all on function public.cascade_resolve_bombs(integer[], integer[], bigint, integer, integer) from public;

-- ─────────────────────────────────────────────────────────────────────────────
-- The verifier: cascade@1 as before, cascade@2 with bombs
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
  v_bombs    boolean;
  v_board    integer[];
  v_timers   integer[] := array_fill(0, array[64]);
  v_state    bigint;
  v_action   integer;
  v_a        integer;
  v_b        integer;
  v_swap     integer;
  v_tiles    integer;
  v_points   bigint;
  v_defused  integer;
  v_level    integer := 1;
  v_progress integer := 0;
  v_total    integer := 0;
  v_cleared  integer := 0;
  v_score    bigint := 0;
  v_since    integer := 0;
  v_live     integer;
  v_over     boolean := false;
  v_cell     integer;
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

  if v_session.rules_version is null
     or v_session.rules_version not in ('cascade@1', 'cascade@2') then
    v_result.outcome := 'wrong_rules';
    v_result.session_id := v_session.id;
    v_result.game_slug := v_game.slug;
    return v_result;
  end if;
  v_bombs := v_session.rules_version = 'cascade@2';

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
    -- Nothing follows a bomb going off, and a swap must line up three or more.
    if v_over or not public.cascade_swap_legal(v_board, v_action) then
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

    if v_bombs then
      v_swap := v_timers[v_a + 1];
      v_timers[v_a + 1] := v_timers[v_b + 1];
      v_timers[v_b + 1] := v_swap;
      select r.p_board, r.p_timers, r.p_state, r.p_tiles, r.p_points, r.p_defused
        into v_board, v_timers, v_state, v_tiles, v_points, v_defused
        from public.cascade_resolve_bombs(v_board, v_timers, v_state, v_a, v_b) r;
    else
      select r.p_board, r.p_state, r.p_tiles, r.p_points
        into v_board, v_state, v_tiles, v_points
        from public.cascade_resolve(v_board, v_state, v_a, v_b) r;
    end if;

    -- A board left with no swap is dealt afresh; its bombs stay where they stand.
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

    if v_bombs then
      -- Every countdown goes down by one; one that reaches zero ends the run.
      v_live := 0;
      for v_cell in 1..64 loop
        continue when v_timers[v_cell] = 0;
        v_timers[v_cell] := v_timers[v_cell] - 1;
        if v_timers[v_cell] = 0 then
          v_over := true;
        else
          v_live := v_live + 1;
        end if;
      end loop;

      -- From level 2, a bomb drops every few swaps while there is room for one.
      if not v_over and v_level >= 2 then
        v_since := v_since + 1;
        if v_since >= public.cascade_bomb_every(v_level) and v_live < 3 then
          v_state := (v_state * 22695477 + 1) % 4294967296;
          v_cell := ((v_state >> 16) % 8)::integer;
          while v_timers[v_cell + 1] > 0 loop
            v_cell := (v_cell + 1) % 8;
          end loop;
          v_timers[v_cell + 1] := public.cascade_bomb_timer(v_level);
          v_since := 0;
        end if;
      end if;
    end if;
  end loop;

  -- Cascade is untimed (cascade_budget_ms is a day), so this only refuses a run
  -- that sat open for longer than any real one.
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
  'Replays a submitted Cascade run from its session seed — every swap, the cascade it sets off and, under cascade@2, every bomb — derives the score, and records it. Any prefix of a legal line is valid; nothing may follow a bomb going off. The claim is compared, never trusted.';

revoke all on function public.complete_cascade_run(uuid, integer[], bigint, integer) from public;
grant execute on function public.complete_cascade_run(uuid, integer[], bigint, integer) to anon, authenticated;

-- ─────────────────────────────────────────────────────────────────────────────
-- Starting, saving and continuing cascade@2 runs
-- ─────────────────────────────────────────────────────────────────────────────

insert into public.game_runtimes (runtime, rules_version, max_actions, session_hours)
values ('cascade', 'cascade@2', public.cascade_max_actions(), 12)
on conflict (runtime, rules_version) do nothing;

-- The same list as 20261224120000_whittle_sessions.sql, plus cascade@2.
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
    'bolted@1', 'huedini@1', 'scatter@1', 'cascade@1', 'cascade@2', 'checkmate@1', 'fusebox@1',
    'minefield@1', 'sumdoku@1', 'whittle@1'
  ), false)
$$;

-- The catalogue copy: no clock any more (20261206120000_cascade_untimed.sql), and bombs.
update public.games
   set description  = 'The swap-and-match puzzle on an 8×8 board: line up three or more of a kind, clear them, and let the tiles above fall into chain reactions. Four in a line leave a line tile, five or an L leave a burst — and from level 2, bombs drop in with a countdown you have to beat.',
       instructions = 'Swap two neighbouring tiles to line up three or more of the same shape in a row or a column. They clear, the tiles above fall and new ones drop in; every wave of a cascade scores more than the one before. Four in a line leave a line tile that clears its whole row or column, five in a line or an L or T leave a burst that clears the 3×3 around it. Each level asks for more tiles cleared. From level 2, bombs drop in with a countdown that goes down by one every swap: match a bomb or catch it in a blast to defuse it for 50 points. If a countdown reaches 0, the run ends and your score so far is kept. There is no clock.'
 where slug = 'cascade';
