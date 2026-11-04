-- Everyone hears about a new game in the app.
--
-- The email digest waits for five new games. This tells every player about each one,
-- when it first goes live: published and playable, because a listing that can't be
-- played yet is not news.
--
-- Each game is announced once. `announced_at` records it, so archiving a game and
-- publishing it again sends nothing, and only a trigger can set it, so editing a
-- game can't announce it again.
--
-- Apply before the client: preference saves send `notify_game_releases`, and fail
-- until the column exists. The games already live are marked announced below, so
-- applying this notifies nobody.

alter table public.user_preferences
  add column if not exists notify_game_releases boolean not null default true;

-- A default fills every existing row without firing a trigger, so live games keep
-- their `updated_at`. Anything not live is then cleared, to be announced when it is.
alter table public.games add column if not exists announced_at timestamptz default now();
alter table public.games alter column announced_at drop default;
update public.games
   set announced_at = null
 where not (status = 'published' and playable);

comment on column public.games.announced_at is
  'When players were told about this game. Set once, by a trigger, when it first goes live.';

create or replace function public.stamp_game_announcement()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_announced timestamptz;
begin
  -- Whatever a request asked for is ignored: the owner can write to this table.
  if tg_op = 'UPDATE' then
    v_announced := old.announced_at;
  end if;
  if v_announced is null and new.status = 'published' and new.playable then
    v_announced := now();
  end if;
  new.announced_at := v_announced;
  return new;
end;
$$;

revoke all on function public.stamp_game_announcement() from public, anon, authenticated;

drop trigger if exists games_stamp_announcement on public.games;
create trigger games_stamp_announcement
  before insert or update on public.games
  for each row execute function public.stamp_game_announcement();

-- One row per player, in one statement. Rows are marked as already handled by push:
-- this is an in-app announcement, and thousands of rows at once would otherwise sit
-- ahead of real follows and replies in the push outbox, which sends oldest first.
create or replace function public.announce_new_game()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.announced_at is null or (tg_op = 'UPDATE' and old.announced_at is not null) then
    return new;
  end if;

  insert into public.notifications (user_id, kind, payload, push_sent_at)
  select
    p.id,
    'system',
    jsonb_build_object(
      'reason', 'new_game',
      'game', new.slug::text,
      'game_title', new.title,
      'tagline', left(new.tagline, 200)
    ),
    now()
  from public.profiles p
  left join public.user_preferences up on up.user_id = p.id
  where not p.is_suspended
    and coalesce(up.notify_game_releases, true)
    -- A creator doesn't need telling about their own game. Unbored's own games tell
    -- everyone, the team included.
    and (new.is_official or p.id is distinct from new.owner_id);
  return new;
exception when others then
  -- A notification must never stop a game being published.
  raise warning 'announce_new_game failed: %', sqlerrm;
  return new;
end;
$$;

revoke all on function public.announce_new_game() from public, anon, authenticated;

drop trigger if exists games_announce on public.games;
create trigger games_announce
  after insert or update on public.games
  for each row execute function public.announce_new_game();
