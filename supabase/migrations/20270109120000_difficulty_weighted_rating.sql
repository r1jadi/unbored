-- Harder games count for more on the all-games board.
--
-- The all-games rating (20261109120000_overall_leaderboard.sql) is the sum of a
-- player's per-game percentiles, so a top-10% Sudoku result and a top-10% One Move
-- result were worth the same 90. Now each game carries a difficulty tier, and its
-- percentile is weighted by it before the sum:
--
--   1 easy   × 1.00      2 medium × 1.25      3 hard × 1.50
--
-- The percentile itself is unchanged — it is still "the share of this game's
-- players you matched or beat" — so a game's own board is untouched; only how much
-- a game moves the all-games rating changes. A rating is now at most 150 per game.
-- The tiers are a judgement, set here per game and changed by a later migration
-- (or directly by staff with database access); a new game is medium until rated.
--
-- `overall_standing` stays the thin wrapper from
-- 20261223120100_standings_respect_opt_out.sql: the computation lives in
-- `overall_standing_unchecked`, which is what this migration replaces.

alter table public.games
  add column if not exists difficulty smallint not null default 2;

alter table public.games drop constraint if exists games_difficulty_range;
alter table public.games add constraint games_difficulty_range check (difficulty between 1 and 3);

comment on column public.games.difficulty is
  'How hard the game is to do well at: 1 easy, 2 medium, 3 hard. Weights the game''s percentile in the all-games rating (game_difficulty_weight).';

create or replace function public.game_difficulty_weight(p_difficulty smallint)
returns numeric
language sql
immutable
set search_path = ''
as $$
  select case p_difficulty when 1 then 1.00 when 3 then 1.50 else 1.25 end
$$;

comment on function public.game_difficulty_weight(smallint) is
  'What a game''s percentile counts for in the all-games rating: easy 1.00, medium 1.25, hard 1.50.';

-- The tiers. Hard: deep puzzles, long solves and games with a way to lose a good
-- run (Cascade's bombs, Minefield's mines). Easy: one-rule arcade and guessing
-- games where a high percentile is quick to reach.
update public.games set difficulty = 3 where slug in (
  'sudoku', 'sumdoku', 'checkmate', 'minefield', 'crossword', 'deep-cut',
  'pixelock', 'cascade', 'huedini', 'updraft'
);
update public.games set difficulty = 2 where slug in (
  'crowns', 'trail', '8-puzzle', 'sun-and-moon', 'mini-sudoku', 'decant', 'bolted',
  'fusebox', 'whittle', 'guesswork', 'foursort', 'honeycomb', '7-second',
  'dont-touch-the-black', 'flipside', 'scatter', 'gridburst', 'memory-flash',
  'then-and-now', 'ton-up'
);
update public.games set difficulty = 1 where slug in (
  'stack-10', 'dont-break-the-chain', 'one-move', 'color-merge', 'ballpark',
  'only-once', 'tee-time'
);

-- ─────────────────────────────────────────────────────────────────────────────
-- The rating, weighted
-- ─────────────────────────────────────────────────────────────────────────────

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
    select s.user_id, s.game_id, s.score, g.difficulty
      from public.scores s
      join public.games g on g.id = s.game_id and g.status = 'published'
     where (p_since is null or s.created_at >= p_since)
       and not exists (
         select 1 from public.user_preferences up
          where up.user_id = s.user_id and not up.show_on_leaderboards
       )
  ),
  best as (
    select w.user_id, w.game_id, w.difficulty, max(w.score) as score
      from windowed w
     group by w.user_id, w.game_id, w.difficulty
  ),
  percentiles as (
    select b.user_id,
           round(100 * cume_dist() over (partition by b.game_id order by b.score))
             * public.game_difficulty_weight(b.difficulty) as points
      from best b
  ),
  totals as (
    select pc.user_id, round(sum(pc.points))::bigint as rating, count(*)::bigint as games
      from percentiles pc
     group by pc.user_id
    having count(*) >= 3
  )
  select
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
  'The all-games ranking: the sum of each player''s per-game percentiles, each weighted by the game''s difficulty (game_difficulty_weight), for players rated in at least three published games, without players who opted out of leaderboards.';

create or replace function public.overall_standing_unchecked(
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
    select s.user_id, s.game_id, s.score, g.difficulty
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
    select w.user_id, w.game_id, w.difficulty, max(w.score) as score
      from windowed w
     group by w.user_id, w.game_id, w.difficulty
  ),
  percentiles as (
    select b.user_id,
           round(100 * cume_dist() over (partition by b.game_id order by b.score))
             * public.game_difficulty_weight(b.difficulty) as points
      from best b
  ),
  totals as (
    select pc.user_id, round(sum(pc.points))::bigint as rating, count(*)::bigint as games
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

comment on function public.overall_standing_unchecked(uuid, timestamptz) is
  'One player''s difficulty-weighted all-games rating and rated-game count, with a rank once they are rated in at least three games. Behind the overall_standing wrapper.';

revoke all on function public.overall_standing_unchecked(uuid, timestamptz)
  from public, anon, authenticated;
