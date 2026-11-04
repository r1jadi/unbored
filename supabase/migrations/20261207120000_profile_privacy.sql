-- Profile privacy: what a visitor's profile page shows.
--
-- `private_account` and `show_recently_played` were stored but nothing read them,
-- and `user_preferences` is owner-only, so a visitor's page could not ask. This
-- adds the scores choice and one function that answers for a page, so the player's
-- choices are applied by the database rather than by the browser asking politely.
--
-- The scores choice is independent of the private profile: a private profile can
-- still show its scores, and a public one can hide them.
--
-- What this does not do: `scores` and `profiles` stay publicly readable, because
-- leaderboards are built from them. A verified score still appears on its game's
-- board, whatever is chosen here.
--
-- APPLY ORDER: before the client that writes `show_profile_scores`. Preference
-- saves send every column, so that client's saves fail until this is applied.

alter table public.user_preferences
  add column if not exists show_profile_scores boolean not null default true;

comment on column public.user_preferences.show_profile_scores is
  'Whether visitors see this player''s best scores on their profile. Independent of private_account.';

-- Anyone who already chose a private account asked for less to be shown, so the
-- new default must not start publishing their scores on their profile.
update public.user_preferences
   set show_profile_scores = false
 where private_account;

create or replace function public.profile_showcase(p_user_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_viewer    uuid := auth.uid();
  v_is_owner  boolean := v_viewer is not null and v_viewer = p_user_id;
  v_private   boolean;
  v_scores    boolean;
  v_recent    boolean;
  v_available boolean;
begin
  -- A missing or suspended account, or an owner who blocked this viewer, shows
  -- nothing. The answer has the same shape as a private profile that hides its
  -- scores, so it does not tell a blocked viewer they were blocked.
  select not p.is_suspended into v_available
    from public.profiles p
   where p.id = p_user_id;

  if v_available is not true or (
    not v_is_owner and exists (
      select 1 from public.blocked_users b
       where b.blocker_id = p_user_id and b.blocked_id = v_viewer
    )
  ) then
    return jsonb_build_object(
      'private', true,
      'scores_visible', false,
      'recent_visible', false,
      'scores', '[]'::jsonb,
      'recent', '[]'::jsonb
    );
  end if;

  -- No row means the defaults: a public profile that shows everything.
  select
    coalesce(max(up.private_account::int), 0) = 1,
    coalesce(max(up.show_profile_scores::int), 1) = 1,
    coalesce(max(up.show_recently_played::int), 1) = 1
    into v_private, v_scores, v_recent
    from public.user_preferences up
   where up.user_id = p_user_id;

  -- A private profile keeps its recent games to itself. Its scores are the one
  -- thing the player can choose to show anyway.
  v_recent := v_recent and not v_private;

  return jsonb_build_object(
    'private', v_private and not v_is_owner,
    'scores_visible', v_scores or v_is_owner,
    'recent_visible', v_recent or v_is_owner,
    'scores', case when v_scores or v_is_owner then coalesce((
      select jsonb_agg(jsonb_build_object('game_id', t.game_id, 'score', t.best)
                       order by t.best desc)
        from (
          select s.game_id, max(s.score) as best
            from public.scores s
            join public.games g on g.id = s.game_id and g.status = 'published'
           where s.user_id = p_user_id
           group by s.game_id
           order by best desc
           limit 50
        ) t
    ), '[]'::jsonb) else '[]'::jsonb end,
    'recent', case when v_recent or v_is_owner then coalesce((
      select jsonb_agg(t.game_id order by t.last_played desc)
        from (
          select s.game_id, max(s.created_at) as last_played
            from public.scores s
            join public.games g on g.id = s.game_id and g.status = 'published'
           where s.user_id = p_user_id
           group by s.game_id
           order by last_played desc
           limit 20
        ) t
    ), '[]'::jsonb) else '[]'::jsonb end
  );
end;
$$;

comment on function public.profile_showcase(uuid) is
  'What a viewer may see on a player''s profile page, decided from that player''s own privacy choices.';

revoke all on function public.profile_showcase(uuid) from public;
grant execute on function public.profile_showcase(uuid) to anon, authenticated;
