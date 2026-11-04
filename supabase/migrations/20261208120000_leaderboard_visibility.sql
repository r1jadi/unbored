-- "Show on leaderboards" takes effect.
--
-- `user_preferences.show_on_leaderboards` was stored but nothing read it. A player
-- who turns it off now leaves the boards entirely: they are not listed, and their
-- scores are removed before ranking, so nobody else's rank has a gap and the
-- all-games percentiles are computed as if they had not played. The scores
-- themselves are kept, and turning the choice back on restores the player.
--
-- A player's own standing still counts them, ranked against the players who are
-- listed, so they can see where they would place. The games service calls these
-- functions with an API key and verifies "me" itself, so the database cannot tell
-- who is asking and the standing functions do not try to: they answer for any id.
-- That gives away nothing new, because `public.scores` stays publicly readable.
--
-- These become `security definer` because `user_preferences` is owner-only, and a
-- public helper listing who opted out would publish that choice. Nothing else
-- widens: each function reads published games only, which is all RLS on `scores`
-- ever showed a visitor here.
--
-- Not covered: `game_stats.best_score` is an anonymous per-game maximum and still
-- counts every score. Each game's verifier also still computes `board_rank` against
-- all scores; the game-sessions service replaces it with `game_standing`'s rank
-- (through `my_game_stats`) before answering, so a player sees the board's number.
--
-- Safe in either order with the app deploy.

create or replace function public.game_leaderboard(
  p_game_slug text,
  p_since     timestamptz,
  p_limit     integer,
  p_offset    integer
)
returns table (
  rank        bigint,
  user_id     uuid,
  username    text,
  score       bigint,
  achieved_at timestamptz,
  plays       bigint
)
language sql
stable
security definer
set search_path = ''
as $$
  with selected_game as (
    select g.id from public.games g
     where g.slug = p_game_slug and g.status = 'published'
  ),
  windowed as (
    select s.user_id, s.score, s.created_at
      from public.scores s
      join selected_game sg on sg.id = s.game_id
     where (p_since is null or s.created_at >= p_since)
       and not exists (
         select 1 from public.user_preferences up
          where up.user_id = s.user_id and not up.show_on_leaderboards
       )
  ),
  best as (
    -- One row per player: their best score, and the first time they reached it.
    select distinct on (w.user_id) w.user_id, w.score, w.created_at as achieved_at
      from windowed w
     order by w.user_id, w.score desc, w.created_at asc
  ),
  played as (
    select w.user_id, count(*) as plays from windowed w group by w.user_id
  )
  select
    -- Ties share a rank, which is what "1st equal" should mean on a board.
    rank() over (order by b.score desc),
    b.user_id,
    p.username,
    b.score,
    b.achieved_at,
    played.plays
  from best b
  left join public.profiles p on p.id = b.user_id
  left join played on played.user_id = b.user_id
  order by b.score desc, b.achieved_at asc
  limit greatest(1, least(coalesce(p_limit, 25), 100))
  offset greatest(0, coalesce(p_offset, 0));
$$;

comment on function public.game_leaderboard(text, timestamptz, integer, integer) is
  'The public ranking for one published game: best score per player, real play counts, without players who opted out of leaderboards.';

create or replace function public.game_standing(
  p_game_slug text,
  p_user_id   uuid,
  p_since     timestamptz
)
returns table (
  rank        bigint,
  score       bigint,
  achieved_at timestamptz,
  plays       bigint
)
language sql
stable
security definer
set search_path = ''
as $$
  with selected_game as (
    select g.id from public.games g
     where g.slug = p_game_slug and g.status = 'published'
  ),
  windowed as (
    select s.user_id, s.score, s.created_at
      from public.scores s
      join selected_game sg on sg.id = s.game_id
     where (p_since is null or s.created_at >= p_since)
       and (
         s.user_id = p_user_id or not exists (
           select 1 from public.user_preferences up
            where up.user_id = s.user_id and not up.show_on_leaderboards
         )
       )
  ),
  best as (
    select distinct on (w.user_id) w.user_id, w.score, w.created_at as achieved_at
      from windowed w
     order by w.user_id, w.score desc, w.created_at asc
  ),
  ranked as (
    select rank() over (order by b.score desc) as rank, b.user_id, b.score, b.achieved_at
      from best b
  ),
  played as (
    select w.user_id, count(*) as plays from windowed w group by w.user_id
  )
  select r.rank, r.score, r.achieved_at, played.plays
    from ranked r
    join played on played.user_id = r.user_id
   where r.user_id = p_user_id;
