-- Achievements and Trending: two readings of the scores already recorded.
--
-- Neither needs a table of its own. A score exists only once the database has replayed
-- the run, so counting scores can't be gamed the way a client-awarded badge could, and
-- every player's past runs count from the moment this is applied.
--
-- Apply before the client: the profile's Achievements tab and the Trending page call
-- these functions.

-- ── Achievements ────────────────────────────────────────────────────────────────

-- The counters the app turns into achievements. It keeps the same promises as the
-- profile showcase: a suspended account, an owner who blocked this viewer, or a player
-- who hides their scores answers `visible: false`, in the same shape for each, so it
-- doesn't tell a blocked viewer they were blocked.
create or replace function public.profile_achievements(p_user_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_viewer    uuid := auth.uid();
  v_is_owner  boolean := v_viewer is not null and v_viewer = p_user_id;
  v_available boolean;
  v_scores    boolean;
  v_runs      bigint;
  v_games     bigint;
  v_days      bigint;
  v_streak    bigint;
  v_first     bigint;
  v_followers bigint;
begin
  select not p.is_suspended into v_available
    from public.profiles p
   where p.id = p_user_id;

  select coalesce(max(up.show_profile_scores::int), 1) = 1 into v_scores
    from public.user_preferences up
   where up.user_id = p_user_id;

  if v_available is not true
     or not (v_scores or v_is_owner)
     or (
       not v_is_owner and exists (
         select 1 from public.blocked_users b
          where b.blocker_id = p_user_id and b.blocked_id = v_viewer
       )
     ) then
    return jsonb_build_object('visible', false);
  end if;

  select count(*), count(distinct s.game_id), count(distinct (s.created_at at time zone 'UTC')::date)
    into v_runs, v_games, v_days
    from public.scores s
    join public.games g on g.id = s.game_id and g.status = 'published'
   where s.user_id = p_user_id;

  -- The longest run of consecutive UTC days with a verified score: consecutive dates
  -- share one value of (date - position), so each run of days is one group.
  select coalesce(max(t.len), 0) into v_streak
    from (
      select count(*) as len
        from (
          select d.day, d.day - (row_number() over (order by d.day))::integer as grp
            from (
              select distinct (s.created_at at time zone 'UTC')::date as day
                from public.scores s
                join public.games g on g.id = s.game_id and g.status = 'published'
               where s.user_id = p_user_id
            ) d
        ) x
       group by x.grp
    ) t;

  -- Games where this player holds the top score right now, ties to the earlier run.
  select count(*) into v_first
    from (
      select distinct s.game_id
        from public.scores s
        join public.games g on g.id = s.game_id and g.status = 'published'
       where s.user_id = p_user_id
    ) mine
   where (
     select top.user_id
       from public.scores top
      where top.game_id = mine.game_id
      order by top.score desc, top.created_at asc
      limit 1
   ) = p_user_id;

  select count(*) into v_followers
    from public.follows f
   where f.followee_id = p_user_id;

  return jsonb_build_object(
    'visible', true,
    'runs', v_runs,
    'games', v_games,
    'days', v_days,
    'longest_streak', v_streak,
    'first_places', v_first,
    'followers', v_followers
  );
end;
$$;

revoke all on function public.profile_achievements(uuid) from public, anon, authenticated;
grant execute on function public.profile_achievements(uuid) to anon, authenticated;

comment on function public.profile_achievements(uuid) is
  'Counters behind a profile''s achievements, read from verified scores. Follows the same visibility rules as profile_showcase.';

-- ── Trending ────────────────────────────────────────────────────────────────────

create index if not exists scores_created_idx on public.scores (created_at desc, game_id);

-- A trend is a change over time, so this compares the last seven days with the seven
-- before them. Runs this week count, and growth on last week counts again, so a game
-- taking off can pass a bigger one that is standing still. A game nobody played this
-- week isn't trending, however popular it once was. Only totals leave this function.
create or replace function public.trending_games(p_limit integer default 20)
returns table (slug text, recent_runs bigint, previous_runs bigint)
language sql
stable
security definer
set search_path = ''
as $$
  select t.slug, t.recent_runs, t.previous_runs
    from (
      select
        g.slug::text as slug,
        count(*) filter (where s.created_at >= now() - interval '7 days') as recent_runs,
        count(*) filter (where s.created_at < now() - interval '7 days') as previous_runs
        from public.scores s
        join public.games g on g.id = s.game_id and g.status = 'published'
       where s.created_at >= now() - interval '14 days'
       group by g.slug
    ) t
   where t.recent_runs > 0
   order by t.recent_runs + greatest(t.recent_runs - t.previous_runs, 0) desc, t.slug
   limit greatest(1, least(coalesce(p_limit, 20), 50));
$$;

revoke all on function public.trending_games(integer) from public, anon, authenticated;
grant execute on function public.trending_games(integer) to anon, authenticated;

comment on function public.trending_games(integer) is
  'Published games ranked by verified runs over the last seven days and their growth on the seven before. Aggregates only.';
