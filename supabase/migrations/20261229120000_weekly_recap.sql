-- The weekly recap: one email per opted-in player about their own week. Games
-- played, the game they played most, new personal bests, friends who passed them,
-- and their streak. It is for bringing a player back, so a quiet week is worth a
-- note too; a player who hasn't played in 30 days is left alone.
--
-- Everything is on the player's own clock, as the daily games are: their week runs
-- Monday to Sunday in their time zone (`user_preferences.time_zone`, saved by the
-- app; their newest push device's zone when that is missing; UTC when neither is
-- known), and the recap goes out from 18:00 on their Sunday. The streak in it is
-- the one the app shows them.
--
-- Opt-in (`notify_weekly_recap`, off by default), like the release digest: it is
-- email. `weekly_recap_deliveries` makes each one once per player per week.
--
-- The sender is services/notifications/weeklyrecap.go, at
-- POST /api/v1/cron/weekly-recap. pg_cron wakes it every ten minutes through
-- Sunday and Monday (UTC), which covers Sunday evening in every time zone, through
-- pg_net at the push sender's address with the path swapped: no new secret.

alter table public.user_preferences
  add column if not exists notify_weekly_recap boolean not null default false;

create table if not exists public.weekly_recap_deliveries (
  user_id    uuid not null references auth.users (id) on delete cascade,
  week_start date not null,
  sent_at    timestamptz not null default now(),
  failure    text,
  primary key (user_id, week_start),
  constraint weekly_recap_deliveries_failure_length check (failure is null or char_length(failure) <= 200)
);

alter table public.weekly_recap_deliveries enable row level security;
revoke all on public.weekly_recap_deliveries from public, anon, authenticated;
grant all on public.weekly_recap_deliveries to service_role;

-- The players whose recap is due now, each with their own week (the Monday it
-- began on their clock) and their week in numbers. Due means: it is Sunday from
-- 18:00 where they are, and this week's recap hasn't gone to them yet.
-- `p_now` is for tests; the sender always means now.
create or replace function public.weekly_recap_due(
  p_limit integer default 25,
  p_now   timestamptz default now()
)
returns table (
  user_id        uuid,
  week_start     date,
  email          text,
  display_name   text,
  language       text,
  games_played   integer,
  games_distinct integer,
  top_game_slug  text,
  top_game_title text,
  new_bests      integer,
  passed_by      integer,
  streak         integer
)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  return query
  with players as (
    select p.id,
           u.email::text as email,
           coalesce(nullif(p.display_name, ''), p.username::text) as name,
           case when pref.language = 'sq' then 'sq' else 'en' end as lang,
           -- Their saved zone, else their newest push device's, else UTC.
           coalesce(
             pref.time_zone,
             (select s.time_zone from public.push_subscriptions s
               where s.user_id = p.id and s.time_zone is not null
               order by s.last_seen_at desc limit 1),
             'UTC'
           ) as zone
      from public.user_preferences pref
      join public.profiles p on p.id = pref.user_id
      join auth.users u on u.id = pref.user_id
     where pref.notify_weekly_recap
       and u.email is not null
       and u.email <> ''
       and u.email_confirmed_at is not null
       and not p.is_suspended
  ),
  clocked as (
    -- A zone the database doesn't know is UTC, as everywhere else.
    select pl.*,
           case when exists (select 1 from pg_catalog.pg_timezone_names z where z.name = pl.zone)
                then pl.zone else 'UTC' end as tz
      from players pl
  ),
  due as (
    select c.*,
           date_trunc('week', p_now at time zone c.tz)::date as week,
           (date_trunc('week', p_now at time zone c.tz)) at time zone c.tz as from_at,
           (date_trunc('week', p_now at time zone c.tz) + interval '7 days') at time zone c.tz as to_at
      from clocked c
     where extract(isodow from p_now at time zone c.tz) = 7
       and extract(hour from p_now at time zone c.tz) >= 18
  )
  select d.id,
         d.week,
         d.email,
         d.name,
         d.lang,
         coalesce(week.plays, 0)::integer,
         coalesce(week.games, 0)::integer,
         top.slug,
         top.title,
         coalesce(bests.n, 0)::integer,
         coalesce(passed.n, 0)::integer,
         coalesce((select st.streak from public.daily_streak_for(d.id, d.tz) st), 0)
    from due d
    left join lateral (
      select count(*) as plays, count(distinct s.game_id) as games
        from public.scores s
       where s.user_id = d.id and s.created_at >= d.from_at and s.created_at < d.to_at
    ) week on true
    left join lateral (
      select g.slug::text as slug, g.title::text as title
        from public.scores s
        join public.games g on g.id = s.game_id
       where s.user_id = d.id and s.created_at >= d.from_at and s.created_at < d.to_at
       group by g.id, g.slug, g.title
       order by count(*) desc, max(s.created_at) desc
       limit 1
    ) top on true
    left join lateral (
      -- Games where this week's best beat everything before it.
      select count(*) as n
        from (
          select s.game_id, max(s.score) as best
            from public.scores s
           where s.user_id = d.id and s.created_at >= d.from_at and s.created_at < d.to_at
           group by s.game_id
        ) w
       where w.best > coalesce((
         select max(e.score) from public.scores e
          where e.user_id = d.id and e.game_id = w.game_id and e.created_at < d.from_at
       ), -1)
    ) bests on true
    left join lateral (
      -- Friends who beat one of this player's scores, told as `score` notifications.
      select count(distinct n.payload ->> 'username') as n
        from public.notifications n
       where n.user_id = d.id and n.kind = 'score'
         and n.created_at >= d.from_at and n.created_at < d.to_at
    ) passed on true
   -- Someone who has drifted for a month isn't mailed every week about it.
   where exists (
       select 1 from public.scores r
        where r.user_id = d.id and r.created_at >= d.to_at - interval '30 days'
     )
     and not exists (
       select 1 from public.weekly_recap_deliveries dl
        where dl.user_id = d.id and dl.week_start = d.week
     )
   order by d.id
   limit greatest(1, least(coalesce(p_limit, 25), 100));
