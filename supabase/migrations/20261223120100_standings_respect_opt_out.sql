-- A standing is the player's own answer; it stops answering strangers for a
-- player who left the boards.
--
-- `game_standing` and `overall_standing` take the player's id as an argument and
-- are callable with the publishable key, so anyone could ask for anyone's rank,
-- best score and play count — including a player who turned off "Show on
-- leaderboards", whose whole point was not to be looked up. The boards leave that
-- player out; these two functions did not.
--
-- The rule now, in one place (`standing_visible`):
--
--   * the player themself always gets their standing (`auth.uid()`);
--   * staff and the service role do too;
--   * anyone else gets it only while the player is on the boards, where the same
--     numbers are public anyway.
--
-- The existing functions keep their bodies under an `_unchecked` name that no
-- client role may execute, and the public names become thin wrappers that apply
-- the rule. A later migration that changes how a standing is computed must
-- change the `_unchecked` function, not replace the wrapper.
--
-- APPLY ORDER: after the games service that forwards the caller's token on
-- standing reads (it used to ask as an anonymous caller, passing the verified
-- id). Applied first, nothing breaks for a player who is on the boards; a player
-- who opted out would briefly not see their own "your rank" line.

-- Re-runnable: rename only while the `_unchecked` name is still free, so a
-- second run (or a run after a partial apply) does not rename the wrapper.
do $$
begin
  if to_regprocedure('public.game_standing_unchecked(text, uuid, timestamptz)') is null then
    alter function public.game_standing(text, uuid, timestamptz)
      rename to game_standing_unchecked;
  end if;
  if to_regprocedure('public.overall_standing_unchecked(uuid, timestamptz)') is null then
    alter function public.overall_standing(uuid, timestamptz)
      rename to overall_standing_unchecked;
  end if;
end
$$;

revoke all on function public.game_standing_unchecked(text, uuid, timestamptz)
  from public, anon, authenticated;
revoke all on function public.overall_standing_unchecked(uuid, timestamptz)
  from public, anon, authenticated;

create or replace function public.standing_visible(p_user_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(p_user_id = auth.uid(), false)
      or coalesce(auth.role(), '') = 'service_role'
      or public.is_staff()
      or not exists (
        select 1 from public.user_preferences up
         where up.user_id = p_user_id and not up.show_on_leaderboards
      );
$$;

comment on function public.standing_visible(uuid) is
  'Whether the caller may read this player''s standing: the player, staff, the service role, or anyone while the player is on the boards.';

revoke all on function public.standing_visible(uuid) from public, anon, authenticated;

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
  select s.rank, s.score, s.achieved_at, s.plays
    from public.game_standing_unchecked(p_game_slug, p_user_id, p_since) s
   where public.standing_visible(p_user_id);
$$;

comment on function public.game_standing(text, uuid, timestamptz) is
  'One player''s place on one board, for a caller allowed to see it (standing_visible). Computed by game_standing_unchecked.';

revoke all on function public.game_standing(text, uuid, timestamptz) from public;
grant execute on function public.game_standing(text, uuid, timestamptz)
  to anon, authenticated, service_role;

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
  select s.rank, s.rating, s.games
    from public.overall_standing_unchecked(p_user_id, p_since) s
   where public.standing_visible(p_user_id);
$$;

comment on function public.overall_standing(uuid, timestamptz) is
  'One player''s all-games rating, for a caller allowed to see it (standing_visible). Computed by overall_standing_unchecked.';

revoke all on function public.overall_standing(uuid, timestamptz) from public;
grant execute on function public.overall_standing(uuid, timestamptz)
  to anon, authenticated, service_role;
