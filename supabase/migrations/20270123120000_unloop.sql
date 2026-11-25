-- Unloop — short vertical videos, published by administrators, watched by everyone.
--
-- Unloop is its own destination: nothing here touches the games catalogue, the For
-- You feed or the game likes and saves. It has four parts.
--
--   * public.unloop_videos — one row per video. Drafts are invisible outside the
--     admin console; published rows are readable by anyone through `unloop_feed`.
--     No role but the definer functions below may write a row: there is no INSERT,
--     UPDATE or DELETE grant for `authenticated`, so publishing goes through the
--     admin API (ADR 0013), which re-checks the ADMIN_EMAILS allowlist per request.
--   * public.unloop_likes / public.unloop_saves — one row per player per video,
--     owner-scoped like `public.saves`. The primary key is the duplicate guard, and
--     only published videos can be liked or saved.
--   * public.unloop_feed(...) — the one public read: published videos with measured
--     like and save counts, and the caller's own liked/saved state. Counts come from
--     the rows, never from a cached number.
--   * The `unloop` storage bucket — public, size and MIME limited. Objects are
--     written only through signed upload URLs the admin API mints (service role),
--     or by a caller the database itself says is an administrator.
--
-- Admin writes follow the platform's bridge pattern (0015): a row-gated function
-- (`admin_guard_admin()`) for callers with a `user_roles` row, and a `_svc` wrapper
-- only `service_role` may execute, which acts for the verified administrator the Go
-- service passes as `p_actor`.
--
-- Rollback (manual):
--   drop function public.admin_unloop_delete_svc(uuid, uuid);
--   drop function public.admin_unloop_save_svc(uuid, uuid, text, text, text, text, text, numeric, text);
--   drop function public.admin_unloop_videos_svc(uuid, text, integer, integer);
--   drop function public.admin_unloop_delete(uuid);
--   drop function public.admin_unloop_save(uuid, text, text, text, text, text, numeric, text);
--   drop function public.admin_unloop_videos(text, integer, integer);
--   drop function public.unloop_feed(text, boolean, uuid, integer, integer);
--   drop table public.unloop_saves, public.unloop_likes, public.unloop_videos;
--   delete from storage.buckets where id = 'unloop';  -- after emptying it

-- ─────────────────────────────────────────────────────────────────────────────
-- Videos
-- ─────────────────────────────────────────────────────────────────────────────

create table if not exists public.unloop_videos (
  id               uuid primary key default gen_random_uuid(),
  title            text not null check (char_length(btrim(title)) between 2 and 80),
  description      text not null default '' check (char_length(description) <= 500),
  category         text not null check (
    category in ('highlights', 'how-to', 'speedruns', 'brain-food', 'behind-the-scenes', 'just-for-fun')
  ),
  -- Paths inside the `unloop` bucket. The API mints them; the pattern keeps a row
  -- from pointing anywhere else.
  video_path       text not null check (video_path ~ '^videos/[a-z0-9-]{36}\.(mp4|webm|mov)$'),
  thumbnail_path   text check (thumbnail_path ~ '^thumbnails/[a-z0-9-]{36}\.(jpg|png|webp)$'),
  duration_seconds numeric(7, 2) check (duration_seconds is null or duration_seconds between 0 and 600),
  status           text not null default 'draft' check (status in ('draft', 'published')),
  created_by       uuid references auth.users (id) on delete set null,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  published_at     timestamptz,
  constraint unloop_videos_published_at check ((status = 'published') = (published_at is not null))
);

create index if not exists unloop_videos_feed_idx
  on public.unloop_videos (published_at desc)
  where status = 'published';

revoke all on public.unloop_videos from anon, authenticated;
grant all on public.unloop_videos to service_role;
alter table public.unloop_videos enable row level security;
-- No policies for anon or authenticated: every read and write goes through the
-- definer functions below, so a direct table request finds nothing.

-- ─────────────────────────────────────────────────────────────────────────────
-- Likes and saves
-- ─────────────────────────────────────────────────────────────────────────────

