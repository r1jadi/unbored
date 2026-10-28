-- Self-service account deletion.
--
-- Until now the Settings screen could only point at the issue tracker: there was
-- no verified way for a player to delete their own account. This adds one.
--
-- `public.delete_my_account()` deletes the caller's `auth.users` row — the
-- caller is the verified token, never an argument, so nobody can delete anyone
-- else — and every table that belongs to an account goes with it, because each
-- references `auth.users` with `on delete cascade`: the profile, preferences,
-- sessions and scores, comments, likes, saves, follows, blocks, reports filed and
-- notifications. Analytics events and a report's resolver are `set null`.
--
-- One reference refuses: `moderation_actions.moderator_id` is `on delete
-- restrict`, because the moderation log must keep saying who acted. A moderator
-- with history is answered `has_moderation_history` and keeps their account; an
-- administrator removes them by hand after reassigning or archiving that log.
--
-- The profile picture lives in Storage, which the client clears first through
-- the Storage API (the owner may delete their own objects); see
-- `src/lib/users/account.ts`.

create or replace function public.delete_my_account()
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user uuid := auth.uid();
begin
  if v_user is null then
    return 'not_signed_in';
  end if;

  if exists (select 1 from public.moderation_actions m where m.moderator_id = v_user) then
    return 'has_moderation_history';
  end if;

  begin
    delete from auth.users u where u.id = v_user;
  exception when foreign_key_violation then
    -- Something outside the cascade still points at the account (an object in
    -- a Storage bucket on an older project, say). Nothing was deleted.
    return 'blocked';
  end;

  return 'deleted';
end;
$$;

comment on function public.delete_my_account() is
  'Deletes the calling account and, by cascade, everything that belongs to it. Answers deleted, not_signed_in, has_moderation_history (a moderator whose actions are on record) or blocked (another reference refused; nothing was deleted).';

revoke all on function public.delete_my_account() from public, anon;
grant execute on function public.delete_my_account() to authenticated;
