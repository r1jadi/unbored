-- One daily streak across every game, with freezes, and an evening push that
-- reminds a player before it ends.
--
-- The streak: every day a signed-in player has a verified score in any game adds a
-- day. As with the per-game streaks (20261110120000_game_streaks.sql), one missed
-- day is a free rest day. On top of that, every seven days of streak earns a
-- freeze (at most two banked), and each missed day past the rest day spends one.
-- Everything is computed from `scores` in the player's own time zone, so nothing
-- new is stored and nothing can drift.
--
-- The reminder: once an hour, `queue_streak_reminders` finds players whose device
-- reads 19:00–19:59, who have a streak of two days or more, haven't played today,
-- weren't reminded today and left `notify_streak_reminders` on. Each gets one
-- `system` notification with reason `streak_reminder`, inserted already read and
-- dismissed: it is for the lock screen, and would be stale in the inbox by morning.
-- The push sender is woken the way announcements wake it.
--
-- The hour comes from pg_cron where the database has it (Supabase does), and the
-- time zone from the device's push subscription, which now records it, or from the
-- player's saved one (`user_preferences.time_zone`).

-- A device's time zone, as the browser reports it --------------------------------

alter table public.push_subscriptions add column if not exists time_zone text;

alter table public.push_subscriptions drop constraint if exists push_subscriptions_time_zone_length;
alter table public.push_subscriptions
  add constraint push_subscriptions_time_zone_length
  check (time_zone is null or char_length(time_zone) <= 64);

