-- The all-games board: one rating across every published game.
--
-- Scores cannot be added across games — a Stack 10 score and a Zip score are on
-- different scales — so each game's result is first turned into a percentile:
-- a player's best score in a game, against every other player's best in it, as
-- the share of players they matched or beat (`cume_dist`, 1–100). The best
-- player in a game gets 100; a game's only player gets 100 too, since nobody
-- beat them. The rating is the sum of a player's percentiles, so it rewards both
-- playing well and playing more games.
--
-- A player needs a percentile in at least three games to be ranked: one lucky
-- run in a quiet game is not "best across all games". A player below that still
-- has a standing (rating and game count, no rank), so the client can say how
-- many more games they need.
--
-- Everything is derived from recorded scores — only verified, signed-in runs are
-- in `public.scores` — and only from published games. `security invoker` keeps
-- Row Level Security in charge, exactly like `game_leaderboard`. The window
-- (`p_since`) applies before the percentiles, so a weekly board compares this
-- week's players with each other.

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
security invoker
set search_path = ''
as $$
  with windowed as (
    select s.user_id, s.game_id, s.score
      from public.scores s
      join public.games g on g.id = s.game_id and g.status = 'published'
     where p_since is null or s.created_at >= p_since
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
  'The all-games ranking: the sum of each player''s per-game percentiles, for players rated in at least three published games.';

revoke all on function public.overall_leaderboard(timestamptz, integer, integer) from public;
grant execute on function public.overall_leaderboard(timestamptz, integer, integer) to anon, authenticated;

-- One player's standing on the all-games board. `rank` is null while they have
-- fewer than three rated games: they have a rating, but no place on the board.
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
security invoker
set search_path = ''
as $$
  with windowed as (
    select s.user_id, s.game_id, s.score
      from public.scores s
      join public.games g on g.id = s.game_id and g.status = 'published'
     where p_since is null or s.created_at >= p_since
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
  'One player''s all-games rating and rated-game count, with a rank once they are rated in at least three games.';

revoke all on function public.overall_standing(uuid, timestamptz) from public;
grant execute on function public.overall_standing(uuid, timestamptz) to anon, authenticated;
