-- Saved progress for signed-in players: unfinished runs, and stats per game.
--
-- Two things a signed-in player keeps from now on:
--
--   1. **An unfinished run.** While a signed-in player plays, the client saves the
--      run's moves to its session (`save_run_progress`). Leaving the game —
--      closing the tab, switching device, going back to the feed — no longer
--      throws the run away: opening the game again finds it (`saved_run`) and
--      offers to continue it. Continuing replays the saved moves from the
--      session's seed, so the board, the score and the level are exactly where
--      they were. Starting a new run instead abandons it, as starting a run
--      always has (`start_game_session` closes the player's other open session
--      for that game).
--
--   2. **Stats per game** (`my_game_stats`): runs played, best score, total
--      points, rank and when the player last played, read from their verified
--      scores.
--
-- Nothing here changes how a score is decided. Saved moves are a convenience for
-- the player who made them, not a claim: the run is still verified only when it
-- is submitted, by replaying the submitted moves from the seed, and a saved run
-- that never comes back is never scored. A player can only save to, and read,
-- their own open session.
--
-- Only untimed games resume: Stack 10, Chain, Memory Flash, One Move, Color Merge
-- and Queens. Zip and 8 Puzzle run against a clock the server times from the
-- session's start, 7 Second is a seven-second daily round, and Don't Touch the
-- Black is a real-time conveyor — none of them can be paused and picked up later.

alter table public.game_sessions
  add column if not exists progress_actions   integer[],
  add column if not exists progress_played_ms integer,
  add column if not exists progress_saved_at  timestamptz;

comment on column public.game_sessions.progress_actions is
  'The moves of a signed-in player''s unfinished run, saved so it can be continued. Not a score: the run is verified only when it is submitted.';
comment on column public.game_sessions.progress_played_ms is
  'How long the unfinished run had been played when it was last saved, so a continued run keeps its duration.';
comment on column public.game_sessions.progress_saved_at is
  'When the unfinished run was last saved.';

-- ─────────────────────────────────────────────────────────────────────────────
-- Which rules can be saved and continued
-- ─────────────────────────────────────────────────────────────────────────────

create or replace function public.run_resumable(p_rules_version text)
returns boolean
language sql
immutable
set search_path = ''
as $$
  select coalesce(p_rules_version in (
    'stack-10@2', 'chain@2', 'memory-flash@2', 'one-move@2', 'color-merge@2', 'queens@1'
  ), false)
$$;

comment on function public.run_resumable(text) is
  'Whether a run under these rules can be saved and continued later: the untimed endless games. Timed and real-time games cannot pause.';

-- ─────────────────────────────────────────────────────────────────────────────
-- Save an unfinished run
-- ─────────────────────────────────────────────────────────────────────────────

create or replace function public.save_run_progress(
  p_session_id uuid,
  p_actions    integer[],
  p_played_ms  integer
)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user    uuid := auth.uid();
  v_session public.game_sessions;
  v_elapsed bigint;
begin
  if p_session_id is null then
    raise exception 'a session id is required' using errcode = '22023';
  end if;
  if p_actions is null or array_position(p_actions, null) is not null then
    raise exception 'actions must be a dense array of moves' using errcode = '22023';
  end if;
  if coalesce(array_length(p_actions, 1), 0) > 8192 then
    raise exception 'a saved run carries at most 8192 moves' using errcode = '22023';
  end if;
  if p_played_ms is null or p_played_ms < 0 then
    raise exception 'played time must be zero or more milliseconds' using errcode = '22023';
  end if;

  -- A guest has no account to keep a run on.
  if v_user is null then
    return 'not_found';
  end if;

  select * into v_session
    from public.game_sessions s
   where s.id = p_session_id and s.user_id = v_user
   for update;

  -- Somebody else's session and a missing one answer the same way.
  if not found then
    return 'not_found';
  end if;
  if v_session.completed_at is not null or v_session.abandoned_at is not null then
    return 'closed';
  end if;
  if now() >= v_session.expires_at then
    return 'expired';
  end if;
  if not public.run_resumable(v_session.rules_version) then
    return 'not_resumable';
  end if;

  -- The played time can never exceed the time the session has existed: a
  -- continued run's duration is checked against that same age when it is scored.
  v_elapsed := (extract(epoch from (now() - v_session.started_at)) * 1000)::bigint;

  update public.game_sessions s
     set progress_actions   = p_actions,
         progress_played_ms = least(p_played_ms::bigint, v_elapsed, 86400000)::integer,
         progress_saved_at  = now(),
         -- A saved run stays open for twelve hours after its last save, so a run
         -- left overnight can still be continued the next day.
         expires_at         = greatest(s.expires_at, now() + interval '12 hours')
   where s.id = v_session.id;

  return 'saved';
end;
$$;

comment on function public.save_run_progress(uuid, integer[], integer) is
  'Saves the moves of the caller''s own open, resumable run so it can be continued. Answers saved, not_found, closed, expired or not_resumable. Not a score.';

revoke all on function public.save_run_progress(uuid, integer[], integer) from public;
grant execute on function public.save_run_progress(uuid, integer[], integer) to authenticated;

-- ─────────────────────────────────────────────────────────────────────────────
-- Find the run to continue
-- ─────────────────────────────────────────────────────────────────────────────

create or replace function public.saved_run(
  p_game_slug     text,
  p_rules_version text
)
returns table (
  session_id    uuid,
  game_slug     text,
  rules_version text,
  -- Text, not a number: the seed is a bigint, and JSON numbers lose its low bits.
  seed          text,
  started_at    timestamptz,
  expires_at    timestamptz,
  actions       integer[],
  played_ms     integer,
  saved_at      timestamptz
)
language sql
stable
security definer
set search_path = ''
as $$
  select s.id, g.slug::text, s.rules_version, s.seed::text, s.started_at, s.expires_at,
         s.progress_actions, coalesce(s.progress_played_ms, 0), s.progress_saved_at
    from public.game_sessions s
    join public.games g on g.id = s.game_id
   where s.user_id = auth.uid()
     and g.slug = p_game_slug
     and s.rules_version = p_rules_version
     and public.run_resumable(s.rules_version)
     and s.completed_at is null
     and s.abandoned_at is null
     and s.expires_at > now()
     and coalesce(array_length(s.progress_actions, 1), 0) > 0
   order by s.progress_saved_at desc
   limit 1
$$;

comment on function public.saved_run(text, text) is
  'The caller''s own unfinished, saved run of one game under one rules version, if there is one to continue.';

revoke all on function public.saved_run(text, text) from public;
grant execute on function public.saved_run(text, text) to authenticated;

-- ─────────────────────────────────────────────────────────────────────────────
-- Stats per game
-- ─────────────────────────────────────────────────────────────────────────────

create or replace function public.my_game_stats(p_game_slug text)
returns table (
  runs           bigint,
  best_score     bigint,
  total_score    bigint,
  rank           bigint,
  last_played_at timestamptz
)
language sql
stable
security invoker
set search_path = ''
as $$
  select count(s.id),
         max(s.score),
         coalesce(sum(s.score), 0)::bigint,
         (select st.rank from public.game_standing(p_game_slug, auth.uid(), null) st),
         max(s.created_at)
    from public.scores s
    join public.games g on g.id = s.game_id
   where g.slug = p_game_slug
     and s.user_id = auth.uid()
$$;

comment on function public.my_game_stats(text) is
  'The caller''s own stats for one game, from their verified scores: runs played, best score, total points, rank and last played.';

revoke all on function public.my_game_stats(text) from public;
grant execute on function public.my_game_stats(text) to authenticated;
