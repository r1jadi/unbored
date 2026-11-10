-- Likes and follows stop being readable row by row to everyone.
--
-- Both tables had a `using (true)` select policy for `anon` and `authenticated`,
-- so any visitor holding the publishable key (every visitor) could ask
-- `GET /rest/v1/likes?user_id=eq.<anyone>` for everything a player liked, or
-- `GET /rest/v1/follows?follower_id=eq.<anyone>` for who they follow. That went
-- straight around `private_account` and around blocks.
--
-- What the app needs from other people's rows is narrower than that:
--
--   * a game's like count — answered by `game_like_count`, which counts only;
--   * a profile's follower / following numbers — answered by `follow_counts`;
--   * follower and following lists on a profile — still read from `follows`,
--     but a row is visible only when `follow_visible` says so.
--
-- Rules after this migration:
--
--   likes   — a player reads their own rows; staff read all. Nobody else.
--   follows — a row is visible to its two players and to staff. Anyone else sees
--             it only when neither player has a private account and neither has
--             blocked the viewer.
--
-- Counts stay public, as they were, and still include every row: a private
-- account's follower number is shown, its list is not.
--
-- The security-definer functions that already read these tables (notifications,
-- messaging, challenges, achievements, admin) run as the owner and are not
-- affected. `following_feed` is caller-rights but only reads the caller's own
-- follows, which stay visible.
--
-- APPLY ORDER: before the client that calls `game_like_count` / `follow_counts`.
-- An older client keeps working for its own rows; its counts for other players'
-- games and profiles drop to what the viewer can see until it is updated.

-- ── Counts ──────────────────────────────────────────────────────────────────

create or replace function public.game_like_count(p_game_id uuid)
returns integer
language sql
stable
security definer
set search_path = ''
as $$
  select count(*)::integer
    from public.likes l
   where l.target_kind = 'game' and l.target_id = p_game_id;
$$;

comment on function public.game_like_count(uuid) is
  'How many players like one game. Counts only: who liked it is private to each player.';

revoke all on function public.game_like_count(uuid) from public;
grant execute on function public.game_like_count(uuid) to anon, authenticated;

create or replace function public.follow_counts(p_user_id uuid)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object(
    'followers', (select count(*) from public.follows f where f.followee_id = p_user_id),
    'following', (select count(*) from public.follows f where f.follower_id = p_user_id)
  );
$$;

comment on function public.follow_counts(uuid) is
  'A profile''s follower and following numbers. Public, like the numbers always were; the lists behind them follow follow_visible.';

revoke all on function public.follow_counts(uuid) from public;
grant execute on function public.follow_counts(uuid) to anon, authenticated;

-- The view counted likes with the caller's rights; with likes now owner-only that
-- would count the caller's own like at most. Count through the function instead,
-- and keep caller rights for comments so hidden ones stay uncounted for visitors.
create or replace view public.game_engagement_counts
  with (security_invoker = true)
as
select
  g.id   as game_id,
  g.slug,
  public.game_like_count(g.id)                                      as like_count,
  (select count(*) from public.comments c
    where c.game_id = g.id)::integer                                as comment_count
from public.games g
where g.status = 'published';

grant select on public.game_engagement_counts to anon, authenticated;

-- ── Likes ───────────────────────────────────────────────────────────────────

drop policy if exists likes_select_public on public.likes;
drop policy if exists likes_select_own on public.likes;

create policy likes_select_own
  on public.likes for select to authenticated
  using (user_id = (select auth.uid()) or public.is_staff());

comment on policy likes_select_own on public.likes is
  'A player reads their own likes; staff read all. Like counts come from game_like_count.';

-- ── Follows ─────────────────────────────────────────────────────────────────

-- Security definer because both inputs live behind owner-only tables:
-- `user_preferences` (private_account) and `blocked_users`.
create or replace function public.follow_visible(p_follower uuid, p_followee uuid)
returns boolean
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_viewer uuid := auth.uid();
begin
  if v_viewer is not null and (v_viewer = p_follower or v_viewer = p_followee) then
    return true;
  end if;

  if public.is_staff() then
    return true;
  end if;

  if exists (
    select 1 from public.user_preferences up
     where up.user_id in (p_follower, p_followee) and up.private_account
  ) then
    return false;
  end if;

  if v_viewer is not null and exists (
    select 1 from public.blocked_users b
     where b.blocker_id in (p_follower, p_followee) and b.blocked_id = v_viewer
  ) then
    return false;
  end if;

  return true;
end;
$$;

comment on function public.follow_visible(uuid, uuid) is
  'Whether the caller may see that one player follows another: always for the two players and staff, otherwise only when neither account is private and neither blocked the caller.';

revoke all on function public.follow_visible(uuid, uuid) from public;
grant execute on function public.follow_visible(uuid, uuid) to anon, authenticated;

drop policy if exists follows_select_public on public.follows;
drop policy if exists follows_select_visible on public.follows;

create policy follows_select_visible
  on public.follows for select to anon, authenticated
  using (public.follow_visible(follower_id, followee_id));

comment on policy follows_select_visible on public.follows is
  'A follow is visible to its two players and staff, and to others only when neither account is private and neither blocked the viewer.';
