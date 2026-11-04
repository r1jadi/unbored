-- Ending a run no longer ends it for good.
--
-- Until now End run closed the session, so nothing was left to continue, and only
-- seven untimed games could be continued at all, and only if the player left without
-- pressing End run. Now:
--
--   * A run the player ends keeps its score, as it always has, and can be continued.
--     Its session closes, because a verified score belongs to a closed session, so
--     continuing issues a new session on the same seed with the same moves.
--   * A run the player lost is over, and can't be continued. That is what keeps a
--     loss meaning something on a board.
--   * The clock games can now be saved and continued too. Their verifiers time a run
--     from `started_at`, so continuing moves `started_at` forward by the time away and
--     the clock genuinely stops while the player is gone. The time played is measured
--     here from the last save, never taken from the client.
--
-- Not resumable, on purpose: Don't Touch the Black and Flutter are real-time, so
-- there is no moment to drop back into, and 7 Second and the crossword are one ranked
-- attempt a day.
--
-- A continued clock game gives a player time to think while the clock is stopped. It
-- is the cost of being able to stop at all. A score still has to be earned move by
-- move, and is still verified by replaying every move from the seed.
--
-- Apply before the client. Until then its calls fail harmlessly: End run still saves
-- the score, and there is just nothing to continue.

alter table public.game_sessions
  add column if not exists continuable boolean not null default false;

comment on column public.game_sessions.continuable is
  'The player ended this run themselves and can pick it up again. Cleared once they do.';

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
    'bolted@1', 'huedini@1', 'scatter@1', 'cascade@1', 'checkmate@1'
  ), false)
$$;

comment on function public.run_resumable(text) is
  'Whether a run under these rules can be saved and continued later. Real-time games and one-attempt-a-day games cannot.';

-- A run stays open for 30 days after its last save, so "later" means later.
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

  v_elapsed := (extract(epoch from (now() - v_session.started_at)) * 1000)::bigint;

  update public.game_sessions s
     set progress_actions   = p_actions,
         progress_played_ms = least(p_played_ms::bigint, v_elapsed, 86400000)::integer,
         progress_saved_at  = now(),
         expires_at         = greatest(s.expires_at, now() + interval '30 days')
   where s.id = v_session.id;

  return 'saved';
end;
$$;

revoke all on function public.save_run_progress(uuid, integer[], integer) from public, anon;
grant execute on function public.save_run_progress(uuid, integer[], integer) to authenticated;

