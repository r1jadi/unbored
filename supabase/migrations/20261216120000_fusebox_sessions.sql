-- Fusebox (`fusebox@1`): the chain-reaction grid, verified by the database.
--
-- A 6×6 grid of cells holding charge. A tap spends a spark and adds one charge; a
-- cell at four charge pops, empties and fires a bolt each way, and a bolt adds one
-- charge to the first charged cell within three cells of it. Chains run in waves,
-- each pop worth its wave's number. Long chains pay sparks back, a board left with
-- four charged cells or fewer is cleared for three more, and the run ends at no
-- sparks. Surge cells (from board 3) fire diagonally too; a shielded cell (from
-- board 5) loses its shield to the first hit, and gains no charge from that one.
--
-- This migration adds the rules, the deal, the replay, the verifier
-- (`complete_fusebox_run`), the (`fusebox`, `fusebox@1`) row in
-- `public.game_runtimes`, and the rules version in `public.run_resumable`. Nothing
-- a user can see changes: `20261216120100_fusebox_playable.sql` flips the catalogue
-- and lands last. Mirrored by src/lib/games/fusebox.ts; the lines in
-- tests/security/verifier_vectors.sql pin the two together. See docs/games/README.md.

-- ─────────────────────────────────────────────────────────────────────────────
-- The rules, as constants the database owns
-- ─────────────────────────────────────────────────────────────────────────────

create or replace function public.fusebox_rules_version()
returns text language sql immutable set search_path = '' as $$ select 'fusebox@1'::text $$;

create or replace function public.fusebox_max_actions()
returns integer language sql immutable set search_path = '' as $$ select 4096 $$;

comment on function public.fusebox_rules_version() is
  'The Fusebox rules version new runs pin: fusebox@1.';
comment on function public.fusebox_max_actions() is
  'The most taps a Fusebox submission may carry. A request bound, not a last board.';

-- The sparks a chain of p_pops pays back on a board: +1, +2 and +3 from 4, 7 and 11
-- pops, each asking for more every second board.
create or replace function public.fusebox_refund(p_pops integer, p_level integer)
returns integer
language plpgsql
immutable
set search_path = ''
as $$
declare
  v_steps integer := (p_level - 1) / 2;
begin
  if p_pops >= 11 + 2 * v_steps then
    return 3;
  elsif p_pops >= 7 + 2 * v_steps then
    return 2;
  elsif p_pops >= 4 + v_steps then
    return 1;
  end if;
  return 0;
end;
$$;

comment on function public.fusebox_refund(integer, integer) is
  'The sparks a Fusebox chain of this many pops pays back on this board. Mirrored by refundFor in src/lib/games/fusebox.ts.';

revoke all on function public.fusebox_refund(integer, integer) from public;

-- ─────────────────────────────────────────────────────────────────────────────
-- The deal
-- ─────────────────────────────────────────────────────────────────────────────
--
-- The seed reduced mod 2³² and mixed with 0xC2B2AE35 (2654435769 if that is 0), an
-- outer LCG advanced once per level, and an inner LCG from that state whose draws
-- are the state's top sixteen bits. Each cell draws its charge: weights 30, 30 and
-- 35 for 0, 1 and 2, and 18 − level for 3, never under 6. Then each surge cell and
-- each shielded cell draws a start cell, and the first charged plain cell from
-- there (wrapping) takes that kind. A cell is written charge + 4 × kind, with kind
-- 0 plain, 1 surge, 2 shielded. Internals, not API surface.
create or replace function public.fusebox_board(p_seed bigint, p_level integer)
returns integer[]
language plpgsql
immutable
set search_path = ''
as $$
declare
  v_state   bigint;
  v_current integer;
  v_hot     integer;
  v_total   integer;
  v_draw    integer;
  v_charges integer[] := array_fill(0, array[36]);
  v_kinds   integer[] := array_fill(0, array[36]);
  v_surges  integer;
  v_shields integer;
  v_kind    integer;
  v_start   integer;
  v_probe   integer;
  v_cell    integer;
  v_i       integer;
