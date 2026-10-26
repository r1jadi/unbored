-- Daily streaks, per game, for signed-in players.
--
-- A day counts when the player has at least one verified score in the game
-- that day, in their own time zone. Every day played adds one to the streak.
--
-- One missed day is forgiven — a rest day: the streak is still alive the day
-- after, and playing that day carries it on. Two missed days in a row end it.
-- So plays two days apart keep a streak; three days apart start a new one.
-- The rest day is not counted as a day played.
--
-- Read from `public.scores`, so only verified, signed-in runs count, exactly
-- like the boards. The caller only ever reads their own streak (`auth.uid()`).

create or replace function public.my_game_streak(
  p_game_slug text,
  p_time_zone text
)
returns table (
  streak         integer,
  last_played_on date,
  today          date
)
language plpgsql
stable
security invoker
set search_path = ''
as $$
declare
  v_zone     text := 'UTC';
  v_today    date;
  v_previous date;
  v_streak   integer := 0;
  v_day      date;
begin
  -- An unknown zone falls back to UTC rather than failing the read.
  if p_time_zone is not null
     and exists (select 1 from pg_catalog.pg_timezone_names z where z.name = p_time_zone) then
    v_zone := p_time_zone;
  end if;
  v_today := (now() at time zone v_zone)::date;

  for v_day in
    select distinct (s.created_at at time zone v_zone)::date as day
      from public.scores s
      join public.games g on g.id = s.game_id
     where g.slug = p_game_slug
       and s.user_id = auth.uid()
     order by day desc
  loop
    if v_previous is null then
      -- The newest day played: more than one missed day since then, and the
      -- streak is already gone.
      if v_today - v_day > 2 then
        exit;
      end if;
      v_streak := 1;
    elsif v_previous - v_day <= 2 then
      -- The next day, or the day after with one rest day between.
      v_streak := v_streak + 1;
    else
      exit;
    end if;
    v_previous := v_day;
  end loop;

  return query
    select v_streak,
           (select max((s.created_at at time zone v_zone)::date)
              from public.scores s
              join public.games g on g.id = s.game_id
             where g.slug = p_game_slug and s.user_id = auth.uid()),
           v_today;
end;
$$;

comment on function public.my_game_streak(text, text) is
  'The caller''s daily streak in one game, in their time zone: days played in a row, with one missed day forgiven.';

revoke all on function public.my_game_streak(text, text) from public;
grant execute on function public.my_game_streak(text, text) to authenticated;