-- Called just before an ended run is submitted, with the moves it ended on. Only the
-- client knows it was the player who ended it. A client that lied about a lost run
-- could continue it, but only as one that left out its losing move, and it could
-- already submit that run instead: the server replays every move either way.
create or replace function public.mark_run_continuable(
  p_session_id uuid,
  p_actions    integer[]
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user uuid := auth.uid();
  v_id   uuid;
begin
  if p_actions is null or array_position(p_actions, null) is not null
     or coalesce(array_length(p_actions, 1), 0) > 8192 then
    raise exception 'actions must be a dense array of at most 8192 moves' using errcode = '22023';
  end if;

  update public.game_sessions s
     set progress_actions  = p_actions,
         progress_saved_at = now(),
         continuable       = coalesce(array_length(p_actions, 1), 0) > 0
   where s.id = p_session_id
     and s.user_id = v_user
     and s.completed_at is null
     and s.abandoned_at is null
     and public.run_resumable(s.rules_version)
  returning s.id into v_id;

  return v_id is not null;
end;
$$;

comment on function public.mark_run_continuable(uuid, integer[]) is
  'Records that the player ended their own open run, and the moves it ended on, so it can be continued after it is scored.';

revoke all on function public.mark_run_continuable(uuid, integer[]) from public, anon;
grant execute on function public.mark_run_continuable(uuid, integer[]) to authenticated;

-- How long a run had been played when it was last saved: the server's own measure.
create or replace function public.run_played_ms(p_saved_at timestamptz, p_started_at timestamptz)
returns integer
language sql
stable
set search_path = ''
as $$
  select least(greatest(extract(epoch from (p_saved_at - p_started_at)) * 1000, 0), 2000000000)::integer
$$;

revoke all on function public.run_played_ms(timestamptz, timestamptz) from public, anon, authenticated;

-- The columns change, so the old function has to go first.
drop function if exists public.saved_run(text, text);

-- The run to offer: one left open, or the latest one the player ended, as long as they
-- haven't started anything newer in this game. A read: only `resume_run` changes anything.
create function public.saved_run(
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
  saved_at      timestamptz,
  -- The score is already on the board, so starting over needn't submit it again.
  already_scored boolean
)
language sql
stable
security definer
set search_path = ''
as $$
  select s.id, g.slug::text, s.rules_version, s.seed::text, s.started_at, s.expires_at,
         s.progress_actions,
         public.run_played_ms(s.progress_saved_at, s.started_at),
         s.progress_saved_at,
         s.completed_at is not null
    from public.game_sessions s
    join public.games g on g.id = s.game_id
   where s.user_id = auth.uid()
     and g.slug = p_game_slug
     and s.rules_version = p_rules_version
     and public.run_resumable(s.rules_version)
     and s.abandoned_at is null
     and coalesce(array_length(s.progress_actions, 1), 0) > 0
     and (
       (s.completed_at is null and s.expires_at > now())
       or (
         s.completed_at is not null
         and s.continuable
         and s.completed_at > now() - interval '30 days'
         and not exists (
           select 1 from public.game_sessions newer
            where newer.game_id = s.game_id
              and newer.user_id = s.user_id
              and newer.id <> s.id
              and newer.started_at > s.completed_at
         )
       )
     )
   order by s.completed_at is null desc, s.progress_saved_at desc
   limit 1
$$;

comment on function public.saved_run(text, text) is
  'The caller''s own run of one game to offer to continue, if there is one: left open, or ended by them.';

revoke all on function public.saved_run(text, text) from public, anon;
grant execute on function public.saved_run(text, text) to authenticated;

-- Continues a run: a left one in place, an ended one as a new session on the same seed
-- and moves. Either way the clock restarts where it stopped.
create or replace function public.resume_run(p_session_id uuid)
returns table (
  session_id    uuid,
  game_slug     text,
  rules_version text,
  seed          text,
  started_at    timestamptz,
  expires_at    timestamptz,
  played_ms     integer
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user    uuid := auth.uid();
  v_found   public.game_sessions;
  v_played  integer;
  v_id      uuid;
begin
  if v_user is null then
    return;
  end if;

  select * into v_found
    from public.game_sessions s
   where s.id = p_session_id
     and s.user_id = v_user
     and s.abandoned_at is null
     and public.run_resumable(s.rules_version)
     and coalesce(array_length(s.progress_actions, 1), 0) > 0
   for update;

  -- Somebody else's, missing, abandoned or lost: all the same answer, nothing.
  if not found then
    return;
  end if;

  v_played := public.run_played_ms(v_found.progress_saved_at, v_found.started_at);

  if v_found.completed_at is null then
    if v_found.expires_at <= now() then
      return;
    end if;
    update public.game_sessions s
       set started_at = now() - make_interval(secs => v_played / 1000.0),
           -- With the start. Time played is the gap between these two, and left behind
           -- it would read as none, handing a second resume a full clock.
           progress_saved_at = now(),
           expires_at = greatest(s.expires_at, now() + interval '30 days')
     where s.id = v_found.id;
    v_id := v_found.id;
  else
    if not v_found.continuable or v_found.completed_at <= now() - interval '30 days' then
      return;
    end if;
    -- One continuation per ending: a second tap can't make a second copy.
    update public.game_sessions s set continuable = false where s.id = v_found.id;
    update public.game_sessions s
       set abandoned_at = now()
     where s.game_id = v_found.game_id
       and s.user_id = v_user
       and s.completed_at is null
       and s.abandoned_at is null;
    insert into public.game_sessions (
      game_id, user_id, client, rules_version, seed, started_at, expires_at,
      progress_actions, progress_played_ms, progress_saved_at
    )
    values (
      v_found.game_id, v_user, v_found.client, v_found.rules_version, v_found.seed,
      now() - make_interval(secs => v_played / 1000.0), now() + interval '30 days',
      v_found.progress_actions, v_played, now()
    )
    returning id into v_id;
  end if;

  return query
    select s.id, g.slug::text, s.rules_version, s.seed::text, s.started_at, s.expires_at, v_played
      from public.game_sessions s
      join public.games g on g.id = s.game_id
     where s.id = v_id;
end;
$$;

comment on function public.resume_run(uuid) is
  'Continues the caller''s own saved or ended run, with its clock restarted where it stopped. Answers nothing for a run that can''t be continued.';

revoke all on function public.resume_run(uuid) from public, anon;
grant execute on function public.resume_run(uuid) to authenticated;