begin
  if p_seed is null then
    raise exception 'a seed is required' using errcode = '22023';
  end if;
  if p_level is null or p_level < 1 or p_level > 8192 then
    raise exception 'fusebox level is outside the reachable run' using errcode = '22023';
  end if;

  v_state := ((p_seed % 4294967296 + 4294967296) % 4294967296) # 3266489909;
  if v_state = 0 then
    v_state := 2654435769;
  end if;
  for v_current in 1..p_level loop
    v_state := (v_state * 1664525 + 1013904223) % 4294967296;
  end loop;

  v_hot := greatest(6, 18 - p_level);
  v_total := 30 + 30 + 35 + v_hot;
  for v_i in 1..36 loop
    v_state := (v_state * 22695477 + 1) % 4294967296;
    v_draw := ((v_state >> 16) % v_total)::integer;
    v_charges[v_i] := case when v_draw < 30 then 0
                           when v_draw < 60 then 1
                           when v_draw < 95 then 2
                           else 3 end;
  end loop;

  v_surges := case when p_level < 3 then 0 else least(3, 1 + (p_level - 3) / 4) end;
  v_shields := case when p_level < 5 then 0 else least(6, 1 + (p_level - 5) / 2) end;
  for v_i in 1..v_surges + v_shields loop
    v_kind := case when v_i <= v_surges then 1 else 2 end;
    v_state := (v_state * 22695477 + 1) % 4294967296;
    v_start := ((v_state >> 16) % 36)::integer;
    for v_probe in 0..35 loop
      v_cell := (v_start + v_probe) % 36 + 1;
      if v_charges[v_cell] > 0 and v_kinds[v_cell] = 0 then
        v_kinds[v_cell] := v_kind;
        exit;
      end if;
    end loop;
  end loop;

  for v_i in 1..36 loop
    v_charges[v_i] := v_charges[v_i] + 4 * v_kinds[v_i];
  end loop;
  return v_charges;
end;
$$;

comment on function public.fusebox_board(bigint, integer) is
  'The cells a Fusebox level is dealt, row by row, each charge + 4 × kind. Mirrored by src/lib/games/fusebox.ts.';

revoke all on function public.fusebox_board(bigint, integer) from public;

-- ─────────────────────────────────────────────────────────────────────────────
-- The replay
-- ─────────────────────────────────────────────────────────────────────────────
--
-- Every tap, from the seed. `valid` is false when a tap is off the board or comes
-- after the sparks ran out. Any prefix of a legal line is valid, because the player
-- may stop at any time and the score only grows.
create or replace function public.fusebox_replay(
  p_seed    bigint,
  p_actions integer[],
  out valid   boolean,
  out cells   integer[],
  out level   integer,
  out sparks  integer,
  out score   bigint,
  out boards  integer,
  out pops    integer
)
language plpgsql
immutable
set search_path = ''
as $$
declare
  v_charge  integer[] := array_fill(0, array[36]);
  v_kind    integer[] := array_fill(0, array[36]);
  v_dealt   integer[];
  v_hits    integer[];
  v_fired   integer[];
  v_surged  boolean[];
  v_rows    constant integer[] := array[-1, -1, 0, 1, 1, 1, 0, -1];
  v_cols    constant integer[] := array[0, 1, 1, 1, 0, -1, -1, -1];
  v_action  integer;
  v_i       integer;
  v_f       integer;
  v_way     integer;
  v_step    integer;
  v_at      integer;
  v_row     integer;
  v_col     integer;
  v_r       integer;
  v_c       integer;
  v_to      integer;
  v_wave    integer;
  v_popped  integer;
  v_count   integer;
