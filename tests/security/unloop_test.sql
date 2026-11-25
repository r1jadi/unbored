-- Unloop: who may read, publish, like and save videos.
--
-- Runs after the migrations on a throwaway database (scripts/test-rls.sh), and rolls
-- everything back. Each check raises on failure, so the file stops at the first one.

\set ON_ERROR_STOP on

begin;

do $$
begin
  if exists (select 1 from pg_roles where rolname = 'supabase_admin') then
    raise exception 'refusing to run against a hosted Supabase project';
  end if;
end $$;

create or replace function pg_temp.player(p_name text)
returns uuid language plpgsql as $$
declare
  v_id uuid := gen_random_uuid();
begin
  insert into auth.users (id, email, email_confirmed_at) values (v_id, p_name || '@example.com', now());
  insert into public.profiles (id, username, display_name) values (v_id, p_name, initcap(p_name))
  on conflict (id) do nothing;
  return v_id;
end;
$$;

create or replace function pg_temp.act_as(p_user uuid)
returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claims',
    jsonb_build_object('sub', p_user, 'role', 'authenticated')::text, true);
end;
$$;

-- Two uploaded files the videos can point at.
insert into storage.objects (bucket_id, name) values
  ('unloop', 'videos/11111111-aaaa-4aaa-8aaa-111111111111.mp4'),
  ('unloop', 'thumbnails/11111111-aaaa-4aaa-8aaa-111111111111.jpg'),
  ('unloop', 'videos/22222222-bbbb-4bbb-8bbb-222222222222.webm');

create temp table unloop_ids (name text primary key, id uuid, who uuid);
grant all on unloop_ids to authenticated, anon, service_role;

do $$
begin
  insert into unloop_ids values ('admin', null, pg_temp.player('unloop_admin'));
  insert into unloop_ids values ('player', null, pg_temp.player('unloop_player'));
  insert into unloop_ids values ('moderator', null, pg_temp.player('unloop_mod'));
  insert into public.user_roles (user_id, role)
    select who, 'admin' from unloop_ids where name = 'admin'
    on conflict (user_id) do update set role = excluded.role;
  insert into public.user_roles (user_id, role)
    select who, 'moderator' from unloop_ids where name = 'moderator'
    on conflict (user_id) do update set role = excluded.role;
end $$;

-- ── Publishing is for administrators only ──────────────────────────────────

do $$
declare
  v_player uuid := (select who from unloop_ids where name = 'player');
  v_mod    uuid := (select who from unloop_ids where name = 'moderator');
begin
  perform pg_temp.act_as(v_player);
  set local role authenticated;
  begin
    perform public.admin_unloop_save(null, 'Nope', '', 'highlights',
      'videos/11111111-aaaa-4aaa-8aaa-111111111111.mp4', null, 12, 'published');
    raise exception 'a player published a video';
  exception when insufficient_privilege then null;
  end;
  begin
    insert into public.unloop_videos (title, category, video_path)
    values ('Direct', 'highlights', 'videos/11111111-aaaa-4aaa-8aaa-111111111111.mp4');
    raise exception 'a player inserted a video row directly';
  exception when insufficient_privilege then null;
  end;
  reset role;

  perform pg_temp.act_as(v_mod);
  set local role authenticated;
  begin
    perform public.admin_unloop_save(null, 'Mod', '', 'highlights',
      'videos/11111111-aaaa-4aaa-8aaa-111111111111.mp4', null, 12, 'published');
    raise exception 'a moderator published a video';
  exception when insufficient_privilege then null;
  end;
  reset role;
  raise notice 'ok   players and moderators cannot publish, directly or through the function';
end $$;

do $$
declare
  v_admin uuid := (select who from unloop_ids where name = 'admin');
  v_result jsonb;
begin
  perform pg_temp.act_as(v_admin);
  set local role authenticated;
  v_result := public.admin_unloop_save(null, '  First loop ', 'A run', 'highlights',
    'videos/11111111-aaaa-4aaa-8aaa-111111111111.mp4',
    'thumbnails/11111111-aaaa-4aaa-8aaa-111111111111.jpg', 12.5, 'published');
  update unloop_ids set id = (v_result ->> 'id')::uuid where name = 'admin';
  v_result := public.admin_unloop_save(null, 'Draft loop', '', 'how-to',
    'videos/22222222-bbbb-4bbb-8bbb-222222222222.webm', null, null, 'draft');
  insert into unloop_ids values ('draft', (v_result ->> 'id')::uuid, null);

  begin
    perform public.admin_unloop_save(null, 'Ghost', '', 'highlights',
      'videos/33333333-cccc-4ccc-8ccc-333333333333.mp4', null, null, 'published');
    raise exception 'a video was saved without its file';
  exception when invalid_parameter_value then null;
  end;
  begin
    perform public.admin_unloop_save(null, 'Bad category', '', 'cats',
      'videos/11111111-aaaa-4aaa-8aaa-111111111111.mp4', null, null, 'published');
    raise exception 'an unknown category was accepted';
  exception when check_violation then null;
  end;
  reset role;

  if (select title from public.unloop_videos where id = (select id from unloop_ids where name = 'admin'))
     <> 'First loop' then
    raise exception 'the title was not trimmed';
  end if;
  if (select published_at from public.unloop_videos where id = (select id from unloop_ids where name = 'draft'))
     is not null then
    raise exception 'a draft has a publish time';
  end if;
  raise notice 'ok   an administrator publishes and drafts; missing files and unknown categories are refused';
