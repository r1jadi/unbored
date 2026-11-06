-- What the admin console could only describe until now: featured placement, broadcast
-- announcements, and platform settings that take effect.
--
-- Each follows the console's existing shape: a row-gated function for moderators and a
-- `*_svc` wrapper, service_role only, for an allowlisted administrator who holds no
-- `user_roles` row (see 20261015120000_admin_service_bridge.sql).
--
-- Moderators can arrange featured games. Broadcasts reach every player and settings
-- change the platform for everyone, so both are administrator-only.
--
-- Apply before the client and the admin service.

-- ── Featured games ──────────────────────────────────────────────────────────────

create table if not exists public.featured_games (
  game_id  uuid primary key references public.games (id) on delete cascade,
  position integer not null,
  set_by   uuid references auth.users (id) on delete set null,
  set_at   timestamptz not null default now(),
  constraint featured_games_position_range check (position between 0 and 11)
);

alter table public.featured_games enable row level security;
revoke all on public.featured_games from public, anon, authenticated;
grant all on public.featured_games to service_role;

-- What players see: published games only, in the order staff chose.
create or replace function public.featured_game_slugs()
returns table (slug text)
language sql
stable
security definer
set search_path = ''
as $$
  select g.slug::text
    from public.featured_games f
    join public.games g on g.id = f.game_id and g.status = 'published'
   order by f.position;
$$;

revoke all on function public.featured_game_slugs() from public, anon, authenticated;
grant execute on function public.featured_game_slugs() to anon, authenticated;

create or replace function public.admin_featured_games()
returns table (
  game_id  uuid,
  slug     text,
  title    text,
  game_status text,
  "position" integer,
  set_by_username text,
  set_at   timestamptz
)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  perform public.admin_guard_staff();
  return query
  select f.game_id, g.slug::text, g.title, g.status::text, f.position, p.username::text, f.set_at
    from public.featured_games f
    join public.games g on g.id = f.game_id
    left join public.profiles p on p.id = f.set_by
   order by f.position;
end;
$$;

revoke all on function public.admin_featured_games() from public, anon, authenticated;
grant execute on function public.admin_featured_games() to authenticated;

-- Replaces the whole list in one transaction, so nobody ever reads half a reorder. The
-- audit trail records each game added or removed, and a reorder once.
create or replace function public.admin_set_featured_games(p_game_ids uuid[])
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor  uuid := coalesce(public.admin_actor(), auth.uid());
  v_ids    uuid[] := coalesce(p_game_ids, '{}');
  v_before uuid[];
begin
  perform public.admin_guard_staff();

  if cardinality(v_ids) > 12 then
    raise exception 'at most 12 games can be featured' using errcode = '22023';
  end if;
  if (select count(distinct x) from unnest(v_ids) x) <> cardinality(v_ids) then
    raise exception 'a game can only be featured once' using errcode = '22023';
  end if;
  if exists (
    select 1 from unnest(v_ids) x
     where not exists (
       select 1 from public.games g where g.id = x and g.status = 'published'
     )
  ) then
    raise exception 'only published games can be featured' using errcode = '22023';
  end if;

  select coalesce(array_agg(f.game_id order by f.position), '{}') into v_before
    from public.featured_games f;

  delete from public.featured_games where true;
  insert into public.featured_games (game_id, position, set_by)
  select x, ord - 1, v_actor
    from unnest(v_ids) with ordinality as t(x, ord);

  insert into public.moderation_actions (moderator_id, target_kind, target_id, action)
  select v_actor, 'game', x, 'feature_game'
    from unnest(v_ids) x where not (x = any (v_before));
  insert into public.moderation_actions (moderator_id, target_kind, target_id, action)
  select v_actor, 'game', x, 'unfeature_game'
    from unnest(v_before) x where not (x = any (v_ids));
  if v_before is distinct from v_ids
     and cardinality(v_ids) > 0
     and (select count(*) from unnest(v_ids) x where not (x = any (v_before))) = 0
     and (select count(*) from unnest(v_before) x where not (x = any (v_ids))) = 0 then
    insert into public.moderation_actions (moderator_id, target_kind, target_id, action)
    values (v_actor, 'game', v_ids[1], 'reorder_featured');
  end if;

  return jsonb_build_object('count', cardinality(v_ids));
