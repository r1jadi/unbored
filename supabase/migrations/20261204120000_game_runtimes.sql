-- The game runtime registry: the start gate reads a table, not a list.
--
-- Until now `public.start_game_session` carried every game in three places — the
-- (runtime, rules version) pairs it accepts, which versions get a twelve-hour
-- session, and each runtime's submission bound — so every new game meant copying
-- the whole function into its migration. A copy made before another game landed
-- silently dropped that game from the gate.
--
-- `public.game_runtimes` holds those three facts, one row per pair. The gate
-- looks the pair up; everything else about it is unchanged. A new game's
-- migration now adds its verifier and one row:
--
--   insert into public.game_runtimes (runtime, rules_version, max_actions, session_hours)
--   values ('my-game', public.my_game_rules_version(), public.my_game_max_actions(), 12);
--
-- The rows below are exactly the pairs, bounds and session lengths the gate
-- issued before this migration (`20261203120000_checkmate_sessions.sql`), so no
-- session starts differently. Safe to re-run.

create table if not exists public.game_runtimes (
  runtime       text    not null,
  rules_version text    not null,
  max_actions   integer not null check (max_actions > 0),
  session_hours integer not null check (session_hours in (2, 12)),
  primary key (runtime, rules_version),
  check (runtime ~ '^[a-z0-9-]{2,48}$'),
  check (rules_version ~ '^[a-z0-9-]{2,32}@[0-9]{1,4}$')
);

comment on table public.game_runtimes is
  'Every (runtime, rules version) pair start_game_session issues, with its submission bound (session_start.tile_count) and session length in hours: 12 for endless runs, 2 for finite and daily ones. A new game''s migration adds its row.';

-- Internal: only the gate reads it, as its owner.
alter table public.game_runtimes enable row level security;
revoke all on table public.game_runtimes from public, anon, authenticated;

insert into public.game_runtimes (runtime, rules_version, max_actions, session_hours) values
  -- The first games: a retired finite version, and the endless one new runs pin.
  ('stack-10', 'stack-10@1', public.stack10_tiles(), 2),
  ('stack-10', public.stack10_rules_version(), public.stack10_max_tiles(), 12),
  ('chain', 'chain@1', public.chain_taps(), 2),
  ('chain', public.chain_rules_version(), public.chain_max_actions(), 12),
  ('memory-flash', 'memory-flash@1', public.memory_flash_taps(), 2),
  ('memory-flash', public.memory_flash_rules_version(), public.memory_flash_max_taps(), 12),
  ('one-move', 'one-move@1', public.one_move_taps(), 2),
  ('one-move', public.one_move_rules_version(), public.one_move_max_taps(), 12),
  ('color-merge', 'color-merge@1', public.color_merge_slides(), 2),
  ('color-merge', public.color_merge_rules_version(), public.color_merge_max_slides(), 12),
  ('dont-touch', 'dont-touch@1', public.dont_touch_cells(), 2),
  ('dont-touch', public.dont_touch_rules_version(), public.dont_touch_max_cells(), 2),
  -- The daily games: the day is the seed, and a session lives two hours.
  ('seven-second', public.seven_second_rules_version(), public.seven_second_answers(), 2),
  ('crossword', public.crossword_rules_version(), public.crossword_max_actions(), 2),
  ('crossword', public.fjalekryqi_rules_version(), public.crossword_max_actions(), 2),
  -- The endless puzzles, some with the version from before the tapered clock.
  ('queens', public.queens_rules_version(), public.queens_max_actions(), 12),
  ('zip', 'zip@1', public.zip_max_actions(), 12),
  ('zip', public.zip_rules_version(), public.zip_max_actions(), 12),
  ('eight-puzzle', 'eight-puzzle@1', public.eight_puzzle_max_actions(), 12),
  ('eight-puzzle', public.eight_puzzle_rules_version(), public.eight_puzzle_max_actions(), 12),
  ('tango', 'tango@1', public.tango_max_actions(), 12),
  ('tango', public.tango_rules_version(), public.tango_max_actions(), 12),
  ('sudoku', 'sudoku@1', public.sudoku_max_actions(), 12),
  ('sudoku', 'sudoku@2', public.sudoku_max_actions(), 12),
  ('sudoku', public.sudoku_rules_version(), public.sudoku_max_actions(), 12),
  ('gridburst', public.gridburst_rules_version(), public.gridburst_max_moves(), 12),
  ('updraft', public.updraft_rules_version(), public.updraft_max_actions(), 2),
  ('decant', 'decant@1', public.decant_max_actions(), 12),
  ('decant', public.decant_rules_version(), public.decant_max_actions(), 12),
  ('mini-sudoku', public.mini_sudoku_rules_version(), public.mini_sudoku_max_actions(), 12),
  ('scatter', public.scatter_rules_version(), public.scatter_max_actions(), 12),
  ('huedini', public.huedini_rules_version(), public.huedini_max_actions(), 12),
  ('cascade', public.cascade_rules_version(), public.cascade_max_actions(), 12),
  ('checkmate', public.checkmate_rules_version(), public.checkmate_max_actions(), 12)
on conflict (runtime, rules_version) do update
  set max_actions   = excluded.max_actions,
      session_hours = excluded.session_hours;

-- ─────────────────────────────────────────────────────────────────────────────
-- The start gate, reading the registry
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
  v_runtime public.game_runtimes;
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
  -- implements, as public.game_runtimes lists them. Anything else is a version
  -- no verifier owns.
  select * into v_runtime
    from public.game_runtimes r
   where r.runtime = v_game.runtime
     and r.rules_version = p_rules_version;

  if not found then
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
    -- of the table's two; the registry says which.
    insert into public.game_sessions (game_id, user_id, client, rules_version, expires_at)
    values (v_game.id, v_user, v_client, p_rules_version,
            now() + make_interval(hours => v_runtime.session_hours))
    returning * into v_session;
  end if;

  v_empty.outcome       := 'started';
  v_empty.id            := v_session.id;
  v_empty.game_slug     := v_game.slug;
  v_empty.rules_version := v_session.rules_version;
  v_empty.seed          := v_session.seed;
  v_empty.tile_count    := v_runtime.max_actions;
  v_empty.started_at    := v_session.started_at;
  v_empty.expires_at    := v_session.expires_at;
  v_empty.ranked        := v_session.user_id is not null;
  return v_empty;
end;
$$;

comment on function public.start_game_session(text, text, text) is
  'Issues a play session with a server-chosen seed. The caller identity is the verified token, never an argument. A game starts only under a (runtime, rules version) pair public.game_runtimes lists, with that row''s submission bound and session length; 7 Second and the daily crossword (crossword@1, or fjalekryqi@1 in Albanian) also answer already_played once the signed-in player has finished today''s, in either language.';