$$;

comment on function public.game_standing(text, uuid, timestamptz) is
  'One player''s rank, best score and play count on one published game''s board, ranked against the players who are listed on it.';

create or replace function public.overall_leaderboard(
  p_since  timestamptz,
  p_limit  integer,
  p_offset integer
)
returns table (
  rank     bigint,
  user_id  uuid,
  username text,
  rating   bigint,
  games    bigint
)
language sql
stable
security definer
set search_path = ''
as $$
  with windowed as (
    select s.user_id, s.game_id, s.score
      from public.scores s
      join public.games g on g.id = s.game_id and g.status = 'published'
     where (p_since is null or s.created_at >= p_since)
       and not exists (
         select 1 from public.user_preferences up
          where up.user_id = s.user_id and not up.show_on_leaderboards
       )
  ),
  best as (
    select w.user_id, w.game_id, max(w.score) as score
      from windowed w
     group by w.user_id, w.game_id
  ),
  percentiles as (
    select b.user_id,
           round(100 * cume_dist() over (partition by b.game_id order by b.score))::bigint as pct
      from best b
  ),
  totals as (
    select pc.user_id, sum(pc.pct)::bigint as rating, count(*)::bigint as games
      from percentiles pc
     group by pc.user_id
    having count(*) >= 3
  )
  select
    -- Ties share a rank, as on every other board.
    rank() over (order by t.rating desc),
    t.user_id,
    p.username,
    t.rating,
    t.games
  from totals t
  left join public.profiles p on p.id = t.user_id
  order by t.rating desc, t.games desc, p.username asc
  limit greatest(1, least(coalesce(p_limit, 25), 100))
  offset greatest(0, coalesce(p_offset, 0));
$$;

comment on function public.overall_leaderboard(timestamptz, integer, integer) is
  'The all-games ranking: the sum of each player''s per-game percentiles, for players rated in at least three published games, without players who opted out of leaderboards.';

create or replace function public.overall_standing(
  p_user_id uuid,
  p_since   timestamptz
)
returns table (
  rank   bigint,
  rating bigint,
  games  bigint
)
language sql
stable
security definer
set search_path = ''
as $$
  with windowed as (
    select s.user_id, s.game_id, s.score
      from public.scores s
      join public.games g on g.id = s.game_id and g.status = 'published'
     where (p_since is null or s.created_at >= p_since)
       and (
         s.user_id = p_user_id or not exists (
           select 1 from public.user_preferences up
            where up.user_id = s.user_id and not up.show_on_leaderboards
         )
       )
  ),
  best as (
    select w.user_id, w.game_id, max(w.score) as score
      from windowed w
     group by w.user_id, w.game_id
  ),
  percentiles as (
    select b.user_id,
           round(100 * cume_dist() over (partition by b.game_id order by b.score))::bigint as pct
      from best b
  ),
  totals as (
    select pc.user_id, sum(pc.pct)::bigint as rating, count(*)::bigint as games
      from percentiles pc
     group by pc.user_id
  ),
  ranked as (
    select rank() over (order by t.rating desc) as rank, t.user_id
      from totals t
     where t.games >= 3
  )
  select r.rank, t.rating, t.games
    from totals t
    left join ranked r on r.user_id = t.user_id
   where t.user_id = p_user_id;
$$;

comment on function public.overall_standing(uuid, timestamptz) is
  'One player''s all-games rating and rated-game count, with a rank once they are rated in at least three games, against the players who are listed.';