end;
$$;

revoke all on function public.admin_set_featured_games(uuid[]) from public, anon, authenticated;
grant execute on function public.admin_set_featured_games(uuid[]) to authenticated;

-- ── Platform settings ───────────────────────────────────────────────────────────

create table if not exists public.platform_settings (
  id               boolean primary key default true,
  banner_text      text,
  comments_enabled boolean not null default true,
  messages_enabled boolean not null default true,
  updated_by       uuid references auth.users (id) on delete set null,
  updated_at       timestamptz not null default now(),
  constraint platform_settings_singleton check (id),
  constraint platform_settings_banner_length check (
    banner_text is null or char_length(banner_text) between 1 and 200
  )
);

insert into public.platform_settings (id) values (true) on conflict (id) do nothing;

create table if not exists public.platform_settings_log (
  id         uuid primary key default gen_random_uuid(),
  actor_id   uuid references auth.users (id) on delete set null,
  before     jsonb not null,
  after      jsonb not null,
  created_at timestamptz not null default now()
);

create index if not exists platform_settings_log_created_idx
  on public.platform_settings_log (created_at desc);

alter table public.platform_settings enable row level security;
alter table public.platform_settings_log enable row level security;
revoke all on public.platform_settings from public, anon, authenticated;
revoke all on public.platform_settings_log from public, anon, authenticated;
grant all on public.platform_settings, public.platform_settings_log to service_role;

-- What every visitor needs to draw the banner and the paused states. Nothing here is
-- private, and it names no staff member.
create or replace function public.public_platform_settings()
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object(
    'banner_text', s.banner_text,
    'comments_enabled', s.comments_enabled,
    'messages_enabled', s.messages_enabled
  )
  from public.platform_settings s
  where s.id;
$$;

revoke all on function public.public_platform_settings() from public, anon, authenticated;
grant execute on function public.public_platform_settings() to anon, authenticated;

create or replace function public.admin_platform_settings()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_result jsonb;
begin
  perform public.admin_guard_staff();
  select jsonb_build_object(
    'bannerText', s.banner_text,
    'commentsEnabled', s.comments_enabled,
    'messagesEnabled', s.messages_enabled,
    'updatedAt', s.updated_at,
    'updatedByUsername', p.username::text,
    'log', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', l.id,
        'actorUsername', a.username::text,
        'before', l.before,
        'after', l.after,
        'createdAt', l.created_at
      ) order by l.created_at desc)
      from (
        select * from public.platform_settings_log
         order by created_at desc
         limit 20
      ) l
      left join public.profiles a on a.id = l.actor_id
    ), '[]'::jsonb)
  ) into v_result
  from public.platform_settings s
  left join public.profiles p on p.id = s.updated_by
  where s.id;
  return v_result;
end;
$$;

revoke all on function public.admin_platform_settings() from public, anon, authenticated;
grant execute on function public.admin_platform_settings() to authenticated;