create table if not exists public.unloop_likes (
  user_id    uuid not null references auth.users (id) on delete cascade,
  video_id   uuid not null references public.unloop_videos (id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (user_id, video_id)
);
create index if not exists unloop_likes_video_idx on public.unloop_likes (video_id);

create table if not exists public.unloop_saves (
  user_id    uuid not null references auth.users (id) on delete cascade,
  video_id   uuid not null references public.unloop_videos (id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (user_id, video_id)
);
create index if not exists unloop_saves_user_idx on public.unloop_saves (user_id, created_at desc);
create index if not exists unloop_saves_video_idx on public.unloop_saves (video_id);

revoke all on public.unloop_likes, public.unloop_saves from anon, authenticated;
grant select, insert, delete on public.unloop_likes, public.unloop_saves to authenticated;
grant all on public.unloop_likes, public.unloop_saves to service_role;
alter table public.unloop_likes enable row level security;
alter table public.unloop_saves enable row level security;

-- Whether a video may be liked or saved: it exists and is published.
create or replace function public.unloop_video_is_live(p_video uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.unloop_videos v where v.id = p_video and v.status = 'published'
  );
$$;
revoke all on function public.unloop_video_is_live(uuid) from public, anon;
grant execute on function public.unloop_video_is_live(uuid) to authenticated;

drop policy if exists unloop_likes_select_own on public.unloop_likes;
create policy unloop_likes_select_own on public.unloop_likes
  for select to authenticated using (auth.uid() = user_id);
drop policy if exists unloop_likes_insert_own on public.unloop_likes;
create policy unloop_likes_insert_own on public.unloop_likes
  for insert to authenticated
  with check (auth.uid() = user_id and public.unloop_video_is_live(video_id));
drop policy if exists unloop_likes_delete_own on public.unloop_likes;
create policy unloop_likes_delete_own on public.unloop_likes
  for delete to authenticated using (auth.uid() = user_id);

drop policy if exists unloop_saves_select_own on public.unloop_saves;
create policy unloop_saves_select_own on public.unloop_saves
  for select to authenticated using (auth.uid() = user_id);
drop policy if exists unloop_saves_insert_own on public.unloop_saves;
create policy unloop_saves_insert_own on public.unloop_saves
  for insert to authenticated
  with check (auth.uid() = user_id and public.unloop_video_is_live(video_id));
drop policy if exists unloop_saves_delete_own on public.unloop_saves;
create policy unloop_saves_delete_own on public.unloop_saves
  for delete to authenticated using (auth.uid() = user_id);

-- ─────────────────────────────────────────────────────────────────────────────
-- The public read
-- ─────────────────────────────────────────────────────────────────────────────

-- Published videos, newest first, with measured counts and the caller's own state.
--   p_category  one category, or null for all of them
--   p_saved     only the caller's saved videos, most recently saved first
--   p_video     one video by id (a shared link), or null
create or replace function public.unloop_feed(
  p_category text default null,
  p_saved    boolean default false,
  p_video    uuid default null,
  p_limit    integer default 12,
  p_offset   integer default 0
)
returns table (
  id               uuid,
  title            text,
  description      text,
  category         text,
  video_path       text,
  thumbnail_path   text,
  duration_seconds numeric,
  published_at     timestamptz,
  likes            bigint,
  saves            bigint,
  liked            boolean,
  saved            boolean
)
language sql
stable
security definer
set search_path = ''
as $$
  select
    v.id, v.title, v.description, v.category, v.video_path, v.thumbnail_path,
    v.duration_seconds, v.published_at,
    (select count(*) from public.unloop_likes l where l.video_id = v.id),
    (select count(*) from public.unloop_saves s where s.video_id = v.id),
    exists (select 1 from public.unloop_likes l where l.video_id = v.id and l.user_id = auth.uid()),
    exists (select 1 from public.unloop_saves s where s.video_id = v.id and s.user_id = auth.uid())
  from public.unloop_videos v
  left join public.unloop_saves mine
    on p_saved and mine.video_id = v.id and mine.user_id = auth.uid()
  where v.status = 'published'
    and (p_category is null or v.category = p_category)
    and (p_video is null or v.id = p_video)
    and (not p_saved or mine.user_id is not null)
  order by
    case when p_saved then mine.created_at end desc nulls last,
    v.published_at desc,
    v.id
  limit least(greatest(coalesce(p_limit, 12), 1), 50)
  offset greatest(coalesce(p_offset, 0), 0);
$$;

comment on function public.unloop_feed(text, boolean, uuid, integer, integer) is
  'Published Unloop videos with measured like/save counts and the caller''s own liked/saved state.';
revoke all on function public.unloop_feed(text, boolean, uuid, integer, integer) from public;
grant execute on function public.unloop_feed(text, boolean, uuid, integer, integer) to anon, authenticated;

-- ─────────────────────────────────────────────────────────────────────────────
-- Admin: list, save (create or edit, draft or publish) and delete
-- ─────────────────────────────────────────────────────────────────────────────

create or replace function public.admin_unloop_videos(
  p_status text default null,
  p_limit  integer default 50,
  p_offset integer default 0
)
returns table (
  id               uuid,
  title            text,
  description      text,
  category         text,
  video_path       text,
  thumbnail_path   text,
  duration_seconds numeric,
  status           text,
  created_by       text,
  created_at       timestamptz,
  updated_at       timestamptz,
  published_at     timestamptz,
  likes            bigint,
  saves            bigint
)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  perform public.admin_guard_admin();
  return query
    select
      v.id, v.title, v.description, v.category, v.video_path, v.thumbnail_path,
      v.duration_seconds, v.status, p.username::text, v.created_at, v.updated_at,
      v.published_at,
      (select count(*) from public.unloop_likes l where l.video_id = v.id),
      (select count(*) from public.unloop_saves s where s.video_id = v.id)
    from public.unloop_videos v
    left join public.profiles p on p.id = v.created_by
    where p_status is null or v.status = p_status
    order by v.updated_at desc, v.id
    limit least(greatest(coalesce(p_limit, 50), 1), 101)
    offset greatest(coalesce(p_offset, 0), 0);
end;
$$;

-- Creates a video (p_id null) or edits one. Publishing stamps `published_at` the
-- first time; moving back to draft clears it. Answers the previous file paths so
-- the API can remove a file that was replaced.
create or replace function public.admin_unloop_save(
  p_id               uuid,
  p_title            text,
  p_description      text,
  p_category         text,
  p_video_path       text,
  p_thumbnail_path   text,
  p_duration_seconds numeric,
  p_status           text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor uuid := coalesce(public.admin_actor(), auth.uid());
  v_old   public.unloop_videos;
  v_id    uuid;
begin
  perform public.admin_guard_admin();

  if p_status not in ('draft', 'published') then
    raise exception 'status must be draft or published' using errcode = '22023';
  end if;
  if not exists (
    select 1 from storage.objects o where o.bucket_id = 'unloop' and o.name = p_video_path
  ) then
    raise exception 'the video file has not been uploaded' using errcode = '22023';
  end if;
  if p_thumbnail_path is not null and not exists (
    select 1 from storage.objects o where o.bucket_id = 'unloop' and o.name = p_thumbnail_path
  ) then
    raise exception 'the thumbnail has not been uploaded' using errcode = '22023';
  end if;

  if p_id is null then
    insert into public.unloop_videos as v (
      title, description, category, video_path, thumbnail_path, duration_seconds,
      status, created_by, published_at
    )
    values (
      btrim(p_title), btrim(coalesce(p_description, '')), p_category, p_video_path,
      p_thumbnail_path, p_duration_seconds, p_status, v_actor,
      case when p_status = 'published' then now() end
    )
    returning v.id into v_id;
    return jsonb_build_object(
      'id', v_id, 'status', p_status,
      'previousVideoPath', null, 'previousThumbnailPath', null
    );
  end if;

  select * into v_old from public.unloop_videos v where v.id = p_id for update;
  if not found then
    raise exception 'no such video' using errcode = 'P0002';
  end if;

  update public.unloop_videos v
     set title            = btrim(p_title),
         description      = btrim(coalesce(p_description, '')),
         category         = p_category,
         video_path       = p_video_path,
         thumbnail_path   = p_thumbnail_path,
         duration_seconds = p_duration_seconds,
         status           = p_status,
         updated_at       = now(),
         published_at     = case
           when p_status = 'draft' then null
           else coalesce(v_old.published_at, now())
         end
   where v.id = p_id;

  return jsonb_build_object(
    'id', p_id, 'status', p_status,
    'previousVideoPath', v_old.video_path,
    'previousThumbnailPath', v_old.thumbnail_path
  );
end;
$$;

-- Deletes a video with its likes and saves. Answers its file paths so the API can
-- remove the files.
create or replace function public.admin_unloop_delete(p_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_old public.unloop_videos;
begin
  perform public.admin_guard_admin();
  delete from public.unloop_videos v where v.id = p_id returning * into v_old;
  if not found then
    raise exception 'no such video' using errcode = 'P0002';
  end if;
  return jsonb_build_object(
    'id', v_old.id, 'videoPath', v_old.video_path, 'thumbnailPath', v_old.thumbnail_path
  );
end;
$$;

revoke all on function public.admin_unloop_videos(text, integer, integer) from public, anon;
revoke all on function public.admin_unloop_save(uuid, text, text, text, text, text, numeric, text) from public, anon;
revoke all on function public.admin_unloop_delete(uuid) from public, anon;
grant execute on function public.admin_unloop_videos(text, integer, integer) to authenticated;
grant execute on function public.admin_unloop_save(uuid, text, text, text, text, text, numeric, text) to authenticated;
grant execute on function public.admin_unloop_delete(uuid) to authenticated;

-- ── The service-role bridge ─────────────────────────────────────────────────

create or replace function public.admin_unloop_videos_svc(
  p_actor uuid, p_status text default null, p_limit integer default 50, p_offset integer default 0
)
returns table (
  id uuid, title text, description text, category text, video_path text,
  thumbnail_path text, duration_seconds numeric, status text, created_by text,
  created_at timestamptz, updated_at timestamptz, published_at timestamptz,
  likes bigint, saves bigint
)
language plpgsql
security definer
set search_path = ''
as $$
begin
  if p_actor is null then
    raise exception 'a verified actor is required' using errcode = '22023';
  end if;
  perform set_config('app.admin_bridge_actor', p_actor::text, true);
  return query select * from public.admin_unloop_videos(p_status, p_limit, p_offset);
end;
$$;

create or replace function public.admin_unloop_save_svc(
  p_actor uuid, p_id uuid, p_title text, p_description text, p_category text,
  p_video_path text, p_thumbnail_path text, p_duration_seconds numeric, p_status text
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
  return public.admin_unloop_save(
    p_id, p_title, p_description, p_category, p_video_path, p_thumbnail_path,
    p_duration_seconds, p_status
  );
end;
$$;

create or replace function public.admin_unloop_delete_svc(p_actor uuid, p_id uuid)
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
  return public.admin_unloop_delete(p_id);
end;
$$;

revoke all on function public.admin_unloop_videos_svc(uuid, text, integer, integer) from public, anon, authenticated;
revoke all on function public.admin_unloop_save_svc(uuid, uuid, text, text, text, text, text, numeric, text) from public, anon, authenticated;
revoke all on function public.admin_unloop_delete_svc(uuid, uuid) from public, anon, authenticated;
grant execute on function public.admin_unloop_videos_svc(uuid, text, integer, integer) to service_role;
grant execute on function public.admin_unloop_save_svc(uuid, uuid, text, text, text, text, text, numeric, text) to service_role;
grant execute on function public.admin_unloop_delete_svc(uuid, uuid) to service_role;

-- ─────────────────────────────────────────────────────────────────────────────
-- Storage
-- ─────────────────────────────────────────────────────────────────────────────

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'unloop',
  'unloop',
  true,
  100 * 1024 * 1024,
  array['video/mp4', 'video/webm', 'video/quicktime', 'image/jpeg', 'image/png', 'image/webp']
)
on conflict (id) do update
  set public = excluded.public,
      file_size_limit = excluded.file_size_limit,
      allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists "unloop_public_read" on storage.objects;
create policy "unloop_public_read"
  on storage.objects for select to anon, authenticated
  using (bucket_id = 'unloop');

-- An administrator with a database row may write directly (the caller-token path);
-- everyone else writes only through a signed URL the admin API minted.
drop policy if exists "unloop_admin_insert" on storage.objects;
create policy "unloop_admin_insert"
  on storage.objects for insert to authenticated
  with check (bucket_id = 'unloop' and public.is_admin());

drop policy if exists "unloop_admin_delete" on storage.objects;
create policy "unloop_admin_delete"
  on storage.objects for delete to authenticated
  using (bucket_id = 'unloop' and public.is_admin());
