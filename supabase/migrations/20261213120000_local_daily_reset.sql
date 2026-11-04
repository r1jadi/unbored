-- Daily games reset at midnight where the player is, not at midnight UTC.
--
-- 7 Second and the crossword were one shared day: midnight UTC is 7 PM in New York
-- and 9 AM in Tokyo. Now the client sends its time zone with a new session, and the
-- day comes from the player's own date. Everyone on the same date still gets the same
-- puzzle, so a puzzle reaches the world over about a day, starting at the date line.
--
-- This is decided only when a session starts. Each session already carries its seed,
-- and the verifiers and the one-ranked-run rule work from that, so none of them change.
--
-- The zone comes from the client, so what it can do is limited here to real offsets,
-- -12 to +14. A false zone reaches at most the next date's puzzle early, which is one
-- ranked run per puzzle as ever, and guests can already practise a puzzle unranked.
-- An unusable zone falls back to UTC.
--
-- Apply before deploying the client. The old three-argument function stays and means
-- UTC, so a service that hasn't been redeployed keeps working.

create or replace function public.player_local_day(p_time_zone text)
returns bigint
language plpgsql
stable
set search_path = ''
as $$
declare
  v_zone text := 'UTC';
begin
  -- Shaped like a zone name, ruling out the POSIX forms Postgres would also accept,
  -- such as 'abc-500'. Not checked against pg_timezone_names, which reads every zone
  -- file on disk and is too slow for starting a game.
  if p_time_zone ~ '^[A-Za-z][A-Za-z0-9_]*(/[A-Za-z0-9_+-]+){0,2}$'
     and char_length(p_time_zone) <= 64 then
    begin
      if (now() at time zone p_time_zone) - (now() at time zone 'UTC')
         between interval '-12 hours' and interval '14 hours' then
        v_zone := p_time_zone;
      end if;
    exception when invalid_parameter_value then
      v_zone := 'UTC';
    end;
  end if;
  return ((now() at time zone v_zone)::date - date '1970-01-01')::bigint;
end;
$$;

comment on function public.player_local_day(text) is
  'Days since 1970-01-01 on the player''s own date. An unusable time zone counts as UTC.';

revoke all on function public.player_local_day(text) from public, anon, authenticated;

create or replace function public.start_game_session(
  p_game_slug     text,
  p_rules_version text,
  p_client        text,
  p_time_zone     text
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
  v_seed    bigint;
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

  -- The daily games' seed is the player's day: the crossword's is the day number,
  -- and 7 Second's is that number hashed exactly as `seven_second_seed` hashes it.
  if v_game.runtime = 'crossword' then
    v_seed := public.player_local_day(p_time_zone);
  elsif v_game.runtime = 'seven-second' then
    v_seed := public.player_local_day(p_time_zone) * 2654435761 + 7;
  end if;

  if v_seed is not null and v_user is not null then
    perform pg_advisory_xact_lock(
      hashtextextended(v_game.id::text || ':' || v_user::text, 0)
    );

    if exists (
      select 1
        from public.game_sessions s
       where s.game_id = v_game.id
         and s.user_id = v_user
         and s.completed_at is not null
         and s.seed = v_seed
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

  if v_seed is not null then
    insert into public.game_sessions (game_id, user_id, client, rules_version, seed)
    values (v_game.id, v_user, v_client, p_rules_version, v_seed)
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

comment on function public.start_game_session(text, text, text, text) is
  'Issues a play session with a server-chosen seed. The caller identity is the verified token, never an argument. A daily game''s seed follows the player''s own date.';

revoke all on function public.start_game_session(text, text, text, text) from public;
grant execute on function public.start_game_session(text, text, text, text) to anon, authenticated;

-- A client or service from before this migration: no zone, so the UTC day it always had.
create or replace function public.start_game_session(
  p_game_slug     text,
  p_rules_version text,
  p_client        text
)
returns public.session_start
language sql
security invoker
set search_path = ''
as $$
  select public.start_game_session(p_game_slug, p_rules_version, p_client, null::text);
$$;

-- The rules players read, which promised UTC.
update public.games
   set instructions = replace(instructions, 'the same deck each UTC day', 'the same deck each day')
 where runtime = 'seven-second' and instructions like '%each UTC day%';

update public.games
   set instructions = replace(instructions, 'arrives at midnight UTC', 'arrives at midnight, your time')
 where runtime = 'crossword' and instructions like '%midnight UTC%';