create or replace function public.admin_set_platform_settings(
  p_banner_text      text,
  p_comments_enabled boolean,
  p_messages_enabled boolean
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor  uuid := coalesce(public.admin_actor(), auth.uid());
  v_banner text := nullif(btrim(coalesce(p_banner_text, '')), '');
  v_before jsonb;
  v_after  jsonb;
begin
  perform public.admin_guard_admin();
  if p_comments_enabled is null or p_messages_enabled is null then
    raise exception 'every setting needs a value' using errcode = '22023';
  end if;
  if v_banner is not null and char_length(v_banner) > 200 then
    raise exception 'the banner is too long' using errcode = '22023';
  end if;

  v_before := public.public_platform_settings();
  update public.platform_settings s
     set banner_text = v_banner,
         comments_enabled = p_comments_enabled,
         messages_enabled = p_messages_enabled,
         updated_by = v_actor,
         updated_at = now()
   where s.id;
  v_after := public.public_platform_settings();

  if v_before is distinct from v_after then
    insert into public.platform_settings_log (actor_id, before, after)
    values (v_actor, v_before, v_after);
  end if;
  return v_after;
end;
$$;

revoke all on function public.admin_set_platform_settings(text, boolean, boolean) from public, anon, authenticated;
grant execute on function public.admin_set_platform_settings(text, boolean, boolean) to authenticated;

-- The switches, where they have to hold: on the tables themselves, so no client can
-- post around a hidden input. Reading and deleting stay open while they are off.
create or replace function public.guard_comments_enabled()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if exists (select 1 from public.platform_settings s where s.id and not s.comments_enabled) then
    raise exception 'comments are paused' using errcode = 'P0001', hint = 'comments_paused';
  end if;
  return new;
end;
$$;

revoke all on function public.guard_comments_enabled() from public, anon, authenticated;

drop trigger if exists comments_guard_enabled on public.comments;
create trigger comments_guard_enabled
  before insert on public.comments
  for each row execute function public.guard_comments_enabled();

create or replace function public.guard_messages_enabled()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if exists (select 1 from public.platform_settings s where s.id and not s.messages_enabled) then
    raise exception 'messages are paused' using errcode = 'P0001', hint = 'messages_paused';
  end if;
  return new;
end;
$$;

revoke all on function public.guard_messages_enabled() from public, anon, authenticated;

drop trigger if exists messages_guard_enabled on public.messages;
create trigger messages_guard_enabled
  before insert on public.messages
  for each row execute function public.guard_messages_enabled();

-- ── Broadcast announcements ─────────────────────────────────────────────────────

create table if not exists public.broadcasts (
  id         uuid primary key default gen_random_uuid(),
  title      text not null,
  body       text not null,
  link       text,
  sent_by    uuid references auth.users (id) on delete set null,
  recipients integer not null default 0,
  created_at timestamptz not null default now(),
  constraint broadcasts_title_length check (char_length(title) between 3 and 80),
  constraint broadcasts_body_length check (char_length(body) between 3 and 300),
  -- A path inside the app, so a broadcast can never send every player somewhere else.
  constraint broadcasts_link_internal check (
    link is null or (link ~ '^/[^/\\]' and char_length(link) <= 200)
  )
);

create index if not exists broadcasts_created_idx on public.broadcasts (created_at desc);
create index if not exists notifications_broadcast_idx
  on public.notifications ((payload ->> 'broadcast'))
  where payload ? 'broadcast';

alter table public.broadcasts enable row level security;
revoke all on public.broadcasts from public, anon, authenticated;
grant all on public.broadcasts to service_role;

-- Asks the push sender to run, once. The per-row trigger on notifications would call
-- it for every player, so a broadcast leaves that trigger out and comes here instead.
create or replace function public.wake_push_dispatch_once()
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_url    text;
  v_secret text;
begin
  if to_regprocedure('net.http_post(text,jsonb,jsonb,jsonb,integer)') is null
     or to_regclass('vault.decrypted_secrets') is null then
    return;
  end if;
  execute 'select decrypted_secret from vault.decrypted_secrets where name = $1 limit 1'
    into v_url using 'push_dispatch_url';
  execute 'select decrypted_secret from vault.decrypted_secrets where name = $1 limit 1'
    into v_secret using 'push_dispatch_secret';
  if v_url is null or v_secret is null then
    return;
  end if;
  execute 'select net.http_post(url := $1, headers := $2, body := ''{}''::jsonb)'
    using v_url, jsonb_build_object(
      'Authorization', 'Bearer ' || v_secret,
      'Content-Type', 'application/json'
    );
exception when others then
  raise warning 'wake_push_dispatch_once failed: %', sqlerrm;
end;
$$;

revoke all on function public.wake_push_dispatch_once() from public, anon, authenticated;
-- The sender calls this itself when a broadcast is larger than one of its runs.
grant execute on function public.wake_push_dispatch_once() to service_role;

create or replace function public.admin_send_broadcast(
  p_title text,
  p_body  text,
  p_link  text default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor      uuid := coalesce(public.admin_actor(), auth.uid());
  v_title      text := btrim(coalesce(p_title, ''));
  v_body       text := btrim(coalesce(p_body, ''));
  v_link       text := nullif(btrim(coalesce(p_link, '')), '');
  v_id         uuid;
  v_recipients integer;
begin
  perform public.admin_guard_admin();

  -- The same announcement twice in ten minutes is a double click, not a decision.
  if exists (
    select 1 from public.broadcasts b
     where b.title = v_title and b.body = v_body
       and b.created_at > now() - interval '10 minutes'
  ) then
    raise exception 'this announcement was just sent' using errcode = '23505';
  end if;

  insert into public.broadcasts (title, body, link, sent_by)
  values (v_title, v_body, v_link, v_actor)
  returning id into v_id;

  -- Marked as already pushed for anyone with no device to push to. The sender treats an
  -- empty batch as "nothing left", so those rows must not sit in its outbox ahead of
  -- the players who do have one.
  insert into public.notifications (user_id, kind, payload, push_sent_at)
  select
    p.id,
    'system',
    jsonb_build_object(
      'reason', 'announcement',
      'broadcast', v_id,
      'title', v_title,
      'text', v_body,
      'link', v_link
    ),
    case
      when exists (select 1 from public.push_subscriptions s where s.user_id = p.id) then null
      else now()
    end
  from public.profiles p
  left join public.user_preferences up on up.user_id = p.id
  where not p.is_suspended
    and coalesce(up.notify_announcements, true);
  get diagnostics v_recipients = row_count;

  update public.broadcasts b set recipients = v_recipients where b.id = v_id;
  perform public.wake_push_dispatch_once();

  return jsonb_build_object('id', v_id, 'recipients', v_recipients);
end;
$$;

revoke all on function public.admin_send_broadcast(text, text, text) from public, anon, authenticated;
grant execute on function public.admin_send_broadcast(text, text, text) to authenticated;

create or replace function public.admin_broadcasts(p_limit integer default 50, p_offset integer default 0)
returns table (
  id          uuid,
  title       text,
  body        text,
  link        text,
  sent_by_username text,
  recipients  integer,
  read_count  bigint,
  created_at  timestamptz
)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  perform public.admin_guard_staff();
  return query
  select
    b.id, b.title, b.body, b.link, p.username::text, b.recipients,
    (
      select count(*) from public.notifications n
       where n.payload ->> 'broadcast' = b.id::text
         and n.payload ? 'broadcast'
         and n.read_at is not null
    ),
    b.created_at
    from public.broadcasts b
    left join public.profiles p on p.id = b.sent_by
   order by b.created_at desc
   limit greatest(1, least(coalesce(p_limit, 50), 100))
  offset greatest(coalesce(p_offset, 0), 0);
end;
$$;

revoke all on function public.admin_broadcasts(integer, integer) from public, anon, authenticated;
grant execute on function public.admin_broadcasts(integer, integer) to authenticated;

-- The sender already skips anything it can't word; announcements are now among what it
-- can. Every other system row (a new game tells the app, not the lock screen) stays out.
create or replace function public.claim_push_batch(p_limit integer)
returns table (
  notification_id uuid,
  kind            text,
  payload         jsonb,
  subscription_id uuid,
  endpoint        text,
  p256dh          text,
  auth            text,
  language        text
)
language plpgsql
security definer
set search_path = ''
as $$
begin
  -- Yesterday's news is not worth waking a phone for, if the sender was down.
  update public.notifications n
     set push_sent_at = now()
   where n.push_sent_at is null
     and n.created_at <= now() - interval '1 day';

  return query
  with claimed as (
    update public.notifications n
       set push_sent_at = now()
     where n.id in (
       select p.id from public.notifications p
        where p.push_sent_at is null
        order by p.created_at
        limit greatest(1, least(coalesce(p_limit, 100), 200))
        for update skip locked
     )
    returning n.id, n.kind, n.payload, n.user_id
  )
  select c.id, c.kind::text, c.payload, s.id, s.endpoint, s.p256dh, s.auth, s.language
    from claimed c
    join public.push_subscriptions s on s.user_id = c.user_id
   where c.kind in ('follow', 'comment', 'score', 'message')
      or (c.kind = 'system' and c.payload ->> 'reason' = 'announcement');
end;
$$;

revoke all on function public.claim_push_batch(integer) from public, anon, authenticated;
grant execute on function public.claim_push_batch(integer) to service_role;

-- ── The bridge for an allowlisted administrator ─────────────────────────────────

create or replace function public.admin_featured_games_svc(p_actor uuid)
returns table (
  game_id uuid, slug text, title text, game_status text, "position" integer,
  set_by_username text, set_at timestamptz
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
  return query select * from public.admin_featured_games();
end;
$$;

create or replace function public.admin_set_featured_games_svc(p_actor uuid, p_game_ids uuid[])
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
  return public.admin_set_featured_games(p_game_ids);
end;
$$;

create or replace function public.admin_platform_settings_svc(p_actor uuid)
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
  return public.admin_platform_settings();
end;
$$;

create or replace function public.admin_set_platform_settings_svc(
  p_actor uuid,
  p_banner_text text,
  p_comments_enabled boolean,
  p_messages_enabled boolean
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
  return public.admin_set_platform_settings(p_banner_text, p_comments_enabled, p_messages_enabled);
end;
$$;

create or replace function public.admin_send_broadcast_svc(
  p_actor uuid,
  p_title text,
  p_body  text,
  p_link  text default null
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
  return public.admin_send_broadcast(p_title, p_body, p_link);
end;
$$;

create or replace function public.admin_broadcasts_svc(
  p_actor uuid,
  p_limit integer default 50,
  p_offset integer default 0
)
returns table (
  id uuid, title text, body text, link text, sent_by_username text,
  recipients integer, read_count bigint, created_at timestamptz
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
  return query select * from public.admin_broadcasts(p_limit, p_offset);
end;
$$;

revoke all on function public.admin_featured_games_svc(uuid) from public, anon, authenticated;
revoke all on function public.admin_set_featured_games_svc(uuid, uuid[]) from public, anon, authenticated;
revoke all on function public.admin_platform_settings_svc(uuid) from public, anon, authenticated;
revoke all on function public.admin_set_platform_settings_svc(uuid, text, boolean, boolean) from public, anon, authenticated;
revoke all on function public.admin_send_broadcast_svc(uuid, text, text, text) from public, anon, authenticated;
revoke all on function public.admin_broadcasts_svc(uuid, integer, integer) from public, anon, authenticated;

grant execute on function public.admin_featured_games_svc(uuid) to service_role;
grant execute on function public.admin_set_featured_games_svc(uuid, uuid[]) to service_role;
grant execute on function public.admin_platform_settings_svc(uuid) to service_role;
grant execute on function public.admin_set_platform_settings_svc(uuid, text, boolean, boolean) to service_role;
grant execute on function public.admin_send_broadcast_svc(uuid, text, text, text) to service_role;
grant execute on function public.admin_broadcasts_svc(uuid, integer, integer) to service_role;
