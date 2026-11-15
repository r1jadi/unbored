-- The start gate learns Foursort and Pixelock: both are seeded by the player's day,
-- as the other daily games are, so everyone plays the same board and a signed-in
-- player gets one ranked play a day (`already_played`).
--
-- The same function as `20270104120400_daily_four_start.sql`, with the two
-- runtimes added to the day-seeded list. Their verifiers and registry rows are
-- `20270105120000_foursort_sessions.sql` and `20270105120100_pixelock_sessions.sql`.

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

  select * into v_runtime
    from public.game_runtimes r
   where r.runtime = v_game.runtime
     and r.rules_version = p_rules_version;

  if not found then
    v_empty.outcome := 'unsupported_runtime';
    return v_empty;
  end if;

  -- The daily games' seed is the player's day: the crossword's, Guesswork's, Deep
  -- Cut's, Ton Up's, Ballpark's, Only Once's, Tee Time's, Foursort's and Pixelock's
  -- is the day number, and
  -- 7 Second's is that number hashed exactly as
  -- `seven_second_seed` hashes it.
  if v_game.runtime in ('crossword', 'guesswork', 'deep-cut',
                        'ton-up', 'ballpark', 'only-once', 'tee-time',
                        'foursort', 'pixelock') then
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
  'Issues a play session with a server-chosen seed. The caller identity is the verified token, never an argument. A daily game''s seed (the crossword, Guesswork, Deep Cut, Ton Up, Ballpark, Only Once, Tee Time, Foursort, Pixelock, 7 Second) follows the player''s own date.';

revoke all on function public.start_game_session(text, text, text, text) from public;
grant execute on function public.start_game_session(text, text, text, text) to anon, authenticated;

