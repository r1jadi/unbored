-- In-app notifications do what Settings says they do.
--
-- Until now only a follow created a notification, and nothing read
-- `notify_beats`, `notify_followers` or `notify_comments`, so those three toggles
-- changed nothing and two of the three notifications never happened. Triggers
-- create them here because every write path passes through the table: a score from
-- any game's verifier, a comment from the Data API.
--
-- Rows no longer store English sentences. The app words each one from its kind and
-- payload, in the player's language.
--
-- A notification must never break the thing it reports, so each trigger logs a
-- failure and lets the insert stand.
--
-- Safe in either order with the app deploy: the app still reads older rows.

-- The rules every notification shares: never about yourself, never between accounts
-- where either has blocked the other, and only if the recipient wants this kind. No
-- preference row means the defaults, which are all on.
create or replace function public.notification_wanted(
  p_recipient uuid,
  p_actor     uuid,
  p_kind      text
)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select p_recipient <> p_actor
     and not exists (
       select 1 from public.blocked_users b
        where (b.blocker_id = p_recipient and b.blocked_id = p_actor)
           or (b.blocker_id = p_actor and b.blocked_id = p_recipient)
     )
     and coalesce((
       select case p_kind
                when 'follow'  then up.notify_followers
                when 'comment' then up.notify_comments
                when 'score'   then up.notify_beats
              end
         from public.user_preferences up
        where up.user_id = p_recipient
     ), true);
$$;

revoke all on function public.notification_wanted(uuid, uuid, text) from public, anon, authenticated;

-- Follows ---------------------------------------------------------------------

create or replace function public.notify_follow()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_username text;
begin
  if not public.notification_wanted(new.followee_id, new.follower_id, 'follow') then
    return new;
  end if;

  -- Following, unfollowing and following again is one piece of news a day, or the
  -- button becomes a way to spam someone.
  if exists (
    select 1 from public.notifications n
     where n.user_id = new.followee_id
       and n.kind = 'follow'
       and n.payload->>'actor_id' = new.follower_id::text
       and n.created_at > now() - interval '1 day'
  ) then
    return new;
  end if;

  select p.username into v_username from public.profiles p where p.id = new.follower_id;

  insert into public.notifications (user_id, kind, payload)
  values (
    new.followee_id,
    'follow',
    jsonb_build_object('actor_id', new.follower_id, 'username', v_username)
  );
  return new;
exception when others then
  raise warning 'notify_follow failed: %', sqlerrm;
  return new;
end;
$$;

revoke all on function public.notify_follow() from public, anon, authenticated;

-- Comments --------------------------------------------------------------------

-- A reply tells the comment's author. A top-level comment tells the game's owner,
-- unless the game is Unbored's own: the team has the admin console for those.
create or replace function public.notify_comment()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_recipient uuid;
  v_reason    text;
  v_username  text;
  v_slug      text;
  v_title     text;
begin
  if new.is_hidden then
    return new;
  end if;

  if new.parent_id is not null then
    select c.author_id into v_recipient from public.comments c where c.id = new.parent_id;
    v_reason := 'reply';
  else
    select g.owner_id into v_recipient from public.games g
     where g.id = new.game_id and not g.is_official;
    v_reason := 'game_comment';
  end if;

  if v_recipient is null
     or not public.notification_wanted(v_recipient, new.author_id, 'comment') then
    return new;
  end if;

  select p.username into v_username from public.profiles p where p.id = new.author_id;
  select g.slug::text, g.title into v_slug, v_title from public.games g where g.id = new.game_id;

  -- No comment text: a notification outlives a moderator hiding what it quoted.
  insert into public.notifications (user_id, kind, payload)
  values (
    v_recipient,
    'comment',
    jsonb_build_object(
      'actor_id', new.author_id,
      'username', v_username,
      'reason', v_reason,
      'game', v_slug,
      'game_title', v_title
    )
  );
  return new;
exception when others then
  raise warning 'notify_comment failed: %', sqlerrm;
  return new;
end;
$$;

revoke all on function public.notify_comment() from public, anon, authenticated;

drop trigger if exists comments_notify on public.comments;
create trigger comments_notify
  after insert on public.comments
  for each row execute function public.notify_comment();

-- Beaten scores ---------------------------------------------------------------

-- A new personal best tells the players it just overtook: those whose best is below
-- the new score, and was not already below the player's old best. Limits keep one
-- good run from messaging a whole board:
--   * only the ten closest players overtaken, who are the ones it means something to;
--   * at most one notification per player per game every six hours.
-- A player off the leaderboards is left out on both sides: someone who opted out
-- isn't named, and has no place on a board to lose.
create or replace function public.notify_score_beaten()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_previous bigint;
  v_username text;
  v_slug     text;
  v_title    text;
begin
  if new.user_id is null then
    return new;
  end if;

  select max(s.score) into v_previous
    from public.scores s
   where s.game_id = new.game_id and s.user_id = new.user_id and s.id <> new.id;
  if v_previous is not null and v_previous >= new.score then
    return new;
  end if;

  if exists (
    select 1 from public.user_preferences up
     where up.user_id = new.user_id and not up.show_on_leaderboards
  ) then
    return new;
  end if;

  select g.slug::text, g.title into v_slug, v_title
    from public.games g
   where g.id = new.game_id and g.status = 'published';
  if v_slug is null then
    return new;
  end if;

  select p.username into v_username from public.profiles p where p.id = new.user_id;

  insert into public.notifications (user_id, kind, payload)
  select
    o.user_id,
    'score',
    jsonb_build_object(
      'actor_id', new.user_id,
      'username', v_username,
      'game', v_slug,
      'game_title', v_title
    )
  from (
    select s.user_id, max(s.score) as best
      from public.scores s
     where s.game_id = new.game_id
       and s.user_id is not null
       and s.user_id <> new.user_id
     group by s.user_id
    having max(s.score) < new.score
       and max(s.score) > 0
       and (v_previous is null or max(s.score) >= v_previous)
     order by best desc
     limit 10
  ) o
  where public.notification_wanted(o.user_id, new.user_id, 'score')
    and not exists (
      select 1 from public.user_preferences up
       where up.user_id = o.user_id and not up.show_on_leaderboards
    )
    and not exists (
      select 1 from public.notifications n
       where n.user_id = o.user_id
         and n.kind = 'score'
         and n.payload->>'game' = v_slug
         and n.created_at > now() - interval '6 hours'
    );
  return new;
exception when others then
  raise warning 'notify_score_beaten failed: %', sqlerrm;
  return new;
end;
$$;

revoke all on function public.notify_score_beaten() from public, anon, authenticated;

drop trigger if exists scores_notify_beaten on public.scores;
create trigger scores_notify_beaten
  after insert on public.scores
  for each row execute function public.notify_score_beaten();