begin
  valid := true;
  level := 1;
  sparks := 10;
  score := 0;
  boards := 0;
  pops := 0;

  v_dealt := public.fusebox_board(p_seed, level);
  for v_i in 1..36 loop
    v_charge[v_i] := v_dealt[v_i] % 4;
    v_kind[v_i] := v_dealt[v_i] / 4;
  end loop;

  foreach v_action in array coalesce(p_actions, array[]::integer[]) loop
    if v_action < 0 or v_action > 35 or sparks <= 0 then
      valid := false;
      exit;
    end if;

    -- The tap. A shield takes it; anything else gains a charge.
    if v_kind[v_action + 1] = 2 then
      v_kind[v_action + 1] := 0;
    else
      v_charge[v_action + 1] := v_charge[v_action + 1] + 1;
    end if;

    v_wave := 0;
    v_popped := 0;
    loop
      -- A wave: every cell at four or more pops and empties, then every bolt flies.
      v_fired := array[]::integer[];
      v_surged := array[]::boolean[];
      for v_i in 1..36 loop
        if v_charge[v_i] >= 4 then
          v_fired := v_fired || v_i;
          v_surged := v_surged || (v_kind[v_i] = 1);
        end if;
      end loop;
      exit when coalesce(array_length(v_fired, 1), 0) = 0;

      foreach v_i in array v_fired loop
        v_charge[v_i] := 0;
        v_kind[v_i] := 0;
      end loop;

      v_hits := array_fill(0, array[36]);
      for v_f in 1..array_length(v_fired, 1) loop
        v_at := v_fired[v_f] - 1;
        v_row := v_at / 6;
        v_col := v_at % 6;
        for v_way in 1..8 loop
          -- The diagonals are the even entries: only a surge cell fires those.
          continue when v_way % 2 = 0 and not v_surged[v_f];
          for v_step in 1..3 loop
            v_r := v_row + v_rows[v_way] * v_step;
            v_c := v_col + v_cols[v_way] * v_step;
            exit when v_r < 0 or v_r > 5 or v_c < 0 or v_c > 5;
            v_to := v_r * 6 + v_c + 1;
            if v_charge[v_to] > 0 then
              v_hits[v_to] := v_hits[v_to] + 1;
              exit;
            end if;
          end loop;
        end loop;
      end loop;

      for v_i in 1..36 loop
        if v_hits[v_i] > 0 then
          if v_kind[v_i] = 2 then
            v_kind[v_i] := 0;
            v_charge[v_i] := v_charge[v_i] + v_hits[v_i] - 1;
          else
            v_charge[v_i] := v_charge[v_i] + v_hits[v_i];
          end if;
        end if;
      end loop;

      v_wave := v_wave + 1;
      v_count := array_length(v_fired, 1);
      v_popped := v_popped + v_count;
      score := score + v_count * v_wave;
    end loop;

    pops := pops + v_popped;
    sparks := sparks - 1 + public.fusebox_refund(v_popped, level);

    v_count := 0;
    for v_i in 1..36 loop
      if v_charge[v_i] > 0 then
        v_count := v_count + 1;
      end if;
    end loop;

    if v_count <= 4 then
      sparks := sparks + 3;
      boards := boards + 1;
      level := level + 1;
      v_dealt := public.fusebox_board(p_seed, level);
      for v_i in 1..36 loop
        v_charge[v_i] := v_dealt[v_i] % 4;
        v_kind[v_i] := v_dealt[v_i] / 4;
      end loop;
    end if;
  end loop;

  cells := array_fill(0, array[36]);
  for v_i in 1..36 loop
    cells[v_i] := v_charge[v_i] + 4 * v_kind[v_i];
  end loop;
end;
$$;

comment on function public.fusebox_replay(bigint, integer[]) is
  'Replays Fusebox taps from a seed: the board, sparks, score, boards cleared and pops they reach, and whether every tap was legal. Mirrored by replay in src/lib/games/fusebox.ts.';

revoke all on function public.fusebox_replay(bigint, integer[]) from public;

-- ─────────────────────────────────────────────────────────────────────────────
-- Complete a run
-- ─────────────────────────────────────────────────────────────────────────────

create or replace function public.complete_fusebox_run(
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
    raise exception 'actions must be a dense array of taps' using errcode = '22023';
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

  if v_session.rules_version is distinct from public.fusebox_rules_version() then
    v_result.outcome := 'wrong_rules';
    v_result.session_id := v_session.id;
    v_result.game_slug := v_game.slug;
    return v_result;
  end if;

  if coalesce(array_length(p_actions, 1), 0) > public.fusebox_max_actions() then
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

  select * into v_replay from public.fusebox_replay(v_session.seed, p_actions);

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
  v_result.tiles_placed    := v_replay.pops;
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

comment on function public.complete_fusebox_run(uuid, integer[], bigint, integer) is
  'Replays a submitted Fusebox run from its session seed, derives the score and records it. A tap off the board or after the sparks ran out is invalid_actions. Any prefix of a legal line is valid. The claim is compared, never trusted.';

revoke all on function public.complete_fusebox_run(uuid, integer[], bigint, integer) from public;
grant execute on function public.complete_fusebox_run(uuid, integer[], bigint, integer) to anon, authenticated;

-- ─────────────────────────────────────────────────────────────────────────────
-- The start gate and saved runs learn Fusebox
-- ─────────────────────────────────────────────────────────────────────────────

insert into public.game_runtimes (runtime, rules_version, max_actions, session_hours)
values ('fusebox', public.fusebox_rules_version(), public.fusebox_max_actions(), 12)
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
    'stack-10@2', 'chain@2', 'memory-flash@2', 'one-move@2', 'color-merge@2', 'queens@1',
    'gridburst@1',
    'zip@2', 'eight-puzzle@2', 'tango@2', 'sudoku@3', 'mini-sudoku@1', 'decant@2',
    'bolted@1', 'huedini@1', 'scatter@1', 'cascade@1', 'checkmate@1', 'fusebox@1'
  ), false)
$$;