-- The device's subscription, now with its time zone. An unknown zone is stored as
-- null: that device simply gets no reminder.
create or replace function public.register_push_subscription(
  p_endpoint  text,
  p_p256dh    text,
  p_auth      text,
  p_language  text,
  p_time_zone text
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user uuid := auth.uid();
  v_zone text;
begin
  if v_user is null then
    raise exception 'a push subscription needs a signed-in account' using errcode = '42501';
  end if;

  if p_time_zone is not null
     and exists (select 1 from pg_catalog.pg_timezone_names z where z.name = p_time_zone) then
    v_zone := p_time_zone;
  end if;

  insert into public.push_subscriptions (user_id, endpoint, p256dh, auth, language, time_zone)
  values (v_user, p_endpoint, p_p256dh, p_auth, p_language, v_zone)
  on conflict (endpoint) do update
    set user_id = excluded.user_id,
        p256dh = excluded.p256dh,
        auth = excluded.auth,
        language = excluded.language,
        time_zone = coalesce(excluded.time_zone, public.push_subscriptions.time_zone),
        last_seen_at = now();

  -- Ten devices is plenty. Past that, the longest unseen ones go.
  delete from public.push_subscriptions s
   where s.user_id = v_user
     and s.id in (
       select o.id from public.push_subscriptions o
        where o.user_id = v_user
        order by o.last_seen_at desc
        offset 10
     );
end;
$$;

revoke all on function public.register_push_subscription(text, text, text, text, text) from public, anon, authenticated;
grant execute on function public.register_push_subscription(text, text, text, text, text) to authenticated;

-- The setting, and the player's own clock ------------------------------------

alter table public.user_preferences
  add column if not exists notify_streak_reminders boolean not null default true;

-- The player's time zone, as their device reports it: what "today" and "this week"
-- mean for them on the server, as the daily games already do per request. The app
-- saves it on load (`set_my_time_zone`). Null until then, which means UTC.
alter table public.user_preferences
  add column if not exists time_zone text;

alter table public.user_preferences drop constraint if exists user_preferences_time_zone_length;
alter table public.user_preferences
  add constraint user_preferences_time_zone_length
  check (time_zone is null or char_length(time_zone) <= 64);

-- Saves the caller's time zone. An unknown zone is ignored rather than stored.
create or replace function public.set_my_time_zone(p_time_zone text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user uuid := auth.uid();
begin
  if v_user is null then
    raise exception 'saving a time zone needs a signed-in account' using errcode = '42501';
  end if;
  if p_time_zone is null
     or not exists (select 1 from pg_catalog.pg_timezone_names z where z.name = p_time_zone) then
    return;
  end if;
  insert into public.user_preferences (user_id, time_zone)
  values (v_user, p_time_zone)
  on conflict (user_id) do update set time_zone = excluded.time_zone
   where public.user_preferences.time_zone is distinct from excluded.time_zone;
end;
$$;

revoke all on function public.set_my_time_zone(text) from public, anon, authenticated;
grant execute on function public.set_my_time_zone(text) to authenticated;

-- The streak ------------------------------------------------------------------

-- Every seven days of streak earns a freeze; no more than this many are banked.
-- Internal: reachable only through the functions below.
create or replace function public.daily_streak_for(p_user uuid, p_zone text)
returns table (
  streak         integer,
  last_played_on date,
  today          date,
  freezes        integer
)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  c_max_freezes constant integer := 2;
  c_earn_every  constant integer := 7;
  v_zone     text := 'UTC';
  v_today    date;
  v_previous date;
  v_streak   integer := 0;
  v_freezes  integer := 0;
  v_missed   integer;
  v_day      date;
begin
  if p_zone is not null
     and exists (select 1 from pg_catalog.pg_timezone_names z where z.name = p_zone) then
    v_zone := p_zone;
  end if;
  v_today := (now() at time zone v_zone)::date;

  -- Oldest first, so freezes are earned and spent in the order the days happened.
  for v_day in
    select distinct (s.created_at at time zone v_zone)::date as day
      from public.scores s
     where s.user_id = p_user
     order by day asc
  loop
    if v_previous is null then
      v_streak := 1;
    else
      v_missed := v_day - v_previous - 1;
      if v_missed <= 1 then
        -- The next day, or the day after one free rest day.
        v_streak := v_streak + 1;
      elsif v_missed - 1 <= v_freezes then
        -- Longer gaps spend a freeze for each missed day past the rest day.
        v_freezes := v_freezes - (v_missed - 1);
        v_streak := v_streak + 1;
      else
        v_streak := 1;
        v_freezes := 0;
      end if;
    end if;
    if v_streak % c_earn_every = 0 then
      v_freezes := least(v_freezes + 1, c_max_freezes);
    end if;
    v_previous := v_day;
  end loop;

  -- Up to today: is the streak still alive, and what would it cost to keep?
  if v_previous is not null then
    v_missed := v_today - v_previous - 1;
    if v_missed <= 1 then
      null;
    elsif v_missed - 1 <= v_freezes then
      v_freezes := v_freezes - (v_missed - 1);
    else
      v_streak := 0;
      v_freezes := 0;
    end if;
  end if;

  return query select v_streak, v_previous, v_today, v_freezes;
end;
$$;

comment on function public.daily_streak_for(uuid, text) is
  'A player''s streak across every game, in a time zone: days played in a row, one missed day forgiven, and a freeze for each further missed day (one earned per seven days, two at most).';

revoke all on function public.daily_streak_for(uuid, text) from public, anon, authenticated;

-- The caller's own streak, for the app.
create or replace function public.my_daily_streak(p_time_zone text)
returns table (
  streak         integer,
  last_played_on date,
  today          date,
  freezes        integer
)
language sql
stable
security definer
set search_path = ''
as $$
  select d.streak, d.last_played_on, d.today, d.freezes
    from public.daily_streak_for(auth.uid(), p_time_zone) d
   where auth.uid() is not null;
$$;

comment on function public.my_daily_streak(text) is
  'The caller''s streak across every game, in their time zone. Nothing for an anonymous caller.';

revoke all on function public.my_daily_streak(text) from public, anon, authenticated;
grant execute on function public.my_daily_streak(text) to authenticated;

-- The reminder ----------------------------------------------------------------

-- One reminder per player per local day, however often the job runs.
create table if not exists public.streak_reminders (
  user_id   uuid not null references auth.users (id) on delete cascade,
  local_day date not null,
  sent_at   timestamptz not null default now(),
  primary key (user_id, local_day)
);

alter table public.streak_reminders enable row level security;
revoke all on public.streak_reminders from public, anon, authenticated;
grant all on public.streak_reminders to service_role;

-- Queues the evening reminders that are due this hour, and wakes the sender.
-- Returns how many were queued.
create or replace function public.queue_streak_reminders()
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_candidate record;
  v_streak    record;
  v_queued    integer := 0;
begin
  for v_candidate in
    -- Each player's most recently seen device, on that device's clock, or the
    -- player's saved one when the device didn't say.
    select distinct on (s.user_id) s.user_id, coalesce(s.time_zone, up.time_zone) as time_zone
      from public.push_subscriptions s
      join public.profiles p on p.id = s.user_id
      left join public.user_preferences up on up.user_id = s.user_id
     where coalesce(s.time_zone, up.time_zone) is not null
       and not p.is_suspended
       and coalesce(up.notify_streak_reminders, true)
     order by s.user_id, s.last_seen_at desc
  loop
    -- Evening on that device.
    continue when extract(hour from (now() at time zone v_candidate.time_zone)) <> 19;

    select * into v_streak
      from public.daily_streak_for(v_candidate.user_id, v_candidate.time_zone);

    -- Worth keeping, not yet kept today.
    continue when v_streak.streak < 2 or v_streak.last_played_on = v_streak.today;

    insert into public.streak_reminders (user_id, local_day)
    values (v_candidate.user_id, v_streak.today)
    on conflict do nothing;
    continue when not found;

    insert into public.notifications (user_id, kind, payload, read_at, dismissed_at)
    values (
      v_candidate.user_id,
      'system',
      jsonb_build_object('reason', 'streak_reminder', 'streak', v_streak.streak),
      now(),
      now()
    );
    v_queued := v_queued + 1;
  end loop;

  if v_queued > 0 then
    perform public.wake_push_dispatch_once();
  end if;

  -- Old rows only keep "once a day" honest; a week is plenty.
  delete from public.streak_reminders r where r.sent_at < now() - interval '7 days';

  return v_queued;
end;
$$;

comment on function public.queue_streak_reminders() is
  'Hourly: one evening push (19:00 on the player''s device) to each player with a streak of two days or more who has not played today.';

revoke all on function public.queue_streak_reminders() from public, anon, authenticated;
grant execute on function public.queue_streak_reminders() to service_role;

-- The push sender takes reminders too ------------------------------------------

create or replace function public.claim_push_batch(p_limit integer)
returns table (
  notification_id uuid,
  kind            text,
  payload         jsonb,
  subscription_id uuid,
  endpoint        text,
  p256dh          text,
  auth            text,
  language        text
)
language plpgsql
security definer
set search_path = ''
as $$
begin
  -- Yesterday's news is not worth waking a phone for, if the sender was down.
  update public.notifications n
     set push_sent_at = now()
   where n.push_sent_at is null
     and n.created_at <= now() - interval '1 day';

  return query
  with claimed as (
    update public.notifications n
       set push_sent_at = now()
     where n.id in (
       select p.id from public.notifications p
        where p.push_sent_at is null
        order by p.created_at
        limit greatest(1, least(coalesce(p_limit, 100), 200))
        for update skip locked
     )
    returning n.id, n.kind, n.payload, n.user_id
  )
  select c.id, c.kind::text, c.payload, s.id, s.endpoint, s.p256dh, s.auth, s.language
    from claimed c
    join public.push_subscriptions s on s.user_id = c.user_id
   where c.kind in ('follow', 'comment', 'score', 'message')
      or (c.kind = 'system' and c.payload ->> 'reason' in ('announcement', 'streak_reminder'));
end;
$$;

revoke all on function public.claim_push_batch(integer) from public, anon, authenticated;
grant execute on function public.claim_push_batch(integer) to service_role;

-- Every hour, where pg_cron exists -----------------------------------------------

do $$
begin
  if exists (select 1 from pg_available_extensions where name = 'pg_cron') then
    create extension if not exists pg_cron;
    perform cron.schedule('streak-reminders', '0 * * * *', 'select public.queue_streak_reminders()');
  else
    raise notice 'pg_cron is not available: streak reminders are not scheduled';
  end if;
exception when others then
  raise warning 'streak reminders could not be scheduled: %', sqlerrm;
end $$;
