-- Every game the caller has a run waiting in, newest first: what the feed's
-- "Continue" card offers. The rules are `saved_run`'s (20261215120200_challenges.sql),
-- one row per game instead of one game at a time: an unfinished run that hasn't
-- expired, or one the player ended and chose to keep, within 30 days and with no
-- newer run of that game since. Callouts are never saved, so never listed.

create or replace function public.my_saved_runs(p_limit integer default 5)
returns table (
  game_slug  text,
  game_title text,
  saved_at   timestamptz
)
language sql
stable
security definer
set search_path = ''
as $$
  select r.slug, r.title, r.saved_at
    from (
      select distinct on (g.id)
             g.slug::text as slug, g.title::text as title, s.progress_saved_at as saved_at
        from public.game_sessions s
        join public.games g on g.id = s.game_id
       where s.user_id = auth.uid()
         and s.challenge_id is null
         and g.status = 'published'
         and public.run_resumable(s.rules_version)
         and s.abandoned_at is null
         and coalesce(array_length(s.progress_actions, 1), 0) > 0
         and (
           (s.completed_at is null and s.expires_at > now())
           or (
             s.completed_at is not null
             and s.continuable
             and s.completed_at > now() - interval '30 days'
             and not exists (
               select 1 from public.game_sessions newer
                where newer.game_id = s.game_id
                  and newer.user_id = s.user_id
                  and newer.id <> s.id
                  and newer.challenge_id is null
                  and newer.started_at > s.completed_at
             )
           )
         )
       order by g.id, s.progress_saved_at desc
    ) r
   order by r.saved_at desc
   limit greatest(1, least(coalesce(p_limit, 5), 20))
$$;

comment on function public.my_saved_runs(integer) is
  'The games the caller can continue a saved run in, newest first, by saved_run''s rules.';

revoke all on function public.my_saved_runs(integer) from public, anon, authenticated;
grant execute on function public.my_saved_runs(integer) to authenticated;