end;
$$;

revoke all on function public.weekly_recap_due(integer, timestamptz) from public, anon, authenticated;
grant execute on function public.weekly_recap_due(integer, timestamptz) to service_role;

-- One outcome per player per week; repeating it changes nothing.
create or replace function public.record_weekly_recap_delivery(
  p_week    date,
  p_user_id uuid,
  p_failure text default null
)
returns void
language sql
security definer
set search_path = ''
as $$
  insert into public.weekly_recap_deliveries (user_id, week_start, failure)
  values (p_user_id, p_week, left(p_failure, 200))
  on conflict (user_id, week_start) do nothing;
$$;

revoke all on function public.record_weekly_recap_delivery(date, uuid, text) from public, anon, authenticated;
grant execute on function public.record_weekly_recap_delivery(date, uuid, text) to service_role;

-- Wakes the sender, at the push sender's address with the path swapped.
create or replace function public.wake_weekly_recap()
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_url    text;
  v_secret text;
begin
  if to_regprocedure('net.http_post(text,jsonb,jsonb,jsonb,integer)') is null
     or to_regclass('vault.decrypted_secrets') is null then
    return;
  end if;
  execute 'select decrypted_secret from vault.decrypted_secrets where name = $1 limit 1'
    into v_url using 'push_dispatch_url';
  execute 'select decrypted_secret from vault.decrypted_secrets where name = $1 limit 1'
    into v_secret using 'push_dispatch_secret';
  if v_url is null or v_secret is null or v_url not like '%/cron/push-dispatch' then
    return;
  end if;
  execute 'select net.http_post(url := $1, headers := $2, body := ''{}''::jsonb)'
    using replace(v_url, '/cron/push-dispatch', '/cron/weekly-recap'),
          jsonb_build_object(
            'Authorization', 'Bearer ' || v_secret,
            'Content-Type', 'application/json'
          );
exception when others then
  raise warning 'wake_weekly_recap failed: %', sqlerrm;
end;
$$;

revoke all on function public.wake_weekly_recap() from public, anon, authenticated;
grant execute on function public.wake_weekly_recap() to service_role;

-- Every ten minutes on Sunday and Monday in UTC, which covers Sunday 18:00–24:00
-- everywhere from UTC+14 to UTC−12. Most runs find nobody due and send nothing.
do $$
begin
  if exists (select 1 from pg_available_extensions where name = 'pg_cron') then
    create extension if not exists pg_cron;
    perform cron.schedule('weekly-recap', '*/10 * * * 0,1', 'select public.wake_weekly_recap()');
  else
    raise notice 'pg_cron is not available: the weekly recap is not scheduled';
  end if;
exception when others then
  raise warning 'the weekly recap could not be scheduled: %', sqlerrm;
end $$;