end $$;

do $$
declare
  v_admin uuid := (select who from unloop_ids where name = 'admin');
begin
  perform set_config('request.jwt.claims', '{"role":"service_role"}', true);
  set local role service_role;
  if (select count(*) from public.admin_unloop_videos_svc(v_admin, null, 50, 0)) <> 2 then
    raise exception 'the bridge does not list both videos';
  end if;
  reset role;

  perform pg_temp.act_as((select who from unloop_ids where name = 'player'));
  set local role authenticated;
  begin
    perform public.admin_unloop_videos_svc(v_admin, null, 50, 0);
    raise exception 'a player called the service-role bridge';
  exception when insufficient_privilege then null;
  end;
  reset role;
  raise notice 'ok   the bridge serves service_role only';
end $$;

-- ── Watching ────────────────────────────────────────────────────────────────

do $$
declare
  v_published uuid := (select id from unloop_ids where name = 'admin');
  v_draft     uuid := (select id from unloop_ids where name = 'draft');
  v_rows      integer;
begin
  perform set_config('request.jwt.claims', '{"role":"anon"}', true);
  set local role anon;
  select count(*) into v_rows from public.unloop_feed();
  if v_rows <> 1 then
    raise exception 'a guest sees % videos; expected only the published one', v_rows;
  end if;
  if exists (select 1 from public.unloop_feed(null, false, v_draft)) then
    raise exception 'a guest opened a draft by id';
  end if;
  begin
    perform 1 from public.unloop_videos;
    raise exception 'a guest read the videos table directly';
  exception when insufficient_privilege then null;
  end;
  reset role;
  raise notice 'ok   guests see published videos only, through the feed';
end $$;

-- ── Likes and saves ─────────────────────────────────────────────────────────

do $$
declare
  v_player    uuid := (select who from unloop_ids where name = 'player');
  v_admin     uuid := (select who from unloop_ids where name = 'admin');
  v_published uuid := (select id from unloop_ids where name = 'admin');
  v_draft     uuid := (select id from unloop_ids where name = 'draft');
  v record;
begin
  perform pg_temp.act_as(v_player);
  set local role authenticated;
  insert into public.unloop_likes (user_id, video_id) values (v_player, v_published);
  insert into public.unloop_saves (user_id, video_id) values (v_player, v_published);
  begin
    insert into public.unloop_likes (user_id, video_id) values (v_player, v_published);
    raise exception 'a video was liked twice';
  exception when unique_violation then null;
  end;
  begin
    insert into public.unloop_likes (user_id, video_id) values (v_player, v_draft);
    raise exception 'a draft was liked';
  exception when insufficient_privilege then null;
  end;
  begin
    insert into public.unloop_saves (user_id, video_id) values (v_admin, v_published);
    raise exception 'a player saved a video for someone else';
  exception when insufficient_privilege then null;
  end;

  select * into v from public.unloop_feed(null, true);
  if v.id <> v_published or not v.liked or not v.saved or v.likes <> 1 or v.saves <> 1 then
    raise exception 'the saved feed is wrong: %', row_to_json(v);
  end if;
  reset role;

  perform pg_temp.act_as(v_admin);
  set local role authenticated;
  if exists (select 1 from public.unloop_saves) then
    raise exception 'one player can read another''s saves';
  end if;
  select * into v from public.unloop_feed();
  if v.liked or v.saved or v.likes <> 1 then
    raise exception 'another player''s feed shows the wrong state: %', row_to_json(v);
  end if;
  if exists (select 1 from public.unloop_feed(null, true)) then
    raise exception 'the saved filter shows videos the caller did not save';
  end if;
  reset role;
  raise notice 'ok   likes and saves are owner-scoped, single, and only on published videos';
end $$;

-- ── Unpublishing and deleting ───────────────────────────────────────────────

do $$
declare
  v_admin     uuid := (select who from unloop_ids where name = 'admin');
  v_published uuid := (select id from unloop_ids where name = 'admin');
  v_result    jsonb;
begin
  perform pg_temp.act_as(v_admin);
  set local role authenticated;
  v_result := public.admin_unloop_save(v_published, 'First loop', '', 'highlights',
    'videos/11111111-aaaa-4aaa-8aaa-111111111111.mp4', null, 12.5, 'draft');
  if v_result ->> 'previousThumbnailPath' <> 'thumbnails/11111111-aaaa-4aaa-8aaa-111111111111.jpg' then
    raise exception 'the replaced thumbnail was not reported: %', v_result;
  end if;
  reset role;

  perform set_config('request.jwt.claims', '{"role":"anon"}', true);
  set local role anon;
  if exists (select 1 from public.unloop_feed()) then
    raise exception 'an unpublished video is still in the feed';
  end if;
  reset role;

  perform pg_temp.act_as(v_admin);
  set local role authenticated;
  v_result := public.admin_unloop_delete(v_published);
  if v_result ->> 'videoPath' <> 'videos/11111111-aaaa-4aaa-8aaa-111111111111.mp4' then
    raise exception 'the deleted video''s file was not reported: %', v_result;
  end if;
  begin
    perform public.admin_unloop_delete(v_published);
    raise exception 'a deleted video was deleted again';
  exception when no_data_found then null;
  end;
  reset role;
  if exists (select 1 from public.unloop_likes where video_id = v_published) then
    raise exception 'likes outlived their video';
  end if;
  raise notice 'ok   unpublishing hides a video; deleting removes it with its likes';
end $$;

rollback;
