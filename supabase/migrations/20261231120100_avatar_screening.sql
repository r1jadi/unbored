-- Avatar screening: a profile picture is checked before anyone else can see it.
--
-- Until now the browser uploaded straight into the public `avatars` bucket and
-- pointed the profile at the file, so a picture was public the moment it was
-- chosen and nothing could look at it first. App Review 1.2 and Google Play's
-- user-generated content policy ask for objectionable material to be filtered
-- before it is posted, and an avatar is shown on every leaderboard, comment and
-- chat.
--
-- The new path:
--
--   1. The browser uploads to `avatar-uploads`, a private bucket, under its own
--      folder. Nobody else can read it.
--   2. It asks the users service (`POST /api/v1/users/me/avatar`) to use it. The
--      service downloads it with the server-only secret key, sends it to the
--      OpenAI moderation endpoint, and only a picture that passes is copied into
--      the public `avatars` bucket and set on the profile. A refused picture is
--      deleted.
--
-- So that nothing can skip step 2, this migration takes away the two shortcuts:
-- players can no longer write into `avatars` (the service does, as
-- service_role), and a player's own token can no longer point `avatar_path` at a
-- file — it can only clear it. Moderators get `admin_remove_avatar`, so a
-- reported picture can be taken down; it is logged like every moderation action.

-- ─────────────────────────────────────────────────────────────────────────────
-- The holding bucket
-- ─────────────────────────────────────────────────────────────────────────────

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'avatar-uploads',
  'avatar-uploads',
  false,
  2 * 1024 * 1024,
  array['image/png', 'image/jpeg', 'image/webp']
)
on conflict (id) do update
  set public = excluded.public,
      file_size_limit = excluded.file_size_limit,
      allowed_mime_types = excluded.allowed_mime_types;

-- avatar-uploads/<user-id>/<file>: the owner may add, read and remove their own.
drop policy if exists "avatar_uploads_owner_insert" on storage.objects;
create policy "avatar_uploads_owner_insert"
  on storage.objects for insert to authenticated
  with check (
    bucket_id = 'avatar-uploads'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

drop policy if exists "avatar_uploads_owner_select" on storage.objects;
create policy "avatar_uploads_owner_select"
  on storage.objects for select to authenticated
  using (
    bucket_id = 'avatar-uploads'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

drop policy if exists "avatar_uploads_owner_delete" on storage.objects;
create policy "avatar_uploads_owner_delete"
  on storage.objects for delete to authenticated
  using (
    bucket_id = 'avatar-uploads'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

-- ─────────────────────────────────────────────────────────────────────────────
-- Public avatars: written by the screening service only
-- ─────────────────────────────────────────────────────────────────────────────

-- Reading stays public, and an owner may still delete their own picture. Adding
-- or replacing one is the service's job, as service_role, which no policy limits.
drop policy if exists "avatars_owner_insert" on storage.objects;
drop policy if exists "avatars_owner_update" on storage.objects;

create or replace function public.avatar_path_server_only()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  -- A player's own token may clear the picture, never point it at a file: a
  -- path is set only by the screening service, after the picture passed.
  if new.avatar_path is not null
     and (tg_op = 'INSERT' or new.avatar_path is distinct from old.avatar_path)
     and current_user in ('anon', 'authenticated') then
    raise exception 'avatar_needs_screening'
      using errcode = '42501',
            hint = 'Upload the picture through POST /api/v1/users/me/avatar.';
  end if;
  return new;
end;
$$;

comment on function public.avatar_path_server_only() is
  'Trigger: only the screening service (service_role) sets profiles.avatar_path to a file; a player may only clear it.';

drop trigger if exists profiles_avatar_path_server_only on public.profiles;
create trigger profiles_avatar_path_server_only
  before insert or update of avatar_path on public.profiles
  for each row execute function public.avatar_path_server_only();

-- ─────────────────────────────────────────────────────────────────────────────
-- Moderators remove a reported picture
-- ─────────────────────────────────────────────────────────────────────────────

create or replace function public.admin_remove_avatar(
  p_user_id uuid,
  p_reason text default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_path   text;
  v_reason text := nullif(btrim(coalesce(p_reason, '')), '');
begin
  perform public.admin_guard_staff();

  select p.avatar_path into v_path from public.profiles p where p.id = p_user_id for update;
  if not found then
    raise exception 'no such account' using errcode = 'P0002';
  end if;
  if v_path is null then
    raise exception 'this account has no picture' using errcode = '22023';
  end if;
  if v_reason is null then
    raise exception 'a reason is required to remove a picture' using errcode = '22023';
  end if;

  update public.profiles set avatar_path = null where id = p_user_id;

  insert into public.moderation_actions (moderator_id, target_kind, target_id, action, reason)
  values (coalesce(public.admin_actor(), auth.uid()), 'profile', p_user_id, 'remove_avatar', v_reason);

  -- The removed path is returned so the service can delete the file itself.
  return jsonb_build_object('userId', p_user_id, 'action', 'remove_avatar', 'avatarPath', v_path);
end;
$$;

comment on function public.admin_remove_avatar(uuid, text) is
  'Staff: takes a player''s picture off their profile, with a reason, and logs it. Returns the removed object path.';

revoke all on function public.admin_remove_avatar(uuid, text) from public, anon;
grant execute on function public.admin_remove_avatar(uuid, text) to authenticated;

create or replace function public.admin_remove_avatar_svc(
  p_actor uuid,
  p_user_id uuid,
  p_reason text default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
begin
  if p_actor is null then
    raise exception 'a verified actor is required' using errcode = '22023';
  end if;
  perform set_config('app.admin_bridge_actor', p_actor::text, true);
  return public.admin_remove_avatar(p_user_id, p_reason);
end;
$$;

comment on function public.admin_remove_avatar_svc(uuid, uuid, text) is
  'Privileged picture removal for an allowlisted administrator. service_role only.';

revoke all on function public.admin_remove_avatar_svc(uuid, uuid, text) from public, anon, authenticated;
grant execute on function public.admin_remove_avatar_svc(uuid, uuid, text) to service_role;
