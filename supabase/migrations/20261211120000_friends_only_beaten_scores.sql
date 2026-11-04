-- Beaten-score notifications come from friends only.
--
-- A friend is someone you follow who follows you back. A stranger passing you on a
-- board is not news worth a notification, or a push to your phone. Friendship is
-- read when the score is recorded, so unfollowing stops these straight away.
--
-- It is checked before the limit of ten, so strangers can't take those places. Boards
-- themselves are unchanged, and so are follow, comment and reply notifications.
--
-- Safe in either order with the app deploy. Notifications already sent stay in the
-- inbox.

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
       -- Friends: each follows the other.
       and exists (
         select 1 from public.follows f
          where f.follower_id = new.user_id and f.followee_id = s.user_id
       )
       and exists (
         select 1 from public.follows f
          where f.follower_id = s.user_id and f.followee_id = new.user_id
       )
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
